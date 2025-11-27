# Edit Existing Handler

Use this guide to update a handler under `src/handlers/` while staying aligned with the KOTA MCP Gateway architecture and documentation.

## Read
- README.md (architecture + runtime expectations)
- docs/specs/ (relevant plans that cover the handler change)
- docs/handlers/ADDING_HANDLERS.md (handler conventions and tooling expectations)
- docs/handlers/<service>.md (service-specific behavior and user-facing details)
- src/handlers/<service>.ts (the handler you are modifying)

## Implement
- Update the handler logic, schemas, and tool definitions in `src/handlers/<service>.ts`.
- Adjust shared utilities or middleware in `src/utils/` or `src/middleware/` if required.
- Update documentation in `docs/handlers/` and corresponding specs in `docs/specs/` to reflect the change.

## Run
- `git status`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run health`

## Report
- Summarize the work you completed in concise bullet points.
- Provide `git diff --stat` for the changes.
- Flag any docs/specs updates performed (or required follow-up if none were needed).
