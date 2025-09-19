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
- One of:
  - OAuth2 client creds (recommended):
    - `WHOOP_CLIENT_ID=<your_client_id>`
    - `WHOOP_CLIENT_SECRET=<your_client_secret>`
    - Optional: `WHOOP_REDIRECT_URI` (defaults to `http://localhost:8084/auth/whoop/callback`)
  - OR a short‑lived WHOOP API access token (fallback):
    - `WHOOP_API_KEY=<your_bearer_token>`

API Base URL (v2)
- The gateway targets WHOOP v2 endpoints under `https://api.prod.whoop.com/developer/v2/...`.
- If you see 404s after authenticating, ensure you’re on the latest gateway image with the `/developer` base path.

Notes on tokens
- WHOOP’s public API uses OAuth2. The gateway supports full OAuth including refresh.
- The OAuth flow now requests offline access and consent to obtain a `refresh_token`. Access tokens typically last ~1 hour and will auto‑refresh when a `refresh_token` is present.
- If you only set `WHOOP_API_KEY`, that token is usually short‑lived and will expire; prefer the OAuth flow below.

OAuth flow (recommended)
- Set `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` in `.env` (and optionally `WHOOP_REDIRECT_URI`).
- Start auth in a browser: `http://localhost:8084/auth/whoop/start`
  - You’ll be prompted to consent. The gateway requests the scopes:
    `read:profile read:body_measurement read:recovery read:sleep read:workout read:cycles`
- After redirect back to the gateway, tokens are stored at `./data/whoop/tokens.json`.
- Verify auth: `curl http://localhost:8084/auth/whoop/status`
  - Response includes `{ authenticated, profile, token_type, expiry_date, scope }`
  - If a `refresh_token` was issued, the server refreshes automatically when near expiry.

Re‑auth steps
- If auth seems expired or you didn’t get a `refresh_token`:
  1) Ensure `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` are set in `.env`.
  2) Visit `http://localhost:8084/auth/whoop/start` again.
  3) Accept consent when prompted (the gateway forces `prompt=consent` and `access_type=offline` to obtain a refresh token).
  4) Check `GET /auth/whoop/status` to confirm.
  - If needed, remove `./data/whoop/tokens.json` and repeat to force a clean re‑auth.

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
