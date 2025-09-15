Stripe Handler

Overview
Provides a high-level summary of account activity over a time window: payments, refunds, payouts, disputes, customers, and subscriptions. Designed for quick overviews across all projects within one Stripe account.

Setup
- Add to `.env`:
```
STRIPE_API_KEY=sk_live_...
# Optional for Connect accounts:
STRIPE_ACCOUNT=acct_...
```

Endpoints
- `GET /auth/stripe/status` → `{ authenticated, account: { id, email, default_currency } }`

MCP Tools
- `stripe_activity_summary { start?, end?, currency?, detail?, max_pages?, max_items? }`
  - `detail`: `numbers` | `full` (default: `numbers`)
  - `start`/`end`: ISO or `YYYY-MM-DD`. Defaults to last 7 days.
  - `currency`: filter results to a currency (optional).
  - `max_pages`/`max_items`: pagination caps for safety.

Examples
```
stripe_activity_summary { "detail": "numbers" }
stripe_activity_summary { "start": "2025-09-01", "end": "2025-09-15", "detail": "full" }
```

Notes
- Uses Charges, Refunds, Payouts, Disputes, Customers, Subscriptions APIs; amounts are aggregated by currency.
- Subscription product names are expanded where possible to compute top products.
- For detailed exports or reconciliation, consider using Stripe balance transactions or Stripe Sigma.

