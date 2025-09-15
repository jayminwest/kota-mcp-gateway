import type { AppConfig } from './config.js';

const STRIPE_API = 'https://api.stripe.com/v1';

export function assertStripeKey(config: AppConfig): string {
  const key = config.STRIPE_API_KEY || '';
  if (!key) throw new Error('Missing STRIPE_API_KEY in environment');
  return key;
}

type Params = Record<string, any>;


async function stripeGet<T = any>(key: string, path: string, search?: Params, account?: string): Promise<T> {
  const url = new URL(STRIPE_API + path);
  if (search) {
    for (const [k, v] of Object.entries(search)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'object' && !Array.isArray(v)) {
        for (const [ck, cv] of Object.entries(v)) url.searchParams.set(`${k}[${ck}]`, String(cv));
      } else if (Array.isArray(v)) {
        for (const val of v) url.searchParams.append(k, String(val));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (account) headers['Stripe-Account'] = account;
  const res = await fetch(url.toString(), { method: 'GET', headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Stripe error: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export interface Range {
  from: number; // unix seconds
  to: number;   // unix seconds
}

export function toUnixRange(start?: string, end?: string, fallbackDays = 7): Range {
  const now = new Date();
  const endDate = end ? new Date(end) : now;
  let startDate = start ? new Date(start) : new Date(now.getTime() - fallbackDays * 86400000);
  if (isNaN(startDate.getTime())) startDate = new Date(now.getTime() - fallbackDays * 86400000);
  const from = Math.floor(startDate.getTime() / 1000);
  const to = Math.floor(endDate.getTime() / 1000);
  return { from, to };
}

async function listAll<T = any>(key: string, path: string, params: Params, account?: string, cap = { maxPages: 10, maxItems: 1000 }): Promise<T[]> {
  let hasMore = true;
  let starting_after: string | undefined = undefined;
  const out: T[] = [];
  let pages = 0;
  while (hasMore && pages < cap.maxPages && out.length < cap.maxItems) {
    const page = await stripeGet<any>(key, path, { ...params, limit: 100, starting_after }, account);
    const data: T[] = page.data || [];
    out.push(...data);
    hasMore = Boolean(page.has_more);
    starting_after = data.length ? (data[data.length - 1] as any).id : undefined;
    pages += 1;
  }
  return out.slice(0, cap.maxItems);
}

export async function getAccountStatus(key: string, account?: string) {
  return stripeGet<any>(key, '/account', undefined, account);
}

export async function getChargesSummary(key: string, range: Range, currency?: string, account?: string, cap?: { maxPages: number; maxItems: number }) {
  const params: Params = { created: { gte: range.from, lte: range.to }, status: 'succeeded' };
  if (currency) params.currency = currency;
  const charges = await listAll<any>(key, '/charges', params, account, cap);
  const byCurrency: Record<string, { count: number; amount: number }> = {};
  for (const c of charges) {
    const cur = c.currency || 'usd';
    if (!byCurrency[cur]) byCurrency[cur] = { count: 0, amount: 0 };
    byCurrency[cur].count += 1;
    byCurrency[cur].amount += Number(c.amount || 0);
  }
  const totalCount = charges.length;
  const totalAmount = Object.values(byCurrency).reduce((a, b) => a + b.amount, 0);
  return { totalCount, totalAmount, byCurrency, samples: charges.slice(0, 10) };
}

export async function getRefundsSummary(key: string, range: Range, account?: string, cap?: { maxPages: number; maxItems: number }) {
  const refunds = await listAll<any>(key, '/refunds', { created: { gte: range.from, lte: range.to } }, account, cap);
  const byCurrency: Record<string, { count: number; amount: number }> = {};
  for (const r of refunds) {
    const cur = r.currency || 'usd';
    if (!byCurrency[cur]) byCurrency[cur] = { count: 0, amount: 0 };
    byCurrency[cur].count += 1;
    byCurrency[cur].amount += Number(r.amount || 0);
  }
  return { totalCount: refunds.length, totalAmount: Object.values(byCurrency).reduce((a, b) => a + b.amount, 0), byCurrency };
}

export async function getPayoutsSummary(key: string, range: Range, account?: string, cap?: { maxPages: number; maxItems: number }) {
  const payouts = await listAll<any>(key, '/payouts', { arrival_date: { gte: range.from, lte: range.to } }, account, cap);
  const byCurrency: Record<string, { count: number; amount: number }> = {};
  for (const p of payouts) {
    const cur = p.currency || 'usd';
    if (!byCurrency[cur]) byCurrency[cur] = { count: 0, amount: 0 };
    byCurrency[cur].count += 1;
    byCurrency[cur].amount += Number(p.amount || 0);
  }
  return { totalCount: payouts.length, totalAmount: Object.values(byCurrency).reduce((a, b) => a + b.amount, 0), byCurrency };
}

export async function getDisputesSummary(key: string, range: Range, account?: string, cap?: { maxPages: number; maxItems: number }) {
  const disputes = await listAll<any>(key, '/disputes', { created: { gte: range.from, lte: range.to } }, account, cap);
  const byStatus: Record<string, number> = {};
  for (const d of disputes) {
    const s = d.status || 'unknown';
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  return { totalCount: disputes.length, byStatus };
}

export async function getCustomersCount(key: string, range: Range, account?: string, cap?: { maxPages: number; maxItems: number }) {
  const customers = await listAll<any>(key, '/customers', { created: { gte: range.from, lte: range.to } }, account, cap);
  return { totalCount: customers.length };
}

export async function getSubscriptionsSummary(key: string, range: Range, account?: string, cap?: { maxPages: number; maxItems: number }) {
  const subs = await listAll<any>(key, '/subscriptions', {
    created: { gte: range.from, lte: range.to },
    status: 'all',
    expand: ['data.items.data.price.product'] as any,
  }, account, cap);
  const active = subs.filter((s: any) => s.status === 'active').length;
  const byProduct: Record<string, number> = {};
  for (const s of subs) {
    const items = s.items?.data || [];
    for (const it of items) {
      const product = it.price?.product;
      let name = '';
      if (typeof product === 'string') name = product;
      else if (product && typeof product === 'object') name = product.name || product.id || '';
      if (!name) name = it.price?.id || 'unknown';
      byProduct[name] = (byProduct[name] || 0) + 1;
    }
  }
  const totalCount = subs.length;
  return { totalCount, activeCount: active, byProduct };
}

export function cents(amount: number): string {
  return (amount / 100).toFixed(2);
}
