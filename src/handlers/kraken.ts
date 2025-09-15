import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';

export class KrakenHandler extends BaseHandler {
  readonly prefix = 'kraken';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'get_ticker',
        description: 'Get ticker price for a symbol pair (e.g., BTCUSD)',
        inputSchema: {
          pair: z.string().describe('Trading pair, e.g., BTCUSD'),
        },
      },
      {
        action: 'get_balance',
        description: 'Get account balances (requires API credentials)',
        inputSchema: {},
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    const msg = `kraken_${action} not implemented yet`;
    this.logger.info({ action, args }, msg);
    return { content: [{ type: 'text', text: `${msg}. Echo args: ${JSON.stringify(args)}` }], isError: false };
  }
}

