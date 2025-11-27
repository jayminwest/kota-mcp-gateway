import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import type { Logger } from './logger.js';
import type { HandlerConfig } from '../types/index.js';

export interface ScopeConfig {
  scope: {
    name: string;
    description: string;
    last_modified: string;
    modified_by: string;
  };
  overview?: string;
  data_sources?: Record<string, any>;
  exposed_tools?: string[];
}

export interface ScopeMetadata {
  name: string;
  description: string;
  last_modified: string;
  modified_by: string;
  data_sources: string[];
  tools: number;
  file_path: string;
}

export interface LoadedScope {
  name: string;
  loaded_at: string;
  last_modified: string;
  modified_by: string;
  context: Record<string, any>;
  exposed_tools: string[];
  file_path: string;
}

export interface RefreshResult {
  status: 'success' | 'error';
  scope: string;
  refreshed_at: string;
  changes_detected?: Record<string, string>;
  error?: string;
}

export type DataFetcher = (toolName: string, args: any) => Promise<any>;

export class ScopeManager {
  private logger: Logger;
  private config: HandlerConfig;
  private scopesDir: string;
  private cache: Map<string, { scope: LoadedScope; timestamp: number }>;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes
  private fetchData?: DataFetcher;

  constructor(opts: { logger: Logger; config: HandlerConfig; fetchData?: DataFetcher }) {
    this.logger = opts.logger;
    this.config = opts.config;
    this.scopesDir = path.join(os.homedir(), 'kota_md', 'scopes');
    this.cache = new Map();
    this.fetchData = opts.fetchData;
  }

  /**
   * Resolve the file path for a scope name
   */
  resolveScopePath(name: string): string {
    const fileName = `${name.toLowerCase()}.scope.yaml`;
    return path.join(this.scopesDir, fileName);
  }

  /**
   * List all available scopes
   */
  async listScopes(): Promise<ScopeMetadata[]> {
    try {
      // Ensure directory exists
      await fs.mkdir(this.scopesDir, { recursive: true });

      const files = await fs.readdir(this.scopesDir);
      const scopeFiles = files.filter(f => f.endsWith('.scope.yaml'));

      const scopes: ScopeMetadata[] = [];
      for (const file of scopeFiles) {
        const filePath = path.join(this.scopesDir, file);
        try {
          const config = await this.loadScopeConfig(file.replace('.scope.yaml', '').toUpperCase());
          if (config) {
            const dataSources = this.extractDataSourceKeys(config.data_sources);
            scopes.push({
              name: config.scope.name,
              description: config.scope.description,
              last_modified: config.scope.last_modified,
              modified_by: config.scope.modified_by,
              data_sources: dataSources,
              tools: config.exposed_tools?.length ?? 0,
              file_path: filePath,
            });
          }
        } catch (error) {
          this.logger.warn({ error, file }, `Failed to load scope ${file}`);
        }
      }

      return scopes;
    } catch (error) {
      this.logger.error({ error }, 'Failed to list scopes');
      return [];
    }
  }

