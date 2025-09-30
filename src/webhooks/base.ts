import crypto from 'node:crypto';
import type { Router, Request, Response } from 'express';
import type { Logger } from '../utils/logger.js';
import { DailyStore, type DailyEntry, type DailyTotals, type DailyDayBase } from '../utils/daily.js';
import type { AppConfig } from '../utils/config.js';
import type { WebhookSourceConfig } from '../utils/webhook-config.js';
import { WebhookEventLogger } from '../utils/webhook-events.js';
import { WebhookDeduper } from '../utils/webhook-dedupe.js';
import { WebhookStore } from '../utils/webhook-store.js';
import type { AttentionPipeline, RawAttentionEvent } from '../attention/index.js';
import { PACIFIC_TIME_ZONE, pacificNowIso, toPacificDate, toPacificIso } from '../utils/time.js';

const pacificHourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

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
  private readonly archive: WebhookStore;
  private readonly attentionPipeline?: AttentionPipeline;

  constructor(opts: {
    logger: Logger;
    config: AppConfig;
    store: DailyStore;
    settings: WebhookSourceConfig;
    eventLogger: WebhookEventLogger;
    deduper: WebhookDeduper;
    debug?: boolean;
    attentionPipeline?: AttentionPipeline;
  }) {
    this.logger = opts.logger;
    this.config = opts.config;
    this.store = opts.store;
    this.settings = opts.settings;
    this.eventLogger = opts.eventLogger;
    this.deduper = opts.deduper;
    this.debug = Boolean(opts.debug);
    this.archive = new WebhookStore(opts.config.DATA_DIR, this.logger.child({ component: 'webhook-archive' }));
    this.attentionPipeline = opts.attentionPipeline;
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
            this.logger.info({ source: this.source, eventType: options.eventType, dedupeKey }, 'Duplicate webhook event ignored (memory cache)');
            continue;
          }

          const eventDate = result.date ?? this.deriveDateFromResult(result) ?? toPacificDate(new Date());
          const enrichment = this.applyEntryEnrichment(result, eventDate, options.eventType);

          if (dedupeKey && eventDate && (await this.archive.hasEvent(eventDate, dedupeKey, this.source, options.eventType))) {
            this.logger.info({ source: this.source, eventType: options.eventType, dedupeKey, eventDate }, 'Duplicate webhook event ignored (archive)');
            continue;
          }

          await this.eventLogger.record(this.source, options.eventType, ctx.payload, dedupeKey, {
            path,
            method,
            eventDate,
            timeOfDay: enrichment.primaryTimeOfDay,
          });

          if (this.attentionPipeline) {
            await this.runAttentionPipeline({
              source: this.source,
              kind: options.eventType,
              payload: ctx.payload,
              dedupeKey,
              receivedAt: pacificNowIso(),
              correlationId: (req as any).id ?? req.header('x-request-id') ?? undefined,
              metadata: {
                path,
                method,
                eventDate,
                enrichment,
                webhookMetadata: result.metadata,
              },
            });
          }

          if (!result.skipStore) {
            await this.persistToDaily(result, dedupeKey, options.eventType, enrichment);
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

  private async runAttentionPipeline(event: RawAttentionEvent): Promise<void> {
    if (!this.attentionPipeline) {
      return;
    }
    try {
      const outcome = await this.attentionPipeline.process(event);
      this.logger.debug(
        {
          source: event.source,
          kind: event.kind,
          outcome: outcome.outcome,
          score: outcome.classification.urgencyScore,
        },
        'Attention pipeline processed webhook event',
      );
    } catch (err) {
      this.logger.error({ err, source: event.source, kind: event.kind }, 'Attention pipeline processing failed');
    }
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

  private async persistToDaily(
    result: WebhookProcessResult,
    dedupeKey: string | undefined,
    eventType: string,
    enrichment: EntryEnrichment
  ): Promise<void> {
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
      ...(enrichment.primaryTimeOfDay ? { webhook_time_of_day: enrichment.primaryTimeOfDay } : {}),
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

  private applyEntryEnrichment(result: WebhookProcessResult, date: string, eventType: string): EntryEnrichment {
    const entries = result.entries ?? [];
    let primaryTimeOfDay: string | undefined;
    const tagSet = new Set<string>();

    result.entries = entries.map(entry => {
      const normalized: DailyEntry = {
        ...entry,
        tags: entry.tags ? [...entry.tags] : undefined,
        metadata: entry.metadata ? { ...entry.metadata } : undefined,
      };

      const enrichment = this.normalizeEntryTime(date, normalized.time, normalized.metadata);
      if (enrichment.time) normalized.time = enrichment.time;
      if (enrichment.isoTime) {
        normalized.metadata = { ...(normalized.metadata ?? {}), normalized_time_iso: enrichment.isoTime };
      }
      if (enrichment.timeOfDay) {
        normalized.metadata = { ...(normalized.metadata ?? {}), time_of_day: enrichment.timeOfDay };
        if (!primaryTimeOfDay) primaryTimeOfDay = enrichment.timeOfDay;
        tagSet.add(enrichment.timeOfDay);
      }

      const template = this.buildTemplate(normalized, eventType);
      if (template) {
        normalized.metadata = {
          ...(normalized.metadata ?? {}),
          template_type: template.type,
          template: template.payload,
        };
      }

      if (normalized.tags) {
        normalized.tags = Array.from(new Set(normalized.tags.map(tag => tag.trim()).filter(Boolean)));
      }
      if (enrichment.timeOfDay) {
        normalized.tags = Array.from(new Set([...(normalized.tags ?? []), enrichment.timeOfDay]));
      }

      return normalized;
    });

    return {
      primaryTimeOfDay,
      tags: Array.from(tagSet),
    };
  }

  private normalizeEntryTime(
    date: string,
    rawTime: string | undefined,
    metadata?: Record<string, unknown>
  ): { time?: string; isoTime?: string; timeOfDay?: string } {
    if (!rawTime) return {};
    const trimmed = rawTime.trim();
    const candidates = [trimmed];
    if (!trimmed.includes('T')) {
      if (/^\d{1,2}:\d{2}(?::\d{2})?\s*(am|pm)?$/i.test(trimmed)) {
        candidates.push(`${date} ${trimmed}`);
        candidates.push(`${date}T${trimmed}`);
      } else {
        candidates.push(`${date}T${trimmed}`);
      }
    }

    let parsed: Date | undefined;
    for (const candidate of candidates) {
      const d = new Date(candidate);
      if (!Number.isNaN(d.getTime())) {
        parsed = d;
        break;
      }
    }

    if (!parsed) {
      if (metadata) metadata.original_time = trimmed;
      return { time: trimmed };
    }

    const iso = toPacificIso(parsed);
    const parts = pacificHourFormatter.formatToParts(parsed);
    const hourStr = parts.find(part => part.type === 'hour')?.value ?? '00';
    const minuteStr = parts.find(part => part.type === 'minute')?.value ?? '00';
    const normalizedTime = `${hourStr.padStart(2, '0')}:${minuteStr.padStart(2, '0')}`;
    const hourNum = Number.parseInt(hourStr, 10);
    const timeOfDay = this.resolveTimeOfDay(Number.isNaN(hourNum) ? 0 : hourNum);
    return { time: normalizedTime, isoTime: iso, timeOfDay };
  }

  private resolveTimeOfDay(hour: number): string {
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  private buildTemplate(
    entry: DailyEntry,
    eventType: string
  ): { type: string; payload: Record<string, unknown> } | undefined {
    const category = (entry.category ?? '').toLowerCase();
    if (['activity', 'training', 'workout'].includes(category)) {
      return {
        type: 'activity_event',
        payload: {
          type: category,
          duration_minutes: entry.duration_minutes,
          intensity: entry.metrics?.strain ?? entry.metrics?.heart_rate_avg,
          location: entry.metadata?.location,
          metrics: entry.metrics,
        },
      };
    }
    if (['food', 'drink', 'supplement', 'snack'].includes(category)) {
      return {
        type: 'nutrition_event',
        payload: {
          meal_type: entry.meal ?? category,
          items: entry.metadata?.items ?? [{ name: entry.name, quantity: entry.quantity }].filter(Boolean),
          macros: entry.macros,
          time: entry.time,
          photo_url: entry.metadata?.photo_url,
        },
      };
    }
    if (['note', 'context'].includes(category) || eventType === 'context') {
      return {
        type: 'context_event',
        payload: {
          location: entry.metadata?.location,
          weather: entry.metadata?.weather,
          movement_type: entry.metadata?.movement_type,
          battery_percent: entry.metadata?.battery_percent,
          calendar_next: entry.metadata?.calendar_next,
        },
      };
    }
    return undefined;
  }

  private deriveDateFromResult(result: WebhookProcessResult): string | undefined {
    if (result.date) return result.date;
    const firstEntry = result.entries?.[0];
    if (firstEntry?.time) {
      const parsed = new Date(firstEntry.time);
      if (!Number.isNaN(parsed.getTime())) {
        return toPacificDate(parsed);
      }
    }
    return undefined;
  }
}

interface EntryEnrichment {
  primaryTimeOfDay?: string;
  tags: string[];
}
