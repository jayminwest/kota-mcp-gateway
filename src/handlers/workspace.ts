import { z } from 'zod';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { parse as parseYAML } from 'yaml';
import type { Logger } from '../utils/logger.js';

const MapSchema = z
  .object({
    path: z
      .string()
      .optional()
      .describe('Relative directory inside DATA_DIR to scope the map (default: root).'),
    search: z.string().optional().describe('Case-insensitive query across names, tags, topics, and summaries.'),
    max_depth: z
      .coerce.number()
      .int()
      .positive()
      .max(10)
      .optional()
      .describe('Maximum directory depth to traverse (default 4).'),
    limit: z
      .coerce.number()
      .int()
      .positive()
      .max(500)
      .optional()
      .describe('Maximum number of files to return when search is used (default 50).'),
    include_snippets: z
      .coerce.boolean()
      .optional()
      .describe('Include body snippets for matching files (default false).'),
    context: z
      .enum(['summary', 'detailed'])
      .optional()
      .describe('Amount of context to return when exploring (summary or detailed).'),
    mode: z
      .enum(['summary', 'explore', 'detailed', 'stats', 'full'])
      .optional()
      .describe('Summary (default) returns lightweight stats, explore shows tree, detailed dumps full metadata.'),
    exclude: z
      .union([
        z.string(),
        z.array(z.string()).min(1).max(20),
      ])
      .optional()
      .describe('Relative paths or folder names to exclude (e.g., "archive", "knowledge/tmp").'),
    time_format: z
      .enum(['absolute', 'relative', 'both'])
      .optional()
      .describe('Timestamp format: ISO (absolute), relative phrases, or both.'),
  })
  .strip();

interface BaseNode {
  type: 'directory' | 'file';
  name: string;
  path: string;
  lastModified: string;
}

interface FileMetadata {
  title?: string;
  tags?: string[];
  topics?: string[];
  keyConcepts?: string[];
  kotaVersion?: string;
  crossReferences?: string[];
  related?: string[];
  created?: string;
  updated?: string;
}

interface FileNode extends BaseNode {
  type: 'file';
  size: number;
  extension: string;
  metadata: FileMetadata;
  snippet?: string;
  matchReasons?: string[];
}

interface DirectorySummary {
  directories: number;
  files: number;
  topics: string[];
  latestModified?: string;
  fileTypes?: Record<string, number>;
}

interface DirectoryNode extends BaseNode {
  type: 'directory';
  children: WorkspaceNode[];
  summary: DirectorySummary;
  truncated?: boolean;
  truncatedChildren?: {
    directories: number;
    files: number;
  };
  truncatedNote?: string;
  matchReasons?: string[];
}

type WorkspaceNode = DirectoryNode | FileNode;

interface BuildResult {
  node: DirectoryNode;
  files: FileNode[];
  directories: number;
  filesCount: number;
}

interface WorkspaceMap {
  generatedAt: string;
  baseDir: string;
  scope: string;
  stats: {
    directories: number;
    files: number;
    matches: number | null;
  };
  parameters: {
    search?: string;
    limit?: number;
    maxDepth: number;
    includeSnippets: boolean;
    context: ContextLevel;
    mode: WorkspaceMode;
    timeFormat: TimeFormat;
    exclude?: string[];
  };
  tree: DirectoryNode;
  matches?: FileNode[];
}

type ContextLevel = 'summary' | 'detailed';
type WorkspaceMode = 'summary' | 'explore' | 'detailed';
type TimeFormat = 'absolute' | 'relative' | 'both';

