KOTA MCP Gateway Handlers

This directory documents handler-specific setup and usage. Start here if you’re bringing a new machine online or enabling a new service.

Handlers Index
- Toolkit Bundles: TOOLKIT.md (enable optional handlers)
- Google (Gmail + Calendar): GOOGLE.md
- KOTA Memory System: MEMORY.md
- Daily Logs: DAILY.md
- Context Snapshots: CONTEXT_SNAPSHOT.md
- Content Calendar: CONTENT_CALENDAR.md
- GitHub: GITHUB.md (enable via bundle `github`)
- Stripe: STRIPE.md (enable via bundle `stripe`)
- Spotify: SPOTIFY.md (enable via bundle `spotify`)
- WHOOP (v2 API): WHOOP.md (enable via bundle `whoop`)
- Kraken (Crypto): KRAKEN.md (enable via bundle `kraken`)
- Rize (GraphQL API): RIZE.md (enable via bundle `rize`)
- Slack: SLACK.md (enable via bundle `slack`)
- Kasa: KASA.md (enable via bundle `kasa`)
- Webhooks: WEBHOOKS.md (enable via bundle `webhooks`)
- Workspace Navigator: WORKSPACE.md (enable via bundle `workspace`)
- Adding New Handlers: ADDING_HANDLERS.md

Common Concepts
- Config: Populate required env vars in `.env` (see `.env.example`).
- Data storage: Persistent data lives under `./data` (mounted into Docker). OAuth tokens are stored in a service-specific folder, e.g., `./data/google/tokens.json`.
- Health: `GET /health` should return `{ status: 'ok' }` when the gateway is running.
- MCP endpoint: Streamable HTTP at `http://localhost:8084/mcp` (default).
- MCP client config: See `.mcp.json` at the repo root.

Notes
- Additional handlers (Plaid, Kasa, Slack) are scaffolded or planned and will be documented here as they’re implemented.
