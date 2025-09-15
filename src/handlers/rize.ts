import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { RizeClient } from '../utils/rize.js';

export class RizeHandler extends BaseHandler {
  readonly prefix = 'rize';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'execute_query',
        description: 'Execute a GraphQL query against Rize',
        inputSchema: {
          query: z.string().describe('GraphQL query string'),
          variables: z.record(z.any()).optional(),
        },
      },
      {
        action: 'introspect',
        description: 'Run GraphQL introspection (schema metadata)',
        inputSchema: {
          partial: z.boolean().default(true).optional(),
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    try {
      const client = new RizeClient(this.config);
      switch (action) {
        case 'execute_query': {
          const data = await client.query(String(args?.query), args?.variables || {});
          return this.json(data);
        }
        case 'introspect': {
          const data = await client.introspect(Boolean(args?.partial ?? true));
          return this.json(data);
        }
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Rize error');
      return { content: [{ type: 'text', text: `Rize error: ${err?.message || String(err)}` }], isError: true };
    }
  }

  private json(obj: any): CallToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
  }
}
