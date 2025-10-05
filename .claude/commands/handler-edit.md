# Edit Existing Handler

Update a handler under `src/handlers/` while maintaining consistency with the KOTA MCP Gateway architecture and documentation standards.

## Pre-Execution Checklist

1. `git fetch --all --prune` (sync remote refs)
2. `git status --short` (confirm clean working tree)
3. Identify the handler to modify and review its current tools

## Read

- README.md (architecture + runtime expectations)
- docs/specs/ (relevant plans that cover the handler change)
- docs/handlers/ADDING_HANDLERS.md (handler conventions and tooling expectations)
- docs/handlers/<service>.md (service-specific behavior and user-facing details)
- src/handlers/<service>.ts (the handler you are modifying)
- src/handlers/base.ts (BaseHandler contract for reference)
- src/utils/<service>.ts (related utility functions)

## Implement

1. Update handler implementation:
   - Modify tool definitions in `getTools()` method
   - Update `execute(action, args)` logic for changed/new actions
   - Adjust input/output schemas as needed
   - Update handler prefix or aliases if required
2. Update supporting code:
   - Adjust shared utilities in `src/utils/<service>.ts`
   - Update middleware in `src/middleware/` if required
   - Modify configuration in `src/utils/config.ts` if new env vars needed
3. Update registration (if needed):
   - Adjust bundle definition in `src/index.ts`
   - Update MCP help resources and prompt examples
   - Modify auth/status endpoints if applicable
4. Update documentation:
   - Update `docs/handlers/<service>.md` with new tool usage
   - Update `docs/specs/` with implementation notes
   - Add `.env.example` entries for new configuration

## Validation Commands

- `git status`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `curl http://localhost:8084/health` (test server starts)
- Manual MCP tool invocation to verify changes work

## Report

- Summarize the work you completed in concise bullet points.
- Provide `git diff --stat` for the changes.
- Flag any docs/specs updates performed (or required follow-up if none were needed).
- Note which tools were added/modified/removed.
