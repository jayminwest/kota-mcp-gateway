import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import { pacificNowIso, toPacificIso } from './time.js';

const STORAGE_DIR = 'kota_content_calendar';
const STORAGE_FILE = 'calendar.json';
const SNAPSHOT_DIR = 'items';
const VERSION = 1;
const DEFAULT_STATUS = 'idea';

type Nullable<T> = T | null | undefined;

export interface ContentCalendarAsset {
  label: string;
  type?: string;
  url?: string;
  path?: string;
  notes?: string;
}

export interface ContentCalendarHistoryEntry {
  type: 'created' | 'updated' | 'status_change' | 'note_added';
  timestamp: string;
  status?: string;
  previousStatus?: string;
  note?: string;
  changes?: string[];
}

export interface ContentCalendarItem {
  id: string;
  title: string;
  status: string;
  channel?: string;
  owner?: string;
  summary?: string;
  description?: string;
  brief?: string;
  scheduledFor?: string;
  publishAt?: string;
  dueAt?: string;
  campaign?: string;
  callToAction?: string;
  tags?: string[];
  notes?: string[];
  assets?: ContentCalendarAsset[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  history?: ContentCalendarHistoryEntry[];
}

interface ContentCalendarFileData {
  version: number;
  items: Record<string, ContentCalendarItem>;
}

export interface ContentCalendarCreateInput {
  id?: string;
  title: string;
  status?: string;
  channel?: string;
  owner?: string;
  summary?: string;
  description?: string;
  brief?: string;
  scheduledFor?: string;
  publishAt?: string;
  dueAt?: string;
  campaign?: string;
  callToAction?: string;
  tags?: string[];
  notes?: string[];
  assets?: ContentCalendarAsset[];
  metadata?: Record<string, unknown>;
}

export interface ContentCalendarUpdateInput {
  title?: string;
  status?: string;
  statusNote?: string;
  channel?: string | null;
  owner?: string | null;
  summary?: string | null;
  description?: string | null;
  brief?: string | null;
  scheduledFor?: string | null;
  publishAt?: string | null;
  dueAt?: string | null;
  campaign?: string | null;
  callToAction?: string | null;
  tags?: string[] | null;
  appendTags?: string[];
  notes?: string[] | null;
  appendNotes?: string[];
  assets?: ContentCalendarAsset[] | null;
  metadata?: Record<string, unknown>;
  mergeMetadata?: boolean;
}

export interface ContentCalendarListOptions {
  status?: string[];
  channel?: string[];
  search?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  sort?: 'scheduled' | 'created' | 'updated';
  limit?: number;
}

function normalizeString(value: Nullable<string>): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeListValues(list?: string[]): string[] | undefined {
  if (!list) return undefined;
  const cleaned = list
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
  if (cleaned.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of cleaned) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function normalizeAppendValues(list?: string[]): string[] | undefined {
  const normalized = normalizeListValues(list);
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeDate(value: Nullable<string>): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return toPacificIso(trimmed);
  } catch {
    throw new Error(`Invalid ISO timestamp provided: ${value}`);
  }
}

function normalizeMetadata(metadata: Nullable<Record<string, unknown>>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).filter(([, val]) => val !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeAsset(asset: ContentCalendarAsset): ContentCalendarAsset | null {
  const label = normalizeString(asset.label);
  if (!label) return null;
  const normalized: ContentCalendarAsset = { label };
  const type = normalizeString(asset.type);
  if (type) normalized.type = type;
  const url = normalizeString(asset.url);
  if (url) normalized.url = url;
  const assetPath = normalizeString(asset.path);
  if (assetPath) normalized.path = assetPath;
  const notes = normalizeString(asset.notes);
  if (notes) normalized.notes = notes;
  return normalized;
}

function normalizeAssets(assets: Nullable<ContentCalendarAsset[]>): ContentCalendarAsset[] | null | undefined {
  if (assets === undefined) return undefined;
  if (assets === null) return null;
  const cleaned = assets
    .map(asset => normalizeAsset(asset))
    .filter((asset): asset is ContentCalendarAsset => Boolean(asset));
  if (cleaned.length === 0) return [];
  const seen = new Set<string>();
  const result: ContentCalendarAsset[] = [];
  for (const asset of cleaned) {
    const key = asset.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(asset);
  }
  return result;
}

function mergeUniqueStrings(base: string[] | undefined, additions: string[]): string[] {
  const result = [...(base ?? [])];
  const seen = new Set(result);
  for (const value of additions) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function arraysEqual(a?: string[], b?: string[]): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function assetsEqual(a?: ContentCalendarAsset[], b?: ContentCalendarAsset[]): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((asset, index) => {
    const other = b[index];
    return (
      asset.label === other.label &&
      asset.type === other.type &&
      asset.url === other.url &&
      asset.path === other.path &&
      asset.notes === other.notes
    );
  });
}

function shallowEqualRecords(a?: Record<string, unknown>, b?: Record<string, unknown>): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(key => Object.is(a[key], b[key]));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-')
    .slice(0, 80);
}

function sanitizeId(value: string): string {
  const slug = slugify(value);
  return slug || 'content';
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9-_]/gi, '_');
}

