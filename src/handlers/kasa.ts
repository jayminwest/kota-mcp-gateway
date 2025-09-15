import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { KasaClient } from '../utils/kasa.js';

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
    try {
      const client = new KasaClient(this.config);
      switch (action) {
        case 'list_devices': {
          const list = await client.getDeviceList();
          // Return concise info
          const simple = list.map((d: any) => ({ id: d.deviceId, alias: d.alias, model: d.deviceModel, status: d.status }))
          return { content: [{ type: 'text', text: JSON.stringify({ devices: simple }, null, 2) }] };
        }
        case 'control_device': {
          const id = String(args?.device_id);
          const on = String(args?.action).toLowerCase() === 'on';
          const resp = await client.setPowerState(id, on);
          return { content: [{ type: 'text', text: JSON.stringify(resp, null, 2) }] };
        }
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Kasa error');
      return { content: [{ type: 'text', text: `Kasa error: ${err?.message || String(err)}` }], isError: true };
    }
  }
}
