import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { getGmail } from '../utils/google.js';
import { ensurePacificIso } from '../utils/time.js';

const ListMessagesSchema = z.object({
  query: z.string().describe('Gmail search query').optional(),
  max_results: z.coerce.number().int().positive().max(100).optional(),
}).strip();

const ComposeSchema = z.object({
  to: z.string().describe('Recipient email'),
  subject: z.string().default('').optional(),
  body: z.string().default('').optional(),
}).strip();

export class GmailHandler extends BaseHandler {
  readonly prefix = 'gmail';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'list_messages',
        description: 'List Gmail messages with optional filters',
        inputSchema: {
          query: ListMessagesSchema.shape.query,
          max_results: ListMessagesSchema.shape.max_results,
        },
      },
      {
        action: 'send_message',
        description: 'Send a Gmail message',
        inputSchema: {
          to: ComposeSchema.shape.to,
          subject: ComposeSchema.shape.subject,
          body: ComposeSchema.shape.body,
        },
      },
      {
        action: 'create_draft',
        description: 'Create a Gmail draft message',
        inputSchema: {
          to: ComposeSchema.shape.to,
          subject: ComposeSchema.shape.subject,
          body: ComposeSchema.shape.body,
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    const { gmail } = await getGmail(this.config, this.logger);
    if (!gmail) {
      return { content: [{ type: 'text', text: this.authMessage() }], isError: true };
    }

    switch (action) {
      case 'list_messages':
        return this.listMessages(gmail, args);
      case 'send_message':
        return this.sendMessage(gmail, args);
      case 'create_draft':
        return this.createDraft(gmail, args);
      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
    }
  }

  private authMessage(): string {
    const cb = `http://localhost:${this.config.PORT}/auth/google/start`;
    return `Gmail/Calendar not authenticated. Open ${cb} to authorize.`;
  }

  private async listMessages(gmail: any, args: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(ListMessagesSchema, args);
    const maxResults = parsed.max_results ?? 10;
    const res = await gmail.users.messages.list({ userId: 'me', q: parsed.query || undefined, maxResults });
    const ids = res.data.messages || [];
    if (ids.length === 0) return { content: [{ type: 'text', text: 'No messages found.' }] };
    const messages = await Promise.all(ids.map(async (m: any) => {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
      const headers = Object.fromEntries((msg.data.payload?.headers || []).map((h: any) => [h.name as string, h.value as string]));
      const date = headers.Date ? ensurePacificIso(headers.Date) ?? headers.Date : '';
      return `- ${date} | ${headers.From || ''} | ${headers.Subject || ''} | id=${msg.data.id}`;
    }));
    const out = messages.filter(Boolean);
    return { content: [{ type: 'text', text: out.join('\n') }] };
  }

  private async sendMessage(gmail: any, args: unknown): Promise<CallToolResult> {
    const { to, subject = '', body = '' } = this.parseArgs(ComposeSchema, args);
    if (!to) return { content: [{ type: 'text', text: 'Missing "to"' }], isError: true };
    const raw = this.buildEmailRaw({ to, subject, body });
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return { content: [{ type: 'text', text: `Sent message id=${res.data.id}` }] };
  }

  private async createDraft(gmail: any, args: unknown): Promise<CallToolResult> {
    const { to, subject = '', body = '' } = this.parseArgs(ComposeSchema, args);
    if (!to) return { content: [{ type: 'text', text: 'Missing "to"' }], isError: true };
    const raw = this.buildEmailRaw({ to, subject, body });
    const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
    return { content: [{ type: 'text', text: `Created draft id=${res.data.id}` }] };
  }

  private buildEmailRaw({ to, subject, body }: { to: string; subject: string; body: string }) {
    const lines = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ];
    const msg = lines.join('\r\n');
    return Buffer.from(msg).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
