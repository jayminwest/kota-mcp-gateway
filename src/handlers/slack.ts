import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { getSlackUserToken, slackApi, loadSlackTokens } from '../utils/slack.js';

const ConversationType = z.enum(['public_channel', 'private_channel', 'im', 'mpim']);

const ListConversationsSchema = z.object({
  types: z.array(ConversationType).optional().describe('Filter conversation types'),
  limit: z.coerce.number().int().positive().max(200).optional().describe('Max results (default 100)'),
  cursor: z.string().optional().describe('Pagination cursor from previous call'),
  include_archived: z.boolean().optional().describe('Include archived conversations'),
}).strip();

const GetMessagesSchema = z.object({
  channel: z.string().describe('Conversation ID (channel, group, or DM)'),
  limit: z.coerce.number().int().positive().max(200).optional().describe('Max messages (default 50)'),
  cursor: z.string().optional().describe('Pagination cursor from previous call'),
  oldest: z.string().optional().describe('Oldest timestamp (Unix seconds or ISO). Inclusive unless inclusive=false'),
  latest: z.string().optional().describe('Latest timestamp (Unix seconds or ISO). Inclusive unless inclusive=false'),
  inclusive: z.boolean().optional().describe('Include oldest/latest timestamps in the results (default true)'),
  only_self: z.boolean().optional().describe('If true, only return messages authored by the authenticated user'),
}).strip();

export class SlackHandler extends BaseHandler {
  readonly prefix = 'slack';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'list_conversations',
        description: 'List Slack conversations (channels, private groups, and DMs)',
        inputSchema: {
          types: ListConversationsSchema.shape.types,
          limit: ListConversationsSchema.shape.limit,
          cursor: ListConversationsSchema.shape.cursor,
          include_archived: ListConversationsSchema.shape.include_archived,
        },
      },
      {
        action: 'get_messages',
        description: 'Fetch message history for a Slack conversation',
        inputSchema: {
          channel: GetMessagesSchema.shape.channel,
          limit: GetMessagesSchema.shape.limit,
          cursor: GetMessagesSchema.shape.cursor,
          oldest: GetMessagesSchema.shape.oldest,
          latest: GetMessagesSchema.shape.latest,
          inclusive: GetMessagesSchema.shape.inclusive,
          only_self: GetMessagesSchema.shape.only_self,
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'list_conversations':
          return await this.listConversations(args);
        case 'get_messages':
          return await this.getMessages(args);
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Slack error');
      return { content: [{ type: 'text', text: `Slack error: ${err?.message || String(err)}` }], isError: true };
    }
  }

  private async listConversations(args: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(ListConversationsSchema, args);
    const token = await getSlackUserToken(this.config, this.logger);
    const types = parsed.types?.join(',') || 'public_channel,private_channel,im,mpim';
    const payload: Record<string, any> = {
      types,
      limit: parsed.limit ?? 100,
      exclude_archived: parsed.include_archived ? false : true,
    };
    if (parsed.cursor) payload.cursor = parsed.cursor;
    const data = await slackApi(token, 'conversations.list', payload);
    const channels = (data.channels || []).map((c: any) => ({
      id: c.id,
      name: c.name || c.user || c.context_team_id || '',
      is_channel: c.is_channel,
      is_group: c.is_group,
      is_im: c.is_im,
      is_mpim: c.is_mpim,
      is_archived: c.is_archived,
      created: c.created,
      num_members: c.num_members,
    }));
    const result = {
      channels,
      next_cursor: data.response_metadata?.next_cursor || null,
    };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  private async getMessages(args: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(GetMessagesSchema, args);
    const token = await getSlackUserToken(this.config, this.logger);
    const payload: Record<string, any> = {
      channel: parsed.channel,
      limit: parsed.limit ?? 50,
      inclusive: parsed.inclusive ?? true,
    };
    if (parsed.cursor) payload.cursor = parsed.cursor;
    const oldest = this.toSlackTimestamp(parsed.oldest);
    if (oldest) payload.oldest = oldest;
    const latest = this.toSlackTimestamp(parsed.latest);
    if (latest) payload.latest = latest;
    const data = await slackApi(token, 'conversations.history', payload);
    let messages = data.messages || [];
    if (parsed.only_self) {
      const tokens = await loadSlackTokens(this.config);
      const selfId = tokens?.authed_user?.id;
      if (selfId) {
        messages = messages.filter((m: any) => m.user === selfId);
      }
    }
    const result = {
      messages,
      next_cursor: data.response_metadata?.next_cursor || null,
      has_more: data.has_more || false,
    };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  private toSlackTimestamp(value?: string) {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return undefined;
    return (date.getTime() / 1000).toFixed(6);
  }
}
