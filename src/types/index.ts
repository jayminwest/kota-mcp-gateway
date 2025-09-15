import type { Logger } from '../utils/logger.js';
import type { AppConfig } from '../utils/config.js';
import type { z } from 'zod';

export interface ToolSpec {
  action: string;
  description: string;
  inputSchema?: z.ZodRawShape;
  outputSchema?: z.ZodRawShape;
}

export interface HandlerConfig extends AppConfig {}

export interface ToolContext {
  logger: Logger;
  config: HandlerConfig;
}
