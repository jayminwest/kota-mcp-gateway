import { google } from 'googleapis';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger.js';
import type { AppConfig } from './config.js';

export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar',
];

function tokensPath(config: AppConfig) {
  const dir = path.resolve(config.DATA_DIR, 'google');
  return { dir, file: path.join(dir, 'tokens.json') };
}

export async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

export async function loadTokens(config: AppConfig): Promise<any | null> {
  const { file } = tokensPath(config);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveTokens(config: AppConfig, tokens: any) {
  const { dir, file } = tokensPath(config);
  await ensureDir(dir);
  await fs.writeFile(file, JSON.stringify(tokens, null, 2), 'utf8');
}

export function getRedirectUri(config: AppConfig) {
  return config.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
}

export async function getOAuth2Client(config: AppConfig, logger: Logger) {
  const clientId = config.GOOGLE_CLIENT_ID;
  const clientSecret = config.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET');
  }
  const redirectUri = getRedirectUri(config);
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const tokens = await loadTokens(config);
  if (tokens) {
    oauth2Client.setCredentials(tokens);
  }
  oauth2Client.on('tokens', async (t) => {
    const merged = { ...(await loadTokens(config)), ...t };
    await saveTokens(config, merged);
    logger.info('Google tokens updated');
  });
  return oauth2Client;
}

export async function getAuthUrl(config: AppConfig): Promise<string> {
  const oauth2 = await getOAuth2Client(config, console as any);
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function handleOAuthCallback(config: AppConfig, code: string, logger: Logger) {
  const oauth2 = await getOAuth2Client(config, logger);
  const { tokens } = await oauth2.getToken(code);
  await saveTokens(config, tokens);
  oauth2.setCredentials(tokens);
  return tokens;
}

export async function getGmail(config: AppConfig, logger: Logger) {
  const auth = await getOAuth2Client(config, logger);
  const tokens = await loadTokens(config);
  if (!tokens) return { gmail: null, reason: 'not_authenticated' as const };
  const gmail = google.gmail({ version: 'v1', auth });
  return { gmail };
}

export async function getCalendar(config: AppConfig, logger: Logger) {
  const auth = await getOAuth2Client(config, logger);
  const tokens = await loadTokens(config);
  if (!tokens) return { calendar: null, reason: 'not_authenticated' as const };
  const calendar = google.calendar({ version: 'v3', auth });
  return { calendar };
}

