import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { getGmail } from '../utils/google.js';

export class GmailHandler extends BaseHandler {
  readonly prefix = 'gmail';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'list_messages',
        description: 'List Gmail messages with optional filters',
        inputSchema: {
          query: z.string().describe('Gmail search query').optional(),
          max_results: z.number().int().positive().max(100).default(10).optional(),
        },
      },
      {
        action: 'send_message',
        description: 'Send a Gmail message',
        inputSchema: {
          to: z.string().describe('Recipient email'),
          subject: z.string().default('').optional(),
          body: z.string().default('').optional(),
        },
      },
      {
        action: 'create_draft',
        description: 'Create a Gmail draft message',
        inputSchema: {
          to: z.string().describe('Recipient email'),
          subject: z.string().default('').optional(),
          body: z.string().default('').optional(),
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    const { gmail, reason } = await getGmail(this.config, this.logger);
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
    const cb = 'http://localhost:3000/auth/google/start';
    return `Gmail/Calendar not authenticated. Open ${cb} to authorize.`;
  }

  private async listMessages(gmail: any, args: { query?: string; max_results?: number }): Promise<CallToolResult> {
    const q = args?.query;
    const maxResults = args?.max_results || 10;
    const res = await gmail.users.messages.list({ userId: 'me', q: q || undefined, maxResults });
    const ids = res.data.messages || [];
    if (ids.length === 0) return { content: [{ type: 'text', text: 'No messages found.' }] };
    const out: string[] = [];
    for (const m of ids) {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id! , format: 'metadata', metadataHeaders: ['From','Subject','Date']});
      const headers = Object.fromEntries((msg.data.payload?.headers||[]).map((h: any)=>[h.name as string, h.value as string]));
      out.push(`- ${headers.Date || ''} | ${headers.From || ''} | ${headers.Subject || ''} | id=${msg.data.id}`);
    }
    return { content: [{ type: 'text', text: out.join('\n') }] };
  }

  private async sendMessage(gmail: any, args: { to: string; subject?: string; body?: string }): Promise<CallToolResult> {
    const { to, subject = '', body = '' } = args;
    if (!to) return { content: [{ type: 'text', text: 'Missing "to"' }], isError: true };
    const raw = this.buildEmailRaw({ to, subject, body });
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return { content: [{ type: 'text', text: `Sent message id=${res.data.id}` }] };
  }

  private async createDraft(gmail: any, args: { to: string; subject?: string; body?: string }): Promise<CallToolResult> {
    const { to, subject = '', body = '' } = args;
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
