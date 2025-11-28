import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import { ensurePacificIso, pacificNowIso } from './time.js';

const CATEGORY_NAMES = ['preferences', 'connections', 'patterns', 'shortcuts', 'state'] as const;
export type MemoryCategory = typeof CATEGORY_NAMES[number];

export interface MemoryEntry {
  value: unknown;
  hits: number;
  created_at: string;
  last_updated: string;
  accessed_at: string;
}

type LegacyTimestampFields = Partial<Record<'created' | 'updated' | 'accessed', string>>;
type StoredMemoryEntry = MemoryEntry & LegacyTimestampFields;

export interface ArchiveEntry {
  key: string;
  originalKey: string;
  archivedAt: string;
  reason: 'expiry' | 'state_clear';
  entry: MemoryEntry;
}

type CategoryMap = Record<MemoryCategory, Record<string, StoredMemoryEntry>>;
type ArchiveMap = Record<MemoryCategory, ArchiveEntry[]>;

const MAX_ENTRIES_PER_CATEGORY = 100;
const MAX_ENTRY_BYTES = 4000;
const MAX_TOTAL_BYTES = 50 * 1024; // 50KB
const ENTRY_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

interface MemoryPaths {
  dir: string;
  metadata: string;
  archive: string;
  categories: Record<MemoryCategory, string>;
}

const VERSION = 2;

export interface MemoryMetadata {
  version: number;
  updatedAt: string;
  lastCleanup: string;
  counts: Record<MemoryCategory, number>;
  bytes: {
    total: number;
    metadata: number;
    categories: Record<MemoryCategory, number>;
    archives: Record<MemoryCategory, number>;
  };
  archives: {
    counts: Record<MemoryCategory, number>;
    total: number;
  };
}

function buildPaths(config: AppConfig): MemoryPaths {
  const dir = path.resolve(config.DATA_DIR, 'kota_memory');
  const categories = CATEGORY_NAMES.reduce((acc, cat) => {
    acc[cat] = path.join(dir, `${cat}.json`);
    return acc;
  }, {} as Record<MemoryCategory, string>);
  return {
    dir,
    metadata: path.join(dir, 'metadata.json'),
    archive: path.join(dir, 'archive.json'),
    categories,
  };
}

function ensureTimestampFields(entry: StoredMemoryEntry): void {
  const createdAt = ensurePacificIso(entry.created_at) ?? ensurePacificIso(entry.created) ?? pacificNowIso();
  const lastUpdated =
    ensurePacificIso(entry.last_updated) ??
    ensurePacificIso(entry.updated) ??
    createdAt;
  const accessedAt =
    ensurePacificIso(entry.accessed_at) ??
    ensurePacificIso(entry.accessed) ??
    lastUpdated;

  entry.created_at = createdAt;
  entry.last_updated = lastUpdated;
  entry.accessed_at = accessedAt;
  entry.hits = typeof entry.hits === 'number' && Number.isFinite(entry.hits) ? entry.hits : 0;

  delete entry.created;
  delete entry.updated;
  delete entry.accessed;
}