export class WorkspaceHandler extends BaseHandler {
  readonly prefix = 'workspace';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'map',
        description: 'Generate a structured map of the DATA_DIR with metadata, tags, and cross-references.',
        inputSchema: MapSchema.shape,
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    switch (action) {
      case 'map':
        return this.workspaceMap(args);
      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
    }
  }

  private async workspaceMap(args: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(MapSchema, args);
    const baseConfig = this.config.DATA_DIR || 'data';
    const baseDir = path.isAbsolute(baseConfig) ? baseConfig : path.resolve(process.cwd(), baseConfig);
    const scopeInput = (parsed.path ?? '.').trim().replace(/^[\\/]+/, '');
    const scopePath = path.resolve(baseDir, scopeInput);

    if (!scopePath.startsWith(baseDir)) {
      return this.errorResult(`Path ${scopeInput || '.'} is outside of DATA_DIR`);
    }

    let stat;
    try {
      stat = await fs.stat(scopePath);
    } catch (err: any) {
      return this.errorResult(`Unable to read path ${scopeInput || '.'}: ${err?.message || String(err)}`);
    }

    if (!stat.isDirectory()) {
      return this.errorResult('Workspace map can only target directories.');
    }

    const maxDepth = parsed.max_depth ?? 4;
    const limit = parsed.limit ?? 50;
    const includeSnippets = parsed.include_snippets ?? false;
    const rawSearch = parsed.search?.trim() || '';
    const mode = normalizeMode(parsed.mode);
    const effectiveMode: WorkspaceMode | 'search' = rawSearch && mode === 'summary' ? 'search' : mode;
    const contextLevel = (parsed.context ?? (mode === 'detailed' ? 'detailed' : 'summary')) as ContextLevel;
    const exclude = normalizeExclude(parsed.exclude);
    const timeFormat = (parsed.time_format ?? 'absolute') as TimeFormat;

    if (effectiveMode === 'summary' && rawSearch) {
      // handled by 'search' effective mode
    }

    if (effectiveMode === 'search' && !rawSearch) {
      return this.errorResult('Search mode requires a search query.');
    }

    if (effectiveMode === 'summary' && includeSnippets) {
      this.logger.debug('Ignoring include_snippets in summary mode');
    }

    // Detailed view allows snippets when requested.
    const allowSnippets = includeSnippets && contextLevel === 'detailed' && effectiveMode === 'detailed';

    const builder = new WorkspaceBuilder({
      baseDir,
      logger: this.logger,
      maxDepth,
      includeSnippets: allowSnippets,
      includeFiles: effectiveMode !== 'summary',
      exclude,
    });
    const result = await builder.build(scopePath);

    const baseAlias = path.relative(process.cwd(), baseDir).split(path.sep).join('/') || baseDir;
    const scopeAlias = path.relative(baseDir, scopePath).split(path.sep).join('/') || '.';

    const generatedAt = new Date().toISOString();

    if (effectiveMode === 'summary') {
      const digest = buildSummaryDigest({
        tree: result.node,
        totalDirectories: result.directories,
        totalFiles: result.filesCount,
        scope: scopeAlias,
        baseDir: baseAlias,
        timeFormat,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ generatedAt, ...digest }, null, 2) }] };
    }

    let tree = result.node;
    let matches: FileNode[] | undefined;

    if (rawSearch) {
      matches = builder.applySearch(result.files, tree, rawSearch, limit);
      if (!matches.length) {
        return { content: [{ type: 'text', text: 'Empty results (workspace search)' }] };
      }
      if (effectiveMode === 'search') {
        const digest = buildSearchDigest({
          matches,
          search: rawSearch,
          scope: scopeAlias,
          baseDir: baseAlias,
          timeFormat,
          limit,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ generatedAt, ...digest }, null, 2) }] };
      }
      tree = builder.pruneTree(tree, new Set(matches.map((m) => m.path)), rawSearch);
    }

    dedupeTopics(tree, new Set());

    const contextForMode = effectiveMode === 'detailed' ? 'detailed' : contextLevel;
    if (contextForMode === 'summary') {
      trimToSummary(tree);
    }

    applyTimeFormat(tree, timeFormat);

    if (matches) {
      for (const match of matches) {
        match.lastModified = formatTimestampValue(match.lastModified, timeFormat);
      }
    }

    const map: WorkspaceMap = {
      generatedAt,
      baseDir: baseAlias,
      scope: scopeAlias,
      stats: {
        directories: result.directories,
        files: result.filesCount,
        matches: rawSearch ? (matches ? matches.length : 0) : null,
      },
      parameters: {
        search: rawSearch || undefined,
        limit: rawSearch ? limit : undefined,
        maxDepth,
        includeSnippets: allowSnippets,
        context: contextForMode,
        mode,
        timeFormat,
        exclude: exclude.length ? exclude : undefined,
      },
      tree,
      matches,
    };

    return { content: [{ type: 'text', text: JSON.stringify(map, null, 2) }] };
  }

  private errorResult(message: string): CallToolResult {
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

class WorkspaceBuilder {
  private readonly baseDir: string;
  private readonly logger: Logger;
  private readonly maxDepth: number;
  private readonly includeSnippets: boolean;
  private readonly includeFiles: boolean;
  private readonly exclude: string[];

  constructor(opts: {
    baseDir: string;
    logger: Logger;
    maxDepth: number;
    includeSnippets: boolean;
    includeFiles: boolean;
    exclude: string[];
  }) {
    this.baseDir = opts.baseDir;
    this.logger = opts.logger;
    this.maxDepth = opts.maxDepth;
    this.includeSnippets = opts.includeSnippets;
    this.includeFiles = opts.includeFiles;
    this.exclude = opts.exclude;
  }

  async build(scopeDir: string): Promise<BuildResult> {
    return this.walkDirectory(scopeDir, 0);
  }

  applySearch(files: FileNode[], root: DirectoryNode, rawQuery: string, limit: number): FileNode[] {
    const query = rawQuery.toLowerCase();
    const matches: FileNode[] = [];

    for (const file of files) {
      const reasons = this.collectMatchReasons(file, query);
      if (reasons.length) {
        file.matchReasons = reasons;
        matches.push(file);
      }
    }

    matches.sort((a, b) => (b.lastModified < a.lastModified ? -1 : b.lastModified > a.lastModified ? 1 : 0));
    if (matches.length > limit) {
      return matches.slice(0, limit);
    }
    return matches;
  }

  pruneTree(node: DirectoryNode, matchedPaths: Set<string>, search: string): DirectoryNode {
    const query = search.toLowerCase();
    const prunedChildren: WorkspaceNode[] = [];

    for (const child of node.children) {
      if (child.type === 'file') {
        if (matchedPaths.has(child.path)) {
          prunedChildren.push(child);
        }
      } else {
        const pruned = this.pruneTree(child, matchedPaths, search);
        if (pruned.children.length || (pruned.matchReasons && pruned.matchReasons.length)) {
          prunedChildren.push(pruned);
        }
      }
    }

    const dirMatchReasons = this.collectDirectoryMatchReasons(node, query);
    const cloned: DirectoryNode = {
      ...node,
      children: prunedChildren,
      matchReasons: dirMatchReasons.length ? dirMatchReasons : undefined,
    };
    return cloned;
  }

  private async walkDirectory(currentDir: string, depth: number): Promise<BuildResult> {
    const relPath = this.relativePath(currentDir) || '.';
    const stat = await fs.stat(currentDir);
    const node: DirectoryNode = {
      type: 'directory',
      name: path.basename(currentDir) || path.basename(this.baseDir),
      path: relPath,
      lastModified: stat.mtime.toISOString(),
      children: [],
      summary: {
        directories: 0,
        files: 0,
        topics: [],
        latestModified: stat.mtime.toISOString(),
      },
    };

    if (depth >= this.maxDepth) {
      node.truncated = true;
      const entries = await this.safeReadDir(currentDir);
      let hiddenDirs = 0;
      let hiddenFiles = 0;
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (this.shouldExclude(fullPath)) continue;
        if (entry.isDirectory()) hiddenDirs += 1;
        else if (entry.isFile()) hiddenFiles += 1;
      }
      node.summary.directories = hiddenDirs;
      node.summary.files = hiddenFiles;
      node.summary.topics = [];
      node.summary.latestModified = stat.mtime.toISOString();
      node.truncatedChildren = { directories: hiddenDirs, files: hiddenFiles };
      const parts: string[] = [];
      if (hiddenDirs) parts.push(`${hiddenDirs} more ${hiddenDirs === 1 ? 'directory' : 'directories'}`);
      if (hiddenFiles) parts.push(`${hiddenFiles} more ${hiddenFiles === 1 ? 'file' : 'files'}`);
      if (parts.length) node.truncatedNote = `Truncated view: ${parts.join(' & ')}`;
      return { node, files: [], directories: 1 + hiddenDirs, filesCount: hiddenFiles };
    }

    let totalDirectories = 1; // include current
    let totalFiles = 0;
    const collectedFiles: FileNode[] = [];
    const entries = await this.safeReadDir(currentDir);
    const typeCounts = new Map<string, number>();

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (this.shouldExclude(fullPath)) continue;
      if (entry.isDirectory()) {
        const child = await this.walkDirectory(fullPath, depth + 1);
        totalDirectories += child.directories;
        totalFiles += child.filesCount;
        node.children.push(child.node);
        collectedFiles.push(...child.files);
        if (child.node.summary.fileTypes) {
          for (const [ext, count] of Object.entries(child.node.summary.fileTypes)) {
            typeCounts.set(ext, (typeCounts.get(ext) ?? 0) + count);
          }
        }
      } else if (entry.isFile()) {
        totalFiles += 1;
        const extRaw = path.extname(entry.name).toLowerCase();
        const ext = extRaw || '[no-ext]';
        typeCounts.set(ext, (typeCounts.get(ext) ?? 0) + 1);
        if (!this.includeFiles) continue;
        const fileNode = await this.buildFileNode(fullPath);
        if (fileNode) {
          node.children.push(fileNode);
          collectedFiles.push(fileNode);
        }
      }
    }

    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    node.summary.directories = totalDirectories - 1;
    node.summary.files = totalFiles;
    node.summary.topics = this.aggregateTopics(node.children);
    node.summary.latestModified = this.computeLatestModified(node.children, node.lastModified);
    const distribution = buildFileTypeSummary(typeCounts);
    if (distribution) node.summary.fileTypes = distribution;

    return { node, files: collectedFiles, directories: totalDirectories, filesCount: totalFiles };
  }

  private async safeReadDir(dir: string): Promise<Dirent[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules');
    } catch (err: any) {
      this.logger.warn({ err, dir }, 'Unable to read directory');
      return [];
    }
  }

  private shouldExclude(fullPath: string): boolean {
    if (!this.exclude.length) return false;
    const rel = this.relativePath(fullPath).toLowerCase();
    if (!rel || rel === '.') return false;
    const normalized = rel.replace(/^\.\/?/, '');
    const segments = normalized.split('/').filter(Boolean);
    for (const pattern of this.exclude) {
      if (!pattern) continue;
      if (pattern.includes('/')) {
        if (normalized === pattern || normalized.startsWith(`${pattern}/`)) return true;
      } else {
        if (segments.includes(pattern)) return true;
      }
    }
    return false;
  }

  private async buildFileNode(filePath: string): Promise<FileNode | null> {
    const relPath = this.relativePath(filePath);
    if (!relPath) return null;

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (err: any) {
      this.logger.warn({ err, filePath }, 'Unable to stat file');
      return null;
    }

    const extension = path.extname(filePath).toLowerCase();
    const metadata: FileMetadata = {};
    let snippet: string | undefined;

    if (this.isTextExtension(extension)) {
      const tags = new Set<string>();
      const topics = new Set<string>();
      const keyConcepts = new Set<string>();
      const related = new Set<string>();
      const crossReferences = new Set<string>();
      const ensureArray = (value: unknown): string[] => {
        if (!value) return [];
        if (Array.isArray(value)) return value.map((item) => String(item));
        return String(value)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      };

      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const { frontMatter, body } = this.extractFrontMatter(raw);
        if (frontMatter) {
          if (frontMatter.title) metadata.title = String(frontMatter.title);
          for (const tag of ensureArray(frontMatter.tags)) tags.add(tag);
          for (const topic of ensureArray(frontMatter.topics)) topics.add(topic);
          const keyConceptArr = [
            ...ensureArray(frontMatter.key_concepts),
            ...ensureArray(frontMatter.keyConcepts),
          ];
          for (const concept of keyConceptArr) keyConcepts.add(concept);
          for (const rel of ensureArray(frontMatter.related)) related.add(rel);
          for (const ref of ensureArray(frontMatter.crossReferences)) crossReferences.add(ref);
          if (frontMatter.created) metadata.created = String(frontMatter.created);
          if (frontMatter.updated) metadata.updated = String(frontMatter.updated);
          const versionCandidates = [
            frontMatter.kota_version,
            frontMatter.kotaVersion,
            frontMatter.kota,
            frontMatter.created_by,
            frontMatter.createdBy,
            frontMatter.version,
          ];
          for (const candidate of versionCandidates) {
            if (!candidate) continue;
            const value = String(candidate);
            if (/kota/i.test(value) || candidate === frontMatter.kota_version || candidate === frontMatter.kotaVersion) {
              metadata.kotaVersion = value;
              break;
            }
          }
        }

        for (const ref of this.collectCrossReferences(body, Array.from(related))) {
          crossReferences.add(ref);
        }
        if (this.includeSnippets) {
          snippet = this.createSnippet(body);
        }
        if (!metadata.title) {
          metadata.title = this.deriveTitle(body);
        }

        const combinedTopics = new Set<string>([
          ...tags,
          ...topics,
          ...keyConcepts,
        ]);
        if (combinedTopics.size) metadata.topics = Array.from(combinedTopics);
        if (tags.size) metadata.tags = Array.from(tags);
        if (keyConcepts.size) metadata.keyConcepts = Array.from(keyConcepts);
        if (related.size) metadata.related = Array.from(related);
        if (crossReferences.size) metadata.crossReferences = Array.from(crossReferences);
      } catch (err: any) {
        this.logger.warn({ err, filePath }, 'Unable to read file for metadata');
      }
    }

    const compacted = compactMetadata(metadata);

    const node: FileNode = {
      type: 'file',
      name: path.basename(filePath),
      path: relPath,
      lastModified: stat.mtime.toISOString(),
      size: stat.size,
      extension,
      metadata: compacted,
      snippet,
    };
    return node;
  }

  private extractFrontMatter(content: string): { frontMatter: any; body: string } {
    const match = content.match(/^---\s*[\r\n]+([\s\S]*?)\n---\s*[\r\n]*/);
    if (!match) {
      return { frontMatter: null, body: content };
    }
    const front = match[1];
    const body = content.slice(match[0].length);
    try {
      const parsed = parseYAML(front) ?? {};
      return { frontMatter: parsed, body };
    } catch (err: any) {
      this.logger.warn({ err }, 'Failed to parse front matter');
      return { frontMatter: {}, body };
    }
  }

  private collectCrossReferences(body: string, related: string[] = []): string[] {
    const refs = new Set<string>(related);
    const markdownLinks = body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
    for (const match of markdownLinks) {
      const target = match[1]?.trim();
      if (target && !target.startsWith('http')) refs.add(target);
    }
    const wikiLinks = body.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const match of wikiLinks) {
      const target = match[1]?.trim();
      if (target) refs.add(target);
    }
    return Array.from(refs);
  }

  private deriveTitle(body: string): string | undefined {
    const match = body.match(/^#\s+(.+)/m);
    if (match) return match[1].trim();
    return undefined;
  }

  private createSnippet(body: string): string {
    const cleaned = body.replace(/\s+/g, ' ').trim();
    return cleaned.length > 240 ? `${cleaned.slice(0, 237)}...` : cleaned;
  }

  private isTextExtension(ext: string): boolean {
    return ['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.html', '.csv', '.tsv', '.js', '.ts', '.mjs', '.cjs'].includes(ext);
  }

  private aggregateTopics(children: WorkspaceNode[]): string[] {
    const counts = new Map<string, number>();
    for (const child of children) {
      if (child.type === 'file') {
        const topics = child.metadata.topics ?? [];
        for (const topic of topics) counts.set(topic, (counts.get(topic) ?? 0) + 1);
      } else {
        for (const topic of child.summary.topics) counts.set(topic, (counts.get(topic) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic]) => topic);
  }

  private computeLatestModified(children: WorkspaceNode[], fallback: string): string {
    let latest = fallback;
    for (const child of children) {
      if (child.lastModified > latest) latest = child.lastModified;
      if (child.type === 'directory' && child.summary.latestModified && child.summary.latestModified > latest) {
        latest = child.summary.latestModified;
      }
    }
    return latest;
  }

  private collectMatchReasons(file: FileNode, query: string): string[] {
    const reasons: string[] = [];
    if (file.name.toLowerCase().includes(query)) reasons.push('name');
    if (file.metadata.title && file.metadata.title.toLowerCase().includes(query)) reasons.push('title');
    if (file.metadata.kotaVersion && file.metadata.kotaVersion.toLowerCase().includes(query)) {
      reasons.push(`kota-version:${file.metadata.kotaVersion}`);
    }
    for (const tag of file.metadata.tags ?? []) {
      if (tag.toLowerCase().includes(query)) reasons.push(`tag:${tag}`);
    }
    for (const topic of file.metadata.topics ?? []) {
      if (topic.toLowerCase().includes(query)) reasons.push(`topic:${topic}`);
    }
    for (const concept of file.metadata.keyConcepts ?? []) {
      if (concept.toLowerCase().includes(query)) reasons.push(`concept:${concept}`);
    }
    for (const ref of file.metadata.crossReferences ?? []) {
      if (ref.toLowerCase().includes(query)) reasons.push(`reference:${ref}`);
    }
    if (file.snippet && file.snippet.toLowerCase().includes(query)) reasons.push('snippet');
    if (file.path.toLowerCase().includes(query)) reasons.push('path');
    return Array.from(new Set(reasons));
  }

  private collectDirectoryMatchReasons(node: DirectoryNode, query: string): string[] {
    const reasons: string[] = [];
    if (node.name.toLowerCase().includes(query)) reasons.push('name');
    for (const topic of node.summary.topics) {
      if (topic.toLowerCase().includes(query)) reasons.push(`topic:${topic}`);
    }
    return Array.from(new Set(reasons));
  }

  private relativePath(target: string): string {
    const rel = path.relative(this.baseDir, target);
    return rel.split(path.sep).join('/');
  }
}

function compactMetadata(meta: FileMetadata): FileMetadata {
  const dedupe = (arr?: string[]) => (arr && arr.length ? Array.from(new Set(arr)) : undefined);
  const compact: FileMetadata = {};
  if (meta.title) compact.title = meta.title;
  const tags = dedupe(meta.tags);
  if (tags) compact.tags = tags;
  const topics = dedupe(meta.topics);
  if (topics) compact.topics = topics;
  const concepts = dedupe(meta.keyConcepts);
  if (concepts) compact.keyConcepts = concepts;
  if (meta.kotaVersion) compact.kotaVersion = meta.kotaVersion;
  const crossRefs = dedupe(meta.crossReferences);
  if (crossRefs) compact.crossReferences = crossRefs;
  const related = dedupe(meta.related);
  if (related) compact.related = related;
  if (meta.created) compact.created = meta.created;
  if (meta.updated) compact.updated = meta.updated;
  return compact;
}

function buildFileTypeSummary(typeCounts: Map<string, number>): Record<string, number> | undefined {
  if (!typeCounts.size) return undefined;
  const sorted = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 8);
  const remainder = sorted.slice(8).reduce((acc, [, count]) => acc + count, 0);
  const distribution: Record<string, number> = {};
  for (const [ext, count] of top) distribution[ext] = count;
  if (remainder) distribution.other = remainder;
  return distribution;
}

