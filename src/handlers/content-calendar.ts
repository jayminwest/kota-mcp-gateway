import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec, HandlerConfig } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import {
  ContentCalendarStore,
  type ContentCalendarCreateInput,
  type ContentCalendarUpdateInput,
  type ContentCalendarListOptions,
} from '../utils/content-calendar.js';

const NonEmptyString = z.string().trim().min(1);
const OptionalString = z.string().trim().min(1).optional();
const NullableString = z.string().trim().min(1).nullable().optional();
const IsoDateString = z.string().datetime().describe('ISO 8601 timestamp');
const NullableIsoDateString = z.union([IsoDateString, z.null()]).optional();
const StringOrStringArray = z.union([NonEmptyString, z.array(NonEmptyString)]);
const NullableStringOrArray = z.union([z.null(), StringOrStringArray]).optional();

const AssetSchema = z
  .object({
    label: NonEmptyString.describe('Identifier for the asset (e.g., brief doc, draft link)'),
    type: OptionalString,
    url: z.string().trim().min(1).describe('URL to the asset').optional(),
    path: OptionalString.describe('Local or relative path reference').optional(),
    notes: OptionalString.optional(),
  })
  .strip();

const MetadataSchema = z.record(z.string(), z.any()).optional();

const CreateItemSchema = z
  .object({
    id: OptionalString.describe('Optional custom identifier (slug-friendly)').optional(),
    title: NonEmptyString.describe('Content title or working headline'),
    status: OptionalString.describe('Workflow status (e.g., idea, draft, scheduled)').optional(),
    channel: OptionalString.describe('Primary channel (newsletter, blog, youtube, etc.)').optional(),
    owner: OptionalString.describe('Lead owner or assignee').optional(),
    summary: OptionalString.describe('Short synopsis of the piece').optional(),
    description: OptionalString.describe('Longer description or narrative outline').optional(),
    brief: OptionalString.describe('Key creative brief or messaging pillars').optional(),
    scheduled_for: IsoDateString.describe('Planned go-live timestamp').optional(),
    publish_at: IsoDateString.describe('Actual publish timestamp if known').optional(),
    due_at: IsoDateString.describe('Internal deadline or handoff time').optional(),
    campaign: OptionalString.describe('Campaign or initiative label').optional(),
    call_to_action: OptionalString.describe('Primary CTA for the piece').optional(),
    tags: StringOrStringArray.describe('Topical tags').optional(),
    notes: StringOrStringArray.describe('Contextual notes or reminders').optional(),
    assets: z.array(AssetSchema).max(50).optional(),
    metadata: MetadataSchema,
  })
  .strip();

const UpdateItemSchema = z
  .object({
    id: NonEmptyString.describe('Existing content calendar item id'),
    title: OptionalString,
    status: OptionalString,
    status_note: OptionalString.describe('Optional note to record alongside the status action').optional(),
    channel: NullableString,
    owner: NullableString,
    summary: NullableString,
    description: NullableString,
    brief: NullableString,
    scheduled_for: NullableIsoDateString,
    publish_at: NullableIsoDateString,
    due_at: NullableIsoDateString,
    campaign: NullableString,
    call_to_action: NullableString,
    tags: NullableStringOrArray,
    append_tags: StringOrStringArray.optional(),
    notes: NullableStringOrArray,
    append_notes: StringOrStringArray.optional(),
    assets: z.union([z.array(AssetSchema).max(50), z.null()]).optional(),
    metadata: MetadataSchema,
    merge_metadata: z.boolean().optional(),
  })
  .strip();

const IdOnlySchema = z
  .object({
    id: NonEmptyString.describe('Content calendar item identifier'),
  })
  .strip();

const ListItemsSchema = z
  .object({
    status: StringOrStringArray.describe('Filter by one or more statuses').optional(),
    channel: StringOrStringArray.describe('Filter by one or more channels').optional(),
    scheduled_from: IsoDateString.describe('Return items scheduled after this timestamp').optional(),
    scheduled_to: IsoDateString.describe('Return items scheduled before this timestamp').optional(),
    search: OptionalString.describe('Case-insensitive search across title, notes, tags, and metadata').optional(),
    sort: z
      .enum(['scheduled', 'created', 'updated'])
      .optional()
      .describe('Sort order: scheduled (default), created (newest first), updated (newest first)'),
    limit: z
      .coerce.number()
      .int()
      .positive()
      .max(500)
      .optional()
      .describe('Maximum items to return (default unlimited, hard cap 500)'),
  })
  .strip();

function toArrayOrUndefined(input?: string | string[]): string[] | undefined {
  if (input === undefined) return undefined;
  return Array.isArray(input) ? input : [input];
}

function toArrayOrNullish(input?: string | string[] | null): string[] | undefined | null {
  if (input === undefined) return undefined;
  if (input === null) return null;
  return Array.isArray(input) ? input : [input];
}

