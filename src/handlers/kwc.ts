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
import {
  decorateRun,
  computeTrickStats as computeTrickStatsAnalytics,
  buildTrendSeriesForTrick,
  buildTrendAnalysis,
  buildTrendSummaryForAllTricks,
  median,
  variance,
} from '../utils/kwc-analytics.js';

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

const DaysSchema = z
  .number()
  .int()
  .min(1)
  .max(365)
  .optional()
  .describe('Lookback window in days');

const TrickStatsArgsSchema = z
  .object({
    trick_code: z.string().trim().min(1).max(32),
    days: DaysSchema,
  })
  .strip();

const RunStatsArgsSchema = z
  .object({
    days: DaysSchema,
    top: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Number of most-consistent runs to return (default 5)'),
  })
  .strip();

const TrendArgsSchema = z
  .object({
    trick_code: z.string().trim().min(1).max(32).optional(),
    days: DaysSchema,
    window: z
      .number()
      .int()
      .min(3)
      .max(30)
      .optional()
      .describe('Rolling window size in days (default 7 or 14 depending on range)'),
  })
  .strip();

type TrickStatsArgs = z.infer<typeof TrickStatsArgsSchema>;
type RunStatsArgs = z.infer<typeof RunStatsArgsSchema>;
type TrendArgs = z.infer<typeof TrendArgsSchema>;

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
      {
        action: 'get_trick_stats',
        description: 'Compute consistency metrics for a specific trick',
        inputSchema: TrickStatsArgsSchema.shape,
      },
      {
        action: 'get_run_stats',
        description: 'Summarise run-level performance and consistency',
        inputSchema: RunStatsArgsSchema.shape,
      },
      {
        action: 'get_trend',
        description: 'Analyse rolling trends for trick or run performance',
        inputSchema: TrendArgsSchema.shape,
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
        case 'get_trick_stats':
          return await this.handleGetTrickStats(args);
        case 'get_run_stats':
          return await this.handleGetRunStats(args);
        case 'get_trend':
          return await this.handleGetTrend(args);
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
    const decorated = runs.map(decorateRun);
    return this.ok({ runs: decorated, count: decorated.length });
  }

  private async handleAddRun(rawArgs: unknown): Promise<CallToolResult> {
    const args = this.parseArgs(runInputSchema, rawArgs) as RunInput;
    const run = await this.store.addRun(args);
    return this.ok({ run: decorateRun(run) });
  }

  private async handleDeleteRun(rawArgs: unknown): Promise<CallToolResult> {
    const args = this.parseArgs(DeleteRunArgsSchema, rawArgs) as DeleteRunArgs;
    const deleted = await this.store.deleteRun(args.recorded_at);
    return this.ok({ recorded_at: args.recorded_at, deleted });
  }

  private async handleGetTrickStats(rawArgs: unknown): Promise<CallToolResult> {
    const args = this.parseArgs(TrickStatsArgsSchema, rawArgs) as TrickStatsArgs;
    const runs = await this.store.listRunsWithinDays(args.days);
    const stats = computeTrickStatsAnalytics(args.trick_code, runs);

    if (!stats.sampleCount) {
      return this.ok({
        trick: args.trick_code,
        windowDays: args.days ?? null,
        runsObserved: stats.runsObserved,
        sampleCount: 0,
        message: 'No attempt data found for the requested window',
      });
    }

    return this.ok({
      trick: args.trick_code,
      windowDays: args.days ?? null,
      runsObserved: stats.runsObserved,
      sampleCount: stats.sampleCount,
      medianSeconds: stats.medianSeconds,
      q1Seconds: stats.q1Seconds,
      q3Seconds: stats.q3Seconds,
      interquartileRangeSeconds: stats.interquartileRangeSeconds,
      outliers: stats.outliers,
    });
  }

  private async handleGetRunStats(rawArgs: unknown): Promise<CallToolResult> {
    const args = this.parseArgs(RunStatsArgsSchema, rawArgs) as RunStatsArgs;
    const runs = await this.store.listRunsWithinDays(args.days);
    if (!runs.length) {
      return this.ok({
        windowDays: args.days ?? null,
        runCount: 0,
        message: 'No runs available for analysis',
      });
    }

    const decorated = runs.map(decorateRun);
    const totals = decorated.map(run => run.totalRunTimeSeconds);
    const medianTotal = median(totals);
    const threshold = medianTotal !== null ? medianTotal * 2 : null;
    const filteredRuns = threshold !== null
      ? decorated.filter(run => run.totalRunTimeSeconds <= threshold)
      : decorated;
    const filteredTotals = filteredRuns.map(run => run.totalRunTimeSeconds);
    const consistentRuns = filteredRuns
      .map(run => ({
        date: run.date,
        recorded_at: run.recordedAt,
        total_seconds: run.totalRunTimeSeconds,
        total_score: run.totalScore,
        trick_variance: run.trickVariance ?? variance(run.averageTrickDurations) ?? 0,
      }))
      .sort((a, b) => a.trick_variance - b.trick_variance)
      .slice(0, args.top ?? 5);

    return this.ok({
      windowDays: args.days ?? null,
      runCount: runs.length,
      filteredRunCount: filteredRuns.length,
      outlierCount: runs.length - filteredRuns.length,
      medianTotalSeconds: filteredTotals.length ? median(filteredTotals) : null,
      consistentRuns,
    });
  }

  private async handleGetTrend(rawArgs: unknown): Promise<CallToolResult> {
    const args = this.parseArgs(TrendArgsSchema, rawArgs) as TrendArgs;
    const runs = await this.store.listRunsWithinDays(args.days);
    if (!runs.length) {
      return this.ok({
        windowDays: args.days ?? null,
        message: 'No runs available for trend analysis',
      });
    }

    const window = args.window ?? (args.days && args.days > 30 ? 14 : 7);

    if (args.trick_code) {
      const data = buildTrendSeriesForTrick(runs, args.trick_code);
      return this.ok(buildTrendAnalysis(data, window, args.trick_code, args.days));
    }

    // Without a specific trick, compute summary signals for all tricks.
    const trends = buildTrendSummaryForAllTricks(runs, window);
    return this.ok({
      windowDays: args.days ?? null,
      windowSize: window,
      improving: trends.improving,
      regressing: trends.regressing,
      stable: trends.stable,
    });
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
