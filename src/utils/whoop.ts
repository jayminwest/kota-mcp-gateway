import { URLSearchParams } from 'node:url';
import type { AppConfig } from './config.js';

const BASE_URL = 'https://api.prod.whoop.com';

export class WhoopClient {
  private token: string;

  constructor(private config: AppConfig) {
    const t = config.WHOOP_API_KEY;
    if (!t) throw new Error('Missing WHOOP_API_KEY');
    this.token = t;
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
    const res = await fetch(u, {
      method: init?.method || 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/json',
      },
      ...init,
    } as any);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`WHOOP ${res.status} ${res.statusText}: ${txt}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async paginate(path: string, params: { start?: string; end?: string; limit?: number; nextToken?: string; all?: boolean }) {
    const limit = params.limit ?? 10;
    const out: any[] = [];
    let nextToken = params.nextToken;
    let count = 0;
    do {
      const q: any = { limit, start: params.start, end: params.end, nextToken };
      const data = await this.request(path, q);
      const items = data?.records || data?.sleep || data?.workouts || data?.cycles || data?.recoveries || data?.records || [];
      if (Array.isArray(items)) out.push(...items);
      nextToken = data?.next_token || data?.nextToken || null;
      count++;
    } while (params.all && nextToken && count < 100);
    return { items: out, nextToken };
  }

  // Specific endpoints
  getProfileBasic() { return this.request('/v2/user/profile/basic'); }
  getBodyMeasurement() { return this.request('/v2/user/measurement/body'); }
  getRecoveries(p: any) { return this.paginate('/v2/recovery', p); }
  getSleeps(p: any) { return this.paginate('/v2/activity/sleep', p); }
  getWorkouts(p: any) { return this.paginate('/v2/activity/workout', p); }
  getCycles(p: any) { return this.paginate('/v2/cycle', p); }
  revokeAccess() { return this.request('/v2/user/access', undefined, { method: 'DELETE' } as any); }
}

