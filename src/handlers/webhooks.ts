import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { HandlerConfig, ToolSpec } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { WebhookStore } from '../utils/webhook-store.js';

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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
    ];
  }

  async execute(action: string, args: unknown): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'list_dates':
          return await this.handleListDates(args);
        case 'get_events':
          return await this.handleGetEvents(args);
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
}
