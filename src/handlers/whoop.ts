import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { WhoopClient } from '../utils/whoop.js';

const RangeShape = {
  start: z.string().describe('ISO start time').optional(),
  end: z.string().describe('ISO end time').optional(),
  limit: z.number().int().positive().max(25).default(10).optional(),
  next_token: z.string().optional(),
  all: z.boolean().default(false).optional(),
};

export class WhoopHandler extends BaseHandler {
  readonly prefix = 'whoop';

  getTools(): ToolSpec[] {
    return [
      { action: 'get_profile', description: 'Get basic user profile (name/email)', inputSchema: {} },
      { action: 'get_body_measurements', description: 'Get user body measurements (height, weight, max HR)', inputSchema: {} },
      { action: 'get_recovery', description: 'List recoveries (paged)', inputSchema: RangeShape },
      { action: 'get_sleep', description: 'List sleeps (paged)', inputSchema: RangeShape },
      { action: 'get_workouts', description: 'List workouts (paged)', inputSchema: RangeShape },
      { action: 'get_cycles', description: 'List cycles (paged)', inputSchema: RangeShape },
      { action: 'revoke_access', description: 'Revoke access token for this user', inputSchema: {} },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    try {
      const client = new WhoopClient(this.config);
      switch (action) {
        case 'get_profile': {
          const data = await client.getProfileBasic();
          return this.jsonResult(data, 'User profile');
        }
        case 'get_body_measurements': {
          const data = await client.getBodyMeasurement();
          return this.jsonResult(data, 'Body measurements');
        }
        case 'get_recovery': {
          const data = await client.getRecoveries(this.toParams(args));
          return this.pagedResult('Recoveries', data);
        }
        case 'get_sleep': {
          const data = await client.getSleeps(this.toParams(args));
          return this.pagedResult('Sleeps', data);
        }
        case 'get_workouts': {
          const data = await client.getWorkouts(this.toParams(args));
          return this.pagedResult('Workouts', data);
        }
        case 'get_cycles': {
          const data = await client.getCycles(this.toParams(args));
          return this.pagedResult('Cycles', data);
        }
        case 'revoke_access': {
          await client.revokeAccess();
          return { content: [{ type: 'text', text: 'Access revoked (204 No Content)' }] };
        }
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Whoop error');
      return { content: [{ type: 'text', text: `Whoop error: ${err?.message || String(err)}` }], isError: true };
    }
  }

  private toParams(args: any) {
    return {
      start: args?.start,
      end: args?.end,
      limit: args?.limit,
      nextToken: args?.next_token,
      all: args?.all,
    };
  }

  private jsonResult(obj: any, title?: string): CallToolResult {
    const text = `${title ? title + ': ' : ''}${JSON.stringify(obj, null, 2)}`;
    return { content: [{ type: 'text', text }] };
  }

  private pagedResult(title: string, data: { items: any[]; nextToken?: string | null }): CallToolResult {
    const summary = `${title}: ${data.items.length} item(s)${data.nextToken ? `, nextToken=${data.nextToken}` : ''}`;
    const body = JSON.stringify(data.items, null, 2);
    return { content: [{ type: 'text', text: `${summary}\n${body}` }] };
  }
}