interface SummaryDigestOptions {
  tree: DirectoryNode;
  totalDirectories: number;
  totalFiles: number;
  scope: string;
  baseDir: string;
  timeFormat: TimeFormat;
}

interface SummaryDigest {
  scope: string;
  totals: { directories: number; files: number };
  topAreas: Array<{ path: string; files: number; directories: number }>;
  topTopics: string[];
  recentActivity: Array<{ path: string; when: string }>;
  suggestions: string[];
}

function buildSummaryDigest(opts: SummaryDigestOptions): SummaryDigest {
  const directories = Math.max(0, opts.totalDirectories - 1);
  const topAreas = collectTopAreas(opts.tree, 5);
  const recent = collectRecentActivity(opts.tree, 5, opts.timeFormat);
  const primaryPathRaw = topAreas[0]?.path;
  const primaryPath = primaryPathRaw && primaryPathRaw !== '' ? primaryPathRaw : opts.scope;
  const searchHint = (opts.tree.summary.topics || [])[0] || 'keyword';
  const suggestions = [
    `workspace_map { "mode": "explore", "path": "${primaryPath}" }`,
    `workspace_map { "mode": "detailed", "path": "${primaryPath}", "max_depth": 3 }`,
    `workspace_map { "search": "${searchHint}" }`,
  ];

  return {
    scope: opts.scope,
    totals: {
      directories,
      files: opts.totalFiles,
    },
    topAreas: topAreas.map((area) => ({
      path: area.path || '.',
      files: area.files,
      directories: area.directories,
    })),
    topTopics: (opts.tree.summary.topics || []).slice(0, 5),
    recentActivity: recent,
    suggestions,
  };
}

