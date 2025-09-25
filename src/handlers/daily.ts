import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec, HandlerConfig } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { DailyStore } from '../utils/daily.js';
import type { DailyTemplateLog } from '../utils/daily.js';

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

const TemplateChecklistSchema = z
  .object({
    morning_supplements: z.boolean().optional(),
    coffee_cups: z.number().int().min(0).optional(),
    substances: z.union([z.number().min(0), NonEmptyString]).optional(),
    kendama_session: z.boolean().optional(),
  })
  .strip();

const TemplateSummarySchema = z
  .object({
    supplements: NonEmptyString.optional(),
    coffee: z.number().int().min(0).optional(),
    substances: z.union([z.number().min(0), NonEmptyString]).optional(),
    kendama: NonEmptyString.optional(),
  })
  .strip();

const TemplateMealSchema = z
  .object({
    slot: NonEmptyString.describe('Meal slot name such as breakfast, lunch, dinner'),
    description: NonEmptyString.describe('Short description of what was eaten'),
    time: NonEmptyString.optional(),
    notes: NonEmptyString.optional(),
  })
  .strip();

const TemplateSchema = z
  .object({
    checklist: TemplateChecklistSchema.optional(),
    summary: TemplateSummarySchema.optional(),
    exceptions: z.array(NonEmptyString).optional(),
    meals: z.array(TemplateMealSchema).optional(),
    notes: z.array(NonEmptyString).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .strip()
  .refine(
    value =>
      Boolean(value.checklist && Object.keys(value.checklist).length) ||
      Boolean(value.summary && Object.keys(value.summary).length) ||
      Boolean(value.exceptions && value.exceptions.length) ||
      Boolean(value.meals && value.meals.length) ||
      Boolean(value.notes && value.notes.length) ||
      Boolean(value.metadata && Object.keys(value.metadata).length),
    { message: 'Provide at least one template field' }
  );

const BaseDaySchema = z
  .object({
    date: z.string().date().describe('ISO date (YYYY-MM-DD) representing this log'),
    timezone: NonEmptyString.optional(),
    summary: NonEmptyString.optional(),
    notes: NotesField.optional(),
    rawText: NonEmptyString.optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    template: TemplateSchema.optional(),
  })
  .strip();

const EntriesSchema = z.array(EntrySchema).min(1);
const OptionalEntriesSchema = EntriesSchema.optional();

const LogDaySchema = BaseDaySchema.extend({
  entries: OptionalEntriesSchema,
  totals: TotalsSchema.optional(),
})
  .refine(data => Boolean(data.template) || Boolean(data.entries && data.entries.length), {
    message: 'Provide entries or a template payload',
    path: ['template'],
  });

const AppendSchema = BaseDaySchema.extend({
  entries: OptionalEntriesSchema,
  totals: TotalsSchema.optional(),
})
  .refine(data => Boolean(data.template) || Boolean(data.entries && data.entries.length), {
    message: 'Provide entries or a template payload',
    path: ['template'],
  });

const LogDayInputShape: z.ZodRawShape = {
  ...BaseDaySchema.shape,
  entries: OptionalEntriesSchema,
  totals: TotalsSchema.optional(),
};

const AppendInputShape: z.ZodRawShape = {
  ...BaseDaySchema.shape,
  entries: OptionalEntriesSchema,
  totals: TotalsSchema.optional(),
};

const DateOnlySchema = z.object({
  date: z.string().date().describe('ISO date (YYYY-MM-DD) to target'),
});

const TemplateRequestSchema = z
  .object({
    date: z.string().date().optional().describe('Optional ISO date to seed the template'),
    includeExamples: z
      .boolean()
      .optional()
      .describe('Include example strings in template fields to guide filling'),
  })
  .strip();

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
  readonly aliases: string[] = [];
  private store: DailyStore;

  constructor(opts: { logger: Logger; config: HandlerConfig }) {
    super(opts);
    this.store = new DailyStore(this.config, this.logger);
  }

  getTools(): ToolSpec[] {
    return [
      {
        action: 'get_template',
        description: 'Retrieve the standard daily template skeleton for a date',
        inputSchema: TemplateRequestSchema.shape,
      },
      {
        action: 'log_day',
        description: 'Overwrite the structured daily log for a date',
        inputSchema: LogDayInputShape,
      },
      {
        action: 'append_entries',
        description: 'Append entries to a day, creating it when missing',
        inputSchema: AppendInputShape,
      },
      {
        action: 'get_day',
        description: 'Get the stored daily log for a date',
        inputSchema: DateOnlySchema.shape,
      },
      {
        action: 'list_days',
        description: 'List stored daily log dates with counts',
        inputSchema: {},
      },
      {
        action: 'delete_day',
        description: 'Delete a stored daily log for a date',
        inputSchema: DateOnlySchema.shape,
      },
    ];
  }

  async execute(action: string, args: unknown): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'get_template':
          return await this.handleGetTemplate(args);
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

  private async handleGetTemplate(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(TemplateRequestSchema, raw);
    const date = parsed.date ?? new Date().toISOString().slice(0, 10);
    const includeExamples = parsed.includeExamples ?? false;
    const template = this.buildTemplateSkeleton(includeExamples);
    const guidance = this.buildTemplateGuidance();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ date, template, guidance }),
        },
      ],
    };
  }

  private buildTemplateSkeleton(includeExamples: boolean): DailyTemplateLog {
    const checklist = {
      morning_supplements: true,
      coffee_cups: 2,
      substances: 6,
      kendama_session: true,
    } as const;

    const summary = {
      supplements: includeExamples ? 'standard' : 'standard',
      coffee: 2,
      substances: 6,
      kendama: includeExamples ? '90min session' : 'session length (e.g., 90min)',
    } as const;

    const meals = [
      {
        slot: 'lunch',
        description: includeExamples ? 'Chipotle bowl' : 'Describe lunch (name only)',
      },
      {
        slot: 'dinner',
        description: includeExamples ? 'Rice and chicken' : 'Describe dinner (name only)',
      },
      {
        slot: 'late',
        description: includeExamples ? 'Greek yogurt' : 'Optional late meal/snack name',
      },
    ];

    const exceptions = includeExamples ? ['Skipped Rhodiola today'] : [];
    const notes = includeExamples ? ['Felt good, new GoPro arrived'] : [];

    const template: DailyTemplateLog = {
      checklist,
      summary,
      exceptions,
      meals,
      notes,
    };

    return template;
  }

  private buildTemplateGuidance(): Record<string, unknown> {
    return {
      usage: 'Confirm the daily constants, only record deviations in exceptions, and keep meals as short names.',
      checklist: {
        morning_supplements: 'true if the usual morning stack was taken; use exceptions to note skips',
        coffee_cups: 'Number of cups consumed unless it deviates from the default',
        substances: 'Count or description of nicotine/other pouches (rename as needed)',
        kendama_session: 'true if a kendama session happened, otherwise log the reason in exceptions',
      },
      exceptions: 'Short bullet strings describing anything that changed (e.g., Skipped Rhodiola, Extra coffee).',
      meals: 'Only provide the meal name—no macros unless explicitly relevant.',
      notes: 'Capture vibe, wins, or context that will matter later.',
    };
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
      template: parsed.template,
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
      template: parsed.template,
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
