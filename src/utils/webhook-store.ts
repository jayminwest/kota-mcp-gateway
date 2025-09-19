import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger.js';

export interface StoredWebhookEvent {
  receivedAt: string;
  source: string;
  eventType: string;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
  payload?: unknown;
}

export interface WebhookDateSummary {
  date: string;
  eventCount: number;
  sources: Record<string, number>;
  eventTypes: Record<string, number>;
  lastReceivedAt?: string;
  filePath: string;
  fileSize?: number;
}

export interface GetEventsOptions {
  limit?: number;
  offset?: number;
  source?: string;
  eventTypes?: string[];
  includePayload?: boolean;
  payloadPreviewLength?: number;
}

export interface WebhookEventResult {
  index: number;
  receivedAt: string;
  source: string;
  eventType: string;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
  payloadPreview?: string;
  payload?: unknown;
}

const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface SearchOptions {
  query: string;
  limit?: number;
  source?: string;
  eventTypes?: string[];
  startDate?: string;
  endDate?: string;
  includePayload?: boolean;
  payloadPreviewLength?: number;
}

export interface GetByTypeOptions {
  eventType: string;
  days?: number;
  limit?: number;
  source?: string;
  includePayload?: boolean;
  payloadPreviewLength?: number;
}

export interface AggregateOptions {
  window?: 'daily' | 'weekly';
  startDate?: string;
  endDate?: string;
  source?: string;
  eventTypes?: string[];
}

export interface AggregateBucket {
  key: string;
  startDate: string;
  endDate: string;
  totalEvents: number;
  sources: Record<string, number>;
  eventTypes: Record<string, number>;
  firstEventAt?: string;
  lastEventAt?: string;
}

export class WebhookStore {
  private readonly baseDir: string;
  private readonly logger: Logger;

  constructor(dataDir: string, logger: Logger) {
    this.baseDir = path.resolve(dataDir, 'webhooks', 'events');
    this.logger = logger;
  }

  async listDates(options: { limit?: number; order?: 'asc' | 'desc'; source?: string; eventTypes?: string[] } = {}): Promise<WebhookDateSummary[]> {
    const { limit = 14, order = 'desc', source, eventTypes } = options;

    const files = await this.collectEventFiles();
    const sorted = files.sort((a, b) => (order === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));

    const summaries: WebhookDateSummary[] = [];
    for (const file of sorted) {
      if (summaries.length >= limit) break;
      const events = await this.readEventsFromFile(file.filePath);
      const filtered = events.filter(event => {
        if (source && event.source !== source) return false;
        if (eventTypes && eventTypes.length > 0 && !eventTypes.includes(event.eventType)) return false;
        return true;
      });
      if (filtered.length === 0) continue;

      const sourcesCount: Record<string, number> = {};
      const eventTypeCount: Record<string, number> = {};
      let lastReceivedAt: string | undefined;
      for (const event of filtered) {
        sourcesCount[event.source] = (sourcesCount[event.source] ?? 0) + 1;
        eventTypeCount[event.eventType] = (eventTypeCount[event.eventType] ?? 0) + 1;
        if (!lastReceivedAt || event.receivedAt > lastReceivedAt) {
          lastReceivedAt = event.receivedAt;
        }
      }

      summaries.push({
        date: file.date,
        eventCount: filtered.length,
        sources: sourcesCount,
        eventTypes: eventTypeCount,
        lastReceivedAt,
        filePath: file.filePath,
        fileSize: file.fileSize,
      });
    }

    return summaries;
  }

  async getEvents(date: string, options: GetEventsOptions = {}): Promise<{ date: string; total: number; events: WebhookEventResult[] }> {
    const { limit = 20, offset = 0, source, eventTypes, includePayload = false, payloadPreviewLength = 240 } = options;

    if (!DATE_REGEX.test(date)) {
      throw new Error('Date must be in YYYY-MM-DD format');
    }

    const filePath = this.buildFilePath(date);
    const events = await this.readEventsFromFile(filePath);

    const filtered = events.filter(event => {
      if (source && event.source !== source) return false;
      if (eventTypes && eventTypes.length > 0 && !eventTypes.includes(event.eventType)) return false;
      return true;
    });

    const sliced = filtered.slice(offset, offset + limit);
    const results = sliced.map<WebhookEventResult>((event, index) => {
      const preview = this.makePreview(event.payload, payloadPreviewLength);
      const base: WebhookEventResult = {
        index: offset + index,
        receivedAt: event.receivedAt,
        source: event.source,
        eventType: event.eventType,
        dedupeKey: event.dedupeKey,
        metadata: event.metadata,
        payloadPreview: preview,
      };
      if (includePayload) {
        base.payload = event.payload;
      }
      return base;
    });

    return { date, total: filtered.length, events: results };
  }

