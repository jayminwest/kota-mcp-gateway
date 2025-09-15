import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { assertStripeKey, cents, getAccountStatus, getChargesSummary, getCustomersCount, getDisputesSummary, getPayoutsSummary, getRefundsSummary, getSubscriptionsSummary, toUnixRange } from '../utils/stripe.js';

const DetailEnum = z.enum(['numbers', 'full']);

export class StripeHandler extends BaseHandler {
  readonly prefix = 'stripe';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'activity_summary',
        description: 'Summarize Stripe activity across the account within a timeframe. Returns totals for charges, refunds, payouts, disputes, customers, and subscriptions.',
        inputSchema: {
          start: z.string().optional().describe('ISO date/time or YYYY-MM-DD. Defaults to 7 days ago.'),
          end: z.string().optional().describe('ISO date/time or YYYY-MM-DD. Defaults to now.'),
          currency: z.string().optional().describe('Filter to a currency (e.g., usd). Default: all.'),
          detail: DetailEnum.optional().describe('Level of detail: numbers | full'),
          max_pages: z.number().int().positive().max(100).default(10).optional(),
          max_items: z.number().int().positive().max(2000).default(1000).optional(),
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    switch (action) {
      case 'activity_summary':
        return this.activitySummary(args);
      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
    }
  }

  private async activitySummary(args: any): Promise<CallToolResult> {
    const parsed = z.object({
      start: z.string().optional(),
      end: z.string().optional(),
      currency: z.string().optional(),
      detail: DetailEnum.default('numbers').optional(),
      max_pages: z.number().int().positive().max(100).default(10).optional(),
      max_items: z.number().int().positive().max(2000).default(1000).optional(),
    }).parse(args || {});

    const key = assertStripeKey(this.config);
    const account = this.config.STRIPE_ACCOUNT;
    const range = toUnixRange(parsed.start, parsed.end, 7);
    const cap = { maxPages: parsed.max_pages || 10, maxItems: parsed.max_items || 1000 };

    // Parallelize calls for responsiveness
    const [acct, charges, refunds, payouts, disputes, customers, subs] = await Promise.all([
      getAccountStatus(key, account).catch((e) => ({ error: e?.message || String(e) })),
      getChargesSummary(key, range, parsed.currency, account, cap),
      getRefundsSummary(key, range, account, cap),
      getPayoutsSummary(key, range, account, cap),
      getDisputesSummary(key, range, account, cap),
      getCustomersCount(key, range, account, cap),
      getSubscriptionsSummary(key, range, account, cap),
    ]);

    const fromDate = new Date(range.from * 1000).toISOString().slice(0, 10);
    const toDate = new Date(range.to * 1000).toISOString().slice(0, 10);

    const lines: string[] = [];
    lines.push(`Stripe activity (${fromDate} → ${toDate})${parsed.currency ? ` [${parsed.currency}]` : ''}`);
    if ((acct as any)?.email) lines.push(`Account: ${(acct as any).email} (${(acct as any).id})`);
    lines.push('');

    // Totals
    lines.push('Totals:');
    // const gross = charges.totalAmount;
    // const refundsAmt = refunds.totalAmount;
    lines.push(`- Payments (succeeded): ${charges.totalCount} — ${formatMoneyMap(charges.byCurrency)}`);
    lines.push(`- Refunds: ${refunds.totalCount} — ${formatMoneyMap(refunds.byCurrency)}`);
    lines.push(`- Payouts: ${payouts.totalCount} — ${formatMoneyMap(payouts.byCurrency)}`);
    lines.push(`- Disputes: ${disputes.totalCount} (by status: ${Object.entries(disputes.byStatus).map(([k, v]) => `${k}:${v}`).join(', ') || 'none'})`);
    lines.push(`- Customers created: ${customers.totalCount}`);
    lines.push(`- Subscriptions created: ${subs.totalCount} (active in window: ${subs.activeCount})`);

    const byProduct = Object.entries(subs.byProduct).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (byProduct.length) {
      lines.push('');
      lines.push('Top subscription products:');
      for (const [name, count] of byProduct) lines.push(`- ${name}: ${count} subscriptions`);
    }

    if (parsed.detail === 'full') {
      const sampleCharges = charges.samples?.map((c: any) => `• ${c.id} — ${c.currency?.toUpperCase()} ${cents(c.amount)} — ${c.billing_details?.email || c.customer || ''}`) || [];
      if (sampleCharges.length) {
        lines.push('');
        lines.push(`Sample charges (${sampleCharges.length} shown):`);
        lines.push(...sampleCharges);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
}

function formatMoneyMap(byCurrency: Record<string, { amount: number } | { amount?: number; count?: number }>): string {
  const entries = Object.entries(byCurrency);
  if (!entries.length) return '$0.00';
  return entries.map(([cur, v]: any) => `${cur.toUpperCase()} ${cents(v.amount || 0)}`).join(' | ');
}
