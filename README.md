KOTA MCP Gateway

Unified Model Context Protocol (MCP) gateway that consolidates KOTA tools behind a single HTTP server running at http://localhost:8084 (default).

Features
- Single connection point for MCP clients
- Dynamic tool registration via handlers
- Webhook ingestion pipeline that maps external events into daily vitals
- Health endpoint at `/health`
- Structured JSON logging with correlation IDs
- Dockerized with persistent data volume
- Webhook event storage with MCP tooling for historical review

Project Structure
- `src/index.ts` – main server and MCP transport
- `src/handlers/*` – service handlers (Gmail, Calendar, Whoop, Kraken, Rize, Kasa, Slack)
  - Also: GitHub (activity summaries)
- `src/webhooks/*` – webhook handlers that append to the daily tracker
- `src/utils/*` – config and logger
- `src/middleware/*` – error and optional auth middleware
- `scripts/*` – healthcheck, webhook testing, and macOS launchd installer
- `data/` – persistent data for tokens/config
- `docs/handlers` & `docs/webhooks` – per-integration guides

Setup
1. Copy `.env.example` to `.env` and fill any required keys.
2. Install dependencies and build:
   - `npm ci`
   - `npm run build`
3. Start locally: `npm start`

Endpoints
- `GET /health` – returns `{ status: 'ok', ... }`
- `GET /kwc` – Kendama run logger UI (lineup editor + run capture)
- `GET /kwc/stats` – Kendama analytics dashboard (consistency + trends)
- `GET /kwc/api/lineup` | `PUT /kwc/api/lineup` – manage Kendama lineup JSON
- `GET /kwc/api/runs` | `POST /kwc/api/runs` – list or append Kendama run history
- `GET /kwc/api/analytics` – aggregate Kendama stats (query: `days`, `window`)
- `GET/POST/DELETE /mcp` – MCP Streamable HTTP transport
 - `GET /auth/github/status` – GitHub token and rate status

MCP Client Config
{
  "mcpServers": {
    "kota": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-http-client",
        "http://localhost:8084"
      ]
    }
  }
}

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
- Kendama run data lives in `data/kota_kwc/{lineup,runs}.json` alongside other persisted storage.
- KWC lineup scores auto-derive from the trick level (e.g., `9-1` counts as 9 points).
- KWC MCP tools offer lineup CRUD plus analytics (`kwc_get_trick_stats`, `kwc_get_run_stats`, `kwc_get_trend`).
- KWC web UI includes `/kwc/stats` analytics view powered by the same MCP calculations.
- KWC timestamps default to Pacific Time; set `KWC_TIMEZONE` to another IANA zone if needed.
