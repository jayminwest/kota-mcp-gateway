import { createHmac, createHash } from 'node:crypto';
import { URLSearchParams } from 'node:url';
import type { AppConfig } from './config.js';

const BASE = 'https://api.kraken.com';

function b64decode(input: string): Buffer {
  return Buffer.from(input, 'base64');
}

function sign(path: string, params: Record<string, any>, secretB64: string): string {
  const secret = b64decode(secretB64);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.append(k, String(v));
  }
  const nonce = String(Date.now());
  body.set('nonce', nonce);
  const postData = body.toString();
  const sha256 = createHash('sha256').update(nonce + postData).digest();
  const hmac = createHmac('sha512', secret).update(Buffer.concat([Buffer.from(path), sha256])).digest('base64');
  return hmac;
}

export class KrakenClient {
  private key?: string;
  private secret?: string;

  constructor(private config: AppConfig) {
    this.key = config.KRAKEN_API_KEY;
    this.secret = config.KRAKEN_API_SECRET;
  }

  async public(endpoint: string, params?: Record<string, any>) {
    const qs = new URLSearchParams();
    if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.append(k, String(v));
    const url = `${BASE}/0/public/${endpoint}${qs.toString() ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Kraken public ${endpoint} failed: ${res.status}`);
    return res.json();
  }

  async private(endpoint: string, params?: Record<string, any>) {
    if (!this.key || !this.secret) throw new Error('Missing KRAKEN_API_KEY/KRAKEN_API_SECRET');
    const path = `/0/private/${endpoint}`;
    const headers: Record<string, string> = {
      'API-Key': this.key,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    };
    // Signature uses nonce + post body
    const bodyParams: Record<string, any> = { ...(params || {}) };
    const sig = sign(path, bodyParams, this.secret);
    headers['API-Sign'] = sig;
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(bodyParams)) if (v !== undefined && v !== null) body.append(k, String(v));
    // nonce added inside sign(), ensure same nonce in body
    if (!body.has('nonce')) body.set('nonce', String(Date.now()));

    const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: body.toString() } as any);
    if (!res.ok) throw new Error(`Kraken private ${endpoint} failed: ${res.status}`);
    const data = await res.json();
    if (data.error && data.error.length) {
      throw new Error(`Kraken error: ${data.error.join(', ')}`);
    }
    return data;
  }

  // Convenience
  getTicker(pair: string) { return this.public('Ticker', { pair }); }
  getBalance() { return this.private('Balance'); }
}