function collectTopAreas(node: DirectoryNode, limit: number) {
  const areas: Array<{ path: string; files: number; directories: number; lastModified: string }> = [];
  for (const child of node.children) {
    if (child.type !== 'directory') continue;
    if (!child.summary.files && !child.summary.directories) continue;
    areas.push({
      path: child.path,
      files: child.summary.files,
      directories: child.summary.directories,
      lastModified: child.lastModified,
    });
  }
  areas.sort((a, b) => b.files - a.files || b.directories - a.directories);
  return areas.slice(0, limit);
}

function collectRecentActivity(
  node: DirectoryNode,
  limit: number,
  timeFormat: TimeFormat,
): Array<{ path: string; when: string }> {
  const entries: Array<{ path: string; lastModified: string }> = [];
  const stack: DirectoryNode[] = [...node.children.filter((child): child is DirectoryNode => child.type === 'directory')];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.summary.files || current.summary.directories) {
      entries.push({ path: current.path, lastModified: current.lastModified });
    }
    for (const child of current.children) {
      if (child.type === 'directory') stack.push(child);
    }
  }
  entries.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
  return entries.slice(0, limit).map((entry) => ({
    path: entry.path || '.',
    when: formatTimestampValue(entry.lastModified, timeFormat),
  }));
}

interface SearchDigestOptions {
  matches: FileNode[];
  search: string;
  scope: string;
  baseDir: string;
  timeFormat: TimeFormat;
  limit: number;
}

