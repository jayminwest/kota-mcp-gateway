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
      {
        action: 'set_brightness',
        description: 'Set bulb brightness (1-100)',
        inputSchema: {
          device_id: z.string(),
          brightness: z.number().int().min(1).max(100),
          transition_ms: z.number().int().min(0).max(10000).default(0).optional(),
        },
      },
      {
        action: 'set_color',
        description: 'Set bulb color via hue (0-360) and saturation (0-100). Optional brightness (1-100).',
        inputSchema: {
          device_id: z.string(),
          hue: z.number().int().min(0).max(360),
          saturation: z.number().int().min(0).max(100),
          brightness: z.number().int().min(1).max(100).optional(),
          transition_ms: z.number().int().min(0).max(10000).default(0).optional(),
        },
      },
      {
        action: 'set_color_temp',
        description: 'Set bulb white color temperature (e.g., 2700-6500 K). Optional brightness (1-100).',
        inputSchema: {
          device_id: z.string(),
          color_temp: z.number().int().min(1500).max(9000),
          brightness: z.number().int().min(1).max(100).optional(),
          transition_ms: z.number().int().min(0).max(10000).default(0).optional(),
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
        case 'set_brightness': {
          const id = String(args?.device_id);
          const brightness = Number(args?.brightness);
          const transition_period = Number(args?.transition_ms ?? 0);
          const resp = await client.setBulbState(id, { on_off: 1, brightness, transition_period });
          return { content: [{ type: 'text', text: JSON.stringify(resp, null, 2) }] };
        }
        case 'set_color': {
          const id = String(args?.device_id);
          const hue = Number(args?.hue);
          const saturation = Number(args?.saturation);
          const brightness = args?.brightness !== undefined ? Number(args?.brightness) : undefined;
          const transition_period = Number(args?.transition_ms ?? 0);
          const resp = await client.setBulbState(id, { on_off: 1, hue, saturation, ...(brightness ? { brightness } : {}), transition_period });
          return { content: [{ type: 'text', text: JSON.stringify(resp, null, 2) }] };
        }
        case 'set_color_temp': {
          const id = String(args?.device_id);
          const color_temp = Number(args?.color_temp);
          const brightness = args?.brightness !== undefined ? Number(args?.brightness) : undefined;
          const transition_period = Number(args?.transition_ms ?? 0);
          const resp = await client.setBulbState(id, { on_off: 1, color_temp, ...(brightness ? { brightness } : {}), transition_period });
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
