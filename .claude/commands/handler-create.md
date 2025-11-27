# Create New Handler

Add a new MCP handler to the KOTA MCP Gateway following the established architecture patterns and conventions.

## Pre-Execution Checklist

1. `git fetch --all --prune` (sync remote refs)
2. `git status --short` (confirm clean working tree)
3. Verify the handler name doesn't conflict with existing handlers

## Read

- README.md (high-level gateway architecture and endpoints)
- docs/specs/ (relevant planning documents guiding this addition)
- docs/handlers/ADDING_HANDLERS.md (required handler patterns and naming)
- docs/handlers/<related-services>.md (ensure consistency with existing integrations)
- src/index.ts (handler bootstrap and bundle registration flow)
- src/handlers/base.ts (BaseHandler contract and expectations)

## Plan & Scaffold

1. Design the handler:
   - Choose handler prefix (e.g., `spotify`, `whoop`, `github`)
   - Define MCP tools and their input/output schemas
   - Plan any required utility functions
2. Create implementation:
   - Create `src/handlers/<service>.ts` extending `BaseHandler`
   - Implement `prefix`, `getTools()`, and `execute(action, args)` methods
   - Add utility functions in `src/utils/<service>.ts` if needed
3. Register the handler:
   - Add bundle definition to `bundleDefinitions` array in `src/index.ts`
   - Set `autoEnable: true` for core handlers, `false` for optional
   - Add appropriate tags (`['core']`, `['optional', 'health']`, etc.)
4. Configuration:
   - Add required keys to `.env.example`
   - Extend `src/utils/config.ts` if new env vars are needed
   - Add auth/status endpoint in `src/index.ts` if applicable
5. Documentation:
   - Create `docs/handlers/<SERVICE>.md` with usage guide
   - Add MCP help resource and prompt examples in `src/index.ts`
   - Update `docs/specs/` with implementation plan if applicable

## Validation Commands

- `git status`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `curl http://localhost:8084/health` (test server starts)
- Manual MCP tool invocation to verify handler works

## Report

- Summarize the new handler, tools, and supporting changes in concise bullet points.
- Provide `git diff --stat` for the work.
- Call out documentation/spec updates and any follow-up required for deployment.
- Note the handler prefix and tool names added.
