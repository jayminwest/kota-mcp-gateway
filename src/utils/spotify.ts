import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { URLSearchParams } from 'node:url';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

const REQUIRED_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-read-recently-played',
  'user-top-read',
  'user-read-private',
];

export interface SpotifyTokens {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in?: number;
  expiry_date?: number;
  refresh_token?: string;
  source?: 'env' | 'file';
}

function tokensPath(config: AppConfig) {
  const dir = path.resolve(config.DATA_DIR, 'spotify');
  return { dir, file: path.join(dir, 'tokens.json') };
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

export function getSpotifyTokensFromEnv(config: AppConfig): SpotifyTokens | null {
  const accessToken = config.SPOTIFY_ACCESS_TOKEN;
  if (!accessToken) return null;
  const tokens: SpotifyTokens = {
    access_token: accessToken,
    token_type: 'Bearer',
    refresh_token: config.SPOTIFY_REFRESH_TOKEN || undefined,
    expiry_date: config.SPOTIFY_TOKEN_EXPIRES_AT || undefined,
    scope: undefined,
    source: 'env',
  };
  return tokens;
}

export async function loadSpotifyTokens(config: AppConfig): Promise<SpotifyTokens | null> {
  const envTokens = getSpotifyTokensFromEnv(config);
  if (envTokens) return envTokens;
  const { file } = tokensPath(config);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw) as SpotifyTokens;
    return { ...data, source: 'file' };
  } catch {
    return null;
  }
}

export async function saveSpotifyTokens(config: AppConfig, tokens: SpotifyTokens) {
  const envTokens = getSpotifyTokensFromEnv(config);
  if (envTokens?.source === 'env') {
    // When env tokens are supplied we avoid persisting to disk to respect the source of truth.
    return;
  }
  const { dir, file } = tokensPath(config);
  await ensureDir(dir);
  const payload: SpotifyTokens = { ...tokens };
  delete payload.source;
  await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
}

export function getSpotifyRedirectUri(config: AppConfig) {
  return config.SPOTIFY_REDIRECT_URI || `http://localhost:${config.PORT}/auth/spotify/callback`;
}

export function generateSpotifyState(): string {
  return randomBytes(16).toString('hex');
}

