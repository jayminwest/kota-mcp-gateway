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
import type { KwcRunRecord, KwcRunTrick } from '../utils/kwc-store.js';

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

interface RunSummary {
  totalScore: number;
  totalRunTimeSeconds: number;
  averageTrickDurations: number[];
  trickSummaries: Array<{
    code: string;
    average: number | null;
    attempts: number[];
  }>;
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const arr = sorted(values);
  const mid = Math.floor(arr.length / 2);
  if (arr.length % 2 === 0) {
    return (arr[mid - 1] + arr[mid]) / 2;
  }
  return arr[mid];
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const arr = sorted(values);
  const idx = (arr.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return arr[lower];
  return arr[lower] + (arr[upper] - arr[lower]) * (idx - lower);
}

function computeIqr(values: number[]) {
  if (!values.length) {
    return { median: null, q1: null, q3: null, iqr: null };
  }
  const med = median(values);
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  const iqr = q1 !== null && q3 !== null ? q3 - q1 : null;
  return { median: med, q1, q3, iqr };
}

function variance(values: number[]): number | null {
  if (!values.length) return null;
  if (values.length === 1) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const total = values.reduce((acc, value) => acc + (value - mean) ** 2, 0);
  return total / values.length;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toValidDurations(trick: KwcRunTrick): number[] {
  return (trick.attempts ?? [])
    .map(attempt => Number(attempt?.durationSeconds))
    .filter(value => Number.isFinite(value) && value >= 0) as number[];
}

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

  private async handleGetTrickStats(rawArgs: unknown): Promise<CallToolResult> {
    const args = this.parseArgs(TrickStatsArgsSchema, rawArgs) as TrickStatsArgs;
    const runs = await this.store.listRunsWithinDays(args.days);
    const matchingRuns = runs.filter(run => run.tricks.some(trick => trick.code === args.trick_code));
    const durations = matchingRuns.flatMap(run => {
      const trick = run.tricks.find(t => t.code === args.trick_code);
      return trick ? toValidDurations(trick) : [];
    });

    if (!durations.length) {
      return this.ok({
        trick: args.trick_code,
        windowDays: args.days ?? null,
        runsObserved: matchingRuns.length,
        sampleCount: 0,
        message: 'No attempt data found for the requested window',
      });
    }

    const stats = computeIqr(durations);
    const medianSeconds = stats.median ?? null;
    const consistencyScore = stats.iqr ?? null;
    const outliers = medianSeconds !== null
      ? durations.filter(value => value > medianSeconds * 2)
      : [];

    return this.ok({
      trick: args.trick_code,
      windowDays: args.days ?? null,
      runsObserved: matchingRuns.length,
      sampleCount: durations.length,
      medianSeconds,
      q1Seconds: stats.q1,
      q3Seconds: stats.q3,
      interquartileRangeSeconds: stats.iqr,
      consistencyScore,
      outliers,
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

    const decorated = runs.map(run => this.decorateRun(run));
    const totals = decorated.map(run => run.totalRunTimeSeconds);
    const medianTotal = median(totals);
    const threshold = medianTotal !== null ? medianTotal * 2 : null;
    const filteredRuns = threshold !== null
      ? decorated.filter(run => run.totalRunTimeSeconds <= threshold)
      : decorated;
    const filteredTotals = filteredRuns.map(run => run.totalRunTimeSeconds);
    const consistentRuns = filteredRuns
      .map(run => {
        const runVariance = variance(run.averageTrickDurations) ?? 0;
        return {
          date: run.date,
          recorded_at: run.recordedAt,
          total_seconds: run.totalRunTimeSeconds,
          total_score: run.totalScore,
          trick_variance: runVariance,
        };
      })
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
      const data = this.buildTrendSeriesForTrick(runs, args.trick_code);
      return this.ok(this.buildTrendResponse(data, window, args.trick_code, args.days));
    }

    // Without a specific trick, compute summary signals for all tricks.
    const trends = this.buildTrendSummaryForAllTricks(runs, window);
    return this.ok({
      windowDays: args.days ?? null,
      windowSize: window,
      improving: trends.improving,
      regressing: trends.regressing,
      stable: trends.stable,
    });
  }

  private decorateRun(run: KwcRunRecord) {
    const summary = this.summariseRun(run);
    return {
      ...run,
      totalScore: summary.totalScore,
      totalRunTimeSeconds: summary.totalRunTimeSeconds,
      averageTrickDurations: summary.averageTrickDurations,
      trickSummaries: summary.trickSummaries,
    };
  }

  private summariseRun(run: KwcRunRecord): RunSummary {
    const trickSummaries = run.tricks.map(trick => {
      const attempts = toValidDurations(trick);
      return {
        code: trick.code,
        average: average(attempts),
        attempts,
      };
    });

    const totalScore = run.tricks.reduce((sum, trick) => sum + (Number.isFinite(trick.score) ? trick.score : 0), 0);
    const totalRunTimeSeconds = trickSummaries.reduce(
      (acc, summary) => acc + summary.attempts.reduce((inner, value) => inner + value, 0),
      0,
    );
    const averageTrickDurations = trickSummaries
      .map(summary => summary.average)
      .filter((value): value is number => value !== null);

    return {
      totalScore,
      totalRunTimeSeconds,
      averageTrickDurations,
      trickSummaries,
    };
  }

  private buildTrendSeriesForTrick(runs: KwcRunRecord[], trickCode: string) {
    const points: Array<{ date: string; value: number }> = [];

    for (const run of runs) {
      const trick = run.tricks.find(t => t.code === trickCode);
      if (!trick) continue;
      const attempts = toValidDurations(trick);
      const medianValue = median(attempts);
      if (medianValue === null) continue;
      points.push({ date: run.date, value: medianValue });
    }

    points.sort((a, b) => a.date.localeCompare(b.date));
    return points;
  }

  private buildTrendResponse(
    points: Array<{ date: string; value: number }>,
    window: number,
    trickCode?: string,
    days?: number,
  ) {
    if (!points.length) {
      return {
        trick: trickCode ?? null,
        windowDays: days ?? null,
        windowSize: window,
        message: 'No rolling data available for the requested parameters',
      };
    }

    const rolling: Array<{ date: string; rollingMedian: number | null; rollingIqr: number | null; sample: number }> = [];
    for (let index = 0; index < points.length; index += 1) {
      const slice = points.slice(Math.max(0, index - window + 1), index + 1);
      const values = slice.map(item => item.value);
      const stats = computeIqr(values);
      rolling.push({
        date: points[index].date,
        rollingMedian: stats.median,
        rollingIqr: stats.iqr,
        sample: values.length,
      });
    }

    const first = rolling.find(item => item.rollingMedian !== null);
    const last = [...rolling].reverse().find(item => item.rollingMedian !== null);
    let direction: 'improving' | 'stable' | 'regressing' | 'insufficient-data' = 'insufficient-data';
    if (first && last && first.rollingMedian !== null && last.rollingMedian !== null && first.sample > 0 && last.sample > 0) {
      const delta = (last.rollingMedian - first.rollingMedian) / first.rollingMedian;
      if (delta <= -0.05) {
        direction = 'improving';
      } else if (delta >= 0.05) {
        direction = 'regressing';
      } else {
        direction = 'stable';
      }
    }

    const firstIqr = rolling.find(item => item.rollingIqr !== null)?.rollingIqr ?? null;
    const lastIqr = [...rolling].reverse().find(item => item.rollingIqr !== null)?.rollingIqr ?? null;
    let consistency: 'more-consistent' | 'less-consistent' | 'unchanged' | 'insufficient-data' = 'insufficient-data';
    if (firstIqr !== null && lastIqr !== null) {
      if (lastIqr < firstIqr * 0.9) {
        consistency = 'more-consistent';
      } else if (lastIqr > firstIqr * 1.1) {
        consistency = 'less-consistent';
      } else {
        consistency = 'unchanged';
      }
    }

    return {
      trick: trickCode ?? null,
      windowDays: days ?? null,
      windowSize: window,
      direction,
      consistency,
      points: rolling,
    };
  }

  private buildTrendSummaryForAllTricks(runs: KwcRunRecord[], window: number) {
    const perTrick = new Map<string, Array<{ date: string; value: number }>>();

    for (const run of runs) {
      for (const trick of run.tricks) {
        const attempts = toValidDurations(trick);
        const med = median(attempts);
        if (med === null) continue;
        const list = perTrick.get(trick.code) ?? [];
        list.push({ date: run.date, value: med });
        perTrick.set(trick.code, list);
      }
    }

    const aggregates: Array<{ code: string; direction: string; consistency: string; delta: number }> = [];
    for (const [code, points] of perTrick.entries()) {
      points.sort((a, b) => a.date.localeCompare(b.date));
      const response = this.buildTrendResponse(points, window, code) as any;
      if (!Array.isArray(response.points) || !response.points.length) {
        continue;
      }
      const first = response.points.find((item: any) => item.rollingMedian !== null)?.rollingMedian;
      const last = [...response.points].reverse().find((item: any) => item.rollingMedian !== null)?.rollingMedian;
      const delta = first !== undefined && last !== undefined && first !== null && last !== null
        ? last - first
        : Number.NaN;
      aggregates.push({
        code,
        direction: response.direction,
        consistency: response.consistency,
        delta: Number.isFinite(delta) ? delta : Number.POSITIVE_INFINITY,
      });
    }

    const improving = aggregates
      .filter(item => item.direction === 'improving')
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 5);
    const regressing = aggregates
      .filter(item => item.direction === 'regressing')
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 5);
    const stable = aggregates
      .filter(item => item.direction === 'stable')
      .slice(0, 5);

    return {
      improving,
      regressing,
      stable,
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
