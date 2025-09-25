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

export interface DailyMealEntry {
  slot: string;
  description: string;
  time?: string;
  notes?: string;
}

export interface DailyTemplateChecklist {
  morning_supplements?: boolean;
  coffee_cups?: number;
  substances?: number | string;
  kendama_session?: boolean;
  [key: string]: boolean | number | string | undefined;
}

export interface DailyTemplateSummary {
  supplements?: string;
  coffee?: number;
  substances?: number | string;
  kendama?: string;
  [key: string]: boolean | number | string | undefined;
}

export interface DailyTemplateLog {
  checklist?: DailyTemplateChecklist;
  summary?: DailyTemplateSummary;
  exceptions?: string[];
  meals?: DailyMealEntry[];
  notes?: string[];
  metadata?: Record<string, unknown>;
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
  entries?: DailyEntry[];
  totals?: DailyTotals;
  rawText?: string;
  metadata?: Record<string, unknown>;
  template?: DailyTemplateLog;
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

function normalizeStringArray(input?: unknown): string[] | undefined {
  if (input === undefined || input === null) return undefined;
  const values = Array.isArray(input) ? input : [input];
  const flattened: string[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = normalizeStringArray(value);
      if (nested) flattened.push(...nested);
      continue;
    }
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) flattened.push(trimmed);
  }
  if (flattened.length === 0) return undefined;
  return Array.from(new Set(flattened));
}

function normalizeNotes(input?: unknown): string[] | undefined {
  return normalizeStringArray(input);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeTemplate(input?: DailyTemplateLog): DailyTemplateLog | undefined {
  if (!input) return undefined;

  const checklist = input.checklist
    ? Object.entries(input.checklist).reduce<DailyTemplateChecklist>((acc, [rawKey, rawValue]) => {
        const trimmedKey = typeof rawKey === 'string' ? rawKey.trim() : '';
        if (!trimmedKey) return acc;
        const key =
          trimmedKey === 'zyn_pouches' || trimmedKey === 'zyn'
            ? 'substances'
            : trimmedKey;
        if (rawValue === undefined || rawValue === null) return acc;
        if (typeof rawValue === 'string') {
          const trimmedValue = rawValue.trim();
          if (trimmedValue) acc[key] = trimmedValue;
        } else if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
          acc[key] = rawValue;
        }
        return acc;
      }, {})
    : undefined;

  const summary = input.summary
    ? Object.entries(input.summary).reduce<DailyTemplateSummary>((acc, [rawKey, rawValue]) => {
        const trimmedKey = typeof rawKey === 'string' ? rawKey.trim() : '';
        if (!trimmedKey) return acc;
        const key =
          trimmedKey === 'zyn_pouches' || trimmedKey === 'zyn'
            ? 'substances'
            : trimmedKey;
        if (rawValue === undefined || rawValue === null) return acc;
        if (typeof rawValue === 'string') {
          const trimmedValue = rawValue.trim();
          if (trimmedValue) acc[key] = trimmedValue;
        } else if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
          acc[key] = rawValue;
        }
        return acc;
      }, {})
    : undefined;

  const meals = Array.isArray(input.meals)
    ? input.meals
        .map(meal => {
          if (!meal) return undefined;
          const slot = typeof meal.slot === 'string' ? meal.slot.trim() : '';
          const description = typeof meal.description === 'string' ? meal.description.trim() : '';
          if (!slot || !description) return undefined;
          const normalized: DailyMealEntry = { slot, description };
          if (typeof meal.time === 'string') {
            const time = meal.time.trim();
            if (time) normalized.time = time;
          }
          if (typeof meal.notes === 'string') {
            const notes = meal.notes.trim();
            if (notes) normalized.notes = notes;
          }
          return normalized;
        })
        .filter((meal): meal is DailyMealEntry => Boolean(meal))
    : undefined;

  const exceptions = normalizeStringArray(input.exceptions);
  const notes = normalizeNotes(input.notes);
  const metadata = input.metadata && isPlainObject(input.metadata) ? { ...input.metadata } : undefined;

  if (
    (!checklist || Object.keys(checklist).length === 0) &&
    (!summary || Object.keys(summary).length === 0) &&
    (!exceptions || exceptions.length === 0) &&
    (!notes || notes.length === 0) &&
    (!meals || meals.length === 0) &&
    !metadata
  ) {
    return undefined;
  }

  return {
    checklist,
    summary,
    exceptions,
    meals,
    notes,
    metadata,
  };
}

function mergeTemplates(
  current?: DailyTemplateLog,
  incoming?: DailyTemplateLog
): DailyTemplateLog | undefined {
  const base = normalizeTemplate(current);
  const next = normalizeTemplate(incoming);
  if (!base) return next;
  if (!next) return base;

  const checklist = {
    ...(base.checklist ?? {}),
    ...(next.checklist ?? {}),
  };

  const summary = {
    ...(base.summary ?? {}),
    ...(next.summary ?? {}),
  };

  const exceptions = normalizeStringArray([base.exceptions ?? [], next.exceptions ?? []]);
  const notes = normalizeNotes([base.notes ?? [], next.notes ?? []]);

  const meals = (() => {
    const existingMeals = base.meals ?? [];
    const incomingMeals = next.meals ?? [];
    if (!existingMeals.length && !incomingMeals.length) return undefined;
    return [...existingMeals, ...incomingMeals];
  })();

  const metadata = {
    ...(base.metadata ?? {}),
    ...(next.metadata ?? {}),
  };

  return normalizeTemplate({
    checklist,
    summary,
    exceptions,
    notes,
    meals,
    metadata,
  });
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
      entries: (input.entries ?? []).map(normalizeEntry),
      totals: input.totals,
      rawText: input.rawText,
      metadata: input.metadata,
      template: normalizeTemplate(input.template),
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
        entries: (input.entries ?? []).map(normalizeEntry),
        totals: input.totals,
        rawText: input.rawText,
        metadata: input.metadata,
        template: normalizeTemplate(input.template),
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

    const notes = normalizeNotes([existing.notes ?? [], input.notes ?? []]);
    const newEntries = (input.entries ?? []).map(normalizeEntry);
    const combinedEntries = [...(existing.entries ?? []), ...newEntries];
    const record: DailyDayRecord = {
      ...existing,
      timezone: input.timezone ?? existing.timezone,
      summary: input.summary ?? existing.summary,
      notes,
      entries: combinedEntries,
      totals: input.totals ?? existing.totals,
      rawText: input.rawText ?? existing.rawText,
      metadata: { ...(existing.metadata ?? {}), ...(input.metadata ?? {}) },
      template: mergeTemplates(existing.template, input.template),
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
      entryCount: day.entries?.length ?? 0,
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
