KOTA MCP Gateway Handlers

This directory documents handler-specific setup and usage. Start here if you’re bringing a new machine online or enabling a new service.

Currently Implemented
- Google (Gmail + Calendar) — OAuth flow with token storage; tools for listing/sending Gmail and listing/creating/updating Calendar events.

Common Concepts
- Config: Populate required env vars in `.env` (see `.env.example`).
- Data storage: Persistent data lives under `./data` (mounted into Docker). OAuth tokens are stored in a service-specific folder, e.g., `./data/google/tokens.json`.
- Health: `GET /health` should return `{ status: 'ok' }` when the gateway is running.
- MCP endpoint: Streamable HTTP at `http://localhost:3000/mcp`.
- MCP client config: See `.mcp.json` at the repo root.

Guides
- GOOGLE.md — Complete setup for Gmail and Google Calendar (OAuth, scopes, testing tools).

