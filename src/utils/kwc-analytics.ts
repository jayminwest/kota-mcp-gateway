import type { KwcRunRecord, KwcRunTrick, KwcLineupTrick } from './kwc-store.js';

export interface TrickStats {
  sampleCount: number;
  runsObserved: number;
  medianSeconds: number | null;
  q1Seconds: number | null;
  q3Seconds: number | null;
  interquartileRangeSeconds: number | null;
  outliers: number[];
}

export interface TrickSummary {
  code: string;
  average: number | null;
  attempts: number[];
}

export interface RunSummary {
  totalScore: number;
  totalRunTimeSeconds: number;
  averageTrickDurations: number[];
  trickSummaries: TrickSummary[];
  trickVariance: number | null;
}

export interface DecoratedRun extends KwcRunRecord, RunSummary {}

export interface TrendPoint {
  date: string;
  rollingMedian: number | null;
  rollingIqr: number | null;
  sample: number;
}

export type TrendDirection = 'improving' | 'stable' | 'regressing' | 'insufficient-data';
export type TrendConsistency = 'more-consistent' | 'less-consistent' | 'unchanged' | 'insufficient-data';

export interface TrendAnalysis {
  trick: string | null;
  windowDays: number | null;
  windowSize: number;
  direction: TrendDirection;
  consistency: TrendConsistency;
  points: TrendPoint[];
}

export interface TrendSummaryItem {
  code: string;
  direction: TrendDirection;
  consistency: TrendConsistency;
  delta: number;
}

