import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { RizeClient } from '../utils/rize.js';

export class RizeHandler extends BaseHandler {
  readonly prefix = 'rize';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'execute_query',
        description: 'Execute a GraphQL query against Rize',
        inputSchema: {
          query: z.string().describe('GraphQL query string'),
          variables: z.record(z.any()).optional(),
        },
      },
      {
        action: 'introspect',
        description: 'Run GraphQL introspection (schema metadata)',
        inputSchema: {
          partial: z.boolean().default(true).optional(),
        },
      },
      // Typed convenience tools (reduce trial-and-error for common needs)
      {
        action: 'get_current_user',
        description: 'Get current user basic info (name, email)',
        inputSchema: {},
      },
      {
        action: 'list_projects',
        description: 'List recent projects',
        inputSchema: { first: z.number().int().positive().max(50).default(10).optional() },
      },
      {
        action: 'list_tasks',
        description: 'List recent tasks',
        inputSchema: { first: z.number().int().positive().max(50).default(10).optional() },
      },
      {
        action: 'list_client_time_entries',
        description: 'List client time entries between start/end; optionally filter by client name',
        inputSchema: {
          startTime: z.string(),
          endTime: z.string(),
          client_name: z.string().optional(),
          limit: z.number().int().positive().max(500).default(100).optional(),
        },
      },
      {
        action: 'get_client_time_spent',
        description: 'Compute total and daily hours for a client between start/end',
        inputSchema: {
          startTime: z.string(),
          endTime: z.string(),
          client_name: z.string(),
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    try {
      const client = new RizeClient(this.config);
      switch (action) {
        case 'execute_query': {
          const data = await client.query(String(args?.query), args?.variables || {});
          return this.json(data);
        }
        case 'introspect': {
          const data = await client.introspect(Boolean(args?.partial ?? true));
          return this.json(data);
        }
        case 'get_current_user': {
          const q = `query { currentUser { name email } }`;
          const data = await client.query(q);
          return this.json(data);
        }
        case 'list_projects': {
          const first = Number(args?.first ?? 10);
          const q = `query($first: Int!) { projects(first: $first) { edges { node { name color createdAt updatedAt } } } }`;
          const data = await client.query(q, { first });
          return this.json(data);
        }
        case 'list_tasks': {
          const first = Number(args?.first ?? 10);
          const q = `query($first: Int!) { tasks(first: $first) { edges { node { name createdAt updatedAt } } } }`;
          const data = await client.query(q, { first });
          return this.json(data);
        }
        case 'list_client_time_entries': {
          const startTime = String(args?.startTime);
          const endTime = String(args?.endTime);
          const clientName = args?.client_name ? String(args?.client_name) : undefined;
          const q = `query($start:String!,$end:String!){ clientTimeEntries(startTime:$start,endTime:$end){ client { name } startTime endTime duration } }`;
          const resp = await client.query(q, { start: startTime, end: endTime });
          let entries = resp?.data?.clientTimeEntries || [];
          if (clientName) entries = entries.filter((e: any) => e?.client?.name === clientName);
          const limit = Number(args?.limit ?? 100);
          entries = entries.slice(0, limit);
          return this.json({ data: { clientTimeEntries: entries } });
        }
        case 'get_client_time_spent': {
          const startTime = String(args?.startTime);
          const endTime = String(args?.endTime);
          const clientName = String(args?.client_name);
          const q = `query($start:String!,$end:String!){ clientTimeEntries(startTime:$start,endTime:$end){ client { name } startTime endTime duration } }`;
          const resp = await client.query(q, { start: startTime, end: endTime });
          const all = (resp?.data?.clientTimeEntries || []).filter((e: any) => e?.client?.name === clientName);
          const totalSeconds = all.reduce((acc: number, e: any) => acc + (e?.duration || 0), 0);
          const byDay: Record<string, { seconds: number; count: number }> = {};
          for (const e of all) {
            const day = new Date(e.startTime).toISOString().slice(0, 10);
            if (!byDay[day]) byDay[day] = { seconds: 0, count: 0 };
            byDay[day].seconds += e.duration || 0;
            byDay[day].count += 1;
          }
          const daily = Object.entries(byDay).sort().map(([date, v]) => ({ date, seconds: v.seconds, sessions: v.count }));
          return this.json({ data: { client: clientName, startTime, endTime, totalSeconds, daily, entries: all.length } });
        }
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Rize error');
      return { content: [{ type: 'text', text: `Rize error: ${err?.message || String(err)}` }], isError: true };
    }
  }

  private json(obj: any): CallToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
  }
}
