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

export class ScopeManager {
  private logger: Logger;
  private config: HandlerConfig;
  private scopesDir: string;
  private cache: Map<string, { scope: LoadedScope; timestamp: number }>;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  constructor(opts: { logger: Logger; config: HandlerConfig }) {
    this.logger = opts.logger;
    this.config = opts.config;
    this.scopesDir = path.join(os.homedir(), 'kota_md', 'scopes');
    this.cache = new Map();
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
   * Load a scope with context (for MVP: returns static config without executing fetchers)
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

    const loaded: LoadedScope = {
      name: config.scope.name,
      loaded_at: new Date().toISOString(),
      last_modified: config.scope.last_modified,
      modified_by: config.scope.modified_by,
      context: {
        overview: config.overview || '',
        // For MVP: return static config structure
        // Phase 4 will execute data fetchers
        data_sources_config: config.data_sources || {},
      },
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
   * Extract data source keys from config
   */
  private extractDataSourceKeys(dataSources?: Record<string, any>): string[] {
    if (!dataSources) return [];
    return Object.keys(dataSources);
  }
}
