import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger.js';
import type { AppConfig } from './config.js';
import { ensurePacificIso, pacificNowIso, toPacificDate } from './time.js';
import { SpotifyClient } from './spotify.js';
import { WhoopClient } from './whoop.js';
import { getCalendar } from './google.js';
import { RizeClient } from './rize.js';

export interface ContextSnapshotPayload {
  timestamp: string | number | Date;
  location?: Record<string, unknown> | null;
  weather?: Record<string, unknown> | null;
  extras?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface ContextSnapshotError {
  source: 'spotify' | 'whoop' | 'calendar' | 'rize';
  message: string;
}

export interface ContextSnapshotSpotify {
  track?: string;
  artists?: string[];
  album?: string;
  isPlaying?: boolean;
  device?: { id?: string | null; name?: string | null; type?: string | null; isActive?: boolean };
  startedAt?: string;
  progressMs?: number;
  durationMs?: number;
  raw?: Record<string, unknown>;
}

export interface ContextSnapshotWhoop {
  id?: string;
  recoveryScore?: number;
  recoveryPercent?: number;
  recoveryColor?: string;
  recordedAt?: string;
  cycleId?: number;
  strain?: number;
  restingHeartRate?: number;
  hrv?: number;
  raw?: Record<string, unknown>;
}

export interface ContextSnapshotCalendar {
  id?: string;
  summary?: string;
  start?: string;
  end?: string;
  location?: string;
  hangoutLink?: string;
  creator?: string;
  attendees?: Array<{ email?: string; responseStatus?: string }>;
  raw?: Record<string, unknown>;
}

export interface ContextSnapshotRize {
  id?: string;
  title?: string | null;
  description?: string | null;
  type?: string | null;
  source?: string | null;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
  durationMinutes?: number;
  isActive?: boolean;
  status?: string;
  raw?: Record<string, unknown>;
}

export interface ContextSnapshotRecord {
  capturedAt: string;
  capturedAtUtc: string;
  recordedAt: string;
  ios: {
    timestamp: string;
    timestampUtc: string;
    location?: Record<string, unknown> | null;
    weather?: Record<string, unknown> | null;
    extras?: Record<string, unknown>;
    raw?: Record<string, unknown>;
  };
  spotify: ContextSnapshotSpotify | null;
  whoop: ContextSnapshotWhoop | null;
  calendar: ContextSnapshotCalendar | null;
  rize: ContextSnapshotRize | null;
  errors?: ContextSnapshotError[];
}

interface ContextSnapshotServiceOptions {
  config: AppConfig;
  logger: Logger;
}

interface ParsedTimestamp {
  date: Date;
  isoUtc: string;
  pacificIso: string;
}

type CalendarEvent = {
  id?: string | null;
  summary?: string | null;
  start?: { date?: string | null; dateTime?: string | null; timeZone?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null; timeZone?: string | null } | null;
  hangoutLink?: string | null;
  htmlLink?: string | null;
  location?: string | null;
  creator?: { email?: string | null } | null;
  attendees?: Array<{ email?: string | null; responseStatus?: string | null }> | null;
  [key: string]: unknown;
};

export class ContextSnapshotService {
  private readonly logger: Logger;
  private readonly config: AppConfig;

  constructor(opts: ContextSnapshotServiceOptions) {
    this.logger = opts.logger;
    this.config = opts.config;
  }

  async collect(payload: ContextSnapshotPayload): Promise<ContextSnapshotRecord> {
    const parsed = this.parseTimestamp(payload.timestamp);
    const errors: ContextSnapshotError[] = [];
    const recordedAt = pacificNowIso();

    const record: ContextSnapshotRecord = {
      capturedAt: parsed.pacificIso,
      capturedAtUtc: parsed.isoUtc,
      recordedAt,
      ios: {
        timestamp: parsed.pacificIso,
        timestampUtc: parsed.isoUtc,
        location: payload.location ?? null,
        weather: payload.weather ?? null,
        extras: payload.extras && Object.keys(payload.extras).length ? payload.extras : undefined,
        raw: payload.raw,
      },
      spotify: null,
      whoop: null,
      calendar: null,
      rize: null,
    };

    record.spotify = await this.fetchSpotify(errors);
    record.whoop = await this.fetchWhoop(errors);
    record.calendar = await this.fetchCalendar(parsed.date, errors);
    record.rize = await this.fetchRize(errors);

    if (errors.length > 0) {
      record.errors = errors;
    }

    return record;
  }