export function getSpotifyAuthUrl(config: AppConfig, state?: string) {
  const clientId = config.SPOTIFY_CLIENT_ID;
  if (!clientId) throw new Error('Missing SPOTIFY_CLIENT_ID');
  const redirectUri = getSpotifyRedirectUri(config);
  const url = new URL(AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', REQUIRED_SCOPES.join(' '));
  if (state) {
    url.searchParams.set('state', state);
  }
  url.searchParams.set('show_dialog', 'true');
  return url.toString();
}

async function tokenRequest(config: AppConfig, body: URLSearchParams): Promise<SpotifyTokens> {
  const clientId = config.SPOTIFY_CLIENT_ID;
  const clientSecret = config.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET');
  }
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
  };
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  const json = await res.json().catch(async () => {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify token error: ${res.status} ${res.statusText} ${text}`);
  });
  if (!res.ok) {
    const message = (json && json.error_description) || json?.error || `${res.status} ${res.statusText}`;
    throw new Error(`Spotify token error: ${message}`);
  }
  const tokens: SpotifyTokens = {
    access_token: json.access_token,
    token_type: json.token_type,
    scope: json.scope,
    expires_in: json.expires_in,
    refresh_token: json.refresh_token,
    expiry_date: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    source: 'file',
  };
  return tokens;
}

export async function exchangeSpotifyCode(config: AppConfig, code: string): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getSpotifyRedirectUri(config),
  });
  const tokens = await tokenRequest(config, body);
  await saveSpotifyTokens(config, tokens);
  return tokens;
}

export async function refreshSpotifyToken(config: AppConfig, refreshToken: string): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const tokens = await tokenRequest(config, body);
  if (!tokens.refresh_token) {
    tokens.refresh_token = refreshToken;
  }
  await saveSpotifyTokens(config, tokens);
  return tokens;
}

async function forceRefreshAccessToken(config: AppConfig): Promise<string> {
  const existing = await loadSpotifyTokens(config);
  const refreshToken = existing?.refresh_token || config.SPOTIFY_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('Spotify refresh token unavailable. Re-authenticate via /auth/spotify/start.');
  }
  const refreshed = await refreshSpotifyToken(config, refreshToken);
  return refreshed.access_token;
}

async function ensureAccessToken(config: AppConfig): Promise<string> {
  if (config.SPOTIFY_ACCESS_TOKEN) {
    return config.SPOTIFY_ACCESS_TOKEN;
  }
  const tokens = await loadSpotifyTokens(config);
  if (!tokens?.access_token) {
    throw new Error('Spotify not authenticated. Visit /auth/spotify/start to connect.');
  }
  const margin = 60_000;
  if (!tokens.expiry_date || tokens.expiry_date - margin > Date.now()) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token && !config.SPOTIFY_REFRESH_TOKEN) {
    throw new Error('Spotify access token expired and no refresh token is available. Re-authenticate via /auth/spotify/start.');
  }
  const refreshed = await refreshSpotifyToken(config, tokens.refresh_token || config.SPOTIFY_REFRESH_TOKEN!);
  return refreshed.access_token;
}

interface RequestOptions {
  query?: Record<string, any>;
  init?: RequestInit;
}

export class SpotifyClient {
  constructor(private readonly config: AppConfig, private readonly opts: { logger?: Logger } = {}) {}

  private async doFetch(token: string, url: string, init?: RequestInit) {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(init?.headers || {}),
      },
    });
    return res;
  }

  private buildUrl(pathname: string, query?: Record<string, any>): string {
    const url = new URL(pathname.startsWith('http') ? pathname : `${API_BASE}${pathname}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          if (value.length === 0) continue;
          url.searchParams.set(key, value.join(','));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async requestRaw(pathname: string, options: RequestOptions = {}): Promise<Response> {
    const url = this.buildUrl(pathname, options.query);
    let token = await ensureAccessToken(this.config);
    let res = await this.doFetch(token, url, options.init);
    if (res.status === 401) {
      try {
        token = await forceRefreshAccessToken(this.config);
        res = await this.doFetch(token, url, options.init);
      } catch (err) {
        const text = await res.text().catch(() => '');
        this.opts.logger?.error({ err, text, url }, 'Spotify refresh error');
        throw new Error(`Spotify 401 Unauthorized: ${text || (err as Error).message}`);
      }
    }
    return res;
  }

  async request<T>(pathname: string, options: RequestOptions = {}): Promise<T | null> {
    const res = await this.requestRaw(pathname, options);
    if (!res.ok) {
      if (res.status === 204) return null;
      const text = await res.text().catch(() => '');
      throw new Error(`Spotify ${res.status} ${res.statusText}: ${text}`);
    }
    if (res.status === 204) return null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json() as Promise<T>;
    }
    const text = await res.text();
    return text as unknown as T;
  }

  async getCurrentlyPlaying() {
    // The API returns 204 when nothing is playing.
    return this.request<any>('/me/player/currently-playing');
  }

  async getRecentTracks(params: { limit?: number; after?: number; before?: number }) {
    return this.request<any>('/me/player/recently-played', {
      query: {
        limit: params.limit,
        after: params.after,
        before: params.before,
      },
    });
  }

  async getTopItems(params: { type: 'tracks' | 'artists'; time_range?: string; limit?: number; offset?: number }) {
    return this.request<any>(`/me/top/${params.type}`, {
      query: {
        time_range: params.time_range,
        limit: params.limit,
        offset: params.offset,
      },
    });
  }

  async search(params: { query: string; types: string[]; limit?: number; offset?: number; market?: string }) {
    return this.request<any>('/search', {
      query: {
        q: params.query,
        type: params.types.join(','),
        limit: params.limit,
        offset: params.offset,
        market: params.market,
      },
    });
  }

  async getAudioFeatures(ids: string[]) {
    if (ids.length === 1) {
      return this.request<any>(`/audio-features/${ids[0]}`);
    }
    return this.request<any>('/audio-features', { query: { ids: ids.join(',') } });
  }

  async getAudioFeature(id: string) {
    return this.request<any>(`/audio-features/${id}`);
  }
}
