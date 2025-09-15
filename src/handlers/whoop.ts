import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';

export class WhoopHandler extends BaseHandler {
  readonly prefix = 'whoop';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'get_recovery',
        description: 'Get Whoop recovery metrics for a date',
        inputSchema: { date: z.string().describe('YYYY-MM-DD').optional() },
      },
      {
        action: 'get_sleep',
        description: 'Get Whoop sleep metrics for a date',
        inputSchema: { date: z.string().describe('YYYY-MM-DD').optional() },
      },
      {
        action: 'get_workouts',
        description: 'Get recent Whoop workouts',
        inputSchema: { limit: z.number().int().positive().max(100).default(10).optional() },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    const msg = `whoop_${action} not implemented yet`;
    (this as any).logger?.info({ action, args }, msg);
    return {
      content: [
        { type: 'text', text: `${msg}. Echo args: ${JSON.stringify(args)}` },
      ],
      isError: false,
    };
  }
}
