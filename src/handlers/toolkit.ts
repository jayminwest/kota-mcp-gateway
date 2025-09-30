import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { HandlerConfig, ToolSpec } from '../types/index.js';
import type { Logger } from '../utils/logger.js';

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
}

export interface ToolkitApi {
  listBundles(): ToolkitBundleInfo[];
  enableBundle(bundle: string): EnableBundleResult;
}

const EnableBundleSchema = z
  .object({
    bundle: z
      .string()
      .trim()
      .min(1)
      .describe('Bundle key to enable (see toolkit_list_bundles).'),
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
        description: 'Enable a handler bundle by key',
        inputSchema: EnableBundleSchema.shape,
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
    const { bundle } = this.parseArgs(EnableBundleSchema, raw);
    const result = this.toolkit.enableBundle(bundle);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
