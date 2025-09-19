import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { getCalendar } from '../utils/google.js';

const ListEventsSchema = z.object({
  start: z.string().describe('ISO start time').optional(),
  end: z.string().describe('ISO end time').optional(),
  max_results: z.coerce.number().int().positive().max(100).optional(),
}).strip();

const CreateEventSchema = z.object({
  title: z.string(),
  start: z.string().describe('ISO start time'),
  end: z.string().describe('ISO end time'),
  description: z.string().optional(),
  attendees: z.array(z.string()).optional(),
}).strip();

const UpdateEventSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  description: z.string().optional(),
}).strip();

const DeleteEventSchema = z.object({
  id: z.string(),
}).strip();

export class CalendarHandler extends BaseHandler {
  readonly prefix = 'calendar';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'list_events',
        description: 'List calendar events in a time range',
        inputSchema: {
          start: ListEventsSchema.shape.start,
          end: ListEventsSchema.shape.end,
          max_results: ListEventsSchema.shape.max_results,
        },
      },
      {
        action: 'create_event',
        description: 'Create a calendar event',
        inputSchema: {
          title: CreateEventSchema.shape.title,
          start: CreateEventSchema.shape.start,
          end: CreateEventSchema.shape.end,
          description: CreateEventSchema.shape.description,
          attendees: CreateEventSchema.shape.attendees,
        },
      },
      {
        action: 'update_event',
        description: 'Update a calendar event by ID',
        inputSchema: {
          id: UpdateEventSchema.shape.id,
          title: UpdateEventSchema.shape.title,
          start: UpdateEventSchema.shape.start,
          end: UpdateEventSchema.shape.end,
          description: UpdateEventSchema.shape.description,
        },
      },
      {
        action: 'delete_event',
        description: 'Delete a calendar event by ID',
        inputSchema: {
          id: DeleteEventSchema.shape.id,
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
      case 'delete_event':
        return this.deleteEvent(calendar, args);
      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
    }
  }

  private authMessage(): string {
    return `Gmail/Calendar not authenticated. Open http://localhost:${this.config.PORT}/auth/google/start to authorize.`;
  }

  private async listEvents(calendar: any, args: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(ListEventsSchema, args);
    const start = parsed.start ? new Date(parsed.start) : new Date();
    const end = parsed.end ? new Date(parsed.end) : new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const maxResults = parsed.max_results ?? 10;
    const res = await calendar.events.list({
      calendarId: 'primary', timeMin: start.toISOString(), timeMax: end.toISOString(), maxResults, singleEvents: true, orderBy: 'startTime'
    });
    const items = res.data.items || [];
    if (items.length === 0) return { content: [{ type: 'text', text: 'No events found.' }] };
    const out = items.map((e: any) => `- ${e.start?.dateTime || e.start?.date} → ${e.end?.dateTime || e.end?.date} | ${e.summary || '(no title)'} | id=${e.id}`);
    return { content: [{ type: 'text', text: out.join('\n') }] };
  }

  private async createEvent(calendar: any, args: unknown): Promise<CallToolResult> {
    const { title, start, end, description, attendees } = this.parseArgs(CreateEventSchema, args);
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

  private async updateEvent(calendar: any, args: unknown): Promise<CallToolResult> {
    const { id, title, start, end, description } = this.parseArgs(UpdateEventSchema, args);
    if (!id) return { content: [{ type: 'text', text: 'Missing id' }], isError: true };
    const patch: any = {};
    if (title) patch.summary = title;
    if (description) patch.description = description;
    if (start) patch.start = { dateTime: new Date(start).toISOString() };
    if (end) patch.end = { dateTime: new Date(end).toISOString() };
    const res = await calendar.events.patch({ calendarId: 'primary', eventId: id, requestBody: patch });
    return { content: [{ type: 'text', text: `Updated event id=${res.data.id}` }] };
  }

  private async deleteEvent(calendar: any, args: unknown): Promise<CallToolResult> {
    const { id } = this.parseArgs(DeleteEventSchema, args);
    if (!id) return { content: [{ type: 'text', text: 'Missing id' }], isError: true };
    await calendar.events.delete({ calendarId: 'primary', eventId: id });
    return { content: [{ type: 'text', text: `Deleted event id=${id}` }] };
  }
}
