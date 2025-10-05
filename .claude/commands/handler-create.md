# Create New Handler

Follow these steps to add a new MCP handler for the KOTA MCP Gateway.

## Read
- README.md (high-level gateway architecture and endpoints)
- docs/specs/ (relevant planning documents guiding this addition)
- docs/handlers/ADDING_HANDLERS.md (required handler patterns and naming)
- docs/handlers/<related-services>.md (ensure consistency with existing integrations)
- src/index.ts (handler bootstrap and registration flow)
- src/handlers/base.ts (BaseHandler contract and expectations)

## Plan & Scaffold
- Design the handler prefix, tools, and input/output schemas.
- Create `src/handlers/<service>.ts` implementing `BaseHandler`.
- Register the handler in `src/index.ts` and ensure any required utilities exist.
- Add configuration keys to `.env.example` and extend `src/utils/config.ts` if needed.
- Draft or update docs in `docs/handlers/` and `docs/specs/` so the new tools are documented.

## Run
- `git status`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run health`

## Report
- Summarize the new handler, tools, and supporting changes in concise bullet points.
- Provide `git diff --stat` for the work.
- Call out documentation/spec updates and any follow-up required for deployment.
