import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { KrakenClient } from '../utils/kraken.js';

const GetTickerSchema = z.object({
  pair: z.string().describe('Trading pair, e.g., BTCUSD').optional(),
}).strip();

export class KrakenHandler extends BaseHandler {
  readonly prefix = 'kraken';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'get_ticker',
        description: 'Get ticker price for a symbol pair (e.g., BTCUSD)',
        inputSchema: {
          pair: GetTickerSchema.shape.pair,
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
    try {
      const client = new KrakenClient(this.config);
      switch (action) {
        case 'get_ticker': {
          const { pair } = this.parseArgs(GetTickerSchema, args);
          const data = await client.getTicker(pair || 'XBTUSD');
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        case 'get_balance': {
          const data = await client.getBalance();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Kraken error');
      return { content: [{ type: 'text', text: `Kraken error: ${err?.message || String(err)}` }], isError: true };
    }
  }
}
