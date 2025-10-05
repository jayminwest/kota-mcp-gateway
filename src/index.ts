import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './utils/config.js';
import { correlationIdMiddleware, logger } from './utils/logger.js';
import { errorMiddleware } from './middleware/error.js';
import { optionalAuthMiddleware } from './middleware/auth.js';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { GmailHandler } from './handlers/gmail.js';
import { CalendarHandler } from './handlers/calendar.js';
import { WhoopHandler } from './handlers/whoop.js';
import { KasaHandler } from './handlers/kasa.js';
import { KrakenHandler } from './handlers/kraken.js';
import { RizeHandler } from './handlers/rize.js';
import { SlackHandler } from './handlers/slack.js';
import { GitHubHandler } from './handlers/github.js';
import { StripeHandler } from './handlers/stripe.js';
import { MemoryHandler } from './handlers/memory.js';
import { ContextSnapshotHandler } from './handlers/context-snapshot.js';
import { DailyHandler } from './handlers/daily.js';
import { ContentCalendarHandler } from './handlers/content-calendar.js';
import { ToolkitHandler } from './handlers/toolkit.js';
import { WorkspaceHandler } from './handlers/workspace.js';
import { WebhooksHandler } from './handlers/webhooks.js';
import { SpotifyHandler } from './handlers/spotify.js';
import { KwcHandler } from './handlers/kwc.js';
import type { ToolkitApi, ToolkitBundleInfo, EnableBundleResult } from './handlers/toolkit.js';
import type { BaseHandler } from './handlers/base.js';
import { KwcStore } from './utils/kwc-store.js';
import { createKwcRouter, createKwcAnalyticsRouter } from './routes/kwc.js';
import { getAuthUrl, handleOAuthCallback, loadTokens, getGmail } from './utils/google.js';
import { getWhoopAuthUrl, exchangeWhoopCode, loadWhoopTokens } from './utils/whoop.js';
import { KrakenClient } from './utils/kraken.js';
import { generateSlackState, getSlackAuthUrl, exchangeSlackCode, getSlackStatus, loadSlackTokens } from './utils/slack.js';
import { generateSpotifyState, getSpotifyAuthUrl, exchangeSpotifyCode, loadSpotifyTokens } from './utils/spotify.js';
import { WebhookManager } from './webhooks/manager.js';
import { loadWebhookConfig } from './utils/webhook-config.js';
import { AttentionConfigService, AttentionPipeline, CodexClassificationAgent, DispatchManager, SlackDispatchTransport } from './attention/index.js';

