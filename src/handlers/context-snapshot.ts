import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { ContextSnapshotService } from '../utils/context-snapshots.js';

const GetRecentSchema = z
  .object({
    limit: z.coerce.number().int().positive().max(50).optional(),
  })
  .strip();

export class ContextSnapshotHandler extends BaseHandler {
  readonly prefix = 'context';
  private readonly service: ContextSnapshotService;

  constructor(opts: ConstructorParameters<typeof BaseHandler>[0]) {
    super(opts);
    this.service = new ContextSnapshotService({
      config: this.config,
      logger: this.logger.child({ handler: 'context_snapshot' }),
    });
  }

  getTools(): ToolSpec[] {
    return [
      {
        action: 'get_recent',
        description: 'Retrieve recent context snapshots captured via the iOS shortcut webhook',
        inputSchema: {
          limit: GetRecentSchema.shape.limit,
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    switch (action) {
      case 'get_recent':
        return this.getRecent(args);
      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
    }
  }

  private async getRecent(args: unknown): Promise<CallToolResult> {
    try {
      const { limit } = this.parseArgs(GetRecentSchema, args);
      const normalizedLimit = limit ?? 5;
      const snapshots = await this.service.getRecent(normalizedLimit);
      const body = {
        limit: normalizedLimit,
        count: snapshots.length,
        snapshots,
      };
      const text = JSON.stringify(body, null, 2);
      return { content: [{ type: 'text', text }] };
    } catch (err: any) {
      this.logger.error({ err }, 'Failed to fetch recent context snapshots');
      return { content: [{ type: 'text', text: `Context snapshot error: ${err?.message || String(err)}` }], isError: true };
    }
  }
}

