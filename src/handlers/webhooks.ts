import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { HandlerConfig, ToolSpec } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { WebhookStore } from '../utils/webhook-store.js';
import { toPacificDate } from '../utils/time.js';

const ListDatesSchema = z
  .object({
    limit: z.number().int().min(1).max(90).default(14).optional(),
    order: z.enum(['asc', 'desc']).default('desc').optional(),
    source: z.string().trim().min(1).optional(),
    event_types: z.array(z.string().trim().min(1)).optional(),
  })
  .strip();

const GetEventsSchema = z
  .object({
    date: z.string().date().optional(),
    source: z.string().trim().min(1).optional(),
    event_types: z.array(z.string().trim().min(1)).optional(),
    limit: z.number().int().min(1).max(50).default(20).optional(),
    offset: z.number().int().min(0).max(500).default(0).optional(),
    include_payload: z.boolean().default(false).optional(),
    payload_preview_length: z.number().int().min(32).max(2000).default(240).optional(),
  })
  .strip();

const SearchSchema = z
  .object({
    query: z.string().trim().min(2),
    source: z.string().trim().min(1).optional(),
    event_types: z.array(z.string().trim().min(1)).optional(),
    start_date: z.string().date().optional(),
    end_date: z.string().date().optional(),
    limit: z.number().int().min(1).max(50).default(20).optional(),
    include_payload: z.boolean().default(false).optional(),
    payload_preview_length: z.number().int().min(32).max(2000).default(240).optional(),
  })
  .strip();

const GetByTypeSchema = z
  .object({
    event_type: z.string().trim().min(1),
    days: z.number().int().min(1).max(90).default(7).optional(),
    limit: z.number().int().min(1).max(100).default(50).optional(),
    source: z.string().trim().min(1).optional(),
    include_payload: z.boolean().default(false).optional(),
    payload_preview_length: z.number().int().min(32).max(2000).default(240).optional(),
  })
  .strip();

const AggregateSchema = z
  .object({
    window: z.enum(['daily', 'weekly']).optional(),
    start_date: z.string().date().optional(),
    end_date: z.string().date().optional(),
    source: z.string().trim().min(1).optional(),
    event_types: z.array(z.string().trim().min(1)).optional(),
  })
  .strip();

function todayISO(): string {
  return toPacificDate(new Date());
}

export class WebhooksHandler extends BaseHandler {
  readonly prefix = 'webhooks';
  private store: WebhookStore;

  constructor(opts: { logger: Logger; config: HandlerConfig }) {
    super(opts);
    this.store = new WebhookStore(this.config.DATA_DIR, this.logger.child({ component: 'webhook-store' }));
  }

  getTools(): ToolSpec[] {
    return [
      {
        action: 'list_dates',
        description: 'List webhook event dates with counts and sources (defaults to the most recent 14 days)',
        inputSchema: ListDatesSchema.shape,
      },
      {
        action: 'get_events',
        description: 'Fetch webhook events for a date (defaults to today) with optional filtering and pagination',
        inputSchema: GetEventsSchema.shape,
      },
      {
        action: 'search',
        description: 'Search webhook payloads/metadata for a text fragment across stored dates',
        inputSchema: SearchSchema.shape,
      },
      {
        action: 'get_by_type',
        description: 'Retrieve recent events of a given type (defaults to last 7 days)',
        inputSchema: GetByTypeSchema.shape,
      },
      {
        action: 'aggregate',
        description: 'Aggregate webhook activity into daily or weekly buckets',
        inputSchema: AggregateSchema.shape,
      },
    ];
  }

  async execute(action: string, args: unknown): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'list_dates':
          return await this.handleListDates(args);
        case 'get_events':
          return await this.handleGetEvents(args);
        case 'search':
          return await this.handleSearch(args);
        case 'get_by_type':
          return await this.handleGetByType(args);
        case 'aggregate':
          return await this.handleAggregate(args);
        default:
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Webhooks handler error');
      const message = err?.message || String(err);
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
    }
  }

  private async handleListDates(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(ListDatesSchema, raw);
    const summaries = await this.store.listDates({
      limit: parsed.limit,
      order: parsed.order,
      source: parsed.source,
      eventTypes: parsed.event_types,
    });
    return { content: [{ type: 'text', text: JSON.stringify({ dates: summaries }) }] };
  }

  private async handleGetEvents(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(GetEventsSchema, raw);
    const date = parsed.date ?? todayISO();
    const result = await this.store.getEvents(date, {
      limit: parsed.limit,
      offset: parsed.offset,
      source: parsed.source,
      eventTypes: parsed.event_types,
      includePayload: parsed.include_payload,
      payloadPreviewLength: parsed.payload_preview_length,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleSearch(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(SearchSchema, raw);
    const result = await this.store.search({
      query: parsed.query,
      source: parsed.source,
      eventTypes: parsed.event_types,
      startDate: parsed.start_date,
      endDate: parsed.end_date,
      limit: parsed.limit,
      includePayload: parsed.include_payload,
      payloadPreviewLength: parsed.payload_preview_length,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleGetByType(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(GetByTypeSchema, raw);
    const result = await this.store.getEventsByType({
      eventType: parsed.event_type,
      days: parsed.days,
      limit: parsed.limit,
      source: parsed.source,
      includePayload: parsed.include_payload,
      payloadPreviewLength: parsed.payload_preview_length,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleAggregate(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(AggregateSchema, raw);
    const result = await this.store.aggregate({
      window: parsed.window,
      startDate: parsed.start_date,
      endDate: parsed.end_date,
      source: parsed.source,
      eventTypes: parsed.event_types,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