  async hasEvent(date: string, dedupeKey: string, source?: string, eventType?: string): Promise<boolean> {
    if (!dedupeKey) return false;
    const filePath = this.buildFilePath(date);
    const events = await this.readEventsFromFile(filePath);
    return events.some(event => {
      if (event.dedupeKey !== dedupeKey) return false;
      if (source && event.source !== source) return false;
      if (eventType && event.eventType !== eventType) return false;
      return true;
    });
  }

  async search(options: SearchOptions): Promise<{ query: string; total: number; events: WebhookEventResult[] }> {
    const {
      query,
      limit = 20,
      source,
      eventTypes,
      startDate,
      endDate,
      includePayload = false,
      payloadPreviewLength = 240,
    } = options;

    const files = await this.collectEventFiles();
    const sorted = files.sort((a, b) => b.date.localeCompare(a.date));
    const results: WebhookEventResult[] = [];
    let matchCount = 0;
    for (const file of sorted) {
      if (results.length >= limit) break;
      if (startDate && file.date < startDate) continue;
      if (endDate && file.date > endDate) continue;
      const events = await this.readEventsFromFile(file.filePath);
      for (let idx = 0; idx < events.length; idx += 1) {
        if (results.length >= limit) break;
        const event = events[idx];
        if (source && event.source !== source) continue;
        if (eventTypes && eventTypes.length > 0 && !eventTypes.includes(event.eventType)) continue;
        const haystack = this.buildSearchHaystack(event);
        if (!haystack.includes(query.toLowerCase())) continue;
        matchCount += 1;
        const preview = this.makePreview(event.payload, payloadPreviewLength);
        const base: WebhookEventResult = {
          index: idx,
          receivedAt: event.receivedAt,
          source: event.source,
          eventType: event.eventType,
          dedupeKey: event.dedupeKey,
          metadata: event.metadata,
          payloadPreview: preview,
        };
        if (includePayload) base.payload = event.payload;
        results.push(base);
      }
    }
    return { query, total: matchCount, events: results };
  }

  async getEventsByType(options: GetByTypeOptions): Promise<{ eventType: string; events: WebhookEventResult[] }> {
    const {
      eventType,
      days = 7,
      limit = 50,
      source,
      includePayload = false,
      payloadPreviewLength = 240,
    } = options;

    const cutoffDate = this.offsetDate(days);
    const files = await this.collectEventFiles();
    const sorted = files.sort((a, b) => b.date.localeCompare(a.date));
    const results: WebhookEventResult[] = [];

    for (const file of sorted) {
      if (results.length >= limit) break;
      if (file.date < cutoffDate) break;
      const events = await this.readEventsFromFile(file.filePath);
      for (let idx = 0; idx < events.length; idx += 1) {
        if (results.length >= limit) break;
        const event = events[idx];
        if (event.eventType !== eventType) continue;
        if (source && event.source !== source) continue;
        const preview = this.makePreview(event.payload, payloadPreviewLength);
        const base: WebhookEventResult = {
          index: idx,
          receivedAt: event.receivedAt,
          source: event.source,
          eventType: event.eventType,
          dedupeKey: event.dedupeKey,
          metadata: event.metadata,
          payloadPreview: preview,
        };
        if (includePayload) base.payload = event.payload;
        results.push(base);
      }
    }

    return { eventType, events: results };
  }

  async aggregate(options: AggregateOptions = {}): Promise<{ window: 'daily' | 'weekly'; buckets: AggregateBucket[] }> {
    const { window = 'daily', startDate, endDate, source, eventTypes } = options;
    const buckets = new Map<string, AggregateBucket>();

    const files = await this.collectEventFiles();
    const sorted = files.sort((a, b) => a.date.localeCompare(b.date));
    for (const file of sorted) {
      if (startDate && file.date < startDate) continue;
      if (endDate && file.date > endDate) continue;
      const events = await this.readEventsFromFile(file.filePath);
      for (const event of events) {
        if (source && event.source !== source) continue;
        if (eventTypes && eventTypes.length > 0 && !eventTypes.includes(event.eventType)) continue;
        const bucketInfo = this.resolveBucket(window, event.receivedAt ?? `${file.date}T00:00:00Z`, file.date);
        const existing = buckets.get(bucketInfo.key) ?? {
          key: bucketInfo.key,
          startDate: bucketInfo.startDate,
          endDate: bucketInfo.endDate,
          totalEvents: 0,
          sources: {},
          eventTypes: {},
        };
        existing.totalEvents += 1;
        existing.sources[event.source] = (existing.sources[event.source] ?? 0) + 1;
        existing.eventTypes[event.eventType] = (existing.eventTypes[event.eventType] ?? 0) + 1;
        if (!existing.firstEventAt || event.receivedAt < existing.firstEventAt) {
          existing.firstEventAt = event.receivedAt;
        }
        if (!existing.lastEventAt || event.receivedAt > existing.lastEventAt) {
          existing.lastEventAt = event.receivedAt;
        }
        buckets.set(bucketInfo.key, existing);
      }
    }

    const ordered = Array.from(buckets.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
    return { window, buckets: ordered };
  }

  private async collectEventFiles(): Promise<Array<{ date: string; filePath: string; fileSize?: number }>> {
    const files: Array<{ date: string; filePath: string; fileSize?: number }> = [];
    try {
      const years = await fs.readdir(this.baseDir, { withFileTypes: true });
      for (const yearDir of years) {
        if (!yearDir.isDirectory()) continue;
        const year = yearDir.name;
        if (!/^\d{4}$/.test(year)) continue;
        const yearPath = path.resolve(this.baseDir, year);
        const months = await fs.readdir(yearPath, { withFileTypes: true });
        for (const monthDir of months) {
          if (!monthDir.isDirectory()) continue;
          const month = monthDir.name;
          if (!/^\d{2}$/.test(month)) continue;
          const monthPath = path.resolve(yearPath, month);
          const entries = await fs.readdir(monthPath, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isFile()) continue;
            const match = entry.name.match(/^(\d{2})-events\.json$/);
            if (!match) continue;
            const day = match[1];
            const date = `${year}-${month}-${day}`;
            const filePath = path.resolve(monthPath, entry.name);
            let fileSize: number | undefined;
            try {
              const stat = await fs.stat(filePath);
              fileSize = stat.size;
            } catch (err: any) {
              this.logger.warn({ err, filePath }, 'Failed to stat webhook events file');
            }
            files.push({ date, filePath, fileSize });
          }
        }
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn({ err, baseDir: this.baseDir }, 'Failed to enumerate webhook events');
      }
    }
    return files;
  }