function buildSearchDigest(opts: SearchDigestOptions) {
  const results = opts.matches.map((match) => ({
    path: match.path,
    title: match.metadata.title,
    type: match.extension || 'file',
    lastModified: formatTimestampValue(match.lastModified, opts.timeFormat),
    reasons: match.matchReasons,
  }));
  const uniqueDirectories = Array.from(
    new Set(results.map((item) => item.path.split('/').slice(0, -1).join('/')).filter(Boolean)),
  ).slice(0, 5);

  return {
    scope: opts.scope,
    search: opts.search,
    count: opts.matches.length,
    results,
    directories: uniqueDirectories,
    truncated: opts.matches.length === opts.limit,
    suggestions: [
      `workspace_map { "mode": "explore", "path": "${uniqueDirectories[0] || opts.scope}" }`,
      `workspace_map { "mode": "detailed", "path": "${uniqueDirectories[0] || opts.scope}" }`,
    ],
  };
}

function trimToSummary(node: WorkspaceNode) {
  if (node.type === 'file') {
    node.snippet = undefined;
    if (node.matchReasons) node.matchReasons = node.matchReasons.slice(0, 3);
    const meta = node.metadata;
    if (meta.tags && meta.tags.length) meta.tags = meta.tags.slice(0, 5);
    if (meta.topics && meta.topics.length) meta.topics = meta.topics.slice(0, 5);
    if (meta.keyConcepts && meta.keyConcepts.length) meta.keyConcepts = meta.keyConcepts.slice(0, 5);
    if (meta.crossReferences && meta.crossReferences.length) meta.crossReferences = meta.crossReferences.slice(0, 5);
    if (meta.related && meta.related.length) meta.related = meta.related.slice(0, 5);
    if (meta.tags && !meta.tags.length) delete meta.tags;
    if (meta.topics && !meta.topics.length) delete meta.topics;
    if (meta.keyConcepts && !meta.keyConcepts.length) delete meta.keyConcepts;
    if (meta.crossReferences && !meta.crossReferences.length) delete meta.crossReferences;
    if (meta.related && !meta.related.length) delete meta.related;
  } else {
    if (node.matchReasons) node.matchReasons = node.matchReasons.slice(0, 3);
    node.summary.topics = node.summary.topics.slice(0, 5);
    if (node.summary.fileTypes) {
      const entries = Object.entries(node.summary.fileTypes);
      if (entries.length > 5) {
        const kept = entries.slice(0, 5);
        const remainder = entries.slice(5).reduce((acc, [, count]) => acc + count, 0);
        const reduced: Record<string, number> = {};
        for (const [ext, count] of kept) reduced[ext] = count;
        if (remainder) reduced.other = remainder;
        node.summary.fileTypes = reduced;
      }
    }
    for (const child of node.children) {
      trimToSummary(child);
    }
  }
}

