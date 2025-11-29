import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec, HandlerConfig } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { ScopeManager, type DataFetcher, type ScopeConfig } from '../utils/scope-manager.js';
import { ScopeGitManager } from '../utils/scope-git.js';

const KotaSchema = z.object({
  scope: z.union([z.string(), z.array(z.string())]).optional().describe('Scope name(s) to load, or "list" to see all scopes'),
}).strip();

const KotaEditSchema = z.object({
  scope: z.string().min(1).describe('Scope name to edit'),
  modification: z.record(z.string(), z.any()).describe('Modification object with add/remove/update operations'),
  reason: z.string().min(1).describe('Reason for the modification'),
}).strip();

const KotaRefreshSchema = z.object({
  scope: z.string().min(1).describe('Scope name to refresh'),
}).strip();

export class KotaHandler extends BaseHandler {
  readonly prefix = 'kota';
  private scopeManager: ScopeManager;
  private gitManager: ScopeGitManager;

  constructor(opts: { logger: Logger; config: HandlerConfig; fetchData?: DataFetcher }) {
    super(opts);
    this.scopeManager = new ScopeManager({
      logger: this.logger,
      config: this.config,
      fetchData: opts.fetchData,
    });
    this.gitManager = new ScopeGitManager({ logger: this.logger });
  }

