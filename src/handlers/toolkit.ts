import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { HandlerConfig, ToolSpec } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import type { ContextConfigService } from '../utils/context-config.js';

export interface ToolkitBundleInfo {
  key: string;
  description: string;
  enabled: boolean;
  autoEnabled: boolean;
  tags?: string[];
}

export interface EnableBundleResult {
  bundle: string;
  enabled: boolean;
  alreadyEnabled: boolean;
  registeredTools: string[];
  persisted?: boolean;
  message?: string;
}

export interface DisableBundleResult {
  success: boolean;
  bundle: string;
  disabled: boolean;
  persisted: boolean;
  restart_required: boolean;
  message: string;
}

export interface ToolkitApi {
  listBundles(): ToolkitBundleInfo[];
  enableBundle(bundle: string): EnableBundleResult;
  disableBundle(bundle: string): void;
  getDisabledBundles(): string[];
  contextService: ContextConfigService;
}

const EnableBundleSchema = z
  .object({
    bundle: z
      .string()
      .trim()
      .min(1)
      .describe('Bundle key to enable (see toolkit_list_bundles).'),
    persist: z
      .boolean()
      .optional()
      .describe('If true, removes bundle from disabled list in context.json.'),
  })
  .strip();

const DisableBundleSchema = z
  .object({
    bundle: z
      .string()
      .trim()
      .min(1)
      .describe('Bundle key to disable.'),
  })
  .strip();

const SetContextSchema = z
  .object({
    active_contexts: z
      .array(z.string())
      .describe('Active context labels (informational).'),
    disabled_bundles: z
      .array(z.string())
      .describe('Bundle keys to disable on startup.'),
  })
  .strip();

export class ToolkitHandler extends BaseHandler {
  readonly prefix = 'toolkit';
  private toolkit: ToolkitApi;

  constructor(opts: { logger: Logger; config: HandlerConfig; toolkit: ToolkitApi }) {
    super(opts);
    this.toolkit = opts.toolkit;
  }

  getTools(): ToolSpec[] {
    return [
      {
        action: 'list_bundles',
        description: 'List handler bundles with enable status',
        inputSchema: {},
      },
      {
        action: 'enable_bundle',
        description: 'Enable a handler bundle by key, optionally persisting the change',
        inputSchema: EnableBundleSchema.shape,
      },
      {
        action: 'disable_bundle',
        description: 'Disable a handler bundle (takes effect on restart)',
        inputSchema: DisableBundleSchema.shape,
      },
      {
        action: 'get_context',
        description: 'Get current context configuration including active contexts and disabled bundles',
        inputSchema: {},
      },
      {
        action: 'set_context',
        description: 'Set context configuration (active contexts and disabled bundles)',
        inputSchema: SetContextSchema.shape,
      },
    ];
  }

  async execute(action: string, args: unknown): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'list_bundles':
          return await this.handleListBundles();
        case 'enable_bundle':
          return await this.handleEnableBundle(args);
        case 'disable_bundle':
          return await this.handleDisableBundle(args);
        case 'get_context':
          return await this.handleGetContext();
        case 'set_context':
          return await this.handleSetContext(args);
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Toolkit handler error');
      const message = err?.message || String(err);
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
    }
  }

  private async handleListBundles(): Promise<CallToolResult> {
    const bundles = this.toolkit.listBundles();
    return { content: [{ type: 'text', text: JSON.stringify({ bundles }) }] };
  }

  private async handleEnableBundle(raw: unknown): Promise<CallToolResult> {
    const { bundle, persist } = this.parseArgs(EnableBundleSchema, raw);
    const result = this.toolkit.enableBundle(bundle);

    // If persist is true, remove bundle from disabled list
    if (persist) {
      const contextConfig = await this.toolkit.contextService.load();
      const currentConfig = contextConfig ?? this.toolkit.contextService.getDefault();

      const updatedDisabledBundles = currentConfig.disabled_bundles.filter(b => b !== bundle);

      const newConfig = {
        active_contexts: currentConfig.active_contexts,
        disabled_bundles: updatedDisabledBundles,
        updated: new Date().toISOString(),
      };

      await this.toolkit.contextService.save(newConfig);

      result.persisted = true;
      result.message = `Bundle '${bundle}' enabled and removed from disabled list.`;
    }

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleDisableBundle(raw: unknown): Promise<CallToolResult> {
    const { bundle } = this.parseArgs(DisableBundleSchema, raw);

    // Add to disabled bundles in context config
    const contextConfig = await this.toolkit.contextService.load();
    const currentConfig = contextConfig ?? this.toolkit.contextService.getDefault();

    // Add bundle to disabled list if not already there
    if (!currentConfig.disabled_bundles.includes(bundle)) {
      currentConfig.disabled_bundles.push(bundle);
    }

    const newConfig = {
      active_contexts: currentConfig.active_contexts,
      disabled_bundles: currentConfig.disabled_bundles,
      updated: new Date().toISOString(),
    };

    await this.toolkit.contextService.save(newConfig);

    // Also mark in registry (for runtime tracking)
    this.toolkit.disableBundle(bundle);

    const result: DisableBundleResult = {
      success: true,
      bundle,
      disabled: true,
      persisted: true,
      restart_required: true,
      message: `Bundle '${bundle}' will be disabled on next restart.`,
    };

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleGetContext(): Promise<CallToolResult> {
    const contextConfig = await this.toolkit.contextService.load();
    const exists = await this.toolkit.contextService.exists();

    const result = {
      active_contexts: contextConfig?.active_contexts ?? [],
      disabled_bundles: contextConfig?.disabled_bundles ?? [],
      updated: contextConfig?.updated ?? null,
      config_path: this.toolkit.contextService.getPath(),
      exists,
    };

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleSetContext(raw: unknown): Promise<CallToolResult> {
    const { active_contexts, disabled_bundles } = this.parseArgs(SetContextSchema, raw);

    const newConfig = {
      active_contexts,
      disabled_bundles,
      updated: new Date().toISOString(),
    };

    await this.toolkit.contextService.save(newConfig);

    const result = {
      success: true,
      active_contexts,
      disabled_bundles,
      updated: newConfig.updated,
      persisted: true,
      restart_required: true,
      message: 'Context updated. Restart the gateway for bundle changes to take effect.',
    };

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
