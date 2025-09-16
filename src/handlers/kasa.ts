import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { getKasaClient } from '../utils/kasa.js';

const ControlDeviceSchema = z.object({
  device_id: z.string(),
  action: z.enum(['on', 'off']).describe('Action to perform'),
}).strip();

const BrightnessSchema = z.object({
  device_id: z.string(),
  brightness: z.coerce.number().int().min(1).max(100),
  transition_ms: z.coerce.number().int().min(0).max(10000).optional(),
}).strip();

const ColorSchema = z.object({
  device_id: z.string(),
  hue: z.coerce.number().int().min(0).max(360),
  saturation: z.coerce.number().int().min(0).max(100),
  brightness: z.coerce.number().int().min(1).max(100).optional(),
  transition_ms: z.coerce.number().int().min(0).max(10000).optional(),
}).strip();

const ColorTempSchema = z.object({
  device_id: z.string(),
  color_temp: z.coerce.number().int().min(1500).max(9000),
  brightness: z.coerce.number().int().min(1).max(100).optional(),
  transition_ms: z.coerce.number().int().min(0).max(10000).optional(),
}).strip();

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
          device_id: ControlDeviceSchema.shape.device_id,
          action: ControlDeviceSchema.shape.action,
        },
      },
      {
        action: 'set_brightness',
        description: 'Set bulb brightness (1-100)',
        inputSchema: {
          device_id: BrightnessSchema.shape.device_id,
          brightness: BrightnessSchema.shape.brightness,
          transition_ms: BrightnessSchema.shape.transition_ms,
        },
      },
      {
        action: 'set_color',
        description: 'Set bulb color via hue (0-360) and saturation (0-100). Optional brightness (1-100).',
        inputSchema: {
          device_id: ColorSchema.shape.device_id,
          hue: ColorSchema.shape.hue,
          saturation: ColorSchema.shape.saturation,
          brightness: ColorSchema.shape.brightness,
          transition_ms: ColorSchema.shape.transition_ms,
        },
      },
      {
        action: 'set_color_temp',
        description: 'Set bulb white color temperature (e.g., 2700-6500 K). Optional brightness (1-100).',
        inputSchema: {
          device_id: ColorTempSchema.shape.device_id,
          color_temp: ColorTempSchema.shape.color_temp,
          brightness: ColorTempSchema.shape.brightness,
          transition_ms: ColorTempSchema.shape.transition_ms,
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    try {
      const client = getKasaClient(this.config);
      switch (action) {
        case 'list_devices': {
          const list = await client.getDeviceList();
          // Return concise info
          const simple = list.map((d: any) => ({ id: d.deviceId, alias: d.alias, model: d.deviceModel, status: d.status }))
          return { content: [{ type: 'text', text: JSON.stringify({ devices: simple }, null, 2) }] };
        }
        case 'control_device': {
          const { device_id, action } = this.parseArgs(ControlDeviceSchema, args);
          const on = action === 'on';
          const resp = await client.setPowerState(device_id, on);
          return { content: [{ type: 'text', text: JSON.stringify(resp, null, 2) }] };
        }
        case 'set_brightness': {
          const { device_id, brightness, transition_ms } = this.parseArgs(BrightnessSchema, args);
          const resp = await client.setBulbState(device_id, { on_off: 1, brightness, transition_period: transition_ms ?? 0 });
          return { content: [{ type: 'text', text: JSON.stringify(resp, null, 2) }] };
        }
        case 'set_color': {
          const { device_id, hue, saturation, brightness, transition_ms } = this.parseArgs(ColorSchema, args);
          const resp = await client.setBulbState(device_id, { on_off: 1, hue, saturation, ...(brightness !== undefined ? { brightness } : {}), transition_period: transition_ms ?? 0 });
          return { content: [{ type: 'text', text: JSON.stringify(resp, null, 2) }] };
        }
        case 'set_color_temp': {
          const { device_id, color_temp, brightness, transition_ms } = this.parseArgs(ColorTempSchema, args);
          const resp = await client.setBulbState(device_id, { on_off: 1, color_temp, ...(brightness !== undefined ? { brightness } : {}), transition_period: transition_ms ?? 0 });
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
