import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';

export class KnowledgeOrgHandler extends BaseHandler {
  readonly prefix = 'knowledge';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'search',
        description: 'Search knowledge notes for a term',
        inputSchema: {
          query: z.string(),
          limit: z.number().int().positive().max(50).default(10).optional(),
        },
      },
      {
        action: 'create_note',
        description: 'Create a markdown note in the knowledge base',
        inputSchema: {
          title: z.string(),
          content: z.string(),
          folder: z.string().optional(),
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    if (action === 'search') return this.search(args);
    if (action === 'create_note') return this.create(args);
    return {
      content: [{ type: 'text', text: `Unknown action: ${action}` }],
      isError: true,
    };
  }

  private async baseDir(): Promise<string> {
    const dir = this.config.KNOWLEDGE_BASE_PATH || '/app/data/knowledge';
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private async search(args: { query: string; limit?: number }): Promise<CallToolResult> {
    const base = await this.baseDir();
    const files = await this.walk(base);
    const q = args.query.toLowerCase();
    const matches: string[] = [];
    for (const f of files) {
      if (matches.length >= (args.limit || 10)) break;
      try {
        const txt = await fs.readFile(f, 'utf8');
        if (txt.toLowerCase().includes(q)) matches.push(path.relative(base, f));
      } catch {}
    }
    return {
      content: [
        {
          type: 'text',
          text: matches.length ? `Matches (relative):\n${matches.join('\n')}` : 'No matches',
        },
      ],
    };
  }

  private async create(args: { title: string; content: string; folder?: string }): Promise<CallToolResult> {
    const base = await this.baseDir();
    const safeTitle = args.title.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/(^-|-$)/g, '');
    const folder = args.folder ? args.folder.replace(/\.\.+/g, '') : '';
    const dir = path.join(base, folder);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${safeTitle}.md`);
    const now = new Date().toISOString();
    const body = `# ${args.title}\n\nCreated: ${now}\n\n${args.content}\n`;
    await fs.writeFile(file, body, 'utf8');
    return { content: [{ type: 'text', text: `Created note: ${path.relative(base, file)}` }] };
  }

  private async walk(root: string): Promise<string[]> {
    const out: string[] = [];
    async function recur(dir: string) {
      const ents = await fs.readdir(dir, { withFileTypes: true });
      for (const e of ents) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await recur(full);
        else if (e.isFile() && /\.(md|txt|mdx)$/i.test(e.name)) out.push(full);
      }
    }
    await recur(root);
    return out;
  }
}
