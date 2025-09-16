import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';

const SLACK_OAUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';

export interface SlackAuthedUser {
  id: string;
  scope?: string;
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number;
}

export interface SlackTokenSet {
  access_token?: string; // bot token (unused for user-only apps)
  scope?: string;
  token_type?: string;
  team?: { id?: string; name?: string };
  authed_user?: SlackAuthedUser;
  installed_at: number;
}

function tokensPath(config: AppConfig) {
  const dir = path.resolve(config.DATA_DIR, 'slack');
  return { dir, file: path.join(dir, 'tokens.json') };
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

export async function loadSlackTokens(config: AppConfig): Promise<SlackTokenSet | null> {
  const { file } = tokensPath(config);
  try {
    const content = await fs.readFile(file, 'utf8');
    return JSON.parse(content) as SlackTokenSet;
  } catch {
    return null;
  }
}

export async function saveSlackTokens(config: AppConfig, tokens: SlackTokenSet) {
  const { dir, file } = tokensPath(config);
  await ensureDir(dir);
  await fs.writeFile(file, JSON.stringify(tokens, null, 2), 'utf8');
}

export function getSlackRedirectUri(config: AppConfig) {
  return config.SLACK_REDIRECT_URI || `http://localhost:${config.PORT}/auth/slack/callback`;
}

const REQUIRED_USER_SCOPES = [
  'channels:history',
  'groups:history',
  'im:history',
  'mpim:history',
  'channels:read',
  'groups:read',
  'im:read',
  'mpim:read',
  'users:read',
];

export function generateSlackState() {
  return randomBytes(16).toString('hex');
}

export function getSlackAuthUrl(config: AppConfig, state: string) {
  const clientId = config.SLACK_CLIENT_ID;
  if (!clientId) throw new Error('Missing SLACK_CLIENT_ID');
  const redirectUri = getSlackRedirectUri(config);
  const url = new URL(SLACK_OAUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('state', state);
  url.searchParams.set('user_scope', REQUIRED_USER_SCOPES.join(','));
  url.searchParams.set('redirect_uri', redirectUri);
  return url.toString();
}

async function slackTokenRequest(body: URLSearchParams) {
  const res = await fetch(SLACK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json();
  if (!json.ok) {
    const message = json.error || 'unknown_error';
    throw new Error(`Slack OAuth error: ${message}`);
  }
  return json;
}

export async function exchangeSlackCode(config: AppConfig, code: string): Promise<SlackTokenSet> {
  const clientId = config.SLACK_CLIENT_ID;
  const clientSecret = config.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing SLACK_CLIENT_ID/SLACK_CLIENT_SECRET');
  }
  const redirectUri = getSlackRedirectUri(config);
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  const json = await slackTokenRequest(params);
  const tokens: SlackTokenSet = {
    access_token: json.access_token,
    scope: json.scope,
    token_type: json.token_type,
    team: json.team,
    authed_user: json.authed_user,
    installed_at: Date.now(),
  };
  if (tokens.authed_user?.expires_in) {
    tokens.authed_user.expires_at = Date.now() + tokens.authed_user.expires_in * 1000;
  }
  await saveSlackTokens(config, tokens);
  return tokens;
}

export async function refreshSlackToken(config: AppConfig, refreshToken: string): Promise<SlackTokenSet> {
  const clientId = config.SLACK_CLIENT_ID;
  const clientSecret = config.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing SLACK_CLIENT_ID/SLACK_CLIENT_SECRET');
  }
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const json = await slackTokenRequest(params);
  const stored = await loadSlackTokens(config);
  const tokens: SlackTokenSet = {
    access_token: json.access_token ?? stored?.access_token,
    scope: json.scope ?? stored?.scope,
    token_type: json.token_type ?? stored?.token_type,
    team: json.team ?? stored?.team,
    authed_user: json.authed_user ?? stored?.authed_user,
    installed_at: stored?.installed_at || Date.now(),
  };
  if (tokens.authed_user?.expires_in) {
    tokens.authed_user.expires_at = Date.now() + tokens.authed_user.expires_in * 1000;
  }
  await saveSlackTokens(config, tokens);
  return tokens;
}

export async function getSlackUserToken(config: AppConfig, logger: Logger) {
  const tokens = await loadSlackTokens(config);
  const authed = tokens?.authed_user;
  if (!authed?.access_token) {
    throw new Error('Slack not authenticated. Visit /auth/slack/start to connect.');
  }
  const margin = 60_000;
  if (authed.expires_at && authed.expires_at - margin <= Date.now()) {
    if (!authed.refresh_token) {
      logger.warn('Slack user token expired and no refresh token available. Re-authentication required.');
    } else {
      const refreshed = await refreshSlackToken(config, authed.refresh_token);
      if (!refreshed.authed_user?.access_token) {
        throw new Error('Failed to refresh Slack user token. Re-authenticate.');
      }
      logger.info('Slack user token refreshed');
      return refreshed.authed_user.access_token;
    }
  }
  return authed.access_token;
}

export async function getSlackStatus(config: AppConfig, logger: Logger) {
  try {
    const token = await getSlackUserToken(config, logger);
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    const json = await res.json();
    if (!json.ok) {
      return { authenticated: false, error: json.error };
    }
    return {
      authenticated: true,
      user_id: json.user_id,
      user: json.user,
      team: json.team,
      team_id: json.team_id,
    };
  } catch (err: any) {
    return { authenticated: false, error: err?.message || String(err) };
  }
}

export async function slackApi(token: string, method: string, payload?: Record<string, any>) {
  const url = `https://slack.com/api/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Slack API error (${method}): ${json.error || 'unknown_error'}`);
  }
  return json;
}