  getTools(): ToolSpec[] {
    return [
      {
        action: 'load',
        description: 'Load scope context. Call without args for guidance, with "list" to see all scopes, or with scope name(s) to load.',
        inputSchema: {
          scope: KotaSchema.shape.scope,
        },
      },
      {
        action: 'edit',
        description: 'Edit a scope configuration and commit to git',
        inputSchema: {
          scope: KotaEditSchema.shape.scope,
          modification: KotaEditSchema.shape.modification,
          reason: KotaEditSchema.shape.reason,
        },
      },
      {
        action: 'refresh',
        description: 'Refresh a scope by clearing cache and reloading',
        inputSchema: {
          scope: KotaRefreshSchema.shape.scope,
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    switch (action) {
      case 'load':
        return this.handleKota(this.parseArgs(KotaSchema, args));
      case 'edit':
        return this.handleKotaEdit(this.parseArgs(KotaEditSchema, args));
      case 'refresh':
        return this.handleKotaRefresh(this.parseArgs(KotaRefreshSchema, args));
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * Handle kota() - load scope(s) or provide guidance
   */
  private async handleKota(args: z.infer<typeof KotaSchema>): Promise<CallToolResult> {
    const { scope } = args;

    // No scope provided: return guidance
    if (!scope) {
      const scopes = await this.scopeManager.listScopes();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'guidance',
              message: 'Scope required. Specify which context you need.',
              usage: {
                single_scope: 'kota.load({ scope: "GEOSYNC" })',
                multiple_scopes: 'kota.load({ scope: ["GEOSYNC", "PERSONAL"] })',
                list_all_scopes: 'kota.load({ scope: "list" })',
              },
              available_scopes: scopes.map(s => ({
                name: s.name,
                description: s.description,
              })),
            }, null, 2),
          },
        ],
      };
    }

    // List all scopes
    if (scope === 'list') {
      const scopes = await this.scopeManager.listScopes();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              available_scopes: scopes,
              usage: {
                load_scope: 'kota.load({ scope: "GEOSYNC" })',
                load_multiple: 'kota.load({ scope: ["GEOSYNC", "PERSONAL"] })',
              },
            }, null, 2),
          },
        ],
      };
    }

    // Load single scope
    if (typeof scope === 'string') {
      const loaded = await this.scopeManager.loadScope(scope);
      if (!loaded) {
        const availableScopes = await this.scopeManager.listScopes();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                message: `Scope '${scope}' not found`,
                available_scopes: availableScopes.map(s => s.name),
                usage: {
                  correct_format: 'kota.load({ scope: "GEOSYNC" })',
                  see_all: 'kota.load({ scope: "list" })',
                },
              }, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              scope: loaded.name,
              loaded_at: loaded.loaded_at,
              last_modified: loaded.last_modified,
              modified_by: loaded.modified_by,
              context: loaded.context,
              exposed_tools: loaded.exposed_tools,
              next_actions: {
                edit_this_scope: {
                  tool: 'kota.edit',
                  example: `kota.edit({ scope: "${loaded.name}", modification: { add: {...} }, reason: "Adding new data source" })`,
                },
                load_additional: {
                  tool: 'kota.load',
                  example: 'kota.load({ scope: "PERSONAL" })',
                },
                refresh_data: {
                  tool: 'kota.refresh',
                  example: `kota.refresh({ scope: "${loaded.name}" })`,
                },
              },
            }, null, 2),
          },
        ],
      };
    }

    // Load multiple scopes
    if (Array.isArray(scope)) {
      const loaded = [];
      const errors = [];

      for (const scopeName of scope) {
        const result = await this.scopeManager.loadScope(scopeName);
        if (result) {
          loaded.push(result);
        } else {
          errors.push(scopeName);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: errors.length > 0 ? 'partial' : 'success',
              loaded_scopes: loaded.map(s => ({
                scope: s.name,
                loaded_at: s.loaded_at,
                last_modified: s.last_modified,
                modified_by: s.modified_by,
                context: s.context,
                exposed_tools: s.exposed_tools,
              })),
              failed_scopes: errors,
              next_actions: {
                refresh_scopes: {
                  tool: 'kota.refresh',
                  example: `kota.refresh({ scope: "${loaded[0]?.name || 'SCOPE'}" })`,
                },
              },
            }, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'error',
            message: 'Invalid scope parameter',
          }, null, 2),
        },
      ],
    };
  }

  /**
   * Handle kota.edit() - edit a scope and commit to git
   */
  private async handleKotaEdit(args: z.infer<typeof KotaEditSchema>): Promise<CallToolResult> {
    const { scope, modification, reason } = args;

    // Load existing scope config
    const config = await this.scopeManager.loadScopeConfig(scope);
    if (!config) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              message: `Scope '${scope}' not found`,
            }, null, 2),
          },
        ],
      };
    }

    // Apply modifications
    const updatedConfig = this.applyModifications(config, modification);

    // Update last_modified metadata
    updatedConfig.scope.last_modified = new Date().toISOString();
    updatedConfig.scope.modified_by = 'kota-agent';

    // Save the updated config
    try {
      await this.scopeManager.saveScopeConfig(scope, updatedConfig);

      // Commit to git
      const filePath = this.scopeManager.resolveScopePath(scope);
      const gitResult = await this.gitManager.commitScopeChange(
        filePath,
        reason,
        updatedConfig.scope.modified_by
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              scope,
              modification: this.describeModification(modification),
              git_commit: gitResult.commit_hash,
              commit_message: gitResult.commit_message,
              file_path: filePath,
              next_actions: {
                reload_scope: `kota.load({ scope: "${scope}" }) # to see updated context`,
                undo: `${gitResult.undo_command} # if modification was incorrect`,
              },
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logger.error({ error, scope }, 'Failed to edit scope');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              message: `Failed to edit scope: ${String(error)}`,
            }, null, 2),
          },
        ],
      };
    }
  }

  /**
   * Handle kota.refresh() - refresh a scope
   */
  private async handleKotaRefresh(args: z.infer<typeof KotaRefreshSchema>): Promise<CallToolResult> {
    const { scope } = args;

    const result = await this.scopeManager.refreshScope(scope);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ...result,
            next_actions: result.status === 'success' ? {
              view_updated: `kota.load({ scope: "${scope}" }) # to see refreshed context`,
            } : undefined,
          }, null, 2),
        },
      ],
    };
  }

  /**
   * Apply modifications to a scope config
   */
  private applyModifications(config: ScopeConfig, modification: Record<string, any>): ScopeConfig {
    const updated = { ...config };

    // Handle 'add' operations
    if (modification.add) {
      for (const [path, value] of Object.entries(modification.add)) {
        this.setNestedValue(updated, path, value, 'add');
      }
    }

    // Handle 'remove' operations
    if (modification.remove) {
      for (const path of modification.remove) {
        this.deleteNestedValue(updated, path);
      }
    }

    // Handle 'update' operations
    if (modification.update) {
      for (const [path, value] of Object.entries(modification.update)) {
        this.setNestedValue(updated, path, value, 'update');
      }
    }

    return updated;
  }

  /**
   * Set a nested value in an object using dot notation
   */
  private setNestedValue(obj: any, path: string, value: any, mode: 'add' | 'update'): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }

    const lastPart = parts[parts.length - 1];
    if (mode === 'add' && Array.isArray(current[lastPart])) {
      current[lastPart].push(value);
    } else {
      current[lastPart] = value;
    }
  }

  /**
   * Delete a nested value from an object using dot notation
   */
  private deleteNestedValue(obj: any, path: string): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        return; // Path doesn't exist
      }
      current = current[part];
    }

    const lastPart = parts[parts.length - 1];
    delete current[lastPart];
  }

  /**
   * Describe a modification for the response
   */
  private describeModification(modification: Record<string, any>): string {
    const operations = [];
    if (modification.add) {
      operations.push(`added ${Object.keys(modification.add).join(', ')}`);
    }
    if (modification.remove) {
      operations.push(`removed ${modification.remove.join(', ')}`);
    }
    if (modification.update) {
      operations.push(`updated ${Object.keys(modification.update).join(', ')}`);
    }
    return operations.join('; ');
  }
}
