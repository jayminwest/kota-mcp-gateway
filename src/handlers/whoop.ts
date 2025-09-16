import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { WhoopClient } from '../utils/whoop.js';

const RangeSchema = z.object({
  start: z.string().describe('ISO start time').optional(),
  end: z.string().describe('ISO end time').optional(),
  limit: z.coerce.number().int().positive().max(25).optional(),
  next_token: z.string().optional(),
  all: z.boolean().optional(),
  max_pages: z.coerce.number().int().positive().max(100).optional(),
  max_items: z.coerce.number().int().positive().max(1000).optional(),
}).strip();

const SleepIdSchema = z.object({ sleep_id: z.string() }).strip();
const WorkoutIdSchema = z.object({ workout_id: z.string() }).strip();
const CycleIdSchema = z.object({ cycle_id: z.coerce.number().int().positive() }).strip();

export class WhoopHandler extends BaseHandler {
  readonly prefix = 'whoop';

  getTools(): ToolSpec[] {
    return [
      { action: 'get_profile', description: 'Get basic user profile (name/email)', inputSchema: {} },
      { action: 'get_body_measurements', description: 'Get user body measurements (height, weight, max HR)', inputSchema: {} },
      { action: 'get_recovery', description: 'List recoveries (paged)', inputSchema: RangeSchema.shape },
      { action: 'get_sleep', description: 'List sleeps (paged)', inputSchema: RangeSchema.shape },
      { action: 'get_workouts', description: 'List workouts (paged)', inputSchema: RangeSchema.shape },
      { action: 'get_cycles', description: 'List cycles (paged)', inputSchema: RangeSchema.shape },
      // By-ID and cycle subresources
      { action: 'get_sleep_by_id', description: 'Get a sleep by UUID', inputSchema: SleepIdSchema.shape },
      { action: 'get_workout_by_id', description: 'Get a workout by UUID', inputSchema: WorkoutIdSchema.shape },
      { action: 'get_cycle_by_id', description: 'Get a cycle by ID', inputSchema: CycleIdSchema.shape },
      { action: 'get_cycle_recovery', description: 'Get recovery for a cycle', inputSchema: CycleIdSchema.shape },
      { action: 'get_cycle_sleep', description: 'Get sleep for a cycle', inputSchema: CycleIdSchema.shape },
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
          const { sleep_id } = this.parseArgs(SleepIdSchema, args);
          const data = await client.getSleepById(sleep_id);
          return this.jsonResult(data, 'Sleep');
        }
        case 'get_workout_by_id': {
          const { workout_id } = this.parseArgs(WorkoutIdSchema, args);
          const data = await client.getWorkoutById(workout_id);
          return this.jsonResult(data, 'Workout');
        }
        case 'get_cycle_by_id': {
          const { cycle_id } = this.parseArgs(CycleIdSchema, args);
          const data = await client.getCycleById(cycle_id);
          return this.jsonResult(data, 'Cycle');
        }
        case 'get_cycle_recovery': {
          const { cycle_id } = this.parseArgs(CycleIdSchema, args);
          const data = await client.getCycleRecovery(cycle_id);
          return this.jsonResult(data, 'Cycle Recovery');
        }
        case 'get_cycle_sleep': {
          const { cycle_id } = this.parseArgs(CycleIdSchema, args);
          const data = await client.getCycleSleep(cycle_id);
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

  private toParams(args: unknown) {
    const parsed = this.parseArgs(RangeSchema, args);
    return {
      start: parsed.start,
      end: parsed.end,
      limit: parsed.limit ?? 10,
      nextToken: parsed.next_token,
      all: parsed.all ?? false,
      maxPages: parsed.max_pages ?? 10,
      maxItems: parsed.max_items ?? 50,
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
