import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec, HandlerConfig } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { KotaMemoryStore, type MemoryCategory, formatList } from '../utils/memory.js';

const CategoryEnum = z.enum(['preferences', 'connections', 'patterns', 'shortcuts', 'state']);

const ConversationNotesSchema = z
  .object({
    summary: z.string().min(1).describe('Concise synopsis of the current conversation'),
    flow: z.string().optional().describe('Key beats describing how the conversation has unfolded'),
    tone: z.string().optional().describe('Notable tone or energy present in the dialogue'),
    highlights: z
      .array(z.string().min(1))
      .optional()
      .describe('Bullet points capturing important moments or facts'),
    nextSteps: z
      .array(z.string().min(1))
      .optional()
      .describe('Follow-up actions or intentions agreed upon'),
    additionalContext: z
      .string()
      .optional()
      .describe('Any extra context that helps rehydrate the interaction'),
    capturedAt: z
      .string()
      .datetime()
      .optional()
      .describe('Optional ISO timestamp representing when the notes were captured'),
    metadata: z
      .record(z.string(), z.any())
      .optional()
      .describe('Structured metadata relevant to the conversation snapshot'),
  })
  .strip();

const SetSchema = z.object({
  key: z.string().min(1).describe('Memory key to store'),
  value: z.any().describe('JSON-serialisable value to persist'),
  category: CategoryEnum.optional().describe('Optional category hint'),
}).strip();

const GetSchema = z.object({
  query: z.string().min(1).describe('Key or fuzzy query to retrieve memory'),
}).strip();

const UpdateSchema = z.object({
  key: z.string().min(1).describe('Existing memory key to update'),
  addition: z.any().describe('Value to merge into the existing entry'),
}).strip();

const DeleteSchema = z.object({
  key: z.string().min(1).describe('Memory key to delete'),
}).strip();

export class MemoryHandler extends BaseHandler {
  readonly prefix = 'memory';
  private store: KotaMemoryStore;

  constructor(opts: { logger: Logger; config: HandlerConfig }) {
    super(opts);
    this.store = new KotaMemoryStore(this.config, this.logger);
  }

  getTools(): ToolSpec[] {
    return [
      {
        action: 'set',
        description: 'Persist a memory key/value pair with optional category hint',
        inputSchema: {
          key: SetSchema.shape.key,
          value: SetSchema.shape.value,
          category: SetSchema.shape.category,
        },
      },
      {
        action: 'get',
        description: 'Retrieve a concise memory entry via direct or fuzzy query',
        inputSchema: {
          query: GetSchema.shape.query,
        },
      },
      {
        action: 'update',
        description: 'Merge new information into an existing memory entry',
        inputSchema: {
          key: UpdateSchema.shape.key,
          addition: UpdateSchema.shape.addition,
        },
      },
      {
        action: 'list',
        description: 'List stored memory keys without values',
        inputSchema: {},
      },
      {
        action: 'list_archived',
        description: 'List archived memory keys (category:key@timestamp)',
        inputSchema: {},
      },
      {
        action: 'delete',
        description: 'Remove a memory entry by key',
        inputSchema: {
          key: DeleteSchema.shape.key,
        },
      },
      {
        action: 'clear_state',
        description: 'Archive and reset the current state entries',
        inputSchema: {},
      },
      {
        action: 'save_conversation_notes',
        description: 'Snapshot summary, flow, and tone of the active conversation for later recall',
        inputSchema: {
          summary: ConversationNotesSchema.shape.summary,
          flow: ConversationNotesSchema.shape.flow,
          tone: ConversationNotesSchema.shape.tone,
          highlights: ConversationNotesSchema.shape.highlights,
          nextSteps: ConversationNotesSchema.shape.nextSteps,
          additionalContext: ConversationNotesSchema.shape.additionalContext,
          capturedAt: ConversationNotesSchema.shape.capturedAt,
          metadata: ConversationNotesSchema.shape.metadata,
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'set':
          return await this.handleSet(args);
        case 'get':
          return await this.handleGet(args);
        case 'update':
          return await this.handleUpdate(args);
        case 'list':
          return await this.handleList();
        case 'list_archived':
          return await this.handleListArchived();
        case 'delete':
          return await this.handleDelete(args);
        case 'clear_state':
          return await this.handleClearState();
        case 'save_conversation_notes':
          return await this.handleSaveConversationNotes(args);
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Memory handler error');
      const message = err?.message || String(err);
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
    }
  }

  private async handleSet(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(SetSchema, raw);
    const category = parsed.category as MemoryCategory | undefined;
    const result = await this.store.set(parsed.key, parsed.value, category);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleGet(raw: unknown): Promise<CallToolResult> {
    const { query } = this.parseArgs(GetSchema, raw);
    const result = await this.store.get(query);
    const payload = result ?? { result: null };
    return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
  }

  private async handleUpdate(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(UpdateSchema, raw);
    const result = await this.store.update(parsed.key, parsed.addition);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleList(): Promise<CallToolResult> {
    const keys = await this.store.list();
    return { content: [{ type: 'text', text: formatList(keys) }] };
  }

  private async handleListArchived(): Promise<CallToolResult> {
    const keys = await this.store.listArchived();
    return { content: [{ type: 'text', text: formatList(keys) }] };
  }

  private async handleDelete(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(DeleteSchema, raw);
    const result = await this.store.remove(parsed.key);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleClearState(): Promise<CallToolResult> {
    const result = await this.store.clearState();
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleSaveConversationNotes(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(ConversationNotesSchema, raw);
    const payload = {
      ...parsed,
      savedAt: new Date().toISOString(),
    };
    const result = await this.store.set('conversation_notes', payload, 'state');
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
