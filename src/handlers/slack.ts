import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { getSlackUserToken, slackApi, loadSlackTokens } from '../utils/slack.js';
import { ensurePacificReadable, toPacificIso, toPacificReadable } from '../utils/time.js';

const ConversationType = z.enum(['public_channel', 'private_channel', 'im', 'mpim']);

const ListConversationsSchema = z.object({
  types: z.array(ConversationType).optional().describe('Filter conversation types'),
  limit: z.coerce.number().int().positive().max(200).optional().describe('Max results (default 100)'),
  cursor: z.string().optional().describe('Pagination cursor from previous call'),
  include_archived: z.boolean().optional().describe('Include archived conversations'),
}).strip();

const GetMessagesSchema = z.object({
  channel: z.string().optional().describe('Conversation ID (channel, group, or DM). Defaults to configured channel when omitted'),
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
      created: c.created ? this.formatUnixTimestamp(c.created) : undefined,
      created_unix: c.created,
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
    const channelId = parsed.channel ?? this.config.SLACK_DEFAULT_CHANNEL;
    if (!channelId) {
      throw new Error('Slack channel is required. Provide a channel or configure SLACK_DEFAULT_CHANNEL.');
    }
    const payload: Record<string, any> = {
      channel: channelId,
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
    const simplifiedMessages = await this.summarizeMessages(token, messages);
    const result = {
      messages: simplifiedMessages,
      next_cursor: data.response_metadata?.next_cursor || null,
      has_more: data.has_more || false,
    };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  private async summarizeMessages(
    token: string,
    messages: any[],
  ): Promise<Array<{ timestamp: string; sender: string; content: string }>> {
    if (!messages.length) return [];
    const userNames = await this.buildUserNameMap(token, messages);
    return messages.map((message: any) => {
      const timestamp = this.formatSlackTimestamp(message.ts) ?? message.ts;
      const sender = this.resolveSenderName(message, userNames);
      const content = this.buildMessageContent(message, userNames) || '[no text]';
      return { timestamp, sender, content };
    });
  }

  private async buildUserNameMap(token: string, messages: any[]): Promise<Record<string, string>> {
    const names: Record<string, string> = {};
    const pending = new Set<string>();

    for (const message of messages) {
      const userId = typeof message.user === 'string' ? message.user : undefined;
      if (!userId) continue;
      const profileName = this.getProfileDisplayName(message.user_profile);
      if (profileName) {
        names[userId] = profileName;
        continue;
      }
      if (!names[userId]) {
        pending.add(userId);
      }
    }

    for (const userId of pending) {
      try {
        const data = await slackApi(token, 'users.info', { user: userId });
        const profileName =
          this.getProfileDisplayName(data.user?.profile) ||
          (typeof data.user?.name === 'string' ? data.user.name : undefined);
        if (profileName) {
          names[userId] = profileName;
        } else {
          names[userId] = userId;
        }
      } catch (err: any) {
        this.logger.debug({ err: err?.message || err, userId }, 'Failed to fetch Slack user info');
        names[userId] = userId;
      }
    }

    return names;
  }

  private getProfileDisplayName(profile?: any): string | undefined {
    if (!profile) return undefined;
    if (typeof profile.display_name === 'string' && profile.display_name.trim()) {
      return profile.display_name.trim();
    }
    if (typeof profile.real_name === 'string' && profile.real_name.trim()) {
      return profile.real_name.trim();
    }
    return undefined;
  }

  private resolveSenderName(message: any, userNames: Record<string, string>): string {
    const profileName = this.getProfileDisplayName(message.user_profile);
    if (profileName) return profileName;
    const userId = typeof message.user === 'string' ? message.user : undefined;
    if (userId && userNames[userId]) return userNames[userId];
    if (typeof message.username === 'string' && message.username.trim()) return message.username.trim();
    if (message.bot_profile?.name) return String(message.bot_profile.name);
    if (userId) return userId;
    if (typeof message.bot_id === 'string') return `Bot ${message.bot_id}`;
    return 'Unknown';
  }

  private buildMessageContent(message: any, userNames: Record<string, string>): string {
    const parts: string[] = [];

    // Prefer blocks over text to avoid duplication (text is often a fallback for blocks)
    let hasBlocks = false;
    if (Array.isArray(message.blocks)) {
      const blockTexts = this.extractBlockText(message.blocks)
        .map((text) => this.decodeSlackFormatting(text, userNames))
        .filter((text) => !!text.trim());
      if (blockTexts.length) {
        parts.push(blockTexts.join('\n'));
        hasBlocks = true;
      }
    }

    // Only use message.text if we didn't get content from blocks
    if (!hasBlocks && typeof message.text === 'string' && message.text.trim()) {
      parts.push(this.decodeSlackFormatting(message.text.trim(), userNames));
    }

    if (Array.isArray(message.attachments)) {
      const attachmentSummaries = message.attachments
        .map((att: any): string | undefined => {
          const candidate = att?.fallback ?? att?.text ?? att?.title;
          return typeof candidate === 'string' ? candidate : undefined;
        })
        .filter((value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value: string) => this.decodeSlackFormatting(value.trim(), userNames));
      if (attachmentSummaries.length) {
        parts.push(`Attachments: ${attachmentSummaries.join(' | ')}`);
      }
    }

    if (Array.isArray(message.files)) {
      const fileSummaries = message.files
        .map((file: any): string | undefined => {
          const candidate = file?.title ?? file?.name;
          return typeof candidate === 'string' ? candidate : undefined;
        })
        .filter((value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0);
      if (fileSummaries.length) {
        parts.push(`Files: ${fileSummaries.join(', ')}`);
      }
    }

    if (message.thread_ts && message.thread_ts !== message.ts) {
      const parentTs = this.formatSlackTimestamp(message.thread_ts) ?? message.thread_ts;
      parts.push(`(reply in thread ${parentTs})`);
    }

    const combined = parts.map((part) => part.trim()).filter(Boolean).join('\n').trim();
    if (combined) return combined;
    if (typeof message.subtype === 'string' && message.subtype.trim()) {
      return message.subtype.trim();
    }
    return '';
  }

  private extractBlockText(blocks: any[]): string[] {
    const texts: string[] = [];
    for (const block of blocks) {
      const blockText = block?.text?.text;
      if (typeof blockText === 'string' && blockText.trim()) {
        texts.push(blockText.trim());
      }
      if (Array.isArray(block?.elements)) {
        for (const element of block.elements) {
          if (typeof element?.text === 'string' && element.text.trim()) {
            texts.push(element.text.trim());
          }
          if (Array.isArray(element?.elements)) {
            for (const inner of element.elements) {
              if (typeof inner?.text === 'string' && inner.text.trim()) {
                texts.push(inner.text.trim());
              }
            }
          }
        }
      }
    }
    return texts;
  }

  private decodeSlackFormatting(text: string, userNames: Record<string, string>): string {
    if (!text) return '';
    let result = text;
    result = result.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    result = result.replace(/<@([A-Z0-9]+)>/gi, (_match, userId: string) => {
      const name = userNames[userId];
      return name ? `@${name}` : `@${userId}`;
    });
    result = result.replace(/<#([A-Z0-9]+)\|([^>]+)>/gi, (_match, _channelId: string, channelName: string) => `#${channelName}`);
    result = result.replace(/<!([^>]+)>/gi, (_match, keyword: string) => `@${keyword}`);
    result = result.replace(/<([^|<>]+)\|([^<>]+)>/g, (_match, url: string, label: string) => `${label} (${url})`);
    result = result.replace(/<([^<>]+)>/g, (_match, value: string) => value);
    return result;
  }

  private toSlackTimestamp(value?: string) {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return undefined;
    return (date.getTime() / 1000).toFixed(6);
  }

  private formatSlackTimestamp(value?: string): string | undefined {
    if (!value) return undefined;
    if (/^\d+(\.\d+)?$/.test(value)) {
      const seconds = Number(value);
      if (!Number.isNaN(seconds)) {
        return toPacificReadable(seconds * 1000);
      }
    }
    return ensurePacificReadable(value) ?? undefined;
  }

  private formatUnixTimestamp(value?: number): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Number.isFinite(value)) return undefined;
    try {
      return toPacificIso(value * 1000);
    } catch {
      return undefined;
    }
  }
}
