WHOOP Setup and Usage

This guide explains how to enable WHOOP tools in the KOTA MCP Gateway and what they do.

What you get
- Tools (read-only, plus revoke):
  - `whoop_get_profile` — Basic user profile (name, email)
  - `whoop_get_body_measurements` — Height, weight, max heart rate
  - `whoop_get_recovery` — Paginated recoveries with optional start/end/limit
  - `whoop_get_sleep` — Paginated sleeps with optional start/end/limit
  - `whoop_get_workouts` — Paginated workouts with optional start/end/limit
  - `whoop_get_cycles` — Paginated cycles with optional start/end/limit
  - `whoop_revoke_access` — Revokes the current access token

Requirements
- WHOOP API access token with scopes: read:profile, read:body_measurement, read:recovery, read:sleep, read:workout, read:cycles
- Add to `.env`:
  - `WHOOP_API_KEY=<your_bearer_token>`

API Base URL (v2)
- The gateway targets WHOOP v2 endpoints under `https://api.prod.whoop.com/developer/v2/...`.
- If you see 404s after authenticating, ensure you’re on the latest gateway image with the `/developer` base path.

Notes on tokens
- WHOOP’s public API uses OAuth2. For now, the gateway expects a bearer token in `WHOOP_API_KEY`.
- If your token is short-lived, you’ll need to update it when it expires. Future versions may add OAuth in the gateway to refresh automatically.

Start/Restart
- Docker: `docker-compose up -d --build` (after setting `.env`)
- Local: `npm run build && node dist/index.js`

Examples (via MCP client)
- `whoop_get_recovery` with optional filters:
  - `{ "start": "2025-09-01T00:00:00Z", "end": "2025-09-15T00:00:00Z", "limit": 25, "all": false }`
- `whoop_get_sleep`:
  - `{ "start": "2025-09-10T00:00:00Z", "end": "2025-09-12T00:00:00Z", "limit": 25 }`
- `whoop_get_workouts` (first page):
  - `{ "limit": 10 }`
- Paging:
  - When the result contains `nextToken`, pass it back as `next_token` to fetch the next page.
  - Or set `all: true` to auto-paginate up to a safety cap.

Troubleshooting
- `Whoop error: Missing WHOOP_API_KEY`: Set the token in `.env` and restart.
- 401/403 errors: Token expired or lacks required scopes.
- 429 rate-limits: Reduce page size or frequency.
