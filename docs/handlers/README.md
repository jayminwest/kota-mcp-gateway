KOTA MCP Gateway Handlers

This directory documents handler-specific setup and usage. Start here if you’re bringing a new machine online or enabling a new service.

Handlers Index
- Google (Gmail + Calendar): GOOGLE.md
- GitHub: GITHUB.md
- Stripe: STRIPE.md
- WHOOP (v2 API): WHOOP.md
- Kraken (Crypto): KRAKEN.md
- Rize (GraphQL API): RIZE.md
- Daily Logs: DAILY.md (nutrition/vitals aliases)
- KOTA Memory System: MEMORY.md
- Workspace Navigator: WORKSPACE.md
- Adding New Handlers: ADDING_HANDLERS.md

Common Concepts
- Config: Populate required env vars in `.env` (see `.env.example`).
- Data storage: Persistent data lives under `./data` (mounted into Docker). OAuth tokens are stored in a service-specific folder, e.g., `./data/google/tokens.json`.
- Health: `GET /health` should return `{ status: 'ok' }` when the gateway is running.
- MCP endpoint: Streamable HTTP at `http://localhost:8081/mcp` (default).
- MCP client config: See `.mcp.json` at the repo root.

Notes
- Additional handlers (Plaid, Kasa, Slack) are scaffolded or planned and will be documented here as they’re implemented.
