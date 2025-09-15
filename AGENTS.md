# Repository Guidelines

## Project Structure & Module Organization
- `src/index.ts` — Express entrypoint + MCP Streamable HTTP transport.
- `src/handlers/*` — service handlers (Gmail, Calendar, WHOOP, Kraken, Rize, Kasa, Slack). Extend `BaseHandler` and expose tools.
- `src/utils/*` — config (`zod`), logger (`pino`), service clients.
- `src/middleware/*` — error and optional auth middleware.
- `scripts/*` — health check and local helpers.
- `data/` — persisted tokens/config (gitignored). See `.env.example` for keys.
- `docs/handlers/*` — per‑service setup and usage.

## Build, Test, and Development Commands
- `npm ci` — install dependencies.
- `npm run dev` — run locally with TS watch (`tsx`).
- `npm run build` — compile TypeScript to `dist/`.
- `npm start` — start compiled server from `dist/index.js`.
- `npm run lint` | `npm run lint:fix` — ESLint v9 (flat config).
- `npm run typecheck` — strict TypeScript type checks (no emit).
- `npm run health` — HTTP health probe for `HEALTH_PATH`.
- Docker: `docker-compose up -d --build` (mounts `./data`).

## Coding Style & Naming Conventions
- TypeScript ESM (`module`/`moduleResolution`: `NodeNext`), strict mode.
- Filenames: lowercase; use kebab-case for multiword files (e.g., `my-service.ts`).
- Code: camelCase for vars/functions; PascalCase for classes/types.
- Handlers: tools named `prefix_action` (e.g., `gmail_list_messages`). Keep logic focused and typed.
- Schemas: prefer `zod` raw shapes; gateway converts to JSON Schema.

## Testing Guidelines
- No unit test framework configured yet.
- Validate with `npm run typecheck` and `npm run lint`.
- Smoke tests: `curl http://localhost:3000/health` and `/auth/*/status` routes.
- For new features, document in `docs/handlers/` and include example curl/MCP calls in PRs. If adding tests, Jest/Vitest are acceptable.

## Commit & Pull Request Guidelines
- Use Conventional Commits: `feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `chore: ...` (see `git log`).
- PRs should include: purpose, linked issues, verification steps (commands, logs), and any new env vars (update `.env.example`).
- Do not commit secrets. `.env` and `data/` are already gitignored.

## Security & Configuration Tips
- Protect endpoints when needed via `MCP_AUTH_TOKEN` (Bearer token).
- OAuth/API keys live in `.env`; tokens persist under `./data/<service>`.
- Default port and health path are configurable (`PORT`, `HEALTH_PATH`).

