import type { Router } from 'express';
import { BaseWebhook, type WebhookContext, type WebhookProcessResult } from './base.js';

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
  const value = payload.date ?? new Date().toISOString().slice(0, 10);
  if (!ISO_DATE_REGEX.test(value)) {
    throw new Error('Date must be in YYYY-MM-DD format');
  }
  return value;
}

export class IOSWebhook extends BaseWebhook {
  readonly source = 'ios';

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
}

