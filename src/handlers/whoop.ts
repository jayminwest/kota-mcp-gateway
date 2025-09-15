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
  max_pages: z.number().int().positive().max(100).default(10).optional(),
  max_items: z.number().int().positive().max(1000).default(50).optional(),
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
      // By-ID and cycle subresources
      { action: 'get_sleep_by_id', description: 'Get a sleep by UUID', inputSchema: { sleep_id: z.string() } },
      { action: 'get_workout_by_id', description: 'Get a workout by UUID', inputSchema: { workout_id: z.string() } },
      { action: 'get_cycle_by_id', description: 'Get a cycle by ID', inputSchema: { cycle_id: z.number().int().positive() } },
      { action: 'get_cycle_recovery', description: 'Get recovery for a cycle', inputSchema: { cycle_id: z.number().int().positive() } },
      { action: 'get_cycle_sleep', description: 'Get sleep for a cycle', inputSchema: { cycle_id: z.number().int().positive() } },
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
        case 'get_sleep_by_id': {
          const data = await client.getSleepById(String(args?.sleep_id));
          return this.jsonResult(data, 'Sleep');
        }
        case 'get_workout_by_id': {
          const data = await client.getWorkoutById(String(args?.workout_id));
          return this.jsonResult(data, 'Workout');
        }
        case 'get_cycle_by_id': {
          const data = await client.getCycleById(Number(args?.cycle_id));
          return this.jsonResult(data, 'Cycle');
        }
        case 'get_cycle_recovery': {
          const data = await client.getCycleRecovery(Number(args?.cycle_id));
          return this.jsonResult(data, 'Cycle Recovery');
        }
        case 'get_cycle_sleep': {
          const data = await client.getCycleSleep(Number(args?.cycle_id));
          return this.jsonResult(data, 'Cycle Sleep');
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
      maxPages: args?.max_pages,
      maxItems: args?.max_items,
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