function sortKey(item: ContentCalendarItem, mode: 'scheduled' | 'created' | 'updated'): string {
  if (mode === 'created') return item.createdAt;
  if (mode === 'updated') return item.updatedAt;
  const fallback = `~${item.createdAt}`;
  return item.scheduledFor ?? item.publishAt ?? item.dueAt ?? fallback;
}

export class ContentCalendarStore {
  private readonly filePath: string;
  private readonly snapshotDir: string;
  private readonly logger: Logger;

  constructor(config: AppConfig, logger: Logger) {
    this.logger = logger;
    const baseDir = path.resolve(config.DATA_DIR, STORAGE_DIR);
    this.filePath = path.join(baseDir, STORAGE_FILE);
    this.snapshotDir = path.join(baseDir, SNAPSHOT_DIR);
  }

  private async ensureDirectory(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
  }

  private async ensureSnapshotDirectory(): Promise<void> {
    await fs.mkdir(this.snapshotDir, { recursive: true });
  }

  private async readFile(): Promise<ContentCalendarFileData> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as ContentCalendarFileData;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.version !== 'number' || !parsed.items) {
        throw new Error('Invalid content calendar store format');
      }
      return parsed;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn({ err, filePath: this.filePath }, 'Failed to read content calendar store');
      }
      return { version: VERSION, items: {} };
    }
  }

  private async writeFile(data: ContentCalendarFileData): Promise<void> {
    await this.ensureDirectory();
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  private async writeSnapshot(item: ContentCalendarItem): Promise<void> {
    try {
      await this.ensureSnapshotDirectory();
      const file = path.join(this.snapshotDir, `${safeFileName(item.id)}.json`);
      await fs.writeFile(file, JSON.stringify(item, null, 2), 'utf8');
    } catch (err) {
      this.logger.warn({ err, id: item.id }, 'Failed to write content calendar snapshot');
    }
  }

  private async removeSnapshot(id: string): Promise<void> {
    const file = path.join(this.snapshotDir, `${safeFileName(id)}.json`);
    try {
      await fs.unlink(file);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn({ err, id }, 'Failed to remove content calendar snapshot');
      }
    }
  }

  private generateId(title: string, data: ContentCalendarFileData): string {
    const base = sanitizeId(title);
    let candidate = base;
    let counter = 1;
    while (data.items[candidate]) {
      candidate = `${base}-${counter}`;
      counter += 1;
    }
    return candidate;
  }

  private resolveId(inputId: string | undefined, title: string, data: ContentCalendarFileData): string {
    if (inputId) {
      const sanitized = sanitizeId(inputId);
      if (!sanitized) {
        throw new Error('Provided id resolves to an empty value');
      }
      if (data.items[sanitized]) {
        throw new Error(`Content calendar item with id "${sanitized}" already exists`);
      }
      return sanitized;
    }
    return this.generateId(title, data);
  }

  async create(input: ContentCalendarCreateInput): Promise<ContentCalendarItem> {
    const data = await this.readFile();
    const now = pacificNowIso();
    const title = normalizeString(input.title);
    if (!title) {
      throw new Error('Title is required');
    }
    const id = this.resolveId(input.id, title, data);
    const status = normalizeString(input.status) ?? DEFAULT_STATUS;
    const tags = normalizeListValues(input.tags);
    const notes = normalizeListValues(input.notes);
    const assets = normalizeAssets(input.assets);
    const metadata = normalizeMetadata(input.metadata);

    const item: ContentCalendarItem = {
      id,
      title,
      status,
      channel: normalizeString(input.channel),
      owner: normalizeString(input.owner),
      summary: normalizeString(input.summary),
      description: normalizeString(input.description),
      brief: normalizeString(input.brief),
      scheduledFor: normalizeDate(input.scheduledFor),
      publishAt: normalizeDate(input.publishAt),
      dueAt: normalizeDate(input.dueAt),
      campaign: normalizeString(input.campaign),
      callToAction: normalizeString(input.callToAction),
      tags: tags && tags.length > 0 ? tags : undefined,
      notes: notes && notes.length > 0 ? notes : undefined,
      assets: assets && assets.length > 0 ? assets : undefined,
      metadata,
      createdAt: now,
      updatedAt: now,
      history: [
        {
          type: 'created',
          timestamp: now,
          status,
        },
      ],
    };

    data.items[id] = item;
    await this.writeFile(data);
    await this.writeSnapshot(item);
    return item;
  }

  async update(id: string, input: ContentCalendarUpdateInput): Promise<ContentCalendarItem> {
    const data = await this.readFile();
    const existing = data.items[id];
    if (!existing) {
      throw new Error(`Content calendar item "${id}" not found`);
    }

    const now = pacificNowIso();
    const updated: ContentCalendarItem = {
      ...existing,
      tags: existing.tags ? [...existing.tags] : undefined,
      notes: existing.notes ? [...existing.notes] : undefined,
      assets: existing.assets ? existing.assets.map(asset => ({ ...asset })) : undefined,
      metadata: existing.metadata ? { ...existing.metadata } : undefined,
      history: existing.history ? [...existing.history] : undefined,
    };

    let hasChanges = false;
    const updatedFields: string[] = [];
    const historyEntries: ContentCalendarHistoryEntry[] = [];
    const appendedNotes: string[] = [];

    const applyOptionalString = (
      value: Nullable<string>,
      getter: () => string | undefined,
      setter: (val: string | undefined) => void,
      label: string,
    ) => {
      if (value === undefined) return;
      if (value === null) {
        if (getter() !== undefined) {
          setter(undefined);
          hasChanges = true;
          updatedFields.push(label);
        }
        return;
      }
      const normalized = normalizeString(value);
      if (normalized === getter()) return;
      setter(normalized);
      hasChanges = true;
      updatedFields.push(label);
    };

    const applyOptionalDate = (
      value: Nullable<string>,
      getter: () => string | undefined,
      setter: (val: string | undefined) => void,
      label: string,
    ) => {
      if (value === undefined) return;
      if (value === null) {
        if (getter() !== undefined) {
          setter(undefined);
          hasChanges = true;
          updatedFields.push(label);
        }
        return;
      }
      const normalized = normalizeDate(value);
      if (normalized === getter()) return;
      setter(normalized);
      hasChanges = true;
      updatedFields.push(label);
    };

    if (input.title !== undefined) {
      const normalized = normalizeString(input.title);
      if (!normalized) {
        throw new Error('Title cannot be empty');
      }
      if (normalized !== updated.title) {
        updated.title = normalized;
        hasChanges = true;
        updatedFields.push('title');
      }
    }

    if (input.status !== undefined) {
      const status = normalizeString(input.status) ?? DEFAULT_STATUS;
      if (status !== updated.status) {
        historyEntries.push({
          type: 'status_change',
          timestamp: now,
          status,
          previousStatus: updated.status,
          note: normalizeString(input.statusNote),
        });
        updated.status = status;
        hasChanges = true;
      } else {
        const statusNote = normalizeString(input.statusNote);
        if (statusNote) {
          historyEntries.push({ type: 'note_added', timestamp: now, note: statusNote });
          hasChanges = true;
        }
      }
    } else {
      const statusNote = normalizeString(input.statusNote);
      if (statusNote) {
        historyEntries.push({ type: 'note_added', timestamp: now, note: statusNote });
        hasChanges = true;
      }
    }

    applyOptionalString(input.channel, () => updated.channel, val => {
      if (val === undefined) {
        delete updated.channel;
      } else {
        updated.channel = val;
      }
    }, 'channel');

    applyOptionalString(input.owner, () => updated.owner, val => {
      if (val === undefined) {
        delete updated.owner;
      } else {
        updated.owner = val;
      }
    }, 'owner');

    applyOptionalString(input.summary, () => updated.summary, val => {
      if (val === undefined) {
        delete updated.summary;
      } else {
        updated.summary = val;
      }
    }, 'summary');

    applyOptionalString(input.description, () => updated.description, val => {
      if (val === undefined) {
        delete updated.description;
      } else {
        updated.description = val;
      }
    }, 'description');

    applyOptionalString(input.brief, () => updated.brief, val => {
      if (val === undefined) {
        delete updated.brief;
      } else {
        updated.brief = val;
      }
    }, 'brief');

    applyOptionalString(input.campaign, () => updated.campaign, val => {
      if (val === undefined) {
        delete updated.campaign;
      } else {
        updated.campaign = val;
      }
    }, 'campaign');

    applyOptionalString(input.callToAction, () => updated.callToAction, val => {
      if (val === undefined) {
        delete updated.callToAction;
      } else {
        updated.callToAction = val;
      }
    }, 'call_to_action');

    applyOptionalDate(input.scheduledFor, () => updated.scheduledFor, val => {
      if (val === undefined) {
        delete updated.scheduledFor;
      } else {
        updated.scheduledFor = val;
      }
    }, 'scheduledFor');

    applyOptionalDate(input.publishAt, () => updated.publishAt, val => {
      if (val === undefined) {
        delete updated.publishAt;
      } else {
        updated.publishAt = val;
      }
    }, 'publishAt');

    applyOptionalDate(input.dueAt, () => updated.dueAt, val => {
      if (val === undefined) {
        delete updated.dueAt;
      } else {
        updated.dueAt = val;
      }
    }, 'dueAt');

    if (input.tags !== undefined) {
      if (input.tags === null) {
        if (updated.tags !== undefined) {
          delete updated.tags;
          hasChanges = true;
          updatedFields.push('tags');
        }
      } else {
        const normalized = normalizeListValues(input.tags);
        const next = normalized ?? [];
        const prev = updated.tags ?? [];
        if (!arraysEqual(prev, next)) {
          updated.tags = next.length > 0 ? next : undefined;
          hasChanges = true;
          updatedFields.push('tags');
        }
      }
    }

    const appendTags = normalizeAppendValues(input.appendTags);
    if (appendTags && appendTags.length > 0) {
      const current = updated.tags ?? [];
      const merged = mergeUniqueStrings(current, appendTags);
      if (!arraysEqual(current, merged)) {
        updated.tags = merged;
        hasChanges = true;
        updatedFields.push('tags');
      }
    }

    if (input.notes !== undefined) {
      if (input.notes === null) {
        if (updated.notes !== undefined) {
          delete updated.notes;
          hasChanges = true;
          updatedFields.push('notes');
        }
      } else {
        const normalized = normalizeListValues(input.notes);
        const next = normalized ?? [];
        const prev = updated.notes ?? [];
        if (!arraysEqual(prev, next)) {
          updated.notes = next.length > 0 ? next : undefined;
          hasChanges = true;
          updatedFields.push('notes');
        }
      }
    }

    const appendNotesNormalized = normalizeAppendValues(input.appendNotes);
    if (appendNotesNormalized && appendNotesNormalized.length > 0) {
      const current = updated.notes ?? [];
      const merged = mergeUniqueStrings(current, appendNotesNormalized);
      if (!arraysEqual(current, merged)) {
        updated.notes = merged;
        appendedNotes.push(...appendNotesNormalized);
        hasChanges = true;
        updatedFields.push('notes');
      }
    }

    if (input.assets !== undefined) {
      if (input.assets === null) {
        if (updated.assets !== undefined) {
          delete updated.assets;
          hasChanges = true;
          updatedFields.push('assets');
        }
      } else {
        const normalized = normalizeAssets(input.assets) ?? [];
        const prev = updated.assets ?? [];
        if (!assetsEqual(prev, normalized)) {
          updated.assets = normalized.length > 0 ? normalized : undefined;
          hasChanges = true;
          updatedFields.push('assets');
        }
      }
    }

    if (input.metadata !== undefined) {
      const normalized = normalizeMetadata(input.metadata);
      if (input.mergeMetadata === false) {
        if (!shallowEqualRecords(normalized, updated.metadata)) {
          if (normalized && Object.keys(normalized).length > 0) {
            updated.metadata = normalized;
          } else {
            delete updated.metadata;
          }
          hasChanges = true;
          updatedFields.push('metadata');
        }
      } else {
        const merged = { ...(updated.metadata ?? {}), ...(normalized ?? {}) };
        const cleaned = Object.keys(merged).length > 0 ? merged : undefined;
        if (!shallowEqualRecords(cleaned, updated.metadata)) {
          if (cleaned) {
            updated.metadata = cleaned;
          } else {
            delete updated.metadata;
          }
          hasChanges = true;
          updatedFields.push('metadata');
        }
      }
    }

    if (updated.tags && updated.tags.length === 0) {
      delete updated.tags;
    }
    if (updated.notes && updated.notes.length === 0) {
      delete updated.notes;
    }
    if (updated.assets && updated.assets.length === 0) {
      delete updated.assets;
    }
    if (updated.metadata && Object.keys(updated.metadata).length === 0) {
      delete updated.metadata;
    }

    if (appendedNotes.length > 0) {
      historyEntries.push({
        type: 'note_added',
        timestamp: now,
        note: appendedNotes.join('\n'),
      });
    }

    const filteredFields = updatedFields.filter(field => field !== '');
    if (filteredFields.length > 0) {
      historyEntries.push({
        type: 'updated',
        timestamp: now,
        changes: Array.from(new Set(filteredFields)).sort(),
      });
    }

    if (!hasChanges && historyEntries.length === 0) {
      return existing;
    }

    if (historyEntries.length > 0) {
      const history = updated.history ? [...updated.history] : [];
      history.push(...historyEntries);
      updated.history = history;
    }

    updated.updatedAt = now;
    data.items[id] = updated;
    await this.writeFile(data);
    await this.writeSnapshot(updated);
    return updated;
  }

  async get(id: string): Promise<ContentCalendarItem | null> {
    const data = await this.readFile();
    const item = data.items[id];
    if (!item) return null;
    return {
      ...item,
      tags: item.tags ? [...item.tags] : undefined,
      notes: item.notes ? [...item.notes] : undefined,
      assets: item.assets ? item.assets.map(asset => ({ ...asset })) : undefined,
      metadata: item.metadata ? { ...item.metadata } : undefined,
      history: item.history
        ? item.history.map(entry => ({
            ...entry,
            changes: entry.changes ? [...entry.changes] : undefined,
          }))
        : undefined,
    };
  }

  async list(options: ContentCalendarListOptions = {}): Promise<ContentCalendarItem[]> {
    const data = await this.readFile();
    const sortMode = options.sort ?? 'scheduled';
    let items = Object.values(data.items);

    if (options.status && options.status.length > 0) {
      const set = new Set(options.status.map(value => value.toLowerCase()));
      items = items.filter(item => set.has(item.status.toLowerCase()));
    }

    if (options.channel && options.channel.length > 0) {
      const set = new Set(options.channel.map(value => value.toLowerCase()));
      items = items.filter(item => (item.channel ? set.has(item.channel.toLowerCase()) : false));
    }

    const scheduledFromIso = normalizeDate(options.scheduledFrom);
    const scheduledToIso = normalizeDate(options.scheduledTo);
    const scheduledFrom = scheduledFromIso ? Date.parse(scheduledFromIso) : undefined;
    const scheduledTo = scheduledToIso ? Date.parse(scheduledToIso) : undefined;

    if (scheduledFrom !== undefined || scheduledTo !== undefined) {
      items = items.filter(item => {
        if (!item.scheduledFor) return false;
        const ts = Date.parse(item.scheduledFor);
        if (Number.isNaN(ts)) return false;
        if (scheduledFrom !== undefined && ts < scheduledFrom) return false;
        if (scheduledTo !== undefined && ts > scheduledTo) return false;
        return true;
      });
    }

    if (options.search) {
      const query = options.search.toLowerCase();
      items = items.filter(item => {
        const segments: string[] = [
          item.title,
          item.status,
          item.channel,
          item.summary,
          item.description,
          item.brief,
          item.owner,
          item.campaign,
          item.callToAction,
        ]
          .concat(item.tags ?? [])
          .concat(item.notes ?? [])
          .filter(Boolean)
          .map(value => value!.toString().toLowerCase());
        if (item.metadata) {
          for (const value of Object.values(item.metadata)) {
            if (typeof value === 'string') {
              segments.push(value.toLowerCase());
            } else if (value !== null && value !== undefined) {
              try {
                segments.push(JSON.stringify(value).toLowerCase());
              } catch {}
            }
          }
        }
        return segments.some(segment => segment.includes(query));
      });
    }

    if (sortMode === 'created') {
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else if (sortMode === 'updated') {
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } else {
      items.sort((a, b) => sortKey(a, 'scheduled').localeCompare(sortKey(b, 'scheduled')));
    }

    const limit = options.limit ? Math.max(1, Math.min(500, options.limit)) : undefined;
    if (limit !== undefined && items.length > limit) {
      items = items.slice(0, limit);
    }

    return items.map(item => ({
      ...item,
      tags: item.tags ? [...item.tags] : undefined,
      notes: item.notes ? [...item.notes] : undefined,
      assets: item.assets ? item.assets.map(asset => ({ ...asset })) : undefined,
      metadata: item.metadata ? { ...item.metadata } : undefined,
      history: item.history ? item.history.map(entry => ({
        ...entry,
        changes: entry.changes ? [...entry.changes] : undefined,
      })) : undefined,
    }));
  }

  async remove(id: string): Promise<boolean> {
    const data = await this.readFile();
    if (!data.items[id]) {
      return false;
    }
    delete data.items[id];
    await this.writeFile(data);
    await this.removeSnapshot(id);
    return true;
  }
}
