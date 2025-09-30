import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger.js';
import { toPacificDate, toPacificIso } from './time.js';

interface StoredWebhookEvent {
  receivedAt: string;
  source: string;
  eventType: string;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
  payload: unknown;
}

export class WebhookEventLogger {
  private readonly baseDir: string;
  private readonly logger: Logger;

  constructor(baseDir: string, logger: Logger) {
    this.baseDir = baseDir;
    this.logger = logger;
  }

  async record(source: string, eventType: string, payload: unknown, dedupeKey?: string, metadata?: Record<string, unknown>): Promise<void> {
    const now = new Date();
    const receivedAt = toPacificIso(now);
    const [year, month, day] = toPacificDate(now).split('-');
    const dir = path.resolve(this.baseDir, 'webhooks', 'events', year, month ?? 'unknown');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.resolve(dir, `${day ?? 'unknown'}-events.json`);

    const entry: StoredWebhookEvent = {
      receivedAt,
      source,
      eventType,
      dedupeKey,
      metadata,
      payload,
    };

    try {
      let existing: StoredWebhookEvent[] = [];
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        existing = JSON.parse(raw) as StoredWebhookEvent[];
        if (!Array.isArray(existing)) existing = [];
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          this.logger.warn({ err, filePath }, 'Failed to read webhook events log; recreating file');
        }
      }
      existing.push(entry);
      await fs.writeFile(filePath, JSON.stringify(existing, null, 2), 'utf8');
    } catch (err: any) {
      this.logger.error({ err, filePath }, 'Failed to persist webhook event log');
    }
  }
}
