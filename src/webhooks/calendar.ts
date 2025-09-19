import type { Router } from 'express';
import { BaseWebhook, type WebhookContext, type WebhookProcessResult } from './base.js';

function isoDateFrom(input?: string): string {
  const date = input ? new Date(input) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function minutesBetween(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return undefined;
  return Math.round((e.getTime() - s.getTime()) / 60000);
}

function eventIdFrom(payload: any): string | undefined {
  return (payload?.id ?? payload?.eventId ?? payload?.data?.id)?.toString();
}

export class CalendarWebhook extends BaseWebhook {
  readonly source = 'calendar';

  protected setupRoutes(router: Router): void {
    this.registerEndpoint(router, 'post', '/calendar/event', this.handleEvent.bind(this), {
      eventType: 'event',
      requireSignature: Boolean(this.settings?.secret),
      requireAuthToken: true,
      extractEventId: eventIdFrom,
    });
  }

  private async handleEvent(ctx: WebhookContext): Promise<WebhookProcessResult> {
    const payload = ctx.payload;
    const start = payload?.start ?? payload?.startTime ?? payload?.start_date;
    const end = payload?.end ?? payload?.endTime ?? payload?.end_date;
    const title = payload?.title ?? payload?.summary ?? 'Calendar Event';
    const calendarId = payload?.calendarId ?? payload?.calendar_id;
    const status = payload?.status ?? payload?.data?.status;

    const duration_minutes = minutesBetween(start, end);
    const eventId = eventIdFrom(payload);

    return {
      date: isoDateFrom(start ?? end),
      entries: [
        {
          name: title,
          category: 'activity',
          time: start,
          duration_minutes,
          notes: status,
          metadata: {
            calendar_id: calendarId,
            event_id: eventId,
            location: payload?.location,
            attendees: payload?.attendees,
          },
        },
      ],
      dedupeKey: eventId,
    };
  }
}
