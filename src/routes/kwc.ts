import express from 'express';
import { ZodError } from 'zod';
import type { Logger } from '../utils/logger.js';
import {
  KwcStore,
  lineupInputSchema,
  runInputSchema,
} from '../utils/kwc-store.js';
import { computeAnalyticsSummary } from '../utils/kwc-analytics.js';

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
      res.json({ runs, timeZone: store.getTimeZone() });
    } catch (err) {
      next(err);
    }
  });

  router.post('/runs', async (req, res, next) => {
    try {
      const payload = runInputSchema.parse(req.body);
      const record = await store.addRun(payload);
      routeLogger.info({ date: record.date }, 'Recorded KWC run');
      res.status(201).json({ run: record, timeZone: store.getTimeZone() });
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
      res.json({ lineup, timeZone: store.getTimeZone() });
    } catch (err) {
      next(err);
    }
  });

  router.put('/lineup', async (req, res, next) => {
    try {
      const payload = lineupInputSchema.parse(req.body);
      const lineup = await store.saveLineup(payload.tricks);
      routeLogger.info({ count: lineup.tricks.length }, 'Updated KWC lineup');
      res.json({ lineup, timeZone: store.getTimeZone() });
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

export function createKwcAnalyticsRouter({ store, logger }: KwcRouterOptions): express.Router {
  const router = express.Router();
  const routeLogger = logger.child({ route: 'kwc-analytics' });

  router.get('/', async (req, res, next) => {
    try {
      const daysParam = typeof req.query.days === 'string' ? Number.parseInt(req.query.days, 10) : undefined;
      const windowParam = typeof req.query.window === 'string' ? Number.parseInt(req.query.window, 10) : undefined;
      const days = Number.isFinite(daysParam) ? daysParam : undefined;
      const window = Number.isFinite(windowParam) ? windowParam : undefined;

      const runs = await store.listRunsWithinDays(days);
      const lineup = await store.getLineup();
      const analytics = computeAnalyticsSummary(runs, lineup, { days, window });
      routeLogger.debug({ days, window, runs: runs.length }, 'Computed KWC analytics');
      res.json({ analytics, timeZone: store.getTimeZone() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
