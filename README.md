KOTA MCP Gateway

Unified Model Context Protocol (MCP) gateway that consolidates KOTA tools behind a single HTTP server running at http://localhost:3000.

Features
- Single connection point for MCP clients
- Dynamic tool registration via handlers
- Health endpoint at `/health`
- Structured JSON logging with correlation IDs
- Dockerized with persistent data volume

Project Structure
- `src/index.ts` – main server and MCP transport
- `src/handlers/*` – service handlers (Gmail, Calendar, Whoop, etc.)
- `src/utils/*` – config and logger
- `src/middleware/*` – error and optional auth middleware
- `scripts/*` – healthcheck and macOS launchd installer
- `data/` – persistent data (e.g., knowledge base)

Setup
1. Copy `.env.example` to `.env` and fill any required keys.
2. Install dependencies and build:
   - `npm ci`
   - `npm run build`
3. Start locally: `npm start`

Endpoints
- `GET /health` – returns `{ status: 'ok', ... }`
- `GET/POST/DELETE /mcp` – MCP Streamable HTTP transport

MCP Client Config
{
  "mcpServers": {
    "kota": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-http-client",
        "http://localhost:3000"
      ]
    }
  }
}

Docker
- `docker-compose up --build -d`
- Default mounts:
  - `./data:/app/data`
  - `~/.kota:/root/.kota:ro`

Adding New Handlers
1. Create a class extending `BaseHandler` in `src/handlers/`.
2. Implement `prefix`, `getTools()`, and `execute(action, args)`.
3. Register in `src/index.ts` by adding the handler to the `handlers` array.
4. Add any config keys to `.env.example`.

Notes
- Initial release stubs most external APIs; expands incrementally per PRD phases.
- Knowledge base tools read/write under `KNOWLEDGE_BASE_PATH` (default `/app/data/knowledge`).

