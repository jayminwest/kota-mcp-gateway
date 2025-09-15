import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';

export class RizeHandler extends BaseHandler {
  readonly prefix = 'rize';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'get_summary',
        description: 'Get time tracking summary for a date range',
        inputSchema: {
          start: z.string().describe('ISO start time'),
          end: z.string().describe('ISO end time'),
        },
      },
      {
        action: 'log_focus',
        description: 'Log a focus session with duration (minutes)',
        inputSchema: {
          topic: z.string().describe('Focus topic'),
          minutes: z.number().int().positive(),
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    const msg = `rize_${action} not implemented yet`;
    this.logger.info({ action, args }, msg);
    return { content: [{ type: 'text', text: `${msg}. Echo args: ${JSON.stringify(args)}` }], isError: false };
  }
}

