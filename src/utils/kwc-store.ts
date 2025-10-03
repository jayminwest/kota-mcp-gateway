import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Logger } from './logger.js';
import type { AppConfig } from './config.js';
import { formatIsoDateInTimeZone } from './timezone.js';

const RUNS_VERSION = 1;
const LINEUP_VERSION = 1;

function deriveScore(code: string | undefined, fallback?: number): number {
  if (typeof code === 'string') {
    const trimmed = code.trim();
    if (trimmed) {
      const [level] = trimmed.split(/[-\s]/);
      const parsed = Number.parseInt(level, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  }
  if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback >= 0) {
    return fallback;
  }
  return 0;
}

const attemptSchema = z.object({
  durationSeconds: z.number().finite().nonnegative(),
});

export const lineupTrickSchema = z.object({
  code: z.string().trim().min(1).max(32),
  label: z.string().trim().max(64).optional(),
  score: z.number().finite().nonnegative(),
});

const runTrickSchema = lineupTrickSchema.extend({
  attempts: z.array(attemptSchema).min(1),
});

export const runInputSchema = z.object({
  date: z.string().regex(/^(\d{4})-(\d{2})-(\d{2})$/, 'Expected YYYY-MM-DD date'),
  notes: z.string().trim().max(500).optional(),
  tricks: z.array(runTrickSchema).min(1).max(30),
});

export const lineupInputSchema = z.object({
  tricks: z.array(lineupTrickSchema).min(1).max(30),
});

export type KwcAttempt = z.infer<typeof attemptSchema>;
export type KwcRunTrick = z.infer<typeof runTrickSchema>;
export type KwcRunInput = z.infer<typeof runInputSchema>;
export type KwcLineupTrick = z.infer<typeof lineupTrickSchema>;

export interface KwcRunRecord extends KwcRunInput {
  recordedAt: string;
}

interface RunFileData {
  version: number;
  runs: KwcRunRecord[];
}

interface LineupFileData {
  version: number;
  updatedAt: string;
  tricks: KwcLineupTrick[];
}

export class KwcStore {
  private readonly runsPath: string;
  private readonly lineupPath: string;
  private readonly logger: Logger;
  private readonly timeZone: string;

  constructor(config: AppConfig, logger: Logger) {
    const baseDir = path.resolve(config.DATA_DIR, 'kota_kwc');
    this.runsPath = path.resolve(baseDir, 'runs.json');
    this.lineupPath = path.resolve(baseDir, 'lineup.json');
    this.logger = logger.child({ component: 'kwc-store' });
    this.timeZone = config.KWC_TIMEZONE;
  }

  private async ensureDir(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  private normalizeRunInput(input: KwcRunInput): KwcRunInput {
    return {
      date: input.date,
      notes: input.notes?.trim() ? input.notes.trim() : undefined,
      tricks: input.tricks.map(trick => ({
        code: trick.code.trim(),
        label: trick.label?.trim() ? trick.label.trim() : undefined,
        score: deriveScore(trick.code, trick.score),
        attempts: trick.attempts.map(att => ({
          durationSeconds: att.durationSeconds,
        })),
      })),
    };
  }

  private normalizeLineup(tricks: KwcLineupTrick[]): KwcLineupTrick[] {
    return tricks.map(trick => ({
      code: trick.code.trim(),
      label: trick.label?.trim() ? trick.label.trim() : undefined,
      score: deriveScore(trick.code, trick.score),
    }));
  }

  private async readRunsFile(): Promise<RunFileData> {
    try {
      const raw = await fs.readFile(this.runsPath, 'utf8');
      const parsed = JSON.parse(raw) as RunFileData;
      if (!parsed || typeof parsed !== 'object' || parsed.version !== RUNS_VERSION || !Array.isArray(parsed.runs)) {
        throw new Error('Invalid runs file');
      }
      const runs: KwcRunRecord[] = [];
      for (const rawRun of parsed.runs) {
        const result = runInputSchema.safeParse(rawRun);
        if (!result.success) {
          this.logger.warn({ issues: result.error.issues }, 'Skipping invalid run entry');
          continue;
        }
        const normalized = this.normalizeRunInput(result.data);
        const recordedAt = typeof (rawRun as KwcRunRecord).recordedAt === 'string' && (rawRun as KwcRunRecord).recordedAt
          ? (rawRun as KwcRunRecord).recordedAt
          : formatIsoDateInTimeZone(new Date(0), this.timeZone);
        runs.push({
          ...normalized,
          recordedAt,
        });
      }
      return {
        version: RUNS_VERSION,
        runs,
      };
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn({ err }, 'Failed to read runs file');
      }
      return { version: RUNS_VERSION, runs: [] };
    }
  }

  private async writeRunsFile(data: RunFileData): Promise<void> {
    await this.ensureDir(this.runsPath);
    const normalized: RunFileData = {
      version: RUNS_VERSION,
      runs: data.runs.map(run => ({
        ...this.normalizeRunInput(run),
        recordedAt: run.recordedAt,
      })),
    };
    await fs.writeFile(this.runsPath, JSON.stringify(normalized, null, 2), 'utf8');
  }

  async listRuns(): Promise<KwcRunRecord[]> {
    const data = await this.readRunsFile();
    return data.runs.sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt));
  }

  async listRunsWithinDays(days?: number): Promise<KwcRunRecord[]> {
    const runs = await this.listRuns();
    if (!days || Number.isNaN(days)) {
      return runs;
    }
    const windowMs = Math.max(1, days) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    return runs.filter(run => {
      const ts = Date.parse(run.recordedAt);
      return Number.isFinite(ts) && ts >= cutoff;
    });
  }

  async addRun(input: KwcRunInput): Promise<KwcRunRecord> {
    const data = await this.readRunsFile();
    const normalized = this.normalizeRunInput(input);
    const record: KwcRunRecord = {
      ...normalized,
      recordedAt: formatIsoDateInTimeZone(new Date(), this.timeZone),
    };
    data.runs.push(record);
    await this.writeRunsFile(data);
    return record;
  }

  async updateRun(recordedAt: string, input: KwcRunInput): Promise<KwcRunRecord | null> {
    if (!recordedAt) {
      return null;
    }
    const data = await this.readRunsFile();
    const index = data.runs.findIndex(run => run.recordedAt === recordedAt);
    if (index === -1) {
      return null;
    }
    const normalized = this.normalizeRunInput(input);
    const record: KwcRunRecord = {
      ...normalized,
      recordedAt,
    };
    data.runs[index] = record;
    await this.writeRunsFile(data);
    return record;
  }

  async findRun(recordedAt: string): Promise<KwcRunRecord | null> {
    if (!recordedAt) return null;
    const data = await this.readRunsFile();
    return data.runs.find(run => run.recordedAt === recordedAt) ?? null;
  }

  async deleteRun(recordedAt: string): Promise<boolean> {
    if (!recordedAt) return false;
    const data = await this.readRunsFile();
    const nextRuns = data.runs.filter(run => run.recordedAt !== recordedAt);
    if (nextRuns.length === data.runs.length) {
      return false;
    }
    data.runs = nextRuns;
    await this.writeRunsFile(data);
    return true;
  }

  private async readLineupFile(): Promise<LineupFileData> {
    try {
      const raw = await fs.readFile(this.lineupPath, 'utf8');
      const parsed = JSON.parse(raw) as LineupFileData;
      if (!parsed || typeof parsed !== 'object' || parsed.version !== LINEUP_VERSION || !Array.isArray(parsed.tricks)) {
        throw new Error('Invalid lineup file');
      }
      const tricks: KwcLineupTrick[] = [];
      for (const rawTrick of parsed.tricks) {
        const result = lineupTrickSchema.safeParse(rawTrick);
        if (!result.success) {
          this.logger.warn({ issues: result.error.issues }, 'Skipping invalid lineup entry');
          continue;
        }
        tricks.push(...this.normalizeLineup([result.data]));
      }
      return {
        version: LINEUP_VERSION,
        updatedAt: parsed.updatedAt,
        tricks,
      };
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn({ err }, 'Failed to read lineup file');
      }
      return {
        version: LINEUP_VERSION,
        updatedAt: formatIsoDateInTimeZone(new Date(0), this.timeZone),
        tricks: [],
      };
    }
  }

  private async writeLineupFile(data: LineupFileData): Promise<void> {
    await this.ensureDir(this.lineupPath);
    const normalized: LineupFileData = {
      version: LINEUP_VERSION,
      updatedAt: data.updatedAt,
      tricks: this.normalizeLineup(data.tricks),
    };
    await fs.writeFile(this.lineupPath, JSON.stringify(normalized, null, 2), 'utf8');
  }

  async getLineup(): Promise<LineupFileData> {
    return this.readLineupFile();
  }

  async saveLineup(tricks: KwcLineupTrick[]): Promise<LineupFileData> {
    const payload: LineupFileData = {
      version: LINEUP_VERSION,
      updatedAt: formatIsoDateInTimeZone(new Date(), this.timeZone),
      tricks: this.normalizeLineup(tricks),
    };
    await this.writeLineupFile(payload);
    return payload;
  }

  getTimeZone(): string {
    return this.timeZone;
  }
}