export interface TrendSummaryGroup {
  improving: TrendSummaryItem[];
  regressing: TrendSummaryItem[];
  stable: TrendSummaryItem[];
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

export function median(values: number[]): number | null {
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

export function computeIqr(values: number[]) {
  if (!values.length) {
    return { median: null, q1: null, q3: null, iqr: null };
  }
  const med = median(values);
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  const iqr = q1 !== null && q3 !== null ? q3 - q1 : null;
  return { median: med, q1, q3, iqr };
}

export function variance(values: number[]): number | null {
  if (!values.length) return null;
  if (values.length === 1) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const total = values.reduce((acc, value) => acc + (value - mean) ** 2, 0);
  return total / values.length;
}

export function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function toValidDurations(trick: KwcRunTrick): number[] {
  return (trick.attempts ?? [])
    .map(attempt => Number(attempt?.durationSeconds))
    .filter(value => Number.isFinite(value) && value >= 0) as number[];
}

export function summariseRun(run: KwcRunRecord): RunSummary {
  const trickSummaries: TrickSummary[] = run.tricks.map(trick => {
    const attempts = toValidDurations(trick);
    return {
      code: trick.code,
      average: average(attempts),
      attempts,
    };
  });

  const totalScore = run.tricks.reduce((sum, trick) => sum + (Number.isFinite(trick.score) ? (trick.score ?? 0) : 0), 0);
  const totalRunTimeSeconds = trickSummaries.reduce(
    (acc, summary) => acc + summary.attempts.reduce((inner, value) => inner + value, 0),
    0,
  );

  const averageTrickDurations = trickSummaries
    .map(summary => summary.average)
    .filter((value): value is number => value !== null);

  const trickVariance = variance(averageTrickDurations ?? []);

  return {
    totalScore,
    totalRunTimeSeconds,
    averageTrickDurations,
    trickSummaries,
    trickVariance,
  };
}

export function decorateRun(run: KwcRunRecord): DecoratedRun {
  const summary = summariseRun(run);
  return {
    ...run,
    ...summary,
  };
}

export function computeTrickStats(trickCode: string, runs: KwcRunRecord[]): TrickStats {
  const matchingRuns = runs.filter(run => run.tricks.some(trick => trick.code === trickCode));
  const durations = matchingRuns.flatMap(run => {
    const trick = run.tricks.find(t => t.code === trickCode);
    return trick ? toValidDurations(trick) : [];
  });

  if (!durations.length) {
    return {
      sampleCount: 0,
      runsObserved: matchingRuns.length,
      medianSeconds: null,
      q1Seconds: null,
      q3Seconds: null,
      interquartileRangeSeconds: null,
      outliers: [],
    };
  }

  const stats = computeIqr(durations);
  const medianSeconds = stats.median ?? null;
  const outliers = medianSeconds !== null
    ? durations.filter(value => value > medianSeconds * 2)
    : [];

  return {
    sampleCount: durations.length,
    runsObserved: matchingRuns.length,
    medianSeconds,
    q1Seconds: stats.q1,
    q3Seconds: stats.q3,
    interquartileRangeSeconds: stats.iqr,
    outliers,
  };
}

export function buildTrendSeriesForTrick(runs: KwcRunRecord[], trickCode: string) {
  const points: Array<{ date: string; value: number }> = [];
  for (const run of runs) {
    const trick = run.tricks.find(t => t.code === trickCode);
    if (!trick) continue;
    const attempts = toValidDurations(trick);
    const med = median(attempts);
    if (med === null) continue;
    points.push({ date: run.date, value: med });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

export function buildTrendAnalysis(
  points: Array<{ date: string; value: number }>,
  window: number,
  trickCode?: string,
  days?: number,
): TrendAnalysis {
  if (!points.length) {
    return {
      trick: trickCode ?? null,
      windowDays: days ?? null,
      windowSize: window,
      direction: 'insufficient-data',
      consistency: 'insufficient-data',
      points: [],
    };
  }

  const rolling: TrendPoint[] = [];
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
  let direction: TrendDirection = 'insufficient-data';
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
  let consistency: TrendConsistency = 'insufficient-data';
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

export function buildTrendSummaryForAllTricks(runs: KwcRunRecord[], window: number): TrendSummaryGroup {
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

  const aggregates: TrendSummaryItem[] = [];
  for (const [code, points] of perTrick.entries()) {
    points.sort((a, b) => a.date.localeCompare(b.date));
    const analysis = buildTrendAnalysis(points, window, code);
    if (!analysis.points.length) continue;
    const first = analysis.points.find(item => item.rollingMedian !== null)?.rollingMedian;
    const last = [...analysis.points].reverse().find(item => item.rollingMedian !== null)?.rollingMedian;
    const delta = first !== undefined && last !== undefined && first !== null && last !== null
      ? last - first
      : Number.POSITIVE_INFINITY;
    aggregates.push({
      code,
      direction: analysis.direction,
      consistency: analysis.consistency,
      delta,
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

  return { improving, regressing, stable };
}

export interface AnalyticsSummary {
  windowDays: number | null;
  windowSize: number;
  lineup: {
    version: number;
    updatedAt: string;
    tricks: KwcLineupTrick[];
  };
  trickStats: Array<{ code: string; stats: TrickStats; trend: TrendAnalysis }>;
  recentRuns: Array<DecoratedRun>;
  medianTotalRunSeconds: number | null;
  topConsistentRuns: Array<{
    date: string;
    recorded_at: string;
    total_seconds: number;
    total_score: number;
    trick_variance: number | null;
  }>;
  trendSummary: TrendSummaryGroup;
}

export function computeAnalyticsSummary(
  runs: KwcRunRecord[],
  lineup: { version: number; updatedAt: string; tricks: KwcLineupTrick[] },
  options: { days?: number; window?: number } = {},
): AnalyticsSummary {
  const windowDays = options.days ?? null;
  const windowSize = options.window ?? (options.days && options.days > 30 ? 14 : 7);

  const decoratedRuns = runs.map(run => decorateRun(run));
  const medianTotal = median(decoratedRuns.map(run => run.totalRunTimeSeconds));

  const trickStats = lineup.tricks.map(trick => ({
    code: trick.code,
    stats: computeTrickStats(trick.code, runs),
    trend: buildTrendAnalysis(buildTrendSeriesForTrick(runs, trick.code), windowSize, trick.code, windowDays ?? undefined),
  }));

  const topConsistent = decoratedRuns
    .map(run => ({
      date: run.date,
      recorded_at: run.recordedAt,
      total_seconds: run.totalRunTimeSeconds,
      total_score: run.totalScore,
      trick_variance: run.trickVariance,
    }))
    .sort((a, b) => {
      const av = a.trick_variance ?? Number.POSITIVE_INFINITY;
      const bv = b.trick_variance ?? Number.POSITIVE_INFINITY;
      return av - bv;
    })
    .slice(0, 5);

  const trendSummary = buildTrendSummaryForAllTricks(runs, windowSize);

  return {
    windowDays,
    windowSize,
    lineup,
    trickStats,
    recentRuns: decoratedRuns.slice(0, 10),
    medianTotalRunSeconds: medianTotal,
    topConsistentRuns: topConsistent,
    trendSummary,
  };
}