  async append(record: ContextSnapshotRecord): Promise<void> {
    const dir = path.resolve(this.config.DATA_DIR, 'context-snapshots');
    const day = this.safePacificDate(record.capturedAt) ?? toPacificDate(record.recordedAt);
    const file = path.join(dir, `${day}.json`);
    await fs.mkdir(dir, { recursive: true });

    let existing: ContextSnapshotRecord[] = [];
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        existing = parsed as ContextSnapshotRecord[];
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn({ err, file }, 'Failed to read existing context snapshot file; creating new file');
      }
    }

    existing.push(record);
    const payload = JSON.stringify(existing, null, 2);
    await fs.writeFile(file, `${payload}\n`, 'utf8');
  }

  async getRecent(limit: number): Promise<ContextSnapshotRecord[]> {
    if (!Number.isFinite(limit) || limit <= 0) {
      return [];
    }
    const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
    const dir = path.resolve(this.config.DATA_DIR, 'context-snapshots');
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return [];
      this.logger.warn({ err, dir }, 'Failed to read context snapshot directory');
      return [];
    }

    const dailyFiles = files
      .filter(name => name.endsWith('.json'))
      .map(name => ({ name, date: name.replace(/\.json$/, '') }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const collected: ContextSnapshotRecord[] = [];
    for (const file of dailyFiles) {
      const full = path.join(dir, file.name);
      try {
        const raw = await fs.readFile(full, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            collected.push(item as ContextSnapshotRecord);
            if (collected.length >= normalizedLimit * 2) {
              break;
            }
          }
        }
      } catch (err) {
        this.logger.warn({ err, file: full }, 'Failed to parse context snapshot file');
      }
      if (collected.length >= normalizedLimit * 2) {
        break;
      }
    }

    const sorted = collected.sort((a, b) => {
      const aTime = this.parseDateForSort(a.capturedAt ?? a.recordedAt);
      const bTime = this.parseDateForSort(b.capturedAt ?? b.recordedAt);
      return aTime - bTime;
    });

    return sorted.slice(-normalizedLimit);
  }

  private parseTimestamp(value: ContextSnapshotPayload['timestamp']): ParsedTimestamp {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value as any);
    if (!Number.isFinite(date.getTime())) {
      throw new Error('Invalid timestamp');
    }
    const isoUtc = date.toISOString();
    const pacificIso = ensurePacificIso(date) ?? isoUtc;
    return { date, isoUtc, pacificIso };
  }

  private parseDateForSort(value: string | undefined): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private safeParseDateMs(value: unknown): number | undefined {
    if (typeof value !== 'string') return undefined;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private safePacificDate(value: string | undefined): string | undefined {
    try {
      return toPacificDate(value ?? new Date());
    } catch {
      return undefined;
    }
  }

  private normalizeError(err: unknown): string {
    if (!err) return 'Unknown error';
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }

  private async fetchSpotify(errors: ContextSnapshotError[]): Promise<ContextSnapshotSpotify | null> {
    try {
      const client = new SpotifyClient(this.config, { logger: this.logger.child({ source: 'context_snapshot', integration: 'spotify' }) });
      const current = await client.getCurrentlyPlaying();
      if (!current || !current.item) {
        return null;
      }
      const item = current.item as any;
      const artists: string[] = Array.isArray(item?.artists)
        ? item.artists.map((artist: any) => artist?.name).filter(Boolean)
        : [];
      const timestamp = typeof current.timestamp === 'number' ? current.timestamp : undefined;
      const progress = typeof current.progress_ms === 'number' ? current.progress_ms : undefined;
      const startedAt = timestamp && typeof progress === 'number'
        ? ensurePacificIso(new Date(timestamp - progress))
        : undefined;

      return {
        track: item?.name ?? undefined,
        artists: artists.length ? artists : undefined,
        album: item?.album?.name ?? undefined,
        isPlaying: Boolean(current.is_playing),
        device: current.device
          ? {
              id: (current.device as any)?.id ?? null,
              name: (current.device as any)?.name ?? null,
              type: (current.device as any)?.type ?? null,
              isActive: Boolean((current.device as any)?.is_active),
            }
          : undefined,
        startedAt,
        progressMs: progress,
        durationMs: typeof item?.duration_ms === 'number' ? item.duration_ms : undefined,
        raw: {
          id: item?.id ?? undefined,
          uri: item?.uri ?? undefined,
        },
      };
    } catch (err) {
      const message = this.normalizeError(err);
      this.logger.warn({ err, integration: 'spotify' }, 'Failed to fetch Spotify playback for context snapshot');
      errors.push({ source: 'spotify', message });
      return null;
    }
  }

  private async fetchWhoop(errors: ContextSnapshotError[]): Promise<ContextSnapshotWhoop | null> {
    try {
      const client = new WhoopClient(this.config);
      const data = await client.getRecoveries({ limit: 1, maxItems: 1, maxPages: 1, all: false });
      const latest = Array.isArray(data?.items) ? data.items[0] : undefined;
      if (!latest) {
        return null;
      }
      const metrics = (latest as any)?.score ?? latest;
      const recordedAtSource = (latest as any)?.recorded_at || (latest as any)?.created_at || (latest as any)?.timestamp || (latest as any)?.updated_at;
      const recordedAt = recordedAtSource ? ensurePacificIso(recordedAtSource) : undefined;

      return {
        id: (latest as any)?.id ?? (latest as any)?.uuid ?? undefined,
        recoveryScore:
          typeof metrics?.recovery_score === 'number'
            ? metrics.recovery_score
            : typeof (latest as any)?.recovery_score === 'number'
              ? (latest as any).recovery_score
              : undefined,
        recoveryPercent:
          typeof metrics?.recovery_score === 'number' && typeof metrics?.recovery_target === 'number'
            ? (metrics.recovery_score / (metrics.recovery_target || 1)) * 100
            : typeof metrics?.score_percentage === 'number'
              ? metrics.score_percentage
              : undefined,
        recoveryColor: metrics?.recovery_color ?? (latest as any)?.recovery_color ?? undefined,
        recordedAt,
        cycleId: typeof (latest as any)?.cycle_id === 'number' ? (latest as any).cycle_id : undefined,
        strain: typeof metrics?.strain === 'number' ? metrics.strain : undefined,
        restingHeartRate: typeof metrics?.resting_heart_rate === 'number' ? metrics.resting_heart_rate : undefined,
        hrv: typeof metrics?.hrv === 'number' ? metrics.hrv : undefined,
        raw: latest as Record<string, unknown>,
      };
    } catch (err) {
      const message = this.normalizeError(err);
      this.logger.warn({ err, integration: 'whoop' }, 'Failed to fetch WHOOP recovery for context snapshot');
      errors.push({ source: 'whoop', message });
      return null;
    }
  }

  private async fetchCalendar(reference: Date, errors: ContextSnapshotError[]): Promise<ContextSnapshotCalendar | null> {
    try {
      const { calendar, reason } = await getCalendar(this.config, this.logger.child({ source: 'context_snapshot', integration: 'calendar' }));
      if (!calendar) {
        const message = reason === 'not_authenticated'
          ? 'Google Calendar not authenticated'
          : 'Calendar unavailable';
        this.logger.warn({ reason }, 'Calendar unavailable for context snapshot');
        errors.push({ source: 'calendar', message });
        return null;
      }

      const windowMs = 12 * 60 * 60 * 1000;
      const timeMin = new Date(reference.getTime() - windowMs).toISOString();
      const timeMax = new Date(reference.getTime() + windowMs).toISOString();
      const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 20,
      });
      const items = (res.data.items || []) as CalendarEvent[];
      if (!items.length) {
        return null;
      }

      const targetMs = reference.getTime();
      const match = items.find(event => {
        const { startMs, endMs } = this.extractEventBounds(event);
        if (startMs === undefined || endMs === undefined) return false;
        return targetMs >= startMs && targetMs < endMs;
      });

      if (!match) {
        return null;
      }

      const { startMs, endMs } = this.extractEventBounds(match);
      const startIso = startMs !== undefined ? ensurePacificIso(new Date(startMs)) : undefined;
      const endIso = endMs !== undefined ? ensurePacificIso(new Date(endMs)) : undefined;

      return {
        id: match.id ?? undefined,
        summary: match.summary ?? undefined,
        start: startIso,
        end: endIso,
        location: match.location ?? undefined,
        hangoutLink: match.hangoutLink ?? match.htmlLink ?? undefined,
        creator: match.creator?.email ?? undefined,
        attendees: Array.isArray(match.attendees)
          ? match.attendees.map(att => ({
              email: att?.email ?? undefined,
              responseStatus: att?.responseStatus ?? undefined,
            }))
          : undefined,
        raw: match as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const message = this.normalizeError(err);
      this.logger.warn({ err, integration: 'calendar' }, 'Failed to fetch Calendar event for context snapshot');
      errors.push({ source: 'calendar', message });
      return null;
    }
  }

  private extractEventBounds(event: CalendarEvent): { startMs?: number; endMs?: number } {
    const start = event.start || undefined;
    const end = event.end || undefined;

    const startMs = this.calendarBoundaryToMs(start, 'start');
    const endMsRaw = this.calendarBoundaryToMs(end, 'end');
    if (startMs === undefined && endMsRaw === undefined) {
      return {};
    }

    const endMs = endMsRaw !== undefined ? endMsRaw : startMs !== undefined ? startMs + 60 * 60 * 1000 : undefined;
    return { startMs, endMs };
  }

  private calendarBoundaryToMs(boundary: CalendarEvent['start'], kind: 'start' | 'end'): number | undefined {
    if (!boundary) return undefined;
    if (boundary.dateTime) {
      const parsed = Date.parse(boundary.dateTime);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (boundary.date) {
      const base = `${boundary.date}T00:00:00Z`;
      const parsed = Date.parse(base);
      if (!Number.isFinite(parsed)) return undefined;
      if (kind === 'end') {
        return parsed;
      }
      return parsed;
    }
    return undefined;
  }

  private async fetchRize(errors: ContextSnapshotError[]): Promise<ContextSnapshotRize | null> {
    try {
      const client = new RizeClient(this.config);
      const attempts: string[] = [];

      const current = await this.fetchRizeCurrentSession(client, attempts);
      if (current) {
        return current;
      }

      const recent = await this.fetchRizeRecentSession(client, attempts);
      if (recent) {
        return recent;
      }

      if (attempts.length) {
        errors.push({ source: 'rize', message: attempts.join('; ') });
      }
      return null;
    } catch (err) {
      const message = this.normalizeError(err);
      this.logger.warn({ err, integration: 'rize' }, 'Rize client unavailable for context snapshot');
      errors.push({ source: 'rize', message });
      return null;
    }
  }

  private async fetchRizeCurrentSession(client: RizeClient, attempts: string[]): Promise<ContextSnapshotRize | null> {
    const query = `
      query ContextSnapshotCurrentSession {
        currentSession {
          id
          title
          description
          type
          source
          startTime
          endTime
          updatedAt
        }
      }
    `;

    try {
      const resp = await client.query(query);
      const session = resp?.data?.currentSession;
      if (!session) {
        attempts.push('currentSession: none');
        return null;
      }
      return this.transformSession(session, { hint: 'currentSession' });
    } catch (err) {
      attempts.push(`currentSession: ${this.normalizeError(err)}`);
      return null;
    }
  }

  private async fetchRizeRecentSession(client: RizeClient, attempts: string[]): Promise<ContextSnapshotRize | null> {
    const query = `
      query ContextSnapshotRecentSessions($start: ISO8601DateTime, $end: ISO8601DateTime, $sort: TimeEntrySortEnum) {
        sessions(startTime: $start, endTime: $end, sort: $sort) {
          id
          title
          description
          type
          source
          startTime
          endTime
          updatedAt
        }
      }
    `;

    const now = Date.now();
    const start = new Date(now - 72 * 60 * 60 * 1000).toISOString();
    const end = new Date(now + 60 * 60 * 1000).toISOString();

    try {
      const resp = await client.query(query, { start, end, sort: 'created_at' });
      const sessions = Array.isArray(resp?.data?.sessions) ? resp.data.sessions : [];
      if (!sessions.length) {
        attempts.push('sessions: empty result');
        return null;
      }

      const best = sessions
        .filter(Boolean)
        .sort((a: any, b: any) => {
          const aTime = this.parseDateForSort(a?.startTime);
          const bTime = this.parseDateForSort(b?.startTime);
          return bTime - aTime;
        })[0];

      if (!best) {
        attempts.push('sessions: unable to select recent session');
        return null;
      }

      return this.transformSession(best, { hint: 'sessions' });
    } catch (err) {
      attempts.push(`sessions: ${this.normalizeError(err)}`);
      return null;
    }
  }

  private transformSession(session: any, context: { hint: string }): ContextSnapshotRize {
    const startIso = ensurePacificIso(session?.startTime);
    const endIso = ensurePacificIso(session?.endTime);
    const updatedIso = ensurePacificIso(session?.updatedAt);

    const startMs = this.safeParseDateMs(session?.startTime);
    const endMs = this.safeParseDateMs(session?.endTime);
    const durationMinutes = typeof startMs === 'number' && typeof endMs === 'number' && endMs >= startMs
      ? Math.round((endMs - startMs) / 60000)
      : undefined;
    const isActive = typeof endMs === 'number' ? endMs > Date.now() : undefined;

    return {
      id: session?.id ?? undefined,
      title: session?.title ?? null,
      description: session?.description ?? null,
      type: session?.type ?? null,
      source: session?.source ?? null,
      startedAt: startIso,
      endedAt: endIso,
      updatedAt: updatedIso,
      durationMinutes,
      isActive,
      status: isActive === true ? 'active' : 'completed',
      raw: {
        hint: context.hint,
        session,
      },
    };
  }
}
