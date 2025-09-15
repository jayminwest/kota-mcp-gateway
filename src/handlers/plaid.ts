import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';

export class PlaidHandler extends BaseHandler {
  readonly prefix = 'plaid';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'get_accounts',
        description: 'List Plaid-linked accounts',
        inputSchema: {},
      },
      {
        action: 'get_transactions',
        description: 'List Plaid transactions for an account',
        inputSchema: {
          account_id: z.string(),
          start: z.string().describe('YYYY-MM-DD').optional(),
          end: z.string().describe('YYYY-MM-DD').optional(),
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    const msg = `plaid_${action} not implemented yet`;
    (this as any).logger?.info({ action, args }, msg);
    return {
      content: [
        { type: 'text', text: `${msg}. Echo args: ${JSON.stringify(args)}` },
      ],
      isError: false,
    };
  }
}
