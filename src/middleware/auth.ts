import type { NextFunction, Request, Response } from 'express';

export function optionalAuthMiddleware(token?: string) {
  return function auth(req: Request, res: Response, next: NextFunction) {
    if (!token) return next();
    const authz = req.headers.authorization || '';
    const provided = authz.startsWith('Bearer ') ? authz.slice('Bearer '.length) : undefined;
    if (provided !== token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  };
}

