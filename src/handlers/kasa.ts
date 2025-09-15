import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';

export class KasaHandler extends BaseHandler {
  readonly prefix = 'kasa';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'list_devices',
        description: 'List Kasa devices',
        inputSchema: {},
      },
      {
        action: 'control_device',
        description: 'Control a Kasa device',
        inputSchema: {
          device_id: z.string(),
          action: z.enum(['on', 'off']).describe('Action to perform'),
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    const msg = `kasa_${action} not implemented yet`;
    (this as any).logger?.info({ action, args }, msg);
    return {
      content: [
        { type: 'text', text: `${msg}. Echo args: ${JSON.stringify(args)}` },
      ],
      isError: false,
    };
  }
}
