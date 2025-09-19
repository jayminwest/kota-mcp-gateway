import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec, HandlerConfig } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { DailyStore } from '../utils/daily.js';

const NonEmptyString = z.string().trim().min(1);

const QuantitySchema = z
  .object({
    value: z.number().finite().optional(),
    unit: NonEmptyString.optional(),
    grams: z.number().finite().optional(),
    volumeMl: z.number().finite().optional(),
    text: NonEmptyString.optional(),
  })
  .strip()
  .refine(
    data =>
      data.value !== undefined ||
      data.grams !== undefined ||
      data.volumeMl !== undefined ||
      Boolean(data.unit) ||
      Boolean(data.text),
    {
      message: 'Provide at least one quantity detail',
    }
  );

const MacrosSchema = z
  .object({
    calories: z.number().finite().optional(),
    protein_g: z.number().finite().optional(),
    carbs_g: z.number().finite().optional(),
    fat_g: z.number().finite().optional(),
    fiber_g: z.number().finite().optional(),
    sugar_g: z.number().finite().optional(),
  })
  .strip();

const TotalsSchema = MacrosSchema.extend({
  water_l: z.number().finite().optional(),
  caffeine_mg: z.number().finite().optional(),
  nicotine_mg: z.number().finite().optional(),
  thc_mg: z.number().finite().optional(),
  cbd_mg: z.number().finite().optional(),
  supplements: z.record(NonEmptyString, z.number().finite()).optional(),
  micros: z.record(NonEmptyString, z.number().finite()).optional(),
}).strip();

const NotesField = z.union([NonEmptyString, z.array(NonEmptyString)]);

const ActivityMetricsSchema = z
  .object({
    heart_rate_avg: z.number().finite().optional(),
    strain: z.number().finite().optional(),
    calories: z.number().finite().optional(),
    reps: z.number().finite().optional(),
    sets: z.number().finite().optional(),
  })
  .strip();

const EntrySchema = z
  .object({
    name: NonEmptyString,
    category: z.string().trim().min(1).default('food'),
    meal: NonEmptyString.optional(),
    quantity: QuantitySchema.optional(),
    macros: MacrosSchema.optional(),
    micros: z.record(NonEmptyString, z.number().finite()).optional(),
    time: NonEmptyString.optional(),
    notes: NonEmptyString.optional(),
    tags: z.array(NonEmptyString).optional(),
    brand: NonEmptyString.optional(),
    sourceText: NonEmptyString.optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    duration_minutes: z.number().finite().positive().optional(),
    metrics: ActivityMetricsSchema.optional(),
    source: NonEmptyString.optional(),
  })
  .strip();

const BaseDaySchema = z
  .object({
    date: z.string().date().describe('ISO date (YYYY-MM-DD) representing this log'),
    timezone: NonEmptyString.optional(),
    summary: NonEmptyString.optional(),
    notes: NotesField.optional(),
    rawText: NonEmptyString.optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .strip();

const LogDaySchema = BaseDaySchema.extend({
  entries: z.array(EntrySchema).min(1),
  totals: TotalsSchema.optional(),
});

const AppendSchema = BaseDaySchema.extend({
  entries: z.array(EntrySchema).min(1),
  totals: TotalsSchema.optional(),
});

const DateOnlySchema = z.object({
  date: z.string().date().describe('ISO date (YYYY-MM-DD) to target'),
});

function normaliseNotes(input?: unknown): string[] | undefined {
  if (!input) return undefined;
  const arr = Array.isArray(input) ? input : [input];
  const cleaned = arr
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

export class DailyHandler extends BaseHandler {
  readonly prefix = 'daily';
  readonly aliases = ['vitals', 'nutrition'];
  private store: DailyStore;

  constructor(opts: { logger: Logger; config: HandlerConfig }) {
    super(opts);
    this.store = new DailyStore(this.config, this.logger);
  }

  getTools(): ToolSpec[] {
    return [
      {
        action: 'log_day',
        description: 'Store a complete structured daily log for a given date (overwrites any existing log)',
        inputSchema: LogDaySchema.shape,
      },
      {
        action: 'append_entries',
        description: 'Append one or more daily entries to a date, creating the day if it does not exist',
        inputSchema: AppendSchema.shape,
      },
      {
        action: 'get_day',
        description: 'Retrieve the stored daily log for a specific date',
        inputSchema: DateOnlySchema.shape,
      },
      {
        action: 'list_days',
        description: 'List stored daily log dates with counts and timestamps',
        inputSchema: {},
      },
      {
        action: 'delete_day',
        description: 'Remove a stored daily log for a date',
        inputSchema: DateOnlySchema.shape,
      },
    ];
  }

  async execute(action: string, args: unknown): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'log_day':
          return await this.handleLogDay(args);
        case 'append_entries':
          return await this.handleAppendEntries(args);
        case 'get_day':
          return await this.handleGetDay(args);
        case 'list_days':
          return await this.handleListDays();
        case 'delete_day':
          return await this.handleDeleteDay(args);
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Daily handler error');
      const message = err?.message || String(err);
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
    }
  }

  private async handleLogDay(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(LogDaySchema, raw);
    const notes = normaliseNotes(parsed.notes);
    const result = await this.store.upsertDay({
      date: parsed.date,
      timezone: parsed.timezone,
      summary: parsed.summary,
      notes,
      entries: parsed.entries,
      totals: parsed.totals,
      rawText: parsed.rawText,
      metadata: parsed.metadata,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleAppendEntries(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(AppendSchema, raw);
    const notes = normaliseNotes(parsed.notes);
    const result = await this.store.appendEntries({
      date: parsed.date,
      timezone: parsed.timezone,
      summary: parsed.summary,
      notes,
      entries: parsed.entries,
      totals: parsed.totals,
      rawText: parsed.rawText,
      metadata: parsed.metadata,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleGetDay(raw: unknown): Promise<CallToolResult> {
    const { date } = this.parseArgs(DateOnlySchema, raw);
    const result = await this.store.getDay(date);
    return { content: [{ type: 'text', text: JSON.stringify({ date, log: result }) }] };
  }

  private async handleListDays(): Promise<CallToolResult> {
    const days = await this.store.listDays();
    return { content: [{ type: 'text', text: JSON.stringify({ days }) }] };
  }

  private async handleDeleteDay(raw: unknown): Promise<CallToolResult> {
    const { date } = this.parseArgs(DateOnlySchema, raw);
    const deleted = await this.store.deleteDay(date);
    return { content: [{ type: 'text', text: JSON.stringify({ date, deleted }) }] };
  }
}