  /**
   * Load a scope configuration from YAML
   */
  async loadScopeConfig(name: string): Promise<ScopeConfig | null> {
    const filePath = this.resolveScopePath(name);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const config = yaml.load(content) as ScopeConfig;

      // Validate required fields
      if (!config.scope?.name || !config.scope?.description || !config.scope?.last_modified || !config.scope?.modified_by) {
        this.logger.error(`Invalid scope config for ${name}: missing required fields`);
        return null;
      }

      return config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.debug(`Scope file not found: ${filePath}`);
        return null;
      }
      this.logger.error({ error, name }, `Failed to load scope ${name}`);
      return null;
    }
  }

  /**
   * Save a scope configuration to YAML
   */
  async saveScopeConfig(name: string, config: ScopeConfig): Promise<void> {
    const filePath = this.resolveScopePath(name);
    const tmpPath = `${filePath}.tmp`;

    try {
      // Ensure directory exists
      await fs.mkdir(this.scopesDir, { recursive: true });

      // Write to temporary file
      const yamlContent = yaml.dump(config, { indent: 2, lineWidth: -1 });
      await fs.writeFile(tmpPath, yamlContent, 'utf-8');

      // Atomic rename
      await fs.rename(tmpPath, filePath);

      // Clear cache for this scope
      this.cache.delete(name);

      this.logger.info(`Saved scope config: ${name}`);
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(tmpPath);
      } catch {}

      this.logger.error({ error, name }, `Failed to save scope ${name}`);
      throw error;
    }
  }

  /**
   * Load a scope with context
   */
  async loadScope(name: string): Promise<LoadedScope | null> {
    // Check cache
    const cached = this.cache.get(name);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      this.logger.debug(`Returning cached scope: ${name}`);
      return cached.scope;
    }

    const config = await this.loadScopeConfig(name);
    if (!config) {
      return null;
    }

    // Execute data fetchers if available
    let context: Record<string, any>;
    if (this.fetchData && config.data_sources) {
      try {
        context = await this.executeFetchers(config.data_sources);
        context.overview = config.overview || '';
      } catch (error) {
        this.logger.error({ error, name }, 'Failed to execute data fetchers');
        // Fall back to static config on error
        context = {
          overview: config.overview || '',
          data_sources_config: config.data_sources,
          error: 'Failed to execute data fetchers',
        };
      }
    } else {
      // No fetch function or no data sources: return static config
      context = {
        overview: config.overview || '',
        data_sources_config: config.data_sources || {},
      };
    }

    const loaded: LoadedScope = {
      name: config.scope.name,
      loaded_at: new Date().toISOString(),
      last_modified: config.scope.last_modified,
      modified_by: config.scope.modified_by,
      context,
      exposed_tools: config.exposed_tools || [],
      file_path: this.resolveScopePath(name),
    };

    // Cache the result
    this.cache.set(name, { scope: loaded, timestamp: Date.now() });

    return loaded;
  }

  /**
   * Refresh a scope (clear cache and reload)
   */
  async refreshScope(name: string): Promise<RefreshResult> {
    try {
      // Clear cache
      this.cache.delete(name);

      // Reload scope
      const scope = await this.loadScope(name);
      if (!scope) {
        return {
          status: 'error',
          scope: name,
          refreshed_at: new Date().toISOString(),
          error: `Scope '${name}' not found`,
        };
      }

      return {
        status: 'success',
        scope: name,
        refreshed_at: new Date().toISOString(),
        changes_detected: {
          note: 'MVP: Data fetchers not yet implemented. Cache cleared.',
        },
      };
    } catch (error) {
      this.logger.error({ error, name }, `Failed to refresh scope ${name}`);
      return {
        status: 'error',
        scope: name,
        refreshed_at: new Date().toISOString(),
        error: String(error),
      };
    }
  }

  /**
   * Execute data fetchers and build context
   */
  async executeFetchers(dataSourcesConfig: Record<string, any>): Promise<Record<string, any>> {
    if (!this.fetchData) {
      this.logger.warn('No fetch function available, returning empty context');
      return {};
    }

    const context: Record<string, any> = {};

    // Process each data source category
    for (const [category, config] of Object.entries(dataSourcesConfig)) {
      try {
        context[category] = await this.executeCategoryFetchers(category, config);
      } catch (error) {
        this.logger.error({ error, category }, `Failed to execute fetchers for category ${category}`);
        context[category] = {
          error: `Failed to fetch ${category}: ${String(error)}`,
        };
      }
    }

    return context;
  }

  /**
   * Execute fetchers for a specific category
   */
  private async executeCategoryFetchers(category: string, config: any): Promise<any> {
    if (!this.fetchData) {
      return {};
    }

    // Handle array of fetchers
    if (Array.isArray(config)) {
      const results: Record<string, any> = {};
      for (const item of config) {
        if (item.key && item.fetch) {
          try {
            results[item.key] = await this.fetchData(item.fetch, item.params || {});
          } catch (error) {
            this.logger.warn({ error, key: item.key, fetch: item.fetch }, 'Fetch failed');
            results[item.key] = { error: String(error) };
          }
        } else if (typeof item === 'object' && item.path) {
          // Handle file references (read file content)
          try {
            const filePath = item.path.startsWith('~/')
              ? path.join(os.homedir(), item.path.slice(2))
              : item.path;
            const content = await fs.readFile(filePath, 'utf-8');
            const excerpt = item.excerpt_length
              ? content.slice(0, item.excerpt_length)
              : content;
            results[item.path] = { path: item.path, excerpt };
          } catch (error) {
            this.logger.warn({ error, path: item.path }, 'File read failed');
            results[item.path] = { error: String(error) };
          }
        }
      }
      return results;
    }

    // Handle object of fetchers
    if (typeof config === 'object' && config !== null) {
      const results: Record<string, any> = {};
      for (const [key, value] of Object.entries(config)) {
        if (typeof value === 'object' && value !== null && 'fetch' in value) {
          try {
            results[key] = await this.fetchData((value as any).fetch, (value as any).params || {});
          } catch (error) {
            this.logger.warn({ error, key, fetch: (value as any).fetch }, 'Fetch failed');
            results[key] = { error: String(error) };
          }
        } else {
          results[key] = value;
        }
      }
      return results;
    }

    return config;
  }

  /**
   * Extract data source keys from config
   */
  private extractDataSourceKeys(dataSources?: Record<string, any>): string[] {
    if (!dataSources) return [];
    return Object.keys(dataSources);
  }
}
