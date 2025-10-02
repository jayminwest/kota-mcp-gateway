import express from 'express';
import { ZodError } from 'zod';
import type { Logger } from '../utils/logger.js';
import {
  KwcStore,
  lineupInputSchema,
  runInputSchema,
} from '../utils/kwc-store.js';

interface KwcRouterOptions {
  store: KwcStore;
  logger: Logger;
}

export function createKwcRouter({ store, logger }: KwcRouterOptions): express.Router {
  const router = express.Router();
  const routeLogger = logger.child({ route: 'kwc' });

  router.get('/runs', async (_req, res, next) => {
    try {
      const runs = await store.listRuns();
      res.json({ runs });
    } catch (err) {
      next(err);
    }
  });

  router.post('/runs', async (req, res, next) => {
    try {
      const payload = runInputSchema.parse(req.body);
      const record = await store.addRun(payload);
      routeLogger.info({ date: record.date }, 'Recorded KWC run');
      res.status(201).json({ run: record });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'Invalid run payload', issues: err.flatten() });
        return;
      }
      next(err);
    }
  });

  router.get('/lineup', async (_req, res, next) => {
    try {
      const lineup = await store.getLineup();
      res.json({ lineup });
    } catch (err) {
      next(err);
    }
  });

  router.put('/lineup', async (req, res, next) => {
    try {
      const payload = lineupInputSchema.parse(req.body);
      const lineup = await store.saveLineup(payload.tricks);
      routeLogger.info({ count: lineup.tricks.length }, 'Updated KWC lineup');
      res.json({ lineup });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'Invalid lineup payload', issues: err.flatten() });
        return;
      }
      next(err);
    }
  });

  return router;
}

