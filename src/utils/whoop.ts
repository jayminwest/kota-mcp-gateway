import { URLSearchParams } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';

// WHOOP v2 base per OpenAPI servers: https://api.prod.whoop.com/developer
const BASE_URL = 'https://api.prod.whoop.com/developer';
const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

export type WhoopTokens = {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in?: number;
  expiry_date?: number; // ms since epoch
  refresh_token?: string;
};

function tokensPath(config: AppConfig) {
  const dir = path.resolve(config.DATA_DIR, 'whoop');
  return { dir, file: path.join(dir, 'tokens.json') };
}

export async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

export async function loadWhoopTokens(config: AppConfig): Promise<WhoopTokens | null> {
  const { file } = tokensPath(config);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveWhoopTokens(config: AppConfig, tokens: WhoopTokens) {
  const { dir, file } = tokensPath(config);
  await ensureDir(dir);
  await fs.writeFile(file, JSON.stringify(tokens, null, 2), 'utf8');
}

export function getWhoopRedirectUri(config: AppConfig) {
  return config.WHOOP_REDIRECT_URI || 'http://localhost:3000/auth/whoop/callback';
}

export function getWhoopAuthUrl(config: AppConfig, state?: string) {
  const cid = config.WHOOP_CLIENT_ID;
  if (!cid) throw new Error('Missing WHOOP_CLIENT_ID');
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: cid,
    redirect_uri: getWhoopRedirectUri(config),
    scope: [
      'read:profile',
      'read:body_measurement',
      'read:recovery',
      'read:sleep',
      'read:workout',
      'read:cycles',
    ].join(' '),
  });
  if (state && state.length >= 8) qs.set('state', state);
  return `${AUTH_URL}?${qs.toString()}`;
}

async function basicAuthHeader(config: AppConfig) {
  const cid = config.WHOOP_CLIENT_ID;
  const cs = config.WHOOP_CLIENT_SECRET;
  if (!cid || !cs) throw new Error('Missing WHOOP_CLIENT_ID/WHOOP_CLIENT_SECRET');
  const b64 = Buffer.from(`${cid}:${cs}`).toString('base64');
  return `Basic ${b64}`;
}

async function tokenRequest(config: AppConfig, body: URLSearchParams, method: 'basic' | 'post'): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const cid = config.WHOOP_CLIENT_ID;
  const cs = config.WHOOP_CLIENT_SECRET;
  if (!cid || !cs) throw new Error('Missing WHOOP_CLIENT_ID/WHOOP_CLIENT_SECRET');
  const payload = new URLSearchParams(body);
  if (method === 'basic') {
    const b64 = Buffer.from(`${cid}:${cs}`).toString('base64');
    headers['Authorization'] = `Basic ${b64}`;
  } else {
    payload.set('client_id', cid);
    payload.set('client_secret', cs);
  }
  return fetch(TOKEN_URL, { method: 'POST', headers, body: payload.toString() } as any);
}

async function tokenRequestWithFallback(config: AppConfig, body: URLSearchParams): Promise<WhoopTokens> {
  const pref = (config.WHOOP_TOKEN_AUTH_METHOD as 'basic' | 'post' | undefined) || undefined;
  const order: ('basic' | 'post')[] = pref ? [pref] : ['basic', 'post'];
  let lastTxt = '';
  for (const method of order) {
    const res = await tokenRequest(config, body, method);
    if (res.ok) return (await res.json()) as WhoopTokens;
    const txt = await res.text().catch(() => '');
    lastTxt = txt;
    if (res.status === 401 && /invalid_client/i.test(txt)) continue;
    throw new Error(`${res.status} ${txt}`);
  }
  throw new Error(`401 ${lastTxt || 'invalid_client'}`);
}

export async function exchangeWhoopCode(config: AppConfig, code: string): Promise<WhoopTokens> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: getWhoopRedirectUri(config) });
  const tokens = await tokenRequestWithFallback(config, body);
  if (tokens.expires_in) tokens.expiry_date = Date.now() + tokens.expires_in * 1000;
  await saveWhoopTokens(config, tokens);
  return tokens;
}

