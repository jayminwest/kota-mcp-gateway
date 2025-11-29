KOTA MCP Gateway

Unified Model Context Protocol (MCP) gateway that consolidates KOTA tools behind a single HTTP server running at http://localhost:8084 (default).

Features
- Single connection point for MCP clients
- Dynamic tool registration via handlers
- Webhook ingestion pipeline that maps external events into daily logs
- REST API for AI Developer Workflow (ADW) task management
- Health endpoint at `/health`
- Structured JSON logging with correlation IDs
- Dockerized with persistent data volume
- Webhook event storage with MCP tooling for historical review
- Multi-project support for isolated task queues

Project Structure
- `src/index.ts` – main server and MCP transport
- `src/handlers/*` – service handlers (Gmail, Calendar, Whoop, Kraken, Rize, Kasa, Slack)
  - Also: GitHub (activity summaries)
- `src/routes/*` – REST API routers (Tasks API for ADWs)
- `src/webhooks/*` – webhook handlers that append to the daily tracker
- `src/utils/*` – config, logger, database utilities
- `src/middleware/*` – error and optional auth middleware
- `scripts/*` – healthcheck, webhook testing, and macOS launchd installer
- `data/` – persistent data for tokens/config/databases
- `docs/handlers` & `docs/webhooks` – per-integration guides
- `docs/HOME_SERVER_API.md` & `docs/KOTADB_API_REFERENCE.md` – Tasks API documentation

Setup
1. Copy `.env.example` to `.env` and fill any required keys.
2. Install dependencies and build:
   - `npm ci`
   - `npm run build`
3. Start locally: `npm start`

Endpoints
- `GET /health` – returns `{ status: 'ok', ... }`
- `GET /tasks` – Tasks Monitor web UI for managing ADW task queues
- `GET/POST/DELETE /mcp` – MCP Streamable HTTP transport (full handler access)
- `GET/POST/DELETE /mcp/agents` – Isolated MCP endpoint for external agents (tasks-only, requires API key)
- `GET /auth/github/status` – GitHub token and rate status
- `/api/tasks/:project_id/*` – Task management API for AI Developer Workflows (see [docs/KOTADB_API_REFERENCE.md](docs/KOTADB_API_REFERENCE.md))

MCP Client Config

Full access (local use):
```json
{
  "mcpServers": {
    "kota": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-http-client",
        "http://localhost:8084/mcp"
      ]
    }
  }
}
```

External agents (tasks-only, requires API key):
```json
{
  "mcpServers": {
    "kota-agents": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-http-client",
        "http://localhost:8084/mcp/agents"
      ],
      "env": {
        "HTTP_AUTHORIZATION": "Bearer your_api_key_here"
      }
    }
  }
}
```

See [docs/AGENT_SETUP_GUIDE.md](docs/AGENT_SETUP_GUIDE.md) for external agent configuration.

Context Management

Control which handler bundles load at startup by defining contexts in `~/.kota/context.json`:

```json
{
  "active_contexts": ["work", "health"],
  "disabled_bundles": ["spotify", "kasa"],
  "updated": "2025-11-23T17:45:00.000Z"
}
```

**Available Bundle Keys:** toolkit, kota, gmail, calendar, memory, daily, context_snapshot, content_calendar, whoop, kasa, kraken, rize, slack, spotify, github, stripe, workspace, webhooks, tasks

**MCP Tools:**
- `toolkit_get_context` – View current context configuration
- `toolkit_set_context` – Update contexts and disabled bundles
- `toolkit_disable_bundle` – Disable a bundle (persisted)
- `toolkit_enable_bundle` – Enable a bundle (with `persist: true` to remove from disabled list)

Restart the gateway after context changes to apply bundle enable/disable updates.

Context Bundling (KOTA Entry Point)

KOTA provides a self-documenting entry point for scope-based context loading. Instead of loading all context at session start, load specific scopes on-demand to reduce token overhead.

**Quick Start:**
```typescript
// List available scopes
kota.load({ scope: "list" })

// Load a scope
kota.load({ scope: "GEOSYNC" })

// Load multiple scopes
kota.load({ scope: ["GEOSYNC", "PERSONAL"] })

// Edit a scope
kota.edit({
  scope: "GEOSYNC",
  modification: { add: { ... } },
  reason: "Adding new data source"
})

// Refresh a scope
kota.refresh({ scope: "GEOSYNC" })
```

**Scope Configuration:**
Scopes are defined in YAML files at `~/kota_md/scopes/`. Each scope specifies:
- Overview and description
- Data sources to fetch (memories, slack messages, files, etc.)
- Tools to expose for the scope

Example scopes provided:
- `geosync.scope.yaml` – Client work context
- `personal.scope.yaml` – Personal life and health tracking
- `kotadb.scope.yaml` – Product development context

See [docs/handlers/KOTA.md](docs/handlers/KOTA.md) for comprehensive documentation.

Docker
- `docker-compose up --build -d`
- Default mounts:
  - `./data:/app/data`
  - `~/.kota:/root/.kota:ro`
- Nightly backups: see `README.md#backups` for the cron-based snapshot routine.

Rebuild and Restart (quick commands)
- Rebuild image and start fresh (best after code changes):
  - `docker-compose up -d --build`
- Restart container without rebuild (best after .env changes):
  - `docker-compose restart`
- Rebuild without cache (force full rebuild):
  - `docker-compose build --no-cache && docker-compose up -d`
- View logs:
  - `docker-compose logs -f`
- Health checks:
  - `curl http://localhost:8084/health`
  - `curl http://localhost:8084/auth/google/status`

Adding New Handlers
1. Create a class extending `BaseHandler` in `src/handlers/`.
2. Implement `prefix`, `getTools()`, and `execute(action, args)`.
3. Register in `src/index.ts` by adding the handler to the `handlers` array.
4. Add any config keys to `.env.example`.

Backups
- Nightly cron job copies `data/` to `/Volumes/kota_ssd/backups/<timestamp>/` using `scripts/backup-data-to-ssd.sh`.

Notes
- Handlers added/expanded incrementally; see docs/handlers for per-service guides.
