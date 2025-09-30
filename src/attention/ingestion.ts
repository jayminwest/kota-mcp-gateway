import type { Logger } from '../utils/logger.js';
import { logger as rootLogger } from '../utils/logger.js';
import type { AttentionEvent, RawAttentionEvent } from './types.js';
import { pacificNowIso } from '../utils/time.js';

export interface AttentionIngestionOptions {
  logger?: Logger;
  enrichers?: Array<(event: RawAttentionEvent) => Promise<Record<string, unknown>>>;
}

export class AttentionIngestionService {
  private readonly logger: Logger;
  private readonly enrichers: Array<(event: RawAttentionEvent) => Promise<Record<string, unknown>>>;

  constructor(options: AttentionIngestionOptions = {}) {
    this.logger = options.logger ?? rootLogger.child({ component: 'attention-ingestion' });
    this.enrichers = options.enrichers ?? [];
  }

  async ingest(event: RawAttentionEvent): Promise<AttentionEvent> {
    const receivedAt = event.receivedAt ?? pacificNowIso();
    const normalized = await this.runEnrichers(event);
    const enriched: AttentionEvent = {
      ...event,
      receivedAt,
      normalized,
    };
    this.logger.debug({ source: event.source, kind: event.kind, dedupeKey: event.dedupeKey }, 'Attention event ingested');
    return enriched;
  }

  private async runEnrichers(event: RawAttentionEvent): Promise<Record<string, unknown>> {
    if (!this.enrichers.length) {
      return { payload: event.payload };
    }
    const result: Record<string, unknown> = { payload: event.payload };
    for (const fn of this.enrichers) {
      try {
        Object.assign(result, await fn(event));
      } catch (err) {
        this.logger.warn({ err, source: event.source, kind: event.kind }, 'Attention enricher failed');
      }
    }
    return result;
  }
}
