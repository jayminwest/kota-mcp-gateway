import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Logger } from '../utils/logger.js';
import { logger as rootLogger } from '../utils/logger.js';
import type { AttentionConfig } from './types.js';

export interface AttentionConfigServiceOptions {
  dataDir: string;
  logger?: Logger;
}

const FALLBACK_CONFIG: AttentionConfig = {
  thresholds: {},
  channelPreferences: {},
  defaultThreshold: 5,
  guardrails: {},
  dispatchTargets: {},
};

export class AttentionConfigService {
  private readonly dataDir: string;
  private readonly logger: Logger;

  constructor(options: AttentionConfigServiceOptions) {
    this.dataDir = options.dataDir;
    this.logger = options.logger ?? rootLogger.child({ component: 'attention-config' });
  }

  async load(): Promise<AttentionConfig> {
    const configPath = this.getConfigPath();
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AttentionConfig>;
      return {
        ...FALLBACK_CONFIG,
        ...parsed,
        thresholds: parsed?.thresholds ?? {},
        channelPreferences: parsed?.channelPreferences ?? {},
        guardrails: {
          ...FALLBACK_CONFIG.guardrails,
          ...parsed?.guardrails,
        },
      } satisfies AttentionConfig;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn({ err, configPath }, 'Failed to load attention config; falling back to defaults');
      }
      return FALLBACK_CONFIG;
    }
  }

  getConfigPath(): string {
    return path.join(this.dataDir, 'attention', 'config.json');
  }

  async ensureDefaults(): Promise<void> {
    const configPath = this.getConfigPath();
    try {
      await fs.access(configPath);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        await this.write(FALLBACK_CONFIG);
      } else {
        throw err;
      }
    }
  }

  async write(config: AttentionConfig): Promise<void> {
    const configPath = this.getConfigPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  }
}