function dedupeTopics(node: WorkspaceNode, ancestorTopics: Set<string>) {
  if (node.type === 'file') {
    if (node.metadata.topics && node.metadata.topics.length) {
      node.metadata.topics = node.metadata.topics.filter((topic) => !ancestorTopics.has(topic));
      if (!node.metadata.topics.length) delete node.metadata.topics;
    }
    return;
  }

  node.summary.topics = node.summary.topics.filter((topic) => !ancestorTopics.has(topic));
  const nextAncestors = new Set([...ancestorTopics, ...node.summary.topics]);

  for (const child of node.children) {
    dedupeTopics(child, nextAncestors);
  }
}

function normalizeExclude(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  const normalized = arr
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^\/+|\/+$/g, '').toLowerCase());
  return Array.from(new Set(normalized));
}

function normalizeMode(raw?: string): WorkspaceMode {
  const value = (raw ?? 'summary').toLowerCase();
  if (value === 'detailed') return 'detailed';
  if (value === 'explore' || value === 'full') return 'explore';
  if (value === 'summary' || value === 'stats') return 'summary';
  return 'summary';
}

function applyTimeFormat(node: WorkspaceNode, format: TimeFormat) {
  node.lastModified = formatTimestampValue(node.lastModified, format);
  if (node.type === 'directory') {
    if (node.summary.latestModified) {
      node.summary.latestModified = formatTimestampValue(node.summary.latestModified, format);
    }
    for (const child of node.children) {
      applyTimeFormat(child, format);
    }
  }
}