export async function refreshWhoopToken(config: AppConfig, refresh_token: string): Promise<WhoopTokens> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token });
  const tokens = await tokenRequestWithFallback(config, body);
  if (tokens.expires_in) tokens.expiry_date = Date.now() + tokens.expires_in * 1000;
  const existing = await loadWhoopTokens(config);
  if (!tokens.refresh_token && existing?.refresh_token) tokens.refresh_token = existing.refresh_token;
  await saveWhoopTokens(config, tokens);
  return tokens;
}

async function ensureAccessToken(config: AppConfig): Promise<string> {
  // If raw API key is provided, use it
  if (config.WHOOP_API_KEY) return config.WHOOP_API_KEY;
  // Else use stored OAuth tokens
  const current = await loadWhoopTokens(config);
  if (!current?.access_token) throw new Error('WHOOP not authenticated. Visit /auth/whoop/start');
  const margin = 60_000; // 60s margin
  if (current.expiry_date && current.expiry_date - margin > Date.now()) {
    return current.access_token;
  }
  if (!current.refresh_token) return current.access_token; // try anyway
  const refreshed = await refreshWhoopToken(config, current.refresh_token);
  return refreshed.access_token;
}

export class WhoopClient {
  constructor(private config: AppConfig) {}

  private async authHeader() {
    const token = await ensureAccessToken(this.config);
    return { 'Authorization': `Bearer ${token}` };
  }

  async request(path: string, query?: Record<string, any>, init?: RequestInit): Promise<any> {
    const qs = new URLSearchParams();
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        qs.set(k, String(v));
      }
    }
    const u = `${BASE_URL}${path}${qs.toString() ? `?${qs}` : ''}`;
    const headers = {
      'Accept': 'application/json',
      ...(await this.authHeader()),
      ...(init?.headers || {}),
    } as any;
    const res = await fetch(u, { method: init?.method || 'GET', headers, ...init } as any);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`WHOOP ${res.status} ${res.statusText}: ${txt}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async paginate(path: string, params: { start?: string; end?: string; limit?: number; nextToken?: string; all?: boolean; maxPages?: number; maxItems?: number }) {
    const limit = params.limit ?? 10;
    const maxPages = params.maxPages ?? 10;
    const maxItems = params.maxItems ?? 50;
    const out: any[] = [];
    let nextToken = params.nextToken;
    let pages = 0;
    do {
      const q: any = { limit, start: params.start, end: params.end, nextToken };
      const data = await this.request(path, q);
      const items = data?.records || data?.sleep || data?.workouts || data?.cycles || data?.recoveries || [];
      if (Array.isArray(items)) {
        for (const it of items) {
          if (out.length >= maxItems) break;
          out.push(it);
        }
      }
      nextToken = data?.next_token || data?.nextToken || null;
      pages++;
      if (out.length >= maxItems) break;
    } while (params.all && nextToken && pages < maxPages);
    return { items: out, nextToken };
  }

  // Specific endpoints (WHOOP v2)
  getProfileBasic() { return this.request('/v2/user/profile/basic'); }
  getBodyMeasurement() { return this.request('/v2/user/measurement/body'); }
  getRecoveries(p: any) { return this.paginate('/v2/recovery', p); }
  getSleeps(p: any) { return this.paginate('/v2/activity/sleep', p); }
  getWorkouts(p: any) { return this.paginate('/v2/activity/workout', p); }
  getCycles(p: any) { return this.paginate('/v2/cycle', p); }

  // By-ID and cycle subresources
  getSleepById(sleepId: string) { return this.request(`/v2/activity/sleep/${encodeURIComponent(sleepId)}`); }
  getWorkoutById(workoutId: string) { return this.request(`/v2/activity/workout/${encodeURIComponent(workoutId)}`); }
  getCycleById(cycleId: number) { return this.request(`/v2/cycle/${cycleId}`); }
  getCycleRecovery(cycleId: number) { return this.request(`/v2/cycle/${cycleId}/recovery`); }
  getCycleSleep(cycleId: number) { return this.request(`/v2/cycle/${cycleId}/sleep`); }
}