  private buildFilePath(date: string): string {
    const match = DATE_REGEX.exec(date);
    if (!match) {
      throw new Error('Date must be in YYYY-MM-DD format');
    }
    const [, year, month, day] = match;
    return path.resolve(this.baseDir, year, month, `${day}-events.json`);
  }

  private async readEventsFromFile(filePath: string): Promise<StoredWebhookEvent[]> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.logger.warn({ filePath }, 'Unexpected webhook events file format');
        return [];
      }
      return parsed as StoredWebhookEvent[];
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn({ err, filePath }, 'Failed to read webhook events file');
      }
      return [];
    }
  }

  private makePreview(payload: unknown, maxLength: number): string | undefined {
    if (payload === undefined) return undefined;
    try {
      const json = JSON.stringify(payload);
      if (!json) return undefined;
      if (json.length <= maxLength) return json;
      return `${json.slice(0, maxLength)}…`;
    } catch {
      return undefined;
    }
  }

  private buildSearchHaystack(event: StoredWebhookEvent): string {
    const parts: string[] = [];
    if (event.receivedAt) parts.push(event.receivedAt.toLowerCase());
    if (event.source) parts.push(event.source.toLowerCase());
    if (event.eventType) parts.push(event.eventType.toLowerCase());
    if (event.dedupeKey) parts.push(event.dedupeKey.toLowerCase());
    if (event.metadata) {
      try {
        parts.push(JSON.stringify(event.metadata).toLowerCase());
      } catch {}
    }
    if (event.payload) {
      try {
        parts.push(JSON.stringify(event.payload).toLowerCase());
      } catch {}
    }
    return parts.join(' ');
  }

  private offsetDate(days: number): string {
    const now = new Date();
    now.setUTCDate(now.getUTCDate() - Math.max(0, days));
    return now.toISOString().slice(0, 10);
  }

  private resolveBucket(window: 'daily' | 'weekly', timestamp: string, fallbackDate: string): { key: string; startDate: string; endDate: string } {
    if (window === 'daily') {
      return { key: fallbackDate, startDate: fallbackDate, endDate: fallbackDate };
    }
    const date = new Date(timestamp || `${fallbackDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      return { key: fallbackDate, startDate: fallbackDate, endDate: fallbackDate };
    }
    const year = date.getUTCFullYear();
    const week = this.getISOWeek(date);
    const start = this.getISOWeekStart(year, week);
    const end = this.getISOWeekEnd(year, week);
    const key = `${year}-W${week.toString().padStart(2, '0')}`;
    return { key, startDate: start, endDate: end };
  }

  private getISOWeek(date: Date): number {
    const temp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    temp.setUTCDate(temp.getUTCDate() + 4 - (temp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return weekNo;
  }

  private getISOWeekStart(year: number, week: number): string {
    const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    const dow = simple.getUTCDay();
    const ISOweekStart = simple;
    if (dow <= 4 && dow > 0) {
      ISOweekStart.setUTCDate(simple.getUTCDate() - dow + 1);
    } else {
      ISOweekStart.setUTCDate(simple.getUTCDate() + 8 - dow);
    }
    return ISOweekStart.toISOString().slice(0, 10);
  }

  private getISOWeekEnd(year: number, week: number): string {
    const start = new Date(this.getISOWeekStart(year, week));
    start.setUTCDate(start.getUTCDate() + 6);
    return start.toISOString().slice(0, 10);
  }
}
