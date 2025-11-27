import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Logger } from 'pino';
import { z } from 'zod';

export interface ContextConfig {
  active_contexts: string[];
  disabled_bundles: string[];
  updated: string; // ISO 8601 timestamp
}

const ContextConfigSchema = z.object({
  active_contexts: z.array(z.string()),
  disabled_bundles: z.array(z.string()),
  updated: z.string().datetime(),
});

export class ContextConfigService {
  private readonly configPath: string;

  constructor(private readonly logger: Logger) {
    const kotaDir = path.join(os.homedir(), '.kota');
    this.configPath = path.join(kotaDir, 'context.json');
  }

  /**
   * Load context configuration from ~/.kota/context.json
   * Returns null if file doesn't exist or is malformed
   */
  async load(): Promise<ContextConfig | null> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const data = JSON.parse(content);

      const validation = ContextConfigSchema.safeParse(data);

      if (!validation.success) {
        this.logger.warn(
          { errors: validation.error.errors, configPath: this.configPath },
          'Invalid context.json format, ignoring'
        );
        return null;
      }

      this.logger.info(
        {
          active_contexts: validation.data.active_contexts,
          disabled_bundles: validation.data.disabled_bundles,
          configPath: this.configPath,
        },
        'Context configuration loaded'
      );

      return validation.data;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger.debug({ configPath: this.configPath }, 'context.json not found, using defaults');
        return null;
      }

      if (error instanceof SyntaxError) {
        this.logger.warn(
          { configPath: this.configPath, error: error.message },
          'Malformed context.json, ignoring'
        );
        return null;
      }

      // Log other errors but don't crash
      this.logger.error(
        { configPath: this.configPath, error: error.message },
        'Error loading context.json'
      );
      return null;
    }
  }

  /**
   * Save context configuration to ~/.kota/context.json with atomic write
   */
  async save(config: ContextConfig): Promise<void> {
    const tempPath = `${this.configPath}.tmp`;

    try {
      // Ensure .kota directory exists
      const kotaDir = path.dirname(this.configPath);
      await fs.mkdir(kotaDir, { recursive: true });

      // Write to temp file first
      const data = {
        active_contexts: config.active_contexts,
        disabled_bundles: config.disabled_bundles,
        updated: config.updated,
      };

      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');

      // Atomic rename
      await fs.rename(tempPath, this.configPath);

      this.logger.info(
        {
          active_contexts: config.active_contexts,
          disabled_bundles: config.disabled_bundles,
          configPath: this.configPath,
        },
        'Context configuration saved'
      );
    } catch (error: any) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      this.logger.error(
        { configPath: this.configPath, error: error.message },
        'Failed to save context configuration'
      );
      throw new Error(`Failed to save context configuration: ${error.message}`);
    }
  }

  /**
   * Get the path to the context configuration file
   */
  getPath(): string {
    return this.configPath;
  }

  /**
   * Check if context configuration file exists
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get default context configuration
   */
  getDefault(): ContextConfig {
    return {
      active_contexts: [],
      disabled_bundles: [],
      updated: new Date().toISOString(),
    };
  }
}
