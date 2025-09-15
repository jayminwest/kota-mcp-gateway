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

  // Help resources (read-only)
  function registerHelpResource(name: string, uri: string, text: string) {
    mcp.resource(name, uri, async (u) => ({
      contents: [
        { uri: u.toString(), text },
      ],
    }));
  }

  registerHelpResource(
    'kota_help_index',
    'help://kota',
    [
      'KOTA MCP Help Index',
      '',
      'General:',
      '- Use typed tools when available (e.g., rize_get_client_time_spent, whoop_get_recovery).',
      '- For raw GraphQL (Rize), call rize_introspect first to learn fields; then rize_execute_query.',
      '- WHOOP: paginate with { limit, start, end, all, max_pages, max_items } to manage sizes.',
      '- Auth routes: /auth/google/start, /auth/whoop/start, and /auth/*/status.',
      '',
      'Help URIs:',
      '- help://rize/usage',
      '- help://whoop/usage',
      '- help://kraken/usage',
      '- help://google/usage',
    ].join('\n')
  );

  registerHelpResource(
    'rize_help_usage',
    'help://rize/usage',
    [
      'Rize Help',
      '',
      'Typed tools:',
      '- rize_get_current_user {}',
      '- rize_list_projects { first?: number }',
      '- rize_list_tasks { first?: number }',
      '- rize_list_client_time_entries { startTime, endTime, client_name?, limit? }',
      '- rize_get_client_time_spent { startTime, endTime, client_name }',
      '',
      'Raw GraphQL:',
      '- rize_introspect { partial?: boolean }',
      '- rize_execute_query { query, variables? }',
    ].join('\n')
  );

  registerHelpResource(
    'whoop_help_usage',
    'help://whoop/usage',
    [
      'WHOOP Help (v2)',
      '',
      'Common list tools:',
      '- whoop_get_recovery { start?, end?, limit?, next_token?, all?, max_pages?, max_items? }',
      '- whoop_get_sleep { ... }',
      '- whoop_get_workouts { ... }',
      '- whoop_get_cycles { ... }',
      'By-ID:',
      '- whoop_get_sleep_by_id { sleep_id }',
      '- whoop_get_workout_by_id { workout_id }',
      '- whoop_get_cycle_by_id { cycle_id }',
      '- whoop_get_cycle_recovery { cycle_id }',
      '- whoop_get_cycle_sleep { cycle_id }',
    ].join('\n')
  );

  registerHelpResource(
    'kraken_help_usage',
    'help://kraken/usage',
    [
      'Kraken Help',
      '',
      'Tools:',
      '- kraken_get_ticker { pair }  (public)',
      '- kraken_get_balance {}       (requires KRAKEN_API_KEY/SECRET)',
      '',
      'Status:',
      '- GET /auth/kraken/status → { hasKey, hasSecret, authorized }',
    ].join('\n')
  );

  registerHelpResource(
    'google_help_usage',
    'help://google/usage',
    [
      'Google (Gmail + Calendar) Help',
      '',
      'Auth routes:',
      '- /auth/google/start → browser consent',
      '- /auth/google/status → token status',
      '',
      'Gmail tools:',
      '- gmail_list_messages { query?, max_results? }',
      '- gmail_send_message { to, subject?, body? }',
      '- gmail_create_draft { to, subject?, body? }',
      '',
      'Calendar tools:',
      '- calendar_list_events { start?, end?, max_results? }',
      '- calendar_create_event { title, start, end, description?, attendees? }',
      '- calendar_update_event { id, title?, start?, end?, description? }',
    ].join('\n')
  );

  // Prompts (examples and quick usage tips)
  mcp.prompt('rize.examples', 'Examples for Rize usage', async () => ({
    description: 'Ready-to-use Rize examples',
    messages: [
      {
        role: 'assistant',
        content: { type: 'text', text: [
          'Examples:',
          '- rize_get_current_user {}',
          '- rize_list_projects { "first": 5 }',
          '- rize_get_client_time_spent { "client_name": "Acme", "startTime": "2025-09-01T00:00:00Z", "endTime": "2025-09-30T23:59:59Z" }',
          '- rize_execute_query { "query": "query { currentUser { name email } }" }',
        ].join('\n') },
      },
    ],
  }));

  mcp.prompt('whoop.examples', 'Examples for WHOOP usage', async () => ({
    description: 'WHOOP pagination and by-ID examples',
    messages: [
      {
        role: 'assistant',
        content: { type: 'text', text: [
          'Examples:',
          '- whoop_get_recovery { "limit": 25, "all": true, "max_pages": 3, "max_items": 60 }',
          '- whoop_get_sleep_by_id { "sleep_id": "...uuid..." }',
          '- whoop_get_cycle_recovery { "cycle_id": 123456 }',
        ].join('\n') },
      },
    ],
  }));

  mcp.prompt('kraken.examples', 'Examples for Kraken usage', async () => ({
    description: 'Kraken quick examples',
    messages: [
      { role: 'assistant', content: { type: 'text', text: 'kraken_get_ticker { "pair": "XBTUSD" }' } },
      { role: 'assistant', content: { type: 'text', text: 'kraken_get_balance {}' } },
    ],
  }));

  mcp.prompt('google.examples', 'Examples for Gmail and Calendar', async () => ({
    description: 'Google tools examples',
    messages: [
      { role: 'assistant', content: { type: 'text', text: 'gmail_list_messages { "query": "is:unread", "max_results": 10 }' } },
      { role: 'assistant', content: { type: 'text', text: 'calendar_list_events { "start": "2025-09-15T00:00:00Z", "end": "2025-09-22T00:00:00Z", "max_results": 10 }' } },
    ],
  }));

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
