import type { NextFunction, Request, Response } from 'express';

export function errorMiddleware(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = typeof err.status === 'number' ? err.status : 500;
  const message = err?.message || 'Internal Server Error';
  const log = (req as any).log || console;
  log.error({ err, status }, 'Unhandled error');
  res.status(status).json({ error: message });
}