export class ContentCalendarHandler extends BaseHandler {
  readonly prefix = 'content_calendar';
  readonly aliases: string[] = [];
  private store: ContentCalendarStore;

  constructor(opts: { logger: Logger; config: HandlerConfig }) {
    super(opts);
    this.store = new ContentCalendarStore(this.config, this.logger);
  }

  getTools(): ToolSpec[] {
    return [
      {
        action: 'create_item',
        description: 'Create a content calendar entry with scheduling data',
        inputSchema: CreateItemSchema.shape,
      },
      {
        action: 'update_item',
        description: 'Update fields on a content calendar entry (null clears)',
        inputSchema: UpdateItemSchema.shape,
      },
      {
        action: 'get_item',
        description: 'Fetch a content calendar item by id',
        inputSchema: IdOnlySchema.shape,
      },
      {
        action: 'list_items',
        description: 'List content calendar entries with filters',
        inputSchema: ListItemsSchema.shape,
      },
      {
        action: 'delete_item',
        description: 'Delete a content calendar entry and snapshots',
        inputSchema: IdOnlySchema.shape,
      },
    ];
  }

  async execute(action: string, args: unknown): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'create_item':
          return await this.handleCreate(args);
        case 'update_item':
          return await this.handleUpdate(args);
        case 'get_item':
          return await this.handleGet(args);
        case 'list_items':
          return await this.handleList(args);
        case 'delete_item':
          return await this.handleDelete(args);
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Content calendar handler error');
      const message = err?.message || String(err);
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
    }
  }

  private async handleCreate(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(CreateItemSchema, raw);
    const input: ContentCalendarCreateInput = {
      id: parsed.id,
      title: parsed.title,
      status: parsed.status,
      channel: parsed.channel,
      owner: parsed.owner,
      summary: parsed.summary,
      description: parsed.description,
      brief: parsed.brief,
      scheduledFor: parsed.scheduled_for,
      publishAt: parsed.publish_at,
      dueAt: parsed.due_at,
      campaign: parsed.campaign,
      callToAction: parsed.call_to_action,
      tags: toArrayOrUndefined(parsed.tags),
      notes: toArrayOrUndefined(parsed.notes),
      assets: parsed.assets?.map(asset => ({ ...asset })),
      metadata: parsed.metadata,
    };
    const created = await this.store.create(input);
    return { content: [{ type: 'text', text: JSON.stringify(created) }] };
  }

  private async handleUpdate(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(UpdateItemSchema, raw);
    const input: ContentCalendarUpdateInput = {
      title: parsed.title,
      status: parsed.status,
      statusNote: parsed.status_note,
      channel: parsed.channel === undefined ? undefined : parsed.channel,
      owner: parsed.owner === undefined ? undefined : parsed.owner,
      summary: parsed.summary === undefined ? undefined : parsed.summary,
      description: parsed.description === undefined ? undefined : parsed.description,
      brief: parsed.brief === undefined ? undefined : parsed.brief,
      scheduledFor: parsed.scheduled_for === undefined ? undefined : parsed.scheduled_for,
      publishAt: parsed.publish_at === undefined ? undefined : parsed.publish_at,
      dueAt: parsed.due_at === undefined ? undefined : parsed.due_at,
      campaign: parsed.campaign === undefined ? undefined : parsed.campaign,
      callToAction: parsed.call_to_action === undefined ? undefined : parsed.call_to_action,
      tags: toArrayOrNullish(parsed.tags),
      appendTags: toArrayOrUndefined(parsed.append_tags),
      notes: toArrayOrNullish(parsed.notes),
      appendNotes: toArrayOrUndefined(parsed.append_notes),
      assets: parsed.assets === undefined ? undefined : parsed.assets,
      metadata: parsed.metadata,
      mergeMetadata: parsed.merge_metadata,
    };
    const updated = await this.store.update(parsed.id, input);
    return { content: [{ type: 'text', text: JSON.stringify(updated) }] };
  }

  private async handleGet(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(IdOnlySchema, raw);
    const item = await this.store.get(parsed.id);
    if (!item) {
      return { content: [{ type: 'text', text: JSON.stringify({ id: parsed.id, result: null }) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(item) }] };
  }

  private async handleList(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(ListItemsSchema, raw);
    const options: ContentCalendarListOptions = {
      status: toArrayOrUndefined(parsed.status),
      channel: toArrayOrUndefined(parsed.channel),
      scheduledFrom: parsed.scheduled_from,
      scheduledTo: parsed.scheduled_to,
      search: parsed.search,
      sort: parsed.sort,
      limit: parsed.limit,
    };
    const items = await this.store.list(options);
    return { content: [{ type: 'text', text: JSON.stringify({ items }) }] };
  }

  private async handleDelete(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(IdOnlySchema, raw);
    const deleted = await this.store.remove(parsed.id);
    return { content: [{ type: 'text', text: JSON.stringify({ id: parsed.id, deleted }) }] };
  }
}
