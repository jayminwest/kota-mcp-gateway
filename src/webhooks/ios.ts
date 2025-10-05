import type { Router } from 'express';
import { z } from 'zod';
import { BaseWebhook, type WebhookContext, type WebhookProcessResult } from './base.js';
import { toPacificDate } from '../utils/time.js';
import { ContextSnapshotService, type ContextSnapshotRecord } from '../utils/context-snapshots.js';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface ManualPayload {
  date?: string;
  time?: string;
  name?: string;
  category?: string;
  duration_minutes?: number;
  metrics?: Record<string, number>;
  notes?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

function parsePayload(ctx: WebhookContext): ManualPayload {
  if (!ctx.payload || typeof ctx.payload !== 'object') {
    throw new Error('Invalid payload');
  }
  return ctx.payload as ManualPayload;
}

function resolveDate(payload: ManualPayload): string {
  const value = payload.date ?? toPacificDate(new Date());
  if (!ISO_DATE_REGEX.test(value)) {
    throw new Error('Date must be in YYYY-MM-DD format');
  }
  return value;
}

const ContextSnapshotSchema = z
  .object({
    timestamp: z.union([z.string(), z.number(), z.date()]),
    location: z.any().optional(),
    weather: z.any().optional(),
  })
  .passthrough();

type ContextSnapshotWebhookPayload = z.infer<typeof ContextSnapshotSchema>;

function parseContextSnapshotPayload(ctx: WebhookContext): ContextSnapshotWebhookPayload {
  const payload = ctx.payload;
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload');
  }
  const parsed = ContextSnapshotSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Invalid context snapshot payload: ${parsed.error.message}`);
  }
  return parsed.data;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export class IOSWebhook extends BaseWebhook {
  readonly source = 'ios';
  private readonly contextSnapshots: ContextSnapshotService;

  constructor(opts: ConstructorParameters<typeof BaseWebhook>[0]) {
    super(opts);
    this.contextSnapshots = new ContextSnapshotService({
      config: opts.config,
      logger: opts.logger.child({ component: 'context-snapshot-service' }),
    });
  }

  protected setupRoutes(router: Router): void {
    const requireSignature = Boolean(this.settings.secret);
    const requireAuthToken = Boolean(this.settings.endpoints?.auth_token);

    this.registerEndpoint(router, 'post', '/ios/note', this.handleNote.bind(this), {
      eventType: 'note',
      requireSignature,
      requireAuthToken,
      extractEventId: payload => payload?.id?.toString(),
    });

    this.registerEndpoint(router, 'post', '/ios/activity', this.handleActivity.bind(this), {
      eventType: 'activity',
      requireSignature,
      requireAuthToken,
      extractEventId: payload => payload?.id?.toString(),
    });

    this.registerEndpoint(router, 'post', '/ios/food', this.handleFood.bind(this), {
      eventType: 'food',
      requireSignature,
      requireAuthToken,
      extractEventId: payload => payload?.id?.toString(),
    });

    this.registerEndpoint(router, 'post', '/ios/context-snapshot', this.handleContextSnapshot.bind(this), {
      eventType: 'context_snapshot',
      requireSignature,
      requireAuthToken,
      extractEventId: payload => payload?.id?.toString(),
    });
  }

  private async handleNote(ctx: WebhookContext): Promise<WebhookProcessResult> {
    const payload = parsePayload(ctx);
    const date = resolveDate(payload);
    const name = payload.name || 'Note';
    return {
      date,
      entries: [
        {
          name,
          category: payload.category ?? 'note',
          time: payload.time,
          notes: payload.notes,
          tags: payload.tags,
          metadata: payload.metadata,
          metrics: payload.metrics,
          source: 'ios_webhook',
        },
      ],
      dedupeKey: ctx.payload?.id?.toString(),
    };
  }

  private async handleActivity(ctx: WebhookContext): Promise<WebhookProcessResult> {
    const payload = parsePayload(ctx);
    const date = resolveDate(payload);
    const name = payload.name || 'Activity';
    return {
      date,
      entries: [
        {
          name,
          category: payload.category ?? 'activity',
          time: payload.time,
          duration_minutes: payload.duration_minutes,
          notes: payload.notes,
          tags: payload.tags,
          metadata: payload.metadata,
          metrics: payload.metrics,
          source: 'ios_webhook',
        },
      ],
      dedupeKey: ctx.payload?.id?.toString(),
    };
  }

  private async handleFood(ctx: WebhookContext): Promise<WebhookProcessResult> {
    const payload = parsePayload(ctx);
    const date = resolveDate(payload);
    const name = payload.name || 'Food item';
    return {
      date,
      entries: [
        {
          name,
          category: payload.category ?? 'food',
          time: payload.time,
          notes: payload.notes,
          tags: payload.tags,
          metadata: payload.metadata,
          metrics: payload.metrics,
          source: 'ios_webhook',
        },
      ],
      dedupeKey: ctx.payload?.id?.toString(),
    };
  }

  private async handleContextSnapshot(ctx: WebhookContext): Promise<WebhookProcessResult> {
    const parsed = parseContextSnapshotPayload(ctx);
    const { timestamp, location, weather, ...rest } = parsed as Record<string, unknown>;

    const extras = Object.keys(rest).length ? rest : undefined;
    const snapshot = await this.contextSnapshots.collect({
      timestamp: timestamp as string | number | Date,
      location: isPlainObject(location) ? (location as Record<string, unknown>) : null,
      weather: isPlainObject(weather) ? (weather as Record<string, unknown>) : null,
      extras: extras && isPlainObject(extras) ? (extras as Record<string, unknown>) : extras,
      raw: isPlainObject(ctx.payload) ? (ctx.payload as Record<string, unknown>) : undefined,
    });

    await this.contextSnapshots.append(snapshot);

    const snapshotDate = this.resolveSnapshotDate(snapshot);

    return {
      date: snapshotDate,
      metadata: {
        contextSnapshot: true,
        errors: snapshot.errors,
      },
      responseBody: { status: 'ok', snapshot },
      skipStore: true,
      statusCode: 200,
    };
  }

  private resolveSnapshotDate(snapshot: ContextSnapshotRecord): string {
    try {
      return toPacificDate(snapshot.capturedAt);
    } catch {
      return toPacificDate(new Date());
    }
  }
}
