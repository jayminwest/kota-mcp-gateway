import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { RizeClient } from '../utils/rize.js';
import { ensurePacificIso, toPacificDate } from '../utils/time.js';

const RecentListSchema = z
  .object({
    first: z.coerce.number().int().positive().max(50).optional(),
  })
  .strip();

const TimeEntriesSchema = z
  .object({
    startTime: z.string().describe('RFC3339 timestamp for range start (inclusive)'),
    endTime: z.string().describe('RFC3339 timestamp for range end (exclusive)'),
    client_name: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  })
  .strip();

const QUERIES = {
  currentUser: `
    query CurrentUser {
      currentUser {
        name
        email
      }
    }
  `,
  projects: `
    query Projects($first: Int!) {
      projects(first: $first) {
        edges {
          node {
            id
            name
            color
            createdAt
            updatedAt
          }
        }
      }
    }
  `,
  tasks: `
    query Tasks($first: Int!) {
      tasks(first: $first) {
        edges {
          node {
            id
            name
            createdAt
            updatedAt
          }
        }
      }
    }
  `,
  clientTimeEntries: `
    query ClientTimeEntries($start: ISO8601DateTime!, $end: ISO8601DateTime!) {
      clientTimeEntries(startTime: $start, endTime: $end) {
        client { name }
        startTime
        endTime
        duration
      }
    }
  `,
} as const;

export class RizeHandler extends BaseHandler {
  readonly prefix = 'rize';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'current_user',
        description: 'Fetch the authenticated Rize user (name, email)',
        inputSchema: {},
      },
      {
        action: 'recent_projects',
        description: 'List recently created or updated projects (default 10)',
        inputSchema: RecentListSchema.shape,
      },
      {
        action: 'recent_tasks',
        description: 'List recently created or updated tasks (default 10)',
        inputSchema: RecentListSchema.shape,
      },
      {
        action: 'time_entries',
        description: 'Fetch client time entries within a date range plus summary totals',
        inputSchema: TimeEntriesSchema.shape,
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    try {
      const client = new RizeClient(this.config);
      switch (action) {
        case 'current_user': {
          const data = await client.query(QUERIES.currentUser);
          return this.json(data);
        }
        case 'recent_projects': {
          const { first } = this.parseArgs(RecentListSchema, args);
          const limit = first ?? 10;
          const resp = await client.query(QUERIES.projects, { first: limit });
          const edges = resp?.data?.projects?.edges ?? [];
          if (!edges.length) return this.empty('Empty results (no projects found)');
          return this.json({ projects: edges.map((edge: any) => edge?.node).filter(Boolean) });
        }
        case 'recent_tasks': {
          const { first } = this.parseArgs(RecentListSchema, args);
          const limit = first ?? 10;
          const resp = await client.query(QUERIES.tasks, { first: limit });
          const edges = resp?.data?.tasks?.edges ?? [];
          if (!edges.length) return this.empty('Empty results (no tasks found)');
          return this.json({ tasks: edges.map((edge: any) => edge?.node).filter(Boolean) });
        }
        case 'time_entries': {
          const parsed = this.parseArgs(TimeEntriesSchema, args);
          const { startTime, endTime, client_name: clientName } = parsed;
          const limit = parsed.limit ?? 100;
          const resp = await client.query(QUERIES.clientTimeEntries, {
            start: startTime,
            end: endTime,
          });
          const allEntries = Array.isArray(resp?.data?.clientTimeEntries)
            ? resp.data.clientTimeEntries
            : [];
          const filtered = clientName
            ? allEntries.filter((entry: any) => entry?.client?.name === clientName)
            : allEntries;
          if (!filtered.length) return this.empty('Empty results (no matching time entries)');

          const totalSeconds = filtered.reduce(
            (acc: number, entry: any) => acc + (entry?.duration || 0),
            0,
          );
          const byDay: Record<string, { seconds: number; sessions: number }> = {};
          const normalizedEntries = filtered.map((entry: any) => {
            const startTimeFormatted = this.formatTimestamp(entry.startTime);
            const endTimeFormatted = this.formatTimestamp(entry.endTime);
            return {
              ...entry,
              startTime: startTimeFormatted,
              endTime: endTimeFormatted,
            };
          });
          for (const entry of normalizedEntries) {
            const sourceForDay = entry.startTime ?? entry.endTime;
            const day = sourceForDay ? toPacificDate(sourceForDay) : toPacificDate(new Date());
            if (!byDay[day]) {
              byDay[day] = { seconds: 0, sessions: 0 };
            }
            byDay[day].seconds += entry?.duration || 0;
            byDay[day].sessions += 1;
          }
          const daily = Object.entries(byDay)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([date, value]) => ({ date, ...value }));
          return this.json({
            data: {
              summary: {
                startTime: this.formatTimestamp(startTime) ?? startTime,
                endTime: this.formatTimestamp(endTime) ?? endTime,
                client: clientName ?? null,
                totalSeconds,
                entryCount: normalizedEntries.length,
                distinctClients: new Set(normalizedEntries.map((entry: any) => entry?.client?.name)).size,
              },
              daily,
              entries: normalizedEntries.slice(0, limit),
            },
          });
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

  private empty(message = 'Empty results'): CallToolResult {
    return { content: [{ type: 'text', text: message }] };
  }

  private formatTimestamp(value?: string): string | undefined {
    return ensurePacificIso(value) ?? value;
  }
}
