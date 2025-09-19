import { z } from 'zod';
import type { Logger } from '../utils/logger.js';
import type { HandlerConfig, ToolSpec } from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export abstract class BaseHandler {
  protected logger: Logger;
  protected config: HandlerConfig;

  abstract readonly prefix: string;
  readonly aliases: string[] = [];

  constructor(opts: { logger: Logger; config: HandlerConfig }) {
    this.logger = opts.logger;
    this.config = opts.config;
  }

  abstract getTools(): ToolSpec[];
  abstract execute(action: string, args: any): Promise<CallToolResult>;

  protected parseArgs<T>(schema: z.ZodType<T>, args: unknown): T {
    return schema.parse(args ?? {});
  }
}
