import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';

export class SlackHandler extends BaseHandler {
  readonly prefix = 'slack';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'send_message',
        description: 'Send a Slack message to a channel',
        inputSchema: {
          channel: z.string().describe('Channel ID or name'),
          text: z.string().describe('Message text'),
        },
      },
      {
        action: 'list_channels',
        description: 'List Slack channels',
        inputSchema: {},
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    const msg = `slack_${action} not implemented yet`;
    this.logger.info({ action, args }, msg);
    return { content: [{ type: 'text', text: `${msg}. Echo args: ${JSON.stringify(args)}` }], isError: false };
  }
}

