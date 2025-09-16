Google (Gmail + Calendar) Setup

This guide walks you through enabling Gmail and Google Calendar tools in the KOTA MCP Gateway.

What you get
- Gmail tools: `gmail_list_messages`, `gmail_send_message`, `gmail_create_draft`
- Calendar tools: `calendar_list_events`, `calendar_create_event`, `calendar_update_event`

Prerequisites
- Node.js 20+ (for local runs) or Docker Desktop (for containerized runs)
- A Google account you control
- Access to Google Cloud Console

Scopes Used
- Gmail: `https://www.googleapis.com/auth/gmail.modify`, `.../gmail.compose`
- Calendar: `https://www.googleapis.com/auth/calendar`

1) Create a Google Cloud OAuth Client
1. Go to Google Cloud Console → create/select a project.
2. Enable APIs:
   - “Gmail API”
   - “Google Calendar API”
3. OAuth consent screen:
   - User type: External (recommended for personal Google accounts)
   - Publishing status: Testing is fine
   - Add your Google account as a Test user
4. Create Credentials → OAuth client ID:
   - Application type: Web application
   - Authorized redirect URI (assuming default port 8081):
     - `http://localhost:8081/auth/google/callback`
   - Save Client ID and Client Secret

2) Configure the Gateway
1. Copy `.env.example` to `.env` (already done if requested).
2. Fill these values:
   - `GOOGLE_CLIENT_ID=<your_client_id>`
   - `GOOGLE_CLIENT_SECRET=<your_client_secret>`
   - Optional: `GOOGLE_REDIRECT_URI=http://localhost:8081/auth/google/callback`

3) Start the Gateway
- Docker (recommended): `docker-compose up -d --build`
- Local: `npm ci && npm run build && node dist/index.js`

4) Authorize with Google
- Visit: `http://localhost:8081/auth/google/start`
- Complete the consent screen. You should see “Google authentication successful.”
- Tokens are stored at `./data/google/tokens.json` (persisted via Docker volume / local dir).

5) Test Tools
- From an MCP client (e.g., Claude Code) with `.mcp.json` configured to `http://localhost:8081/mcp`:
  - Gmail list: `gmail_list_messages` with `{ "query": "is:unread", "max_results": 10 }`
  - Gmail send: `gmail_send_message` with `{ "to": "you@example.com", "subject": "Hi", "body": "Hello!" }`
  - Calendar list: `calendar_list_events` with `{ "start": "<ISO>", "end": "<ISO>", "max_results": 10 }`
  - Calendar create: `calendar_create_event` with `{ "title": "Test", "start": "<ISO>", "end": "<ISO>" }`

If you prefer raw JSON‑RPC with curl, include the Accept header:

```
H='Content-Type: application/json'
A='Accept: application/json, text/event-stream'
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}'
curl -sS -H "$H" -H "$A" -d "$INIT" http://localhost:8081/mcp > /dev/null
LIST='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
curl -sS -H "$H" -H "$A" -d "$LIST" http://localhost:8081/mcp
```

Troubleshooting
- “Missing code” at callback: Use `/auth/google/start` to begin the flow; don’t open the callback URL directly.
- Redirect URI mismatch: Ensure the Cloud Console URI exactly matches the server (host, port, path).
- Not authenticated errors: Re-run `/auth/google/start` and ensure tokens exist at `./data/google/tokens.json`.
- Consent blocked: Add your account as a Test user in the OAuth consent screen.

Security Notes
- Secrets live in `.env`; never commit it.
- OAuth tokens are stored under `./data/google/tokens.json` (gitignored) for persistence.
