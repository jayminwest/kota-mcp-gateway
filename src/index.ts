import express from 'express';
import cors from 'cors';
import { loadConfig } from './utils/config.js';
import { correlationIdMiddleware, logger } from './utils/logger.js';
import { errorMiddleware } from './middleware/error.js';
import { optionalAuthMiddleware } from './middleware/auth.js';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { GmailHandler } from './handlers/gmail.js';
import { CalendarHandler } from './handlers/calendar.js';
import { WhoopHandler } from './handlers/whoop.js';
import { PlaidHandler } from './handlers/plaid.js';
import { KasaHandler } from './handlers/kasa.js';
import { KnowledgeOrgHandler } from './handlers/knowledge-org.js';
import { KrakenHandler } from './handlers/kraken.js';
import { RizeHandler } from './handlers/rize.js';
import { SlackHandler } from './handlers/slack.js';
import { getAuthUrl, handleOAuthCallback, getRedirectUri, loadTokens, getGmail } from './utils/google.js';
import { getWhoopAuthUrl, exchangeWhoopCode, loadWhoopTokens, getWhoopRedirectUri } from './utils/whoop.js';
import { KrakenClient } from './utils/kraken.js';

async function main() {
  const config = loadConfig();
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '4mb' }));
  app.use(correlationIdMiddleware);
  app.use(optionalAuthMiddleware(config.MCP_AUTH_TOKEN));

  // Health endpoint
  app.get(config.HEALTH_PATH, (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
  });

  // Google OAuth endpoints
  app.get('/auth/google/start', async (req, res, next) => {
    try {
      const url = await getAuthUrl(config);
      res.redirect(302, url);
    } catch (err) { next(err); }
  });

  app.get('/auth/google/callback', async (req, res, next) => {
    try {
      const code = (req.query.code as string) || '';
      if (!code) return res.status(400).send('Missing code');
      await handleOAuthCallback(config, code, logger);
      res.send('Google authentication successful. You can close this window.');
    } catch (err) { next(err); }
  });

  // Minimal token/status endpoint
  app.get('/auth/google/status', async (req, res, next) => {
    try {
      const tokens = await loadTokens(config);
      if (!tokens) return res.json({ authenticated: false });
      let email: string | undefined;
      try {
        const { gmail } = await getGmail(config, logger);
        if (gmail) {
          const profile = await gmail.users.getProfile({ userId: 'me' });
          email = profile.data.emailAddress || undefined;
        }
      } catch {}
      res.json({
        authenticated: true,
        email,
        expiry_date: tokens.expiry_date,
        scope: tokens.scope,
        token_type: tokens.token_type,
      });
    } catch (err) { next(err); }
  });

  // WHOOP OAuth endpoints
  app.get('/auth/whoop/start', async (req, res, next) => {
    try {
      // Generate a minimal state to satisfy WHOOP requirement
      const state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const url = getWhoopAuthUrl(config, state);
      // Set a lightweight cookie for optional validation
      res.setHeader('Set-Cookie', `whoop_state=${state}; Path=/; HttpOnly; SameSite=Lax`);
      res.redirect(302, url);
    } catch (err) { next(err); }
  });
  app.get('/auth/whoop/callback', async (req, res, next) => {
    try {
      const code = (req.query.code as string) || '';
      if (!code) return res.status(400).send('Missing code');
      // Optional: validate state
      try {
        const state = (req.query.state as string) || '';
        const cookie = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('whoop_state='));
        const stored = cookie ? cookie.split('=')[1] : '';
        if (stored && state && stored !== state) {
          return res.status(400).send('Invalid state');
        }
      } catch {}
      await exchangeWhoopCode(config, code);
      res.send('WHOOP authentication successful. You can close this window.');
    } catch (err) { next(err); }
  });
  app.get('/auth/whoop/status', async (req, res, next) => {
    try {
      const tokens = await loadWhoopTokens(config);
      if (!tokens && !config.WHOOP_API_KEY) return res.json({ authenticated: false });
      let profile: any = undefined;
      try {
        const { WhoopClient } = await import('./utils/whoop.js');
        const client = new WhoopClient(config);
        profile = await client.getProfileBasic();
      } catch {}
      res.json({ authenticated: true, profile, token_type: tokens?.token_type || (config.WHOOP_API_KEY ? 'Bearer' : undefined), expiry_date: tokens?.expiry_date, scope: tokens?.scope });
    } catch (err) { next(err); }
  });

  // Kraken status: report env presence and auth check
  app.get('/auth/kraken/status', async (req, res, next) => {
    try {
      const hasKey = Boolean(config.KRAKEN_API_KEY);
      const hasSecret = Boolean(config.KRAKEN_API_SECRET);
      let authorized: boolean | undefined;
      let error: string | undefined;
      if (hasKey && hasSecret) {
        try {
          const k = new KrakenClient(config);
          // Attempt a lightweight private call to verify credentials
          await k.getBalance();
          authorized = true;
        } catch (e: any) {
          authorized = false;
          error = e?.message || String(e);
        }
      }
      res.json({
        hasKey,
        hasSecret,
        authorized,
        ...(error ? { error } : {}),
      });
    } catch (err) { next(err); }
  });

  // MCP server
  const mcp = new McpServer({
    name: 'kota-gateway',
    version: '1.0.0',
  }, {
    instructions: [
      'KOTA MCP Gateway usage:',
      '- Prefer typed tools when available (e.g., rize_get_client_time_spent, whoop_get_recovery).',
      '- For Rize GraphQL, first call rize_introspect to learn fields; then use rize_execute_query.',
      '- WHOOP v2 endpoints are paginated. Use limit/start/end and control page size via max_pages/max_items.',
      '- Google: authorize via /auth/google/start; WHOOP: /auth/whoop/start; status routes available under /auth/*/status.',
    ].join('\n')
  });

  // Create transport for Streamable HTTP
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless by default
    enableJsonResponse: true,
  });

  // Register handlers and their tools
  const make = (HandlerCtor: any) => new HandlerCtor({ logger, config });
  const handlers = [
    make(GmailHandler),
    make(CalendarHandler),
    make(WhoopHandler),
    make(PlaidHandler),
    make(KasaHandler),
    make(KnowledgeOrgHandler),
    make(KrakenHandler),
    make(RizeHandler),
    make(SlackHandler),
  ];

  for (const handler of handlers) {
    for (const spec of handler.getTools()) {
      const name = `${handler.prefix}_${spec.action}`;
      const paramsSchema = spec.inputSchema ? z.object(spec.inputSchema) : undefined;
      mcp.registerTool(name, {
        description: spec.description,
        inputSchema: spec.inputSchema,
        outputSchema: spec.outputSchema,
      }, async (args: any, extra) => {
        const res = await handler.execute(spec.action, args ?? {});
        logger.debug({ tool: name, args, sessionId: extra?.sessionId }, 'Tool executed');
        return res;
      });
    }
  }

  // Connect after tools are registered
  await mcp.connect(transport);

  // Wire HTTP transport to Express routes
  app.get('/mcp', (req, res) => transport.handleRequest(req as any, res as any));
  app.post('/mcp', (req, res) => transport.handleRequest(req as any, res as any, (req as any).body));
  app.delete('/mcp', (req, res) => transport.handleRequest(req as any, res as any));

  // Error handling
  app.use(errorMiddleware);

  const port = config.PORT;
  app.listen(port, () => {
    logger.info(`KOTA MCP Gateway running on http://localhost:${port}`);
  });
}

// Start
main().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
