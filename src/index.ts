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

  // MCP server
  const mcp = new McpServer({
    name: 'kota-gateway',
    version: '1.0.0',
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