function formatTimestampValue(value: string, format: TimeFormat): string {
  if (format === 'absolute') return value;
  const relative = formatRelativeFromNow(new Date(value));
  if (format === 'relative') return relative;
  return `${value} (${relative})`;
}

function formatRelativeFromNow(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const future = diffMs < 0;
  const absMs = Math.abs(diffMs);

  const units: [number, string][] = [
    [1000, 'second'],
    [60 * 1000, 'minute'],
    [60 * 60 * 1000, 'hour'],
    [24 * 60 * 60 * 1000, 'day'],
    [7 * 24 * 60 * 60 * 1000, 'week'],
    [30 * 24 * 60 * 60 * 1000, 'month'],
    [365 * 24 * 60 * 60 * 1000, 'year'],
  ];

  const format = (value: number, unit: string) => {
    const plural = value === 1 ? unit : `${unit}s`;
    return future ? `in ${value} ${plural}` : `${value} ${plural} ago`;
  };

  if (absMs < 5 * 1000) return future ? 'in moments' : 'just now';
  if (absMs < 60 * 1000) return format(Math.round(absMs / 1000), 'second');
  if (absMs < 60 * 60 * 1000) return format(Math.round(absMs / (60 * 1000)), 'minute');
  if (absMs < 24 * 60 * 60 * 1000) return format(Math.round(absMs / (60 * 60 * 1000)), 'hour');
  if (absMs < 7 * 24 * 60 * 60 * 1000) return format(Math.round(absMs / (24 * 60 * 60 * 1000)), 'day');
  if (absMs < 30 * 24 * 60 * 60 * 1000) return format(Math.round(absMs / (7 * 24 * 60 * 60 * 1000)), 'week');
  if (absMs < 365 * 24 * 60 * 60 * 1000) return format(Math.round(absMs / (30 * 24 * 60 * 60 * 1000)), 'month');
  return format(Math.round(absMs / (365 * 24 * 60 * 60 * 1000)), 'year');
}
