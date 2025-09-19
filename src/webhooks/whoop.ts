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

function capitalise(input?: string): string | undefined {
  if (!input) return undefined;
  return input.charAt(0).toUpperCase() + input.slice(1);
}

function normaliseSport(input?: string): string | undefined {
  if (!input) return undefined;
  const value = input.toLowerCase();
  if (value === 'lacrosse') return 'Kendama training';
  return capitalise(value);
}

function extractEventId(payload: any): string | undefined {
  return (
    payload?.id ??
    payload?.uuid ??
    payload?.sleep_id ??
    payload?.recovery_id ??
    payload?.workout_id ??
    payload?.cycle_id ??
    payload?.event_id ??
    payload?.data?.id ??
    payload?.data?.uuid
  )?.toString();
}

export class WhoopWebhook extends BaseWebhook {
  readonly source = 'whoop';

  protected setupRoutes(router: Router): void {
    const requireSignature = Boolean(this.settings.secret);
    const requireAuthToken = Boolean(this.settings.endpoints?.auth_token);
    this.registerEndpoint(router, 'post', '/whoop/sleep', this.handleSleep.bind(this), {
      eventType: 'sleep',
      requireSignature,
      requireAuthToken,
      extractEventId,
    });
    this.registerEndpoint(router, 'post', '/whoop/recovery', this.handleRecovery.bind(this), {
      eventType: 'recovery',
      requireSignature,
      requireAuthToken,
      extractEventId,
    });
    this.registerEndpoint(router, 'post', '/whoop/workout', this.handleWorkout.bind(this), {
      eventType: 'workout',
      requireSignature,
      requireAuthToken,
      extractEventId,
    });
  }

  private async handleSleep(ctx: WebhookContext): Promise<WebhookProcessResult> {
    const payload = ctx.payload;
    const start = payload?.start ?? payload?.start_time;
    const end = payload?.end ?? payload?.end_time;
    const duration = minutesBetween(start, end);
    const eventId = extractEventId(payload);

    const metrics: Record<string, number> = {};
    const avgHr = payload?.average_heart_rate ?? payload?.score?.average_heart_rate;
    const calories = payload?.calorie_burn ?? payload?.score?.calories_burned;
    const strain = payload?.score?.strain ?? payload?.strain;
    if (typeof strain === 'number') metrics.strain = strain;
    if (typeof avgHr === 'number') metrics.heart_rate_avg = avgHr;
    if (typeof calories === 'number') metrics.calories = calories;

    return {
      date: isoDateFrom(end ?? start),
      entries: [
        {
          name: 'Sleep session',
          category: 'activity',
          time: end ?? start,
          duration_minutes: duration,
          metrics: Object.keys(metrics).length ? metrics : undefined,
          notes: payload?.score?.stage_summary ? `Stages: ${JSON.stringify(payload.score.stage_summary)}` : undefined,
          metadata: {
            whoop_id: eventId,
            cycle_id: payload?.cycle_id ?? payload?.cycle?.id,
            sleep_id: payload?.id ?? payload?.sleep_id,
            recovery_score: payload?.score?.sleep_performance ?? payload?.sleep_performance_percentage,
          },
        },
      ],
      dedupeKey: eventId,
    };
  }

  private async handleRecovery(ctx: WebhookContext): Promise<WebhookProcessResult> {
    const payload = ctx.payload;
    const capturedAt = payload?.recorded_at ?? payload?.created_at;
    const eventId = extractEventId(payload);
    const recoveryScore = payload?.recovery_score ?? payload?.score ?? payload?.status;

    const metrics: Record<string, number> = {};
    if (typeof payload?.strain === 'number') metrics.strain = payload.strain;
    if (typeof payload?.resting_heart_rate === 'number') metrics.heart_rate_avg = payload.resting_heart_rate;

    return {
      date: isoDateFrom(capturedAt),
      entries: [
        {
          name: 'WHOOP Recovery',
          category: 'note',
          time: capturedAt,
          metrics: Object.keys(metrics).length ? metrics : undefined,
          notes: typeof recoveryScore === 'number' ? `Recovery ${recoveryScore}%` : recoveryScore,
          metadata: {
            whoop_id: eventId,
            recovery_score: recoveryScore,
            hrv: payload?.heart_rate_variability ?? payload?.hrv,
            sleep_need: payload?.sleep_need,
          },
        },
      ],
      dedupeKey: eventId,
    };
  }

  private async handleWorkout(ctx: WebhookContext): Promise<WebhookProcessResult> {
    const payload = ctx.payload;
    const start = payload?.start ?? payload?.start_time;
    const end = payload?.end ?? payload?.end_time;
    const duration = minutesBetween(start, end);
    const eventId = extractEventId(payload);

    const sportName = normaliseSport(payload?.sport ?? payload?.sport_type ?? payload?.segment_type);
    const name = sportName ? sportName : 'Workout';

    const metrics: Record<string, number> = {};
    if (typeof payload?.strain === 'number') metrics.strain = payload.strain;
    const avgHr = payload?.average_heart_rate ?? payload?.heart_rate_avg;
    if (typeof avgHr === 'number') metrics.heart_rate_avg = avgHr;
    const calories = payload?.calorie_burn ?? payload?.calories;
    if (typeof calories === 'number') metrics.calories = calories;
    if (typeof payload?.reps === 'number') metrics.reps = payload.reps;
    if (typeof payload?.sets === 'number') metrics.sets = payload.sets;

    return {
      date: isoDateFrom(end ?? start),
      entries: [
        {
          name,
          category: 'activity',
          time: start,
          duration_minutes: duration,
          metrics: Object.keys(metrics).length ? metrics : undefined,
          notes: payload?.notes ?? payload?.description,
          metadata: {
            whoop_id: eventId,
            sport: payload?.sport,
            intensity_zones: payload?.intensity_zones,
            score: payload?.score,
          },
        },
      ],
      dedupeKey: eventId,
    };
  }
}
