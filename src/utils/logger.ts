import pino from 'pino';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined,
});

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers['x-request-id'] as string) || randomUUID();
  (req as any).id = id;
  res.setHeader('x-request-id', id);
  (req as any).log = logger.child({ reqId: id, path: req.path, method: req.method });
  next();
}

export type Logger = typeof logger;

