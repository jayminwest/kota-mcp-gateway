Kraken Setup and Usage

> Bundle: `kraken` (auto-enabled). Use `toolkit_list_bundles {}` for a quick refresh of finance-related tools.

What you get
- Tools:
  - `kraken_get_ticker` — Public ticker data for a pair (e.g., `XBTUSD`)
  - `kraken_get_balance` — Private balances (requires API key/secret)

Requirements
- Create Kraken API credentials (key + secret). Read-only is sufficient for balances.
- Add to `.env`:
  - `KRAKEN_API_KEY=<key>`
  - `KRAKEN_API_SECRET=<base64_secret>`

Notes
- `KRAKEN_API_SECRET` must be the base64-encoded string exactly as provided by Kraken; do not modify.
- `kraken_get_ticker` works without credentials; `get_balance` requires both key/secret.

Status
- Verify configuration and credentials quickly in a browser:
  - `GET http://localhost:8084/auth/kraken/status`
  - Returns `{ hasKey, hasSecret, authorized, error? }`

Examples
- Ticker: `{ "pair": "XBTUSD" }`
- Balance: `{}`

Troubleshooting
- `Kraken error: Missing KRAKEN_API_KEY/KRAKEN_API_SECRET`: Add both to `.env` and restart the gateway.
- `Kraken error: Kraken error: EAPI:Invalid key` or signature errors: regenerate credentials and verify secret is base64.
