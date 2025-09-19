import crypto from 'node:crypto';
import type { Router, Request, Response } from 'express';
import type { Logger } from '../utils/logger.js';
import { DailyStore, type DailyEntry, type DailyTotals, type DailyDayBase } from '../utils/daily.js';
import type { AppConfig } from '../utils/config.js';
import type { WebhookSourceConfig } from '../utils/webhook-config.js';
import { WebhookEventLogger } from '../utils/webhook-events.js';
import { WebhookDeduper } from '../utils/webhook-dedupe.js';

export interface WebhookContext {
  req: Request;
  res: Response;
  config: AppConfig;
  settings: WebhookSourceConfig;
  rawBody?: Buffer;
  payload: any;
}

export interface WebhookProcessResult extends Partial<Omit<DailyDayBase, 'entries'>> {
  date: string;
  entries?: DailyEntry[];
  totals?: DailyTotals;
  metadata?: Record<string, unknown>;
  responseBody?: unknown;
  statusCode?: number;
  dedupeKey?: string;
  eventId?: string;
  skipStore?: boolean;
}

interface RegisterOptions {
  eventType: string;
  requireSignature?: boolean;
  requireAuthToken?: boolean;
  extractEventId?: (payload: any, req: Request) => string | undefined;
}

export abstract class BaseWebhook {
  protected readonly logger: Logger;
  protected readonly config: AppConfig;
  protected readonly store: DailyStore;
  protected readonly settings: WebhookSourceConfig;
  private readonly eventLogger: WebhookEventLogger;
  private readonly deduper: WebhookDeduper;
  private readonly debug: boolean;

  constructor(opts: {
    logger: Logger;
    config: AppConfig;
    store: DailyStore;
    settings: WebhookSourceConfig;
    eventLogger: WebhookEventLogger;
    deduper: WebhookDeduper;
    debug?: boolean;
  }) {
    this.logger = opts.logger;
    this.config = opts.config;
    this.store = opts.store;
    this.settings = opts.settings;
    this.eventLogger = opts.eventLogger;
    this.deduper = opts.deduper;
    this.debug = Boolean(opts.debug);
  }

  abstract readonly source: string;

  protected abstract setupRoutes(router: Router): void;

  register(router: Router): void {
    if (!this.settings?.enabled) {
      this.logger.info({ source: this.source }, 'Webhook source disabled; routes not registered');
      return;
    }
    this.setupRoutes(router);
  }

  protected registerEndpoint(
    router: Router,
    method: 'post' | 'put',
    path: string,
    handler: (ctx: WebhookContext) => Promise<WebhookProcessResult | WebhookProcessResult[] | void>,
    options: RegisterOptions
  ): void {
    const wrapped = async (req: Request, res: Response) => {
      try {
        const rawBody = (req as any).rawBody as Buffer | undefined;
        const payload = (req as any).body ?? {};

        const ctx: WebhookContext = {
          req,
          res,
          config: this.config,
          settings: this.settings,
          rawBody,
          payload,
        };

        if (this.debug) {
          this.logger.debug({ source: this.source, path, payload }, 'Webhook payload received');
        }

        if (options.requireAuthToken) {
          this.verifyAuthToken(ctx);
        }

        if (options.requireSignature) {
          this.verifySignature(ctx, options.eventType);
        }

        const results = await handler(ctx);

        if (results === undefined) {
          res.status(204).end();
          return;
        }

        const normalizedResults = Array.isArray(results) ? results : [results];
        let processed = false;
        for (const result of normalizedResults) {
          if (!result) continue;
          const dedupeKey = result.dedupeKey ?? options.extractEventId?.(ctx.payload, ctx.req) ?? result.eventId;
          if (dedupeKey && this.deduper.has(`${this.source}:${dedupeKey}`)) {
            this.logger.info({ source: this.source, eventType: options.eventType, dedupeKey }, 'Duplicate webhook event ignored');
            continue;
          }

          await this.eventLogger.record(this.source, options.eventType, ctx.payload, dedupeKey, {
            path,
            method,
          });

          if (!result.skipStore) {
            await this.persistToDaily(result, dedupeKey, options.eventType);
          }
          processed = true;
        }

        if (!processed) {
          res.status(202).json({ status: 'skipped' });
          return;
        }

        const first = normalizedResults.find(Boolean);
        const status = first?.statusCode ?? 200;
        res.status(status).json(first?.responseBody ?? { status: 'ok' });
      } catch (err) {
        this.logger.error({ err, source: this.source, path }, 'Webhook handler error');
        res.status(500).json({ error: 'webhook_handler_error', message: (err as Error).message });
      }
    };

    (router as any)[method](path, wrapped);
  }

  private verifySignature(ctx: WebhookContext, eventType: string): void {
    const secret = this.settings?.secret;
    if (!secret) {
      this.logger.warn({ source: this.source }, 'Signature verification requested but no secret configured');
      return;
    }
    const signatureHeader = this.settings?.signature_header ?? 'x-webhook-signature';
    const provided = ctx.req.header(signatureHeader);
    if (!provided) {
      throw new Error('Missing webhook signature header');
    }
    if (!ctx.rawBody) {
      throw new Error('Missing raw body for signature verification');
    }
    let payload = ctx.rawBody;
    const timestampHeader = this.settings?.signature_timestamp_header;
    if (timestampHeader) {
      const timestamp = ctx.req.header(timestampHeader);
      if (!timestamp) {
        throw new Error('Missing webhook signature timestamp header');
      }
      payload = Buffer.concat([Buffer.from(timestamp), ctx.rawBody]);
    }
    const digest = crypto.createHmac('sha256', secret).update(payload).digest();
    const hex = digest.toString('hex');
    const base64 = digest.toString('base64');
    if (provided !== hex && provided !== base64) {
      throw new Error(`Invalid webhook signature for ${eventType}`);
    }
  }

  private verifyAuthToken(ctx: WebhookContext): void {
    const expected = this.settings?.endpoints?.auth_token;
    if (!expected) {
      throw new Error('Webhook auth token required but not configured');
    }
    const header = ctx.req.header('authorization') || ctx.req.header('Authorization');
    if (!header) {
      throw new Error('Missing Authorization header');
    }
    const token = header.replace(/^Bearer\s+/i, '').trim();
    if (token !== expected) {
      throw new Error('Invalid webhook auth token');
    }
  }

  private async persistToDaily(result: WebhookProcessResult, dedupeKey: string | undefined, eventType: string): Promise<void> {
    if (!result.date) {
      throw new Error('Webhook result missing date');
    }

    const entries = (result.entries ?? []).map(entry => ({
      ...entry,
      source: entry.source ?? `${this.source}_webhook`,
    }));

    const metadata = {
      ...(result.metadata ?? {}),
      webhook_source: this.source,
      webhook_event_type: eventType,
      ...(dedupeKey ? { webhook_dedupe_key: dedupeKey } : {}),
    };

    await this.store.appendEntries({
      date: result.date,
      timezone: result.timezone,
      summary: result.summary,
      notes: result.notes,
      entries,
      totals: result.totals,
      rawText: result.rawText,
      metadata,
    });
  }
}