function asyncHandler<
  T extends (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<unknown>
>(fn: T) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

interface BundleDefinition {
  key: string;
  description: string;
  factory: () => BaseHandler;
  autoEnable?: boolean;
  tags?: string[];
}

class BundleRegistry {
  private readonly definitions = new Map<string, BundleDefinition>();
  private readonly order: string[] = [];
  private readonly enabled = new Map<string, { handler: BaseHandler; tools: string[] }>();

  constructor(private readonly opts: { logger: typeof logger; mcp: McpServer }) {}

  addBundle(def: BundleDefinition): void {
    if (this.definitions.has(def.key)) {
      throw new Error(`Bundle already registered: ${def.key}`);
    }
    this.definitions.set(def.key, def);
    this.order.push(def.key);
    if (def.autoEnable) {
      this.enableBundle(def.key);
    }
  }

  enableBundle(key: string): EnableBundleResult {
    const def = this.definitions.get(key);
    if (!def) {
      throw new Error(`Unknown bundle: ${key}`);
    }
    const existing = this.enabled.get(key);
    if (existing) {
      return {
        bundle: key,
        enabled: true,
        alreadyEnabled: true,
        registeredTools: existing.tools,
      };
    }
    const handler = def.factory();
    const tools = this.registerHandler(key, handler);
    this.enabled.set(key, { handler, tools });
    return {
      bundle: key,
      enabled: true,
      alreadyEnabled: false,
      registeredTools: tools,
    };
  }

  listBundles(): ToolkitBundleInfo[] {
    return this.order.map(key => {
      const def = this.definitions.get(key)!;
      return {
        key,
        description: def.description,
        enabled: this.enabled.has(key),
        autoEnabled: Boolean(def.autoEnable),
        tags: def.tags,
      };
    });
  }

  private registerHandler(bundleKey: string, handler: BaseHandler): string[] {
    const registered: string[] = [];
    const prefixes = [handler.prefix, ...(handler.aliases ?? [])];
    const uniquePrefixes = Array.from(new Set(prefixes));
    for (const spec of handler.getTools()) {
      for (const prefix of uniquePrefixes) {
        const name = `${prefix}_${spec.action}`;
        this.opts.mcp.registerTool(name, {
          description: spec.description,
          inputSchema: spec.inputSchema,
          outputSchema: spec.outputSchema,
        }, async (args: any, extra) => {
          const res = await handler.execute(spec.action, args ?? {});
          this.opts.logger.debug({ tool: name, args, sessionId: extra?.sessionId }, 'Tool executed');
          return res;
        });
        this.opts.logger.info({ tool: name, prefix, bundle: bundleKey }, 'Tool registered');
        registered.push(name);
      }
    }
    return registered;
  }
}

async function main() {
  const config = loadConfig();
  const app = express();
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const kwcPublicDir = path.resolve(moduleDir, '../public/kwc');

  app.use(cors());
  app.get('/kwc', (req, res) => {
    res.sendFile(path.join(kwcPublicDir, 'index.html'), err => {
      if (err) {
        const status = typeof (err as any)?.statusCode === 'number' ? (err as any).statusCode : 500;
        ((req as any).log || logger).warn({ err }, 'Failed to serve KWC index');
        if (!res.headersSent) {
          res.status(status).end();
        }
      }
    });
  });
  app.get('/kwc/stats', (req, res) => {
    res.sendFile(path.join(kwcPublicDir, 'stats.html'), err => {
      if (err) {
        const status = typeof (err as any)?.statusCode === 'number' ? (err as any).statusCode : 500;
        ((req as any).log || logger).warn({ err }, 'Failed to serve KWC stats');
        if (!res.headersSent) {
          res.status(status).end();
        }
      }
    });
  });
  app.use('/kwc', express.static(kwcPublicDir, { index: 'index.html', redirect: true }));
  app.use(express.json({
    limit: '4mb',
    verify: (req, _res, buf) => {
      (req as any).rawBody = Buffer.from(buf);
    },
  }));
  app.use(correlationIdMiddleware);
  app.use(optionalAuthMiddleware(config.MCP_AUTH_TOKEN));

  const kwcStore = new KwcStore(config, logger);
  app.use('/kwc/api/analytics', createKwcAnalyticsRouter({ store: kwcStore, logger }));
  app.use('/kwc/api', createKwcRouter({ store: kwcStore, logger }));

  const webhookConfig = await loadWebhookConfig(config.DATA_DIR, logger);

  const attentionConfigService = new AttentionConfigService({ dataDir: config.DATA_DIR, logger });
  await attentionConfigService.ensureDefaults();
  const attentionConfig = await attentionConfigService.load();
  const attentionDispatch = new DispatchManager({ logger });
  if (attentionConfig.dispatchTargets?.slack?.channelId) {
    const slackTransport = new SlackDispatchTransport({
      logger,
      appConfig: config,
      attentionConfig,
    });
    attentionDispatch.registerTransport('slack', slackTransport.send.bind(slackTransport));
  }
  const attentionPipeline = new AttentionPipeline({
    logger,
    config: attentionConfig,
    classifier: new CodexClassificationAgent({ logger, config: attentionConfig }),
    dispatch: attentionDispatch,
  });

  const webhookManager = new WebhookManager({ app, config, logger, webhookConfig, attentionPipeline });
  webhookManager.register();

  // Health endpoint
  app.get(config.HEALTH_PATH, (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
  });

  // Google OAuth endpoints
  app.get('/auth/google/start', asyncHandler(async (_req, res) => {
    const url = await getAuthUrl(config, logger);
    res.redirect(302, url);
  }));

  app.get('/auth/google/callback', asyncHandler(async (req, res) => {
    const code = (req.query.code as string) || '';
    if (!code) {
      res.status(400).send('Missing code');
      return;
    }
    await handleOAuthCallback(config, code, logger);
    res.send('Google authentication successful. You can close this window.');
  }));

  // Minimal token/status endpoint
  app.get('/auth/google/status', asyncHandler(async (_req, res) => {
    const tokens = await loadTokens(config);
    if (!tokens) {
      res.json({ authenticated: false });
      return;
    }
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
  }));

  // WHOOP OAuth endpoints
  app.get('/auth/whoop/start', asyncHandler(async (_req, res) => {
    // Generate a minimal state to satisfy WHOOP requirement
    const state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const url = getWhoopAuthUrl(config, state);
    // Set a lightweight cookie for optional validation
    res.setHeader('Set-Cookie', `whoop_state=${state}; Path=/; HttpOnly; SameSite=Lax`);
    res.redirect(302, url);
  }));
  app.get('/auth/whoop/callback', asyncHandler(async (req, res) => {
    const error = (req.query.error as string) || '';
    const errorDescription = (req.query.error_description as string) || '';
    if (error) {
      res.status(400).send(`WHOOP authorization failed: ${error}${errorDescription ? ` - ${errorDescription}` : ''}`);
      return;
    }
    const code = (req.query.code as string) || '';
    if (!code) {
      res.status(400).send('Missing code');
      return;
    }
    // Optional: validate state
    try {
      const state = (req.query.state as string) || '';
      const cookie = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('whoop_state='));
      const stored = cookie ? cookie.split('=')[1] : '';
      if (stored && state && stored !== state) {
        res.status(400).send('Invalid state');
        return;
      }
    } catch {}
    await exchangeWhoopCode(config, code);
    res.send('WHOOP authentication successful. You can close this window.');
  }));
  app.get('/auth/whoop/status', asyncHandler(async (_req, res) => {
    const tokens = await loadWhoopTokens(config);
    if (!tokens && !config.WHOOP_API_KEY) {
      res.json({ authenticated: false });
      return;
    }
    let profile: any = undefined;
    try {
      const { WhoopClient } = await import('./utils/whoop.js');
      const client = new WhoopClient(config);
      profile = await client.getProfileBasic();
    } catch {}
    res.json({
      authenticated: true,
      profile,
      token_type: tokens?.token_type || (config.WHOOP_API_KEY ? 'Bearer' : undefined),
      expiry_date: tokens?.expiry_date,
      scope: tokens?.scope,
      has_refresh_token: Boolean(tokens?.refresh_token),
      refresh_token_expiry_date: tokens?.refresh_token_expiry_date,
      updated_at: tokens?.updated_at,
    });
  }));

  // Slack OAuth endpoints
  app.get('/auth/slack/start', asyncHandler(async (_req, res) => {
    const state = generateSlackState();
    const url = getSlackAuthUrl(config, state);
    res.setHeader('Set-Cookie', `slack_state=${state}; Path=/; HttpOnly; SameSite=Lax`);
    res.redirect(302, url);
  }));
  app.get('/auth/slack/callback', asyncHandler(async (req, res) => {
    const code = (req.query.code as string) || '';
    if (!code) {
      res.status(400).send('Missing code');
      return;
    }
    try {
      const state = (req.query.state as string) || '';
      const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('slack_state='));
      const stored = cookie ? cookie.split('=')[1] : '';
      if (stored && state && stored !== state) {
        res.status(400).send('Invalid state');
        return;
      }
    } catch {}
    await exchangeSlackCode(config, code);
    res.send('Slack authentication successful. You can close this window.');
  }));
  app.get('/auth/slack/status', asyncHandler(async (_req, res) => {
    const tokens = await loadSlackTokens(config);
    if (!tokens?.authed_user?.access_token) {
      res.json({ authenticated: false });
      return;
    }
    const status = await getSlackStatus(config, logger);
    res.json({
      ...status,
      authed_user: {
        id: tokens.authed_user?.id,
        scope: tokens.authed_user?.scope,
        expires_at: tokens.authed_user?.expires_at,
      },
      team: tokens.team,
    });
  }));

  // Spotify OAuth endpoints
  app.get('/auth/spotify/start', asyncHandler(async (_req, res) => {
    const state = generateSpotifyState();
    const url = getSpotifyAuthUrl(config, state);
    res.setHeader('Set-Cookie', `spotify_state=${state}; Path=/; HttpOnly; SameSite=Lax`);
    res.redirect(302, url);
  }));
  app.get('/auth/spotify/callback', asyncHandler(async (req, res) => {
    const error = (req.query.error as string) || '';
    if (error) {
      const description = (req.query.error_description as string) || '';
      res.status(400).send(`Spotify authorization failed: ${error}${description ? ` - ${description}` : ''}`);
      return;
    }
    const code = (req.query.code as string) || '';
    if (!code) {
      res.status(400).send('Missing code');
      return;
    }
    try {
      const state = (req.query.state as string) || '';
      const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('spotify_state='));
      const stored = cookie ? cookie.split('=')[1] : '';
      if (stored && state && stored !== state) {
        res.status(400).send('Invalid state');
        return;
      }
    } catch {}
    await exchangeSpotifyCode(config, code);
    res.send('Spotify authentication successful. You can close this window.');
  }));
  app.get('/auth/spotify/status', asyncHandler(async (_req, res) => {
    const tokens = await loadSpotifyTokens(config);
    if (!tokens?.access_token) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      scope: tokens.scope,
      expiry_date: tokens.expiry_date,
      has_refresh_token: Boolean(tokens.refresh_token || config.SPOTIFY_REFRESH_TOKEN),
      token_source: tokens.source || 'file',
      has_client: Boolean(config.SPOTIFY_CLIENT_ID && config.SPOTIFY_CLIENT_SECRET),
    });
  }));

  // Kraken status: report env presence and auth check
  app.get('/auth/kraken/status', asyncHandler(async (_req, res) => {
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
  }));

  // Kasa status: report creds and device count
  app.get('/auth/kasa/status', asyncHandler(async (_req, res) => {
    const hasUser = Boolean(config.KASA_USERNAME);
    const hasPass = Boolean(config.KASA_PASSWORD);
    let devices: any[] | undefined;
    let error: string | undefined;
    if (hasUser && hasPass) {
      try {
        const { getKasaClient } = await import('./utils/kasa.js');
        const kasa = getKasaClient(config);
        devices = await kasa.getDeviceList();
      } catch (e: any) {
        error = e?.message || String(e);
      }
    }
    res.json({ hasUser, hasPass, deviceCount: devices?.length, devices: devices?.map(d => ({ id: d.deviceId, alias: d.alias, model: d.deviceModel }))?.slice(0, 20), ...(error ? { error } : {}) });
  }));

  // GitHub status: token presence + viewer + rate limit
  app.get('/auth/github/status', asyncHandler(async (_req, res) => {
    const { GITHUB_TOKEN } = config;
    if (!GITHUB_TOKEN) {
      res.json({ authenticated: false });
      return;
    }
    try {
      const { getRateStatus } = await import('./utils/github.js');
      const data = await getRateStatus(GITHUB_TOKEN);
      res.json({ authenticated: true, login: data.viewer?.login, rateLimit: data.rateLimit });
    } catch (e: any) {
      res.json({ authenticated: false, error: e?.message || String(e) });
    }
  }));

  // Stripe status: token presence + account details
  app.get('/auth/stripe/status', asyncHandler(async (_req, res) => {
    const { STRIPE_API_KEY, STRIPE_ACCOUNT } = config;
    if (!STRIPE_API_KEY) {
      res.json({ authenticated: false });
      return;
    }
    try {
      const { getAccountStatus } = await import('./utils/stripe.js');
      const acct = await getAccountStatus(STRIPE_API_KEY, STRIPE_ACCOUNT);
      res.json({ authenticated: true, account: { id: acct.id, email: acct.email, default_currency: acct.default_currency } });
    } catch (e: any) {
      res.json({ authenticated: false, error: e?.message || String(e) });
    }
  }));

  // MCP server
  const mcp = new McpServer({
    name: 'kota-gateway',
    version: '1.0.0',
  }, {
    instructions: [
      'KOTA MCP Gateway usage:',
      '- Prefer typed tools when available (e.g., rize_time_entries, whoop_get_recovery).',
      '- Rize handler exposes curated queries like rize_current_user, rize_recent_projects, rize_recent_tasks, and rize_time_entries.',
      '- WHOOP v2 endpoints are paginated. Use limit/start/end and control page size via max_pages/max_items.',
      '- Google: authorize via /auth/google/start; WHOOP: /auth/whoop/start; status routes available under /auth/*/status.',
      '- Bundles load automatically; call toolkit_list_bundles for a quick inventory when planning tool usage.',
    ].join('\n')
  });

  // Create transport for Streamable HTTP
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless by default
    enableJsonResponse: true,
  });

  const registry = new BundleRegistry({ logger, mcp });
  const make = (HandlerCtor: any, extra: Record<string, unknown> = {}) => () =>
    new HandlerCtor({ logger, config, ...extra });

  const toolkitApi: ToolkitApi = {
    listBundles: () => registry.listBundles(),
    enableBundle: (bundle: string) => registry.enableBundle(bundle),
  };

  const bundleDefinitions: BundleDefinition[] = [
    {
      key: 'toolkit',
      description: 'Enable optional handler bundles',
      autoEnable: true,
      factory: make(ToolkitHandler, { toolkit: toolkitApi }),
      tags: ['core'],
    },
    {
      key: 'gmail',
      description: 'Gmail message, draft, and send actions',
      autoEnable: true,
      factory: make(GmailHandler),
      tags: ['core', 'google'],
    },
    {
      key: 'calendar',
      description: 'Google Calendar event helpers',
      autoEnable: true,
      factory: make(CalendarHandler),
      tags: ['core', 'google'],
    },
    {
      key: 'memory',
      description: 'Persistent memory storage and retrieval',
      autoEnable: true,
      factory: make(MemoryHandler),
      tags: ['core'],
    },
    {
      key: 'daily',
      description: 'Holistic daily logging tools',
      autoEnable: true,
      factory: make(DailyHandler),
      tags: ['core', 'health'],
    },
    {
      key: 'context_snapshot',
      description: 'Context snapshots aggregated from the iOS shortcut webhook',
      autoEnable: true,
      factory: make(ContextSnapshotHandler),
      tags: ['core', 'automation'],
    },
    {
      key: 'kwc',
      description: 'Kendama World Cup lineup and run tracking',
      autoEnable: true,
      factory: make(KwcHandler),
      tags: ['optional', 'training'],
    },
    {
      key: 'content_calendar',
      description: 'Editorial and campaign planning tools',
      autoEnable: true,
      factory: make(ContentCalendarHandler),
      tags: ['core', 'planning'],
    },
    {
      key: 'whoop',
      description: 'WHOOP v2 recovery, sleep, and workout data',
      autoEnable: true,
      factory: make(WhoopHandler),
      tags: ['optional', 'health'],
    },
    {
      key: 'kasa',
      description: 'TP-Link Kasa smart device controls',
      autoEnable: true,
      factory: make(KasaHandler),
      tags: ['optional', 'iot'],
    },
    {
      key: 'kraken',
      description: 'Kraken crypto tickers and balances',
      autoEnable: true,
      factory: make(KrakenHandler),
      tags: ['optional', 'finance'],
    },
    {
      key: 'rize',
      description: 'Rize project, task, and time entries',
      autoEnable: true,
      factory: make(RizeHandler),
      tags: ['optional', 'productivity'],
    },
    {
      key: 'slack',
      description: 'Slack channel discovery and messaging',
      autoEnable: true,
      factory: make(SlackHandler),
      tags: ['optional', 'communication'],
    },
    {
      key: 'spotify',
      description: 'Spotify playback and library insights',
      autoEnable: true,
      factory: make(SpotifyHandler),
      tags: ['optional', 'media'],
    },
    {
      key: 'github',
      description: 'GitHub activity summaries',
      autoEnable: true,
      factory: make(GitHubHandler),
      tags: ['optional', 'engineering'],
    },
    {
      key: 'stripe',
      description: 'Stripe account activity summaries',
      autoEnable: true,
      factory: make(StripeHandler),
      tags: ['optional', 'finance'],
    },
    {
      key: 'workspace',
      description: 'Workspace map and knowledge explorer',
      autoEnable: true,
      factory: make(WorkspaceHandler),
      tags: ['optional', 'knowledge'],
    },
    {
      key: 'webhooks',
      description: 'Webhook inspection and aggregation tools',
      autoEnable: true,
      factory: make(WebhooksHandler),
      tags: ['optional', 'integration'],
    },
  ];

  for (const def of bundleDefinitions) {
    registry.addBundle(def);
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
      '- Use typed tools when available (e.g., rize_time_entries, whoop_get_recovery).',
      '- Rize tools run curated queries: rize_current_user, rize_recent_projects, rize_recent_tasks, rize_time_entries.',
      '- WHOOP: paginate with { limit, start, end, all, max_pages, max_items } to manage sizes.',
      '- Auth routes: /auth/google/start, /auth/whoop/start, and /auth/*/status.',
      '',
      'Help URIs:',
      '- help://rize/usage',
      '- help://whoop/usage',
      '- help://kraken/usage',
      '- help://google/usage',
      '- help://github/usage',
      '- help://daily/usage (aliases: help://nutrition/usage, help://vitals/usage)',
      '- help://memory/usage',
      '- help://spotify/usage',
      '- help://kwc/usage',
      '- help://workspace/usage',
    ].join('\n')
  );

  registerHelpResource(
    'rize_help_usage',
    'help://rize/usage',
    [
      'Rize Help',
      '',
      'Typed tools:',
      '- rize_current_user {}',
      '- rize_recent_projects { first?: number }',
      '- rize_recent_tasks { first?: number }',
      '- rize_time_entries { startTime, endTime, client_name?, limit? }',
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

  const dailyHelpText = [
    'Daily Log Help',
    '',
    'Primary tools:',
    '- daily_log_day { date, entries, summary?, notes?, totals?, rawText?, metadata?, timezone? }',
    '- daily_append_entries { date, entries, summary?, notes?, totals?, rawText?, metadata?, timezone? }',
    '- daily_get_day { date }',
    '- daily_list_days {}',
    '- daily_delete_day { date }',
    '',
    'Aliases (same input schema):',
    '- nutrition_log_day / nutrition_append_entries / ...',
    '- vitals_log_day / vitals_append_entries / ...',
    '',
    'Notes:',
    '- Entries can represent food, drink, supplements, substances, activities, training sessions, and free-form notes.',
    '- Provide structured metrics when available (e.g., duration_minutes, metrics.heart_rate_avg, macros.calories).',
    '- Use list_days before/after logging to confirm persisted changes.',
  ].join('\n');

  registerHelpResource('daily_help_usage', 'help://daily/usage', dailyHelpText);
  registerHelpResource('nutrition_help_usage', 'help://nutrition/usage', dailyHelpText);
  registerHelpResource('vitals_help_usage', 'help://vitals/usage', dailyHelpText);

  const kwcHelpText = [
    'Kendama Run Logger Help',
    '',
    'Tools:',
    '- kwc_get_lineup {}',
    '- kwc_set_lineup { tricks }',
    '- kwc_list_runs { date?, limit? }',
    '- kwc_add_run { date, tricks, notes? }',
    '- kwc_delete_run { recorded_at }',
    '- kwc_get_trick_stats { trick_code, days? }',
    '- kwc_get_run_stats { days?, top? }',
    '- kwc_get_trend { trick_code?, days?, window? }',
    '',
    'Notes:',
    '- Trick scores auto-derive from the trick level (e.g., 9-1 = 9 points).',
    '- Each run expects exactly the tricks you are tracking; include attempt durations for every trick.',
    '- Use list_runs with a date filter to pull all attempts for a competition day.',
    '- Analytics helpers surface medians, IQR, and rolling trends to gauge consistency over time.',
  ].join('\n');

  registerHelpResource('kwc_help_usage', 'help://kwc/usage', kwcHelpText);

  registerHelpResource(
    'workspace_help_usage',
    'help://workspace/usage',
    [
      'Workspace Handler Help',
      '',
      'Tools:',
      '- workspace_map { path?, search?, max_depth?, limit?, include_snippets?, context?, mode?, exclude?, time_format? }',
      '',
      'Tips:',
      '- `path` scopes the map to a subdirectory inside DATA_DIR.',
      '- `search` filters by names, tags, topics, KOTA versions, and cross-references.',
      '- Default call returns a compact stats digest; switch to `mode: "explore"` for tree view.',
      '- `context: "summary"` keeps explore results lean; use `"detailed"` for full metadata.',
      '- Use `exclude` to drop noisy folders (e.g., `node_modules`) and `time_format` for relative timestamps.',
      '- Snippets are only included when `context` is `"detailed"` and `include_snippets` is true.',
    ].join('\n')
  );

  registerHelpResource(
    'github_help_usage',
    'help://github/usage',
    [
      'GitHub Help',
      '',
      'Auth/status:',
      '- Set GITHUB_TOKEN in .env; optional GITHUB_USERNAME to target a user.',
      '- GET /auth/github/status → { authenticated, login, rateLimit }',
      '',
      'Tools:',
      '- github_activity_summary { start?, end?, detail?: "numbers"|"titles"|"full", username?, max_items? }',
      '',
      'Notes:',
      '- Uses GitHub GraphQL contributions; commit messages are not listed. PRs/issues and mentions are included.',
    ].join('\n')
  );

  registerHelpResource(
    'memory_help_usage',
    'help://memory/usage',
    [
      'KOTA Memory Help',
      '',
      'Tools:',
      '- memory_set { key, value, category? }',
      '- memory_get { query }',
      '- memory_update { key, addition }',
      '- memory_list {}',
      '- memory_list_archived {}',
      '- memory_delete { key }',
      '- memory_clear_state {}',
      '',
      'Notes:',
      '- Data stored under data/kota_memory with metadata.json for auditability.',
      '- Entries unused for 90 days are archived (not deleted) and still searchable.',
      '- Entries respect 500B per entry / 50KB total limits; clear_state archives the current state snapshot.',
    ].join('\n')
  );

  registerHelpResource(
    'spotify_help_usage',
    'help://spotify/usage',
    [
      'Spotify Help',
      '',
      'Auth:',
      '- /auth/spotify/start → connect account (requires SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET).',
      '- /auth/spotify/status → token scope and expiry info.',
      '',
      'Tools:',
      '- spotify_get_current {}',
      '- spotify_recent_tracks { limit?, after?, before? }',
      '- spotify_top_items { type?, time_range?, limit?, offset? }',
      '- spotify_search { query, type?, limit?, offset?, market? }',
      '- spotify_audio_features { track_ids }',
      '',
      'Notes:',
      '- recent_tracks.after/before accept epoch ms or ISO timestamps.',
      '- audio_features.track_ids accepts arrays or comma-separated lists (max 100).',
    ].join('\n')
  );

  registerHelpResource(
    'stripe_help_usage',
    'help://stripe/usage',
    [
      'Stripe Help',
      '',
      'Auth/status:',
      '- Set STRIPE_API_KEY in .env (sk_live_ or sk_test_).',
      '- Optional STRIPE_ACCOUNT for Connect (acct_...).',
      '- GET /auth/stripe/status → { authenticated, account }',
      '',
      'Tools:',
      '- stripe_activity_summary { start?, end?, currency?, detail?: "numbers"|"full", max_pages?, max_items? }',
      '',
      'Notes:',
      '- Aggregates charges, refunds, payouts, disputes, customers, subscriptions.',
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
          '- rize_current_user {}',
          '- rize_recent_projects { "first": 5 }',
          '- rize_recent_tasks { "first": 5 }',
          '- rize_time_entries { "startTime": "2025-09-01T00:00:00Z", "endTime": "2025-09-15T23:59:59Z", "client_name": "Acme" }',
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

  mcp.prompt('github.examples', 'Examples for GitHub activity', async () => ({
    description: 'GitHub activity summary examples',
    messages: [
      { role: 'assistant', content: { type: 'text', text: 'github_activity_summary { "detail": "numbers" }' } },
      { role: 'assistant', content: { type: 'text', text: 'github_activity_summary { "start": "2025-09-01", "end": "2025-09-15", "detail": "titles", "max_items": 10 }' } },
    ],
  }));

  mcp.prompt('stripe.examples', 'Examples for Stripe activity', async () => ({
    description: 'Stripe activity summary examples',
    messages: [
      { role: 'assistant', content: { type: 'text', text: 'stripe_activity_summary { "detail": "numbers" }' } },
      { role: 'assistant', content: { type: 'text', text: 'stripe_activity_summary { "start": "2025-09-01", "end": "2025-09-15", "detail": "full" }' } },
    ],
  }));

  mcp.prompt('spotify.examples', 'Examples for Spotify tools', async () => ({
    description: 'Spotify quick examples',
    messages: [
      { role: 'assistant', content: { type: 'text', text: 'spotify_get_current {}' } },
      { role: 'assistant', content: { type: 'text', text: 'spotify_recent_tracks { "limit": 10 }' } },
      { role: 'assistant', content: { type: 'text', text: 'spotify_top_items { "type": "tracks", "time_range": "long_term", "limit": 5 }' } },
    ],
  }));

  mcp.prompt('kwc.examples', 'Examples for Kendama run logging', async () => ({
    description: 'KWC lineup and run logging examples',
    messages: [
      { role: 'assistant', content: { type: 'text', text: 'kwc_get_lineup {}' } },
      { role: 'assistant', content: { type: 'text', text: 'kwc_set_lineup { "tricks": [{ "code": "9-1" }, { "code": "9-5" }, { "code": "8-4" }] }' } },
      { role: 'assistant', content: { type: 'text', text: 'kwc_add_run { "date": "2025-10-02", "tricks": [{ "code": "9-1", "attempts": [{ "durationSeconds": 42 }] }, { "code": "9-5", "attempts": [{ "durationSeconds": 55 }] }] }' } },
      { role: 'assistant', content: { type: 'text', text: 'kwc_list_runs { "date": "2025-10-02" }' } },
      { role: 'assistant', content: { type: 'text', text: 'kwc_get_trick_stats { "trick_code": "9-1", "days": 30 }' } },
      { role: 'assistant', content: { type: 'text', text: 'kwc_get_run_stats { "days": 14 }' } },
      { role: 'assistant', content: { type: 'text', text: 'kwc_get_trend { "trick_code": "8-4", "days": 60 }' } },
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
