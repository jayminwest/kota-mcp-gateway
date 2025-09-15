import { createHmac, createHash } from 'node:crypto';
import { URLSearchParams } from 'node:url';
import type { AppConfig } from './config.js';

const BASE = 'https://api.kraken.com';

function b64decode(input: string): Buffer {
  return Buffer.from(input, 'base64');
}

function krakenSign(path: string, nonce: string, postDataEncoded: string, secretB64: string): string {
  const secret = b64decode(secretB64);
  const sha256 = createHash('sha256').update(nonce + postDataEncoded).digest();
  return createHmac('sha512', secret).update(Buffer.concat([Buffer.from(path), sha256])).digest('base64');
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
    // Build body once with a fixed nonce, and sign that exact encoding
    const nonce = String(Date.now());
    const body = new URLSearchParams();
    body.append('nonce', nonce);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) body.append(k, String(v));
      }
    }
    const encoded = body.toString();
    headers['API-Sign'] = krakenSign(path, nonce, encoded, this.secret);

    const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: encoded } as any);
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
