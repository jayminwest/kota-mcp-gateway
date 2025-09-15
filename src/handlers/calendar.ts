import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { getCalendar } from '../utils/google.js';

export class CalendarHandler extends BaseHandler {
  readonly prefix = 'calendar';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'list_events',
        description: 'List calendar events in a time range',
        inputSchema: {
          start: z.string().describe('ISO start time').optional(),
          end: z.string().describe('ISO end time').optional(),
          max_results: z.number().int().positive().max(100).default(10).optional(),
        },
      },
      {
        action: 'create_event',
        description: 'Create a calendar event',
        inputSchema: {
          title: z.string(),
          start: z.string().describe('ISO start time'),
          end: z.string().describe('ISO end time'),
          description: z.string().optional(),
          attendees: z.array(z.string()).optional(),
        },
      },
      {
        action: 'update_event',
        description: 'Update a calendar event by ID',
        inputSchema: {
          id: z.string(),
          title: z.string().optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          description: z.string().optional(),
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    const { calendar } = await getCalendar(this.config, this.logger);
    if (!calendar) {
      return { content: [{ type: 'text', text: this.authMessage() }], isError: true };
    }

    switch (action) {
      case 'list_events':
        return this.listEvents(calendar, args);
      case 'create_event':
        return this.createEvent(calendar, args);
      case 'update_event':
        return this.updateEvent(calendar, args);
      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
    }
  }

  private authMessage(): string {
    return `Gmail/Calendar not authenticated. Open http://localhost:3000/auth/google/start to authorize.`;
  }

  private async listEvents(calendar: any, args: { start?: string; end?: string; max_results?: number }): Promise<CallToolResult> {
    const start = args?.start ? new Date(args.start) : new Date();
    const end = args?.end ? new Date(args.end) : new Date(Date.now() + 7*24*3600*1000);
    const maxResults = args?.max_results || 10;
    const res = await calendar.events.list({
      calendarId: 'primary', timeMin: start.toISOString(), timeMax: end.toISOString(), maxResults, singleEvents: true, orderBy: 'startTime'
    });
    const items = res.data.items || [];
    if (items.length === 0) return { content: [{ type: 'text', text: 'No events found.' }] };
    const out = items.map((e: any) => `- ${e.start?.dateTime || e.start?.date} → ${e.end?.dateTime || e.end?.date} | ${e.summary || '(no title)'} | id=${e.id}`);
    return { content: [{ type: 'text', text: out.join('\n') }] };
  }

  private async createEvent(calendar: any, args: { title: string; start: string; end: string; description?: string; attendees?: string[] }): Promise<CallToolResult> {
    const { title, start, end, description, attendees } = args;
    if (!title || !start || !end) return { content: [{ type: 'text', text: 'Missing title/start/end' }], isError: true };
    const res = await calendar.events.insert({ calendarId: 'primary', requestBody: {
      summary: title,
      description,
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(end).toISOString() },
      attendees: attendees?.map(e => ({ email: e }))
    }});
    return { content: [{ type: 'text', text: `Created event id=${res.data.id}` }] };
  }

  private async updateEvent(calendar: any, args: { id: string; title?: string; start?: string; end?: string; description?: string }): Promise<CallToolResult> {
    const { id, title, start, end, description } = args;
    if (!id) return { content: [{ type: 'text', text: 'Missing id' }], isError: true };
    const patch: any = {};
    if (title) patch.summary = title;
    if (description) patch.description = description;
    if (start) patch.start = { dateTime: new Date(start).toISOString() };
    if (end) patch.end = { dateTime: new Date(end).toISOString() };
    const res = await calendar.events.patch({ calendarId: 'primary', eventId: id, requestBody: patch });
    return { content: [{ type: 'text', text: `Updated event id=${res.data.id}` }] };
  }
}
