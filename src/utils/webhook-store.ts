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
}
