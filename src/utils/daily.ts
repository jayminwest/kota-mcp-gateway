import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';

export type DailyEntryCategory =
  | 'food'
  | 'drink'
  | 'supplement'
  | 'substance'
  | 'snack'
  | 'note'
  | 'activity'
  | 'training'
  | string;

export interface DailyQuantity {
  value?: number;
  unit?: string;
  grams?: number;
  volumeMl?: number;
  text?: string;
}

export interface DailyMacros {
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  sugar_g?: number;
}

export interface DailyTotals extends DailyMacros {
  water_l?: number;
  caffeine_mg?: number;
  nicotine_mg?: number;
  thc_mg?: number;
  cbd_mg?: number;
  supplements?: Record<string, number>;
  micros?: Record<string, number>;
}

export interface DailyActivityMetrics {
  heart_rate_avg?: number;
  strain?: number;
  calories?: number;
  reps?: number;
  sets?: number;
}

export interface DailyEntry {
  name: string;
  category?: DailyEntryCategory;
  meal?: string;
  quantity?: DailyQuantity;
  macros?: DailyMacros;
  micros?: Record<string, number>;
  time?: string;
  notes?: string;
  tags?: string[];
  brand?: string;
  sourceText?: string;
  metadata?: Record<string, unknown>;
  duration_minutes?: number;
  metrics?: DailyActivityMetrics;
  source?: string;
}

export interface DailyDayBase {
  date: string;
  timezone?: string;
  summary?: string;
  notes?: string[];
  entries: DailyEntry[];
  totals?: DailyTotals;
  rawText?: string;
  metadata?: Record<string, unknown>;
}

export interface DailyDayRecord extends DailyDayBase {
  createdAt: string;
  updatedAt: string;
}

interface DailyFileData {
  version: number;
  days: Record<string, DailyDayRecord>;
}

export interface DailyListItem {
  date: string;
  entryCount: number;
  updatedAt: string;
  summary?: string;
}

const VERSION = 1;

const STORAGE_DIR = 'kota_daily';
const LEGACY_STORAGE_DIR = 'kota_nutrition';

function normalizeNotes(input?: string | string[]): string[] | undefined {
  if (!input) return undefined;
  const arr = Array.isArray(input) ? input : [input];
  const cleaned = arr.map(note => note.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeEntry(entry: DailyEntry): DailyEntry {
  return {
    ...entry,
    category: entry.category ?? 'food',
    tags: entry.tags?.map(tag => tag.trim()).filter(Boolean),
    source: entry.source?.trim() || undefined,
  };
}

export class DailyStore {
  private readonly filePath: string;
  private readonly legacyFilePath: string;
  private readonly logger: Logger;

  constructor(config: AppConfig, logger: Logger) {
    this.logger = logger;
    this.filePath = path.resolve(config.DATA_DIR, STORAGE_DIR, 'logs.json');
    this.legacyFilePath = path.resolve(config.DATA_DIR, LEGACY_STORAGE_DIR, 'logs.json');
  }

  private async ensureDirectory(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  private async readJson(targetPath: string): Promise<DailyFileData | null> {
    try {
      const raw = await fs.readFile(targetPath, 'utf8');
      const parsed = JSON.parse(raw) as DailyFileData;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.version !== 'number' || !parsed.days) {
        throw new Error('Invalid daily store file');
      }
      return parsed;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn({ err, targetPath }, 'Failed to read daily store file');
      }
      return null;
    }
  }

  private async readFile(): Promise<DailyFileData> {
    const current = await this.readJson(this.filePath);
    if (current) return current;

    const legacy = await this.readJson(this.legacyFilePath);
    if (legacy) {
      this.logger.info({ legacyPath: this.legacyFilePath }, 'Loaded daily logs from legacy nutrition store');
      return legacy;
    }

    await this.ensureDirectory();
    return { version: VERSION, days: {} };
  }

  private async writeFile(data: DailyFileData): Promise<void> {
    await this.ensureDirectory();
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  private async writeDaySnapshot(record: DailyDayRecord): Promise<void> {
    const [year, month, day] = record.date.split('-');
    if (!year || !month || !day) return;
    const dir = path.resolve(path.dirname(this.filePath), year, month);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.resolve(dir, `${day}.json`);
    await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
  }

  async upsertDay(input: DailyDayBase): Promise<DailyDayRecord> {
    const data = await this.readFile();
    const key = input.date;
    const now = new Date().toISOString();
    const existing = data.days[key];
    const record: DailyDayRecord = {
      date: input.date,
      timezone: input.timezone,
      summary: input.summary,
      notes: normalizeNotes(input.notes),
      entries: input.entries.map(normalizeEntry),
      totals: input.totals,
      rawText: input.rawText,
      metadata: input.metadata,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    data.days[key] = record;
    await this.writeFile(data);
    await this.writeDaySnapshot(record).catch(err => {
      this.logger.warn({ err, date: input.date }, 'Failed to write daily snapshot');
    });
    return record;
  }

  async appendEntries(input: DailyDayBase): Promise<DailyDayRecord> {
    const data = await this.readFile();
    const key = input.date;
    const now = new Date().toISOString();
    const existing = data.days[key];
    if (!existing) {
      const record: DailyDayRecord = {
        date: input.date,
        timezone: input.timezone,
        summary: input.summary,
        notes: normalizeNotes(input.notes),
        entries: input.entries.map(normalizeEntry),
        totals: input.totals,
        rawText: input.rawText,
        metadata: input.metadata,
        createdAt: now,
        updatedAt: now,
      };
      data.days[key] = record;
      await this.writeFile(data);
      await this.writeDaySnapshot(record).catch(err => {
        this.logger.warn({ err, date: input.date }, 'Failed to write daily snapshot');
      });
      return record;
    }

    const mergedNotes = [
      ...(existing.notes ?? []),
      ...(normalizeNotes(input.notes) ?? []),
    ];
    const notes = mergedNotes.length > 0 ? mergedNotes : undefined;
    const record: DailyDayRecord = {
      ...existing,
      timezone: input.timezone ?? existing.timezone,
      summary: input.summary ?? existing.summary,
      notes,
      entries: [...existing.entries, ...input.entries.map(normalizeEntry)],
      totals: input.totals ?? existing.totals,
      rawText: input.rawText ?? existing.rawText,
      metadata: { ...(existing.metadata ?? {}), ...(input.metadata ?? {}) },
      updatedAt: now,
    };
    data.days[key] = record;
    await this.writeFile(data);
    await this.writeDaySnapshot(record).catch(err => {
      this.logger.warn({ err, date: input.date }, 'Failed to write daily snapshot');
    });
    return record;
  }

  async getDay(date: string): Promise<DailyDayRecord | null> {
    const data = await this.readFile();
    return data.days[date] ?? null;
  }

  async listDays(): Promise<DailyListItem[]> {
    const data = await this.readFile();
    const items: DailyListItem[] = Object.values(data.days).map(day => ({
      date: day.date,
      entryCount: day.entries.length,
      updatedAt: day.updatedAt,
      summary: day.summary,
    }));
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }

  async deleteDay(date: string): Promise<boolean> {
    const data = await this.readFile();
    if (!data.days[date]) return false;
    delete data.days[date];
    await this.writeFile(data);
    return true;
  }
}
