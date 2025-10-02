import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec, HandlerConfig } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import {
  KwcStore,
  lineupInputSchema,
  runInputSchema,
} from '../utils/kwc-store.js';
import type { KwcRunRecord } from '../utils/kwc-store.js';

const DateString = z
  .string()
  .regex(/^(\d{4})-(\d{2})-(\d{2})$/, 'Expected YYYY-MM-DD date')
  .describe('ISO date (YYYY-MM-DD) to filter runs');

const ListRunsArgsSchema = z
  .object({
    date: DateString.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Maximum number of runs to return (default: all)'),
  })
  .strip();

const IsoTimestamp = z
  .string()
  .refine(value => !Number.isNaN(Date.parse(value)), { message: 'Invalid ISO timestamp' })
  .describe('ISO timestamp returned by kwc_add_run/kwc_list_runs');

const DeleteRunArgsSchema = z
  .object({
    recorded_at: IsoTimestamp,
  })
  .strip();

type ListRunsArgs = z.infer<typeof ListRunsArgsSchema>;
type DeleteRunArgs = z.infer<typeof DeleteRunArgsSchema>;

type RunInput = z.infer<typeof runInputSchema>;
type LineupInput = z.infer<typeof lineupInputSchema>;

export class KwcHandler extends BaseHandler {
  readonly prefix = 'kwc';
  readonly aliases: string[] = [];
  private readonly store: KwcStore;

  constructor(opts: { logger: Logger; config: HandlerConfig }) {
    super(opts);
    this.store = new KwcStore(this.config, this.logger);
  }

  getTools(): ToolSpec[] {
    return [
      {
        action: 'get_lineup',
        description: 'Retrieve the current Kendama lineup and last-updated timestamp',
        inputSchema: {},
      },
      {
        action: 'set_lineup',
        description: 'Replace the Kendama lineup (scores auto-derive from trick level)',
        inputSchema: lineupInputSchema.shape,
      },
      {
        action: 'list_runs',
        description: 'List Kendama runs with optional date filter and limit',
        inputSchema: ListRunsArgsSchema.shape,
      },
      {
        action: 'add_run',
        description: 'Record a Kendama run with attempt timing per trick',
        inputSchema: runInputSchema.shape,
      },
      {
        action: 'delete_run',
        description: 'Delete a run using its recorded_at timestamp',
        inputSchema: DeleteRunArgsSchema.shape,
      },
    ];
  }

  async execute(action: string, args: unknown): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'get_lineup':
          return await this.handleGetLineup();
        case 'set_lineup':
          return await this.handleSetLineup(args);
        case 'list_runs':
          return await this.handleListRuns(args);
        case 'add_run':
          return await this.handleAddRun(args);
        case 'delete_run':
          return await this.handleDeleteRun(args);
        default:
          return this.error(`Unknown action: ${action}`);
      }
    } catch (err: any) {
      const message = err?.message || String(err);
      return this.error(message);
    }
  }

  private async handleGetLineup(): Promise<CallToolResult> {
    const lineup = await this.store.getLineup();
    return this.ok({ lineup });
  }

  private async handleSetLineup(rawArgs: unknown): Promise<CallToolResult> {
    const args = this.parseArgs(lineupInputSchema, rawArgs) as LineupInput;
    const result = await this.store.saveLineup(args.tricks);
    return this.ok({ lineup: result });
  }

  private async handleListRuns(rawArgs: unknown): Promise<CallToolResult> {
    const args = this.parseArgs(ListRunsArgsSchema, rawArgs) as ListRunsArgs;
    let runs = await this.store.listRuns();
    if (args.date) {
      runs = runs.filter(run => run.date === args.date);
    }
    if (args.limit) {
      runs = runs.slice(0, args.limit);
    }
    const decorated = runs.map(run => this.decorateRun(run));
    return this.ok({ runs: decorated, count: decorated.length });
  }

  private async handleAddRun(rawArgs: unknown): Promise<CallToolResult> {
    const args = this.parseArgs(runInputSchema, rawArgs) as RunInput;
    const run = await this.store.addRun(args);
    return this.ok({ run: this.decorateRun(run) });
  }

  private async handleDeleteRun(rawArgs: unknown): Promise<CallToolResult> {
    const args = this.parseArgs(DeleteRunArgsSchema, rawArgs) as DeleteRunArgs;
    const deleted = await this.store.deleteRun(args.recorded_at);
    return this.ok({ recorded_at: args.recorded_at, deleted });
  }

  private decorateRun(run: KwcRunRecord) {
    const totalScore = run.tricks.reduce((sum, trick) => sum + (Number.isFinite(trick.score) ? trick.score : 0), 0);
    const totalRunTimeSeconds = run.tricks.reduce((outer, trick) => {
      const attempts = Array.isArray(trick.attempts) ? trick.attempts : [];
      const subtotal = attempts.reduce((inner, attempt) => {
        const value = Number(attempt.durationSeconds);
        return Number.isFinite(value) && value >= 0 ? inner + value : inner;
      }, 0);
      return outer + subtotal;
    }, 0);
    return {
      ...run,
      totalScore,
      totalRunTimeSeconds,
    };
  }

  private ok(payload: unknown): CallToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    };
  }

  private error(message: string): CallToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
}
