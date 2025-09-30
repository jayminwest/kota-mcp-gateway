import type { Router } from 'express';
import { BaseWebhook, type WebhookContext, type WebhookProcessResult } from './base.js';
import { WhoopClient } from '../utils/whoop.js';
import { toPacificDate } from '../utils/time.js';

function isoDateFrom(input?: string): string {
  try {
    const value = input ? new Date(input) : new Date();
    return toPacificDate(value);
  } catch {
    return toPacificDate(new Date());
  }
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

type WhoopResourceKind = 'sleep' | 'recovery' | 'workout';

interface HydratedEvent {
  kind: WhoopResourceKind;
  payload: any;
  record: any;
  eventId?: string;
  rawType?: string;
  hydrated: boolean;
  kindMismatch: boolean;
  originalPayload: any;
}

export class WhoopWebhook extends BaseWebhook {
  readonly source = 'whoop';
  private readonly whoopClient: WhoopClient;

  constructor(opts: ConstructorParameters<typeof BaseWebhook>[0]) {
    super(opts);
    this.whoopClient = new WhoopClient(this.config);
  }

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
    const hydration = await this.hydratePayload(ctx, 'sleep');
    ctx.payload = this.composeAttentionPayload(hydration);
    return this.buildResultFromHydration(hydration);
  }

  private async handleRecovery(ctx: WebhookContext): Promise<WebhookProcessResult> {
    const hydration = await this.hydratePayload(ctx, 'recovery');
    ctx.payload = this.composeAttentionPayload(hydration);
    return this.buildResultFromHydration(hydration);
  }

  private async handleWorkout(ctx: WebhookContext): Promise<WebhookProcessResult> {
    const hydration = await this.hydratePayload(ctx, 'workout');
    ctx.payload = this.composeAttentionPayload(hydration);
    return this.buildResultFromHydration(hydration);
  }

  private buildResultFromHydration(h: HydratedEvent): WebhookProcessResult {
    switch (h.kind) {
      case 'sleep':
        return this.buildSleepResult(h);
      case 'recovery':
        return this.buildRecoveryResult(h);
      case 'workout':
      default:
        return this.buildWorkoutResult(h);
    }
  }

  private buildSleepResult(h: HydratedEvent): WebhookProcessResult {
    const payload = h.record ?? {};
    const start = payload?.start ?? payload?.start_time ?? payload?.sleep_start;
    const end = payload?.end ?? payload?.end_time ?? payload?.sleep_end;
    const duration = minutesBetween(start, end);

    const metrics: Record<string, number> = {};
    const score = payload?.score ?? {};
    const avgHr = payload?.average_heart_rate ?? score?.average_heart_rate;
    const calories = payload?.calorie_burn ?? score?.calories_burned;
    const strain = score?.strain ?? payload?.strain;
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
          notes: score?.stage_summary ? `Stages: ${JSON.stringify(score.stage_summary)}` : undefined,
          metadata: this.decorateMetadata(h, {
            whoop_id: h.eventId,
            cycle_id: payload?.cycle_id ?? payload?.cycle?.id,
            sleep_id: payload?.id ?? payload?.sleep_id,
            recovery_score: score?.sleep_performance ?? payload?.sleep_performance_percentage,
          }),
        },
      ],
      dedupeKey: h.eventId,
    };
  }

  private buildRecoveryResult(h: HydratedEvent): WebhookProcessResult {
    const payload = h.record ?? {};
    const capturedAt = payload?.recorded_at ?? payload?.created_at ?? payload?.timestamp;
    const recoveryScore = payload?.recovery_score ?? payload?.score ?? payload?.status ?? payload?.sleep_performance_percentage;

    const metrics: Record<string, number> = {};
    if (typeof payload?.strain === 'number') metrics.strain = payload.strain;
    if (typeof payload?.resting_heart_rate === 'number') metrics.heart_rate_avg = payload.resting_heart_rate;
    if (typeof payload?.hrv === 'number') metrics.hrv = payload.hrv;
    if (typeof payload?.heart_rate_variability === 'number') metrics.hrv = payload.heart_rate_variability;

    return {
      date: isoDateFrom(capturedAt),
      entries: [
        {
          name: 'WHOOP Recovery',
          category: 'note',
          time: capturedAt,
          metrics: Object.keys(metrics).length ? metrics : undefined,
          notes: typeof recoveryScore === 'number' ? `Recovery ${recoveryScore}%` : recoveryScore,
          metadata: this.decorateMetadata(h, {
            whoop_id: h.eventId,
            recovery_score: recoveryScore,
            hrv: payload?.heart_rate_variability ?? payload?.hrv,
            sleep_need: payload?.sleep_need,
          }),
        },
      ],
      dedupeKey: h.eventId,
    };
  }

  private buildWorkoutResult(h: HydratedEvent): WebhookProcessResult {
    const payload = h.record ?? {};
    const start = payload?.start ?? payload?.start_time;
    const end = payload?.end ?? payload?.end_time;
    const duration = minutesBetween(start, end);

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
          metadata: this.decorateMetadata(h, {
            whoop_id: h.eventId,
            sport: payload?.sport ?? payload?.sport_type,
            intensity_zones: payload?.intensity_zones,
            score: payload?.score,
          }),
        },
      ],
      dedupeKey: h.eventId,
    };
  }

  private unwrapRecord(payload: any): any {
    if (!payload || typeof payload !== 'object') return payload;
    if (payload.record && typeof payload.record === 'object') return payload.record;
    if (payload.data && typeof payload.data === 'object') return payload.data;
    if (payload.sleep && typeof payload.sleep === 'object') return payload.sleep;
    return payload;
  }

  private decorateMetadata(h: HydratedEvent, extra?: Record<string, unknown>): Record<string, unknown> {
    const metadata: Record<string, unknown> = { ...(extra ?? {}) };
    metadata.webhook_kind = h.kind;
    if (h.rawType) metadata.webhook_event_type = h.rawType;
    if (h.kindMismatch) metadata.webhook_kind_mismatch = true;
    if (h.hydrated) metadata.webhook_hydrated = true;
    if (h.originalPayload?.trace_id) metadata.trace_id = h.originalPayload.trace_id;
    if (h.originalPayload?.user_id) metadata.user_id = h.originalPayload.user_id;
    if (h.originalPayload?.type) metadata.original_type = h.originalPayload.type;
    return metadata;
  }

  private composeAttentionPayload(h: HydratedEvent): Record<string, unknown> {
    const record = (h.record && typeof h.record === 'object') ? h.record : {};
    const payload: Record<string, unknown> = { ...record };
    payload._webhook_kind = h.kind;
    if (h.rawType) payload._webhook_event_type = h.rawType;
    if (h.kindMismatch) payload._webhook_kind_mismatch = true;
    if (h.hydrated) payload._webhook_hydrated = true;
    if (h.hydrated && h.originalPayload) payload._webhook_original = h.originalPayload;
    if (h.eventId && payload.id === undefined) payload.id = h.eventId;
    if (h.originalPayload?.trace_id && payload.trace_id === undefined) payload.trace_id = h.originalPayload.trace_id;
    if (h.originalPayload?.user_id && payload.user_id === undefined) payload.user_id = h.originalPayload.user_id;
    return payload;
  }

  private async hydratePayload(ctx: WebhookContext, fallback: WhoopResourceKind): Promise<HydratedEvent> {
    const original = ctx.payload ?? {};
    const eventId = extractEventId(original);
    const rawType = typeof original?.type === 'string' ? original.type : undefined;
    const kind = this.resolveKind(rawType, fallback);
    const kindMismatch = kind !== fallback;

    if (kindMismatch) {
      this.logger.info({ expected: fallback, resolved: kind, rawType }, 'WHOOP webhook type mismatch detected');
    }

    if (!eventId) {
      return {
        kind,
        payload: original,
        record: this.unwrapRecord(original),
        eventId,
        rawType,
        hydrated: false,
        kindMismatch,
        originalPayload: original,
      };
    }

    if (this.hasDetailedPayload(original)) {
      return {
        kind,
        payload: original,
        record: this.unwrapRecord(original),
        eventId,
        rawType,
        hydrated: false,
        kindMismatch,
        originalPayload: original,
      };
    }

    try {
      const fetched = await this.fetchResource(kind, eventId);
      if (fetched) {
        return {
          kind,
          payload: fetched,
          record: this.unwrapRecord(fetched),
          eventId,
          rawType,
          hydrated: true,
          kindMismatch,
          originalPayload: original,
        };
      }
    } catch (err) {
      this.logger.warn({ err, eventId, kind, rawType }, 'WHOOP webhook hydration failed');
    }

    return {
      kind,
      payload: original,
      record: this.unwrapRecord(original),
      eventId,
      rawType,
      hydrated: false,
      kindMismatch,
      originalPayload: original,
    };
  }

  private hasDetailedPayload(payload: any): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const minimalKeys = new Set([
      'id',
      'user_id',
      'type',
      'trace_id',
      'subscription_id',
      'signature',
      'timestamp',
      'event_id',
      'resource_type',
      'resource_id',
      'object_type',
      'object_id',
    ]);
    const informativeKeys = Object.keys(payload).filter((key) => !minimalKeys.has(key));
    if (informativeKeys.length > 0) return true;
    if (payload.data && typeof payload.data === 'object') return true;
    if (payload.record && typeof payload.record === 'object') return true;
    return false;
  }

  private resolveKind(rawType: string | undefined, fallback: WhoopResourceKind): WhoopResourceKind {
    if (!rawType) return fallback;
    const type = rawType.toLowerCase();
    if (type.includes('sleep')) return 'sleep';
    if (type.includes('recovery')) return 'recovery';
    if (type.includes('workout') || type.includes('activity')) return 'workout';
    return fallback;
  }

  private async fetchResource(kind: WhoopResourceKind, eventId: string): Promise<any> {
    switch (kind) {
      case 'sleep':
        return this.whoopClient.getSleepById(eventId);
      case 'recovery':
        return this.whoopClient.getRecoveryById(eventId);
      case 'workout':
      default:
        return this.whoopClient.getWorkoutById(eventId);
    }
  }
}