function getActivityTimestamp(entry: StoredMemoryEntry): number {
  const source = entry.accessed_at || entry.last_updated || entry.created_at || '';
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toJson(input: unknown): string {
  return JSON.stringify(input, null, 2);
}

function entrySize(entry: StoredMemoryEntry): number {
  return Buffer.byteLength(JSON.stringify(entry), 'utf8');
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function valueToSearchString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

function similarityScore(query: string, target: string): number {
  const normalizedQuery = normalize(query);
  const normalizedTarget = normalize(target);
  if (!normalizedQuery || !normalizedTarget) return 0;
  if (normalizedQuery === normalizedTarget) return 1;
  if (normalizedTarget.includes(normalizedQuery)) return Math.max(0.85, normalizedQuery.length / normalizedTarget.length);
  if (normalizedQuery.includes(normalizedTarget)) return Math.max(0.8, normalizedTarget.length / normalizedQuery.length);
  const distance = levenshtein(normalizedQuery, normalizedTarget);
  const longest = Math.max(normalizedQuery.length, normalizedTarget.length) || 1;
  const score = 1 - distance / longest;
  return score < 0 ? 0 : score;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultArchive(): ArchiveMap {
  return CATEGORY_NAMES.reduce((acc, category) => {
    acc[category] = [];
    return acc;
  }, {} as ArchiveMap);
}

export class KotaMemoryStore {
  private readonly paths: MemoryPaths;
  private metadataCache: MemoryMetadata | null = null;
  private ready: Promise<void> | null = null;

  constructor(private readonly config: AppConfig, private readonly logger: Logger) {
    this.paths = buildPaths(config);
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await fs.mkdir(this.paths.dir, { recursive: true });
        for (const file of Object.values(this.paths.categories)) {
          try {
            await fs.access(file);
          } catch {
            await fs.writeFile(file, '{}', 'utf8');
          }
        }
        try {
          await fs.access(this.paths.archive);
        } catch {
          await fs.writeFile(this.paths.archive, toJson(defaultArchive()), 'utf8');
        }
        try {
          await fs.access(this.paths.metadata);
        } catch {
          const metadata = this.defaultMetadata();
          await fs.writeFile(this.paths.metadata, toJson(metadata), 'utf8');
          this.metadataCache = metadata;
        }
      })();
    }
    await this.ready;
  }

  private defaultMetadata(): MemoryMetadata {
    const counts = CATEGORY_NAMES.reduce((acc, category) => {
      acc[category] = 0;
      return acc;
    }, {} as Record<MemoryCategory, number>);
    const bytes = CATEGORY_NAMES.reduce((acc, category) => {
      acc[category] = 0;
      return acc;
    }, {} as Record<MemoryCategory, number>);
const timestamp = pacificNowIso();
    return {
      version: VERSION,
      updatedAt: timestamp,
      lastCleanup: timestamp,
      counts,
      bytes: {
        total: 0,
        metadata: 0,
        categories: { ...bytes },
        archives: { ...bytes },
      },
      archives: {
        counts: { ...counts },
        total: 0,
      },
    };
  }

  private normalizeMetadata(metadata: MemoryMetadata): MemoryMetadata {
    const counts = { ...(metadata.counts ?? {}) } as Record<MemoryCategory, number>;
    const bytesCategories = { ...(metadata.bytes?.categories ?? {}) } as Record<MemoryCategory, number>;
    const bytesArchives = { ...(metadata.bytes?.archives ?? {}) } as Record<MemoryCategory, number>;
    const archiveCounts = { ...((metadata.archives?.counts as Record<MemoryCategory, number> | undefined) ?? {}) } as Record<MemoryCategory, number>;
    for (const category of CATEGORY_NAMES) {
      counts[category] ??= 0;
      bytesCategories[category] ??= 0;
      bytesArchives[category] ??= 0;
      archiveCounts[category] ??= 0;
    }
    return {
      ...metadata,
      version: VERSION,
      counts,
      bytes: {
        ...metadata.bytes,
        categories: bytesCategories,
        archives: bytesArchives,
      },
      archives: {
        ...metadata.archives,
        counts: archiveCounts,
      },
    };
  }

  private async readMetadata(): Promise<MemoryMetadata> {
    await this.ensureReady();
    if (this.metadataCache) return this.metadataCache;
    try {
      const raw = await fs.readFile(this.paths.metadata, 'utf8');
      const parsed = JSON.parse(raw) as MemoryMetadata;
      const normalized = this.normalizeMetadata(parsed);
      this.metadataCache = normalized;
      return normalized;
    } catch {
      const fallback = this.defaultMetadata();
      await fs.writeFile(this.paths.metadata, toJson(fallback), 'utf8');
      this.metadataCache = fallback;
      return fallback;
    }
  }

  private async loadCategory(category: MemoryCategory): Promise<Record<string, StoredMemoryEntry>> {
    await this.ensureReady();
    const file = this.paths.categories[category];
    try {
      const raw = await fs.readFile(file, 'utf8');
      if (!raw.trim()) return {};
      const parsed = JSON.parse(raw) as Record<string, StoredMemoryEntry>;
      if (!parsed) return {};
      for (const entry of Object.values(parsed)) {
        if (entry) ensureTimestampFields(entry);
      }
      return parsed;
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        await fs.writeFile(file, '{}', 'utf8');
        return {};
      }
      throw error;
    }
  }

  private async loadAllCategories(): Promise<CategoryMap> {
    const data = {} as CategoryMap;
    for (const category of CATEGORY_NAMES) {
      data[category] = await this.loadCategory(category);
    }
    return data;
  }

  private async saveCategories(data: CategoryMap, changed: Set<MemoryCategory>): Promise<void> {
    const writes = Array.from(changed).map(category => fs.writeFile(this.paths.categories[category], toJson(data[category]), 'utf8'));
    await Promise.all(writes);
  }

  private async loadArchive(): Promise<ArchiveMap> {
    await this.ensureReady();
    try {
      const raw = await fs.readFile(this.paths.archive, 'utf8');
      if (!raw.trim()) return defaultArchive();
      const parsed = JSON.parse(raw) as Partial<ArchiveMap>;
      const archive = defaultArchive();
      for (const category of CATEGORY_NAMES) {
        if (Array.isArray(parsed?.[category])) {
          archive[category] = (parsed as ArchiveMap)[category].map(record => {
            const normalizedEntry = { ...record.entry } as StoredMemoryEntry;
            ensureTimestampFields(normalizedEntry);
            const canonicalEntry: MemoryEntry = {
              value: normalizedEntry.value,
              hits: normalizedEntry.hits,
              created_at: normalizedEntry.created_at,
              last_updated: normalizedEntry.last_updated,
              accessed_at: normalizedEntry.accessed_at,
            };
            return { ...record, entry: canonicalEntry };
          });
        }
      }
      return archive;
    } catch {
      const archive = defaultArchive();
      await fs.writeFile(this.paths.archive, toJson(archive), 'utf8');
      return archive;
    }
  }

  private async saveArchive(archive: ArchiveMap): Promise<void> {
    await this.ensureReady();
    await fs.writeFile(this.paths.archive, toJson(archive), 'utf8');
  }

  private buildMetadataSnapshot(
    categories: CategoryMap,
    overrides: Partial<Pick<MemoryMetadata, 'updatedAt' | 'lastCleanup'>> | undefined,
    archive: ArchiveMap,
  ): { metadata: MemoryMetadata; json: string; size: number } {
    const counts = CATEGORY_NAMES.reduce((acc, category) => {
      acc[category] = Object.keys(categories[category]).length;
      return acc;
    }, {} as Record<MemoryCategory, number>);

    const archiveCounts = CATEGORY_NAMES.reduce((acc, category) => {
      acc[category] = archive[category].length;
      return acc;
    }, {} as Record<MemoryCategory, number>);

    const bytesActive = CATEGORY_NAMES.reduce((acc, category) => {
      const json = toJson(categories[category]);
      acc[category] = Buffer.byteLength(json, 'utf8');
      return acc;
    }, {} as Record<MemoryCategory, number>);

    const bytesArchive = CATEGORY_NAMES.reduce((acc, category) => {
      const json = toJson(archive[category]);
      acc[category] = Buffer.byteLength(json, 'utf8');
      return acc;
    }, {} as Record<MemoryCategory, number>);

    const activeTotal = Object.values(bytesActive).reduce((sum, val) => sum + val, 0);
    const archiveTotal = Object.values(bytesArchive).reduce((sum, val) => sum + val, 0);

    const baseMetadata: MemoryMetadata = {
      version: VERSION,
      updatedAt: overrides?.updatedAt ?? pacificNowIso(),
      lastCleanup: overrides?.lastCleanup ?? (this.metadataCache?.lastCleanup ?? pacificNowIso()),
      counts,
      bytes: {
        total: activeTotal + archiveTotal,
        metadata: 0,
        categories: bytesActive,
        archives: bytesArchive,
      },
      archives: {
        counts: archiveCounts,
        total: archiveTotal,
      },
    };

    let json = toJson(baseMetadata);
    let size = Buffer.byteLength(json, 'utf8');
    baseMetadata.bytes.metadata = size;
    baseMetadata.bytes.total += size;
    json = toJson(baseMetadata);
    size = Buffer.byteLength(json, 'utf8');
    if (size !== baseMetadata.bytes.metadata) {
      baseMetadata.bytes.metadata = size;
      baseMetadata.bytes.total = activeTotal + archiveTotal + size;
      json = toJson(baseMetadata);
      size = Buffer.byteLength(json, 'utf8');
    }

    return { metadata: baseMetadata, json, size };
  }

  private async writeMetadata(
    categories: CategoryMap,
    overrides: Partial<Pick<MemoryMetadata, 'updatedAt' | 'lastCleanup'>> | undefined,
    archive: ArchiveMap,
  ): Promise<void> {
    const snapshot = this.buildMetadataSnapshot(categories, overrides, archive);
    this.metadataCache = snapshot.metadata;
    await fs.writeFile(this.paths.metadata, snapshot.json, 'utf8');
  }

  private findExistingKey(data: Record<string, StoredMemoryEntry>, key: string): string | null {
    const normalizedTarget = normalize(key);
    for (const existingKey of Object.keys(data)) {
      if (normalize(existingKey) === normalizedTarget) {
        return existingKey;
      }
    }
    return null;
  }

  private findStaleEntry(data: Record<string, StoredMemoryEntry>): string | null {
    let oldestKey: string | null = null;
    let oldestTimestamp = Number.POSITIVE_INFINITY;
    for (const [key, entry] of Object.entries(data)) {
      ensureTimestampFields(entry);
      const ts = getActivityTimestamp(entry);
      if (ts < oldestTimestamp) {
        oldestTimestamp = ts;
        oldestKey = key;
      }
    }
    return oldestKey;
  }

  private inferCategory(key: string, hint?: MemoryCategory): MemoryCategory {
    if (hint) return hint;
    const normalizedKey = normalize(key);
    if (/pref(erence|s)?/.test(normalizedKey)) return 'preferences';
    if (/connect|relationship|team|partner|client/.test(normalizedKey)) return 'connections';
    if (/pattern|habit|routine|limit|hours?/.test(normalizedKey)) return 'patterns';
    if (/shortcut|phrase|alias/.test(normalizedKey)) return 'shortcuts';
    return 'state';
  }

  private collectActiveEntries(map: CategoryMap) {
    const entries: Array<{ category: MemoryCategory; key: string; entry: StoredMemoryEntry }> = [];
    for (const category of CATEGORY_NAMES) {
      for (const [key, entry] of Object.entries(map[category])) {
        entries.push({ category, key, entry });
      }
    }
    return entries;
  }

  private collectArchiveEntries(map: ArchiveMap) {
    const entries: Array<{ category: MemoryCategory; entry: ArchiveEntry }> = [];
    for (const category of CATEGORY_NAMES) {
      for (const entry of map[category]) {
        entries.push({ category, entry });
      }
    }
    return entries;
  }

  private async enforceCategoryLimits(map: CategoryMap, category: MemoryCategory): Promise<boolean> {
    const entries = map[category];
    let modified = false;
    while (Object.keys(entries).length > MAX_ENTRIES_PER_CATEGORY) {
      const victim = this.findStaleEntry(entries);
      if (!victim) break;
      delete entries[victim];
      modified = true;
    }
    return modified;
  }

  private enforceTotalLimit(map: CategoryMap, archive: ArchiveMap) {
    const changedCategories = new Set<MemoryCategory>();
    const changedArchiveCategories = new Set<MemoryCategory>();

    const computeTotal = () => this.buildMetadataSnapshot(map, { updatedAt: this.metadataCache?.updatedAt }, archive).metadata.bytes.total;

    let total = computeTotal();
    if (total <= MAX_TOTAL_BYTES) {
      return { categories: changedCategories, archives: changedArchiveCategories };
    }

    const archivedEntries = this.collectArchiveEntries(archive).sort((a, b) => {
      const aTime = Date.parse(a.entry.archivedAt) || 0;
      const bTime = Date.parse(b.entry.archivedAt) || 0;
      return aTime - bTime;
    });

    let idx = 0;
    while (total > MAX_TOTAL_BYTES && idx < archivedEntries.length) {
      const { category, entry } = archivedEntries[idx];
      const list = archive[category];
      const position = list.indexOf(entry);
      if (position >= 0) {
        list.splice(position, 1);
        changedArchiveCategories.add(category);
        total = computeTotal();
      }
      idx += 1;
    }

    if (total > MAX_TOTAL_BYTES) {
      const activeEntries = this.collectActiveEntries(map).sort((a, b) => getActivityTimestamp(a.entry) - getActivityTimestamp(b.entry));
      let pointer = 0;
      while (total > MAX_TOTAL_BYTES && pointer < activeEntries.length) {
        const victim = activeEntries[pointer];
        if (map[victim.category][victim.key]) {
          delete map[victim.category][victim.key];
          changedCategories.add(victim.category);
          total = computeTotal();
        }
        pointer += 1;
      }
    }

    if (total > MAX_TOTAL_BYTES) {
      throw new Error('Unable to satisfy memory size limits. Storage remains above 50KB.');
    }

    return { categories: changedCategories, archives: changedArchiveCategories };
  }

  private archiveEntry(
    archive: ArchiveMap,
    category: MemoryCategory,
    key: string,
    entry: StoredMemoryEntry,
    reason: ArchiveEntry['reason'],
    timestamp?: string,
  ): ArchiveEntry {
    const archivedAt = timestamp ?? pacificNowIso();
    ensureTimestampFields(entry);
    const canonicalEntry: MemoryEntry = {
      value: entry.value,
      hits: entry.hits,
      created_at: entry.created_at,
      last_updated: entry.last_updated,
      accessed_at: entry.accessed_at,
    };
    const record: ArchiveEntry = {
      key: `${key}@${archivedAt}`,
      originalKey: key,
      archivedAt,
      reason,
      entry: canonicalEntry,
    };
    archive[category].push(record);
    return record;
  }

  private cleanupExpiredEntries(map: CategoryMap, archive: ArchiveMap) {
    const changedCategories = new Set<MemoryCategory>();
    let archiveChanged = false;
    const cutoff = Date.now() - ENTRY_EXPIRY_MS;
    for (const category of CATEGORY_NAMES) {
      const entries = map[category];
      for (const [key, entry] of Object.entries(entries)) {
        ensureTimestampFields(entry);
        const ts = getActivityTimestamp(entry);
        if (ts && ts < cutoff) {
          this.archiveEntry(archive, category, key, entry, 'expiry');
          delete entries[key];
          changedCategories.add(category);
          archiveChanged = true;
        }
      }
    }
    return { changedCategories, archiveChanged };
  }

  private async persist(
    categories: CategoryMap,
    archive: ArchiveMap,
    categoryChanges: Set<MemoryCategory>,
    archivesChanged: boolean,
    overrides?: Partial<Pick<MemoryMetadata, 'updatedAt' | 'lastCleanup'>>,
  ) {
    if (categoryChanges.size) {
      await this.saveCategories(categories, categoryChanges);
    }
    if (archivesChanged) {
      await this.saveArchive(archive);
    }
    await this.writeMetadata(categories, overrides, archive);
  }

  async set(key: string, value: unknown, categoryHint?: MemoryCategory) {
    if (!key?.trim()) throw new Error('Key is required');
    const categories = await this.loadAllCategories();
    const archive = await this.loadArchive();

    const cleanupResult = this.cleanupExpiredEntries(categories, archive);
    const cleanupCategories = cleanupResult.changedCategories;
    const categoryChanges = new Set<MemoryCategory>(cleanupCategories);
    let archivesChanged = cleanupResult.archiveChanged;
    let overrides: Partial<Pick<MemoryMetadata, 'updatedAt' | 'lastCleanup'>> | undefined;
    if (cleanupCategories.size || cleanupResult.archiveChanged) {
      overrides = { lastCleanup: pacificNowIso() };
    }

    const category = this.inferCategory(key, categoryHint);
    const entries = categories[category];
    const existingKey = this.findExistingKey(entries, key);
    const targetKey = existingKey ?? key.trim();
    const now = pacificNowIso();
    const existing = existingKey ? entries[existingKey] : undefined;
    const createdTimestamp = existing?.created_at ?? now;
    const nextEntry: MemoryEntry = {
      value,
      hits: existing?.hits ?? 0,
      created_at: createdTimestamp,
      last_updated: now,
      accessed_at: now,
    };
    ensureTimestampFields(nextEntry as StoredMemoryEntry);
    if (entrySize(nextEntry as StoredMemoryEntry) > MAX_ENTRY_BYTES) {
      throw new Error('Entry exceeds 500 byte limit. Please store a smaller or more concise value.');
    }
    entries[targetKey] = nextEntry;
    categoryChanges.add(category);

    if (await this.enforceCategoryLimits(categories, category)) {
      categoryChanges.add(category);
    }

    const limitResult = this.enforceTotalLimit(categories, archive);
    limitResult.categories.forEach(cat => categoryChanges.add(cat));
    if (limitResult.archives.size > 0) {
      archivesChanged = true;
    }

    await this.persist(categories, archive, categoryChanges, archivesChanged, overrides);
    this.logger.info({ key: targetKey, category }, 'Memory entry stored');
    return {
      key: targetKey,
      category,
      created_at: nextEntry.created_at,
      last_updated: nextEntry.last_updated,
      accessed_at: nextEntry.accessed_at,
    };
  }

  async get(query: string) {
    if (!query?.trim()) throw new Error('Query is required');
    const categories = await this.loadAllCategories();
    const archive = await this.loadArchive();

    const cleanupResult = this.cleanupExpiredEntries(categories, archive);
    const cleanupCategories = cleanupResult.changedCategories;
    const categoryChanges = new Set<MemoryCategory>(cleanupCategories);
    let archivesChanged = cleanupResult.archiveChanged;
    let overrides: Partial<Pick<MemoryMetadata, 'updatedAt' | 'lastCleanup'>> | undefined;
    if (cleanupCategories.size || cleanupResult.archiveChanged) {
      overrides = { lastCleanup: pacificNowIso() };
    }

    const normalizedQuery = normalize(query);
    let best: {
      category: MemoryCategory;
      key: string;
      entry: StoredMemoryEntry;
      confidence: number;
      archived: boolean;
      archivedAt?: string;
      reason?: ArchiveEntry['reason'];
      originalKey?: string;
    } | null = null;

    for (const category of CATEGORY_NAMES) {
      const entries = categories[category];
      for (const [key, entry] of Object.entries(entries)) {
        const keyScore = similarityScore(normalizedQuery, key);
        let score = keyScore;
        if (score < 0.6) {
          const valueScore = similarityScore(normalizedQuery, valueToSearchString(entry.value));
          score = Math.max(score, valueScore * 0.9);
        }
        if (score > (best?.confidence ?? 0)) {
          best = { category, key, entry, confidence: Number(score.toFixed(3)), archived: false };
        }
        if (score >= 0.99) break;
      }
    }

    for (const category of CATEGORY_NAMES) {
      const archivedEntries = archive[category];
      for (const archivedEntry of archivedEntries) {
        const { key, originalKey, entry, reason, archivedAt } = archivedEntry;
        const scoreFromKey = similarityScore(normalizedQuery, key);
        const scoreFromOriginal = similarityScore(normalizedQuery, originalKey);
        const scoreFromValue = similarityScore(normalizedQuery, valueToSearchString(entry.value)) * 0.9;
        const score = Math.max(scoreFromKey, scoreFromOriginal, scoreFromValue);
        if (score > (best?.confidence ?? 0)) {
          best = {
            category,
            key,
            entry,
            confidence: Number(score.toFixed(3)),
            archived: true,
            archivedAt,
            reason,
            originalKey,
          };
        }
      }
    }

    if (!best) {
      if (categoryChanges.size || archivesChanged) {
        await this.persist(categories, archive, categoryChanges, archivesChanged, overrides);
      }
      return null;
    }

    const now = pacificNowIso();
    best.entry.accessed_at = now;
    ensureTimestampFields(best.entry);
    best.entry.hits += 1;
    if (best.archived) {
      archivesChanged = true;
    } else {
      categoryChanges.add(best.category);
    }

    await this.persist(categories, archive, categoryChanges, archivesChanged, overrides);
    return {
      key: best.key,
      category: best.category,
      value: best.entry.value,
      created_at: best.entry.created_at,
      last_updated: best.entry.last_updated,
      accessed_at: best.entry.accessed_at,
      hits: best.entry.hits,
      confidence: best.confidence,
      archived: best.archived,
      ...(best.archived ? { archivedAt: best.archivedAt, reason: best.reason, originalKey: best.originalKey } : {}),
    };
  }

  async list(categoryFilter?: MemoryCategory): Promise<string[]> {
    const categories = await this.loadAllCategories();
    const archive = await this.loadArchive();

    const cleanupResult = this.cleanupExpiredEntries(categories, archive);
    const categoryChanges = cleanupResult.changedCategories;
    const archivesChanged = cleanupResult.archiveChanged;
    let overrides: Partial<Pick<MemoryMetadata, 'updatedAt' | 'lastCleanup'>> | undefined;
    if (categoryChanges.size || archivesChanged) {
      overrides = { lastCleanup: pacificNowIso() };
    }

    const keys: string[] = [];
    const categoriesToList = categoryFilter ? [categoryFilter] : CATEGORY_NAMES;
    for (const category of categoriesToList) {
      for (const key of Object.keys(categories[category])) {
        keys.push(`${category}:${key}`);
      }
    }

    if (categoryChanges.size || archivesChanged) {
      await this.persist(categories, archive, categoryChanges, archivesChanged, overrides);
    }

    return keys.sort((a, b) => a.localeCompare(b));
  }

  async listArchived(): Promise<string[]> {
    const categories = await this.loadAllCategories();
    const archive = await this.loadArchive();

    const cleanupResult = this.cleanupExpiredEntries(categories, archive);
    const categoryChanges = cleanupResult.changedCategories;
    const archivesChanged = cleanupResult.archiveChanged;
    let overrides: Partial<Pick<MemoryMetadata, 'updatedAt' | 'lastCleanup'>> | undefined;
    if (categoryChanges.size || archivesChanged) {
      overrides = { lastCleanup: pacificNowIso() };
    }

    const keys: string[] = [];
    for (const category of CATEGORY_NAMES) {
      for (const entry of archive[category]) {
        keys.push(`${category}:${entry.key}`);
      }
    }

    if (categoryChanges.size || archivesChanged) {
      await this.persist(categories, archive, categoryChanges, archivesChanged, overrides);
    }

    return keys.sort((a, b) => a.localeCompare(b));
  }

  private mergeValues(current: unknown, addition: unknown): unknown {
    if (Array.isArray(current)) {
      if (Array.isArray(addition)) {
        return [...current, ...addition];
      }
      return [...current, addition];
    }
    if (isPlainObject(current) && isPlainObject(addition)) {
      return { ...current, ...addition };
    }
    if (typeof current === 'string' && typeof addition === 'string') {
      if (!addition.trim()) return current;
      if (current.includes(addition)) return current;
      return `${current} ${addition}`.trim();
    }
    return addition;
  }

  async update(key: string, addition: unknown) {
    if (!key?.trim()) throw new Error('Key is required');
    const categories = await this.loadAllCategories();
    const archive = await this.loadArchive();

    const cleanupResult = this.cleanupExpiredEntries(categories, archive);
    const cleanupCategories = cleanupResult.changedCategories;
    const categoryChanges = new Set<MemoryCategory>(cleanupCategories);
    let archivesChanged = cleanupResult.archiveChanged;
    let overrides: Partial<Pick<MemoryMetadata, 'updatedAt' | 'lastCleanup'>> | undefined;
    if (cleanupCategories.size || cleanupResult.archiveChanged) {
      overrides = { lastCleanup: pacificNowIso() };
    }

    const normalizedKey = normalize(key);
    for (const category of CATEGORY_NAMES) {
      const entries = categories[category];
      for (const [entryKey, entry] of Object.entries(entries)) {
        if (normalize(entryKey) === normalizedKey) {
          const merged = this.mergeValues(entry.value, addition);
          const now = pacificNowIso();
          entry.value = merged;
          entry.last_updated = now;
          entry.accessed_at = now;
          entry.hits += 1;
          ensureTimestampFields(entry);
          if (entrySize(entry) > MAX_ENTRY_BYTES) {
            throw new Error('Updated entry exceeds 500 byte limit. Operation aborted.');
          }
          categoryChanges.add(category);
          if (await this.enforceCategoryLimits(categories, category)) {
            categoryChanges.add(category);
          }
          const limitResult = this.enforceTotalLimit(categories, archive);
          limitResult.categories.forEach(cat => categoryChanges.add(cat));
          if (limitResult.archives.size > 0) {
            archivesChanged = true;
          }
          await this.persist(categories, archive, categoryChanges, archivesChanged, overrides);
          this.logger.info({ key: entryKey, category }, 'Memory entry updated');
          return {
            key: entryKey,
            category,
            created_at: entry.created_at,
            last_updated: entry.last_updated,
            accessed_at: entry.accessed_at,
          };
        }
      }
    }
    throw new Error(`No memory entry found for key: ${key}`);
  }

  async remove(key: string) {
    if (!key?.trim()) throw new Error('Key is required');
    const categories = await this.loadAllCategories();
    const archive = await this.loadArchive();

    const cleanupResult = this.cleanupExpiredEntries(categories, archive);
    const cleanupCategories = cleanupResult.changedCategories;
    const categoryChanges = new Set<MemoryCategory>(cleanupCategories);
    let archivesChanged = cleanupResult.archiveChanged;
    let overrides: Partial<Pick<MemoryMetadata, 'updatedAt' | 'lastCleanup'>> | undefined;
    if (cleanupCategories.size || cleanupResult.archiveChanged) {
      overrides = { lastCleanup: pacificNowIso() };
    }

    const normalizedKey = normalize(key);
    for (const category of CATEGORY_NAMES) {
      const entries = categories[category];
      for (const entryKey of Object.keys(entries)) {
        if (normalize(entryKey) === normalizedKey) {
          const entry = entries[entryKey];
          if (entry) ensureTimestampFields(entry);
          delete entries[entryKey];
          categoryChanges.add(category);
          const limitResult = this.enforceTotalLimit(categories, archive);
          limitResult.categories.forEach(cat => categoryChanges.add(cat));
          if (limitResult.archives.size > 0) {
            archivesChanged = true;
          }
          await this.persist(categories, archive, categoryChanges, archivesChanged, overrides);
          this.logger.info({ key: entryKey, category }, 'Memory entry deleted');
          return entry
            ? {
                key: entryKey,
                category,
                created_at: entry.created_at,
                last_updated: entry.last_updated,
                accessed_at: entry.accessed_at,
              }
            : { key: entryKey, category };
        }
      }
    }
    throw new Error(`No memory entry found for key: ${key}`);
  }

  async clearState() {
    const categories = await this.loadAllCategories();
    const archive = await this.loadArchive();

    const cleanupResult = this.cleanupExpiredEntries(categories, archive);
    const cleanupCategories = cleanupResult.changedCategories;
    const categoryChanges = new Set<MemoryCategory>(cleanupCategories);
    let archivesChanged = cleanupResult.archiveChanged;
    let overrides: Partial<Pick<MemoryMetadata, 'updatedAt' | 'lastCleanup'>> | undefined;
    if (cleanupCategories.size || cleanupResult.archiveChanged) {
      overrides = { lastCleanup: pacificNowIso() };
    }

    const stateEntries = categories.state;
    if (!Object.keys(stateEntries).length) {
      if (categoryChanges.size || archivesChanged) {
        await this.persist(categories, archive, categoryChanges, archivesChanged, overrides);
      }
      return { cleared: false, message: 'State is already empty.' };
    }

    const snapshotAt = pacificNowIso();
    const archivedKeys: string[] = [];
    for (const [key, entry] of Object.entries(stateEntries)) {
      const archived = this.archiveEntry(archive, 'state', key, entry, 'state_clear', snapshotAt);
      archivedKeys.push(archived.key);
      archivesChanged = true;
    }

    categories.state = {};
    categoryChanges.add('state');

    const limitResult = this.enforceTotalLimit(categories, archive);
    limitResult.categories.forEach(cat => categoryChanges.add(cat));
    if (limitResult.archives.size > 0) {
      archivesChanged = true;
    }

    overrides = overrides ? { ...overrides, updatedAt: snapshotAt } : { updatedAt: snapshotAt };
    await this.persist(categories, archive, categoryChanges, archivesChanged, overrides);
    this.logger.info({ archivedCount: archivedKeys.length }, 'Current state cleared');
    return { cleared: true, archivedKeys, archivedAt: snapshotAt };
  }
}

export function formatList(keys: string[]): string {
  return JSON.stringify(keys);
}
