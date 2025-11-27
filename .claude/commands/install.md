# Install & Prime

Initialize the KOTA MCP Gateway for local development.

## Read

- .env.example (never read .env)
- README.md (setup instructions and architecture)

## Read and Execute

.claude/commands/prime.md

## Run

1. Copy environment template: `cp .env.example .env`
2. Install gateway dependencies: `npm ci`
3. Compile TypeScript build output: `npm run build`
4. Verify installation: `npm run typecheck && npm run lint`

## Report

- Output the work you've just done in a concise bullet point list.
- Instruct the user to fill out `.env` based on `.env.example`:
  - Required: `PORT`, `DATA_DIR`, `HEALTH_PATH`
  - Optional service credentials (Google, WHOOP, Slack, etc.)
- Note: Gateway can run with minimal config; services requiring auth will be unavailable until credentials are added.
- Mention next steps:
  - Start server: `npm start`
  - Health check: `curl http://localhost:8084/health`
  - Configure MCP client per README
