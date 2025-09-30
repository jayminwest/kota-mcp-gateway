Adding New Handlers

Overview
This project exposes services as MCP tools via small TypeScript handler classes. Each handler groups logically related tools (e.g., Gmail, WHOOP) and implements a simple interface so the gateway can auto‑register them.

Core Concepts
- Naming: tools follow `{service}_{action}` (e.g., `gmail_list_messages`).
- Base class: extend `BaseHandler` and implement `prefix`, `getTools()`, and `execute(action, args)`.
- Schemas: define tool input schemas with `zod` raw shapes; the gateway converts them to JSON Schema.
- Config: add new env keys to `.env.example` and validate them in `src/utils/config.ts`.
- Status: optional HTTP status route under `/auth/<service>/status` to quickly verify creds/state.
- Help: optional `help://<service>/usage` resource and `<service>.examples` prompt for quick tips.
- Observability: use the injected `logger` for structured logs; catch and surface errors as tool results.

Minimal Handler Skeleton
```
// src/handlers/my-service.ts
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';

export class MyServiceHandler extends BaseHandler {
  readonly prefix = 'myservice';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'do_thing',
        description: 'Do a thing with MyService',
        inputSchema: {
          id: z.string(),
          verbose: z.boolean().optional(),
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'do_thing':
          // Implement your logic
          const result = { ok: true, id: String(args.id) };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'MyService error');
      return { content: [{ type: 'text', text: `MyService error: ${err?.message || String(err)}` }], isError: true };
    }
  }
}
```

Registering the Handler
```
// src/index.ts
import { MyServiceHandler } from './handlers/my-service.js';

const bundleDefinitions: BundleDefinition[] = [
  // ...existing bundles
  {
    key: 'myservice',
    description: 'Short description shown in toolkit_list_bundles',
    // Set autoEnable: true to ship it with the core manifest, otherwise enable on demand.
    autoEnable: false,
    factory: make(MyServiceHandler),
    tags: ['optional', 'category'],
  },
];
```

Choose a unique `key`, keep descriptions brief (they are surfaced to the LLM), and tag the bundle so it groups logically in `toolkit_list_bundles`.

Adding Configuration
1) `.env.example` — add placeholder keys:
```
MYSERVICE_API_KEY=
MYSERVICE_ENDPOINT=
```
2) `src/utils/config.ts` — extend the schema:
```
  MYSERVICE_API_KEY: z.string().optional(),
  MYSERVICE_ENDPOINT: z.string().optional(),
```
3) Read configuration in your handler or a dedicated client util and surface helpful errors when keys are missing.

Status Route (optional but recommended)
Add a minimal HTTP route to verify configuration/health quickly:
```
// src/index.ts
app.get('/auth/myservice/status', async (req, res, next) => {
  try {
    const hasKey = Boolean(config.MYSERVICE_API_KEY);
    let authorized: boolean | undefined;
    let error: string | undefined;
    if (hasKey) {
      try {
        // e.g., ping the API
        authorized = true;
      } catch (e: any) { authorized = false; error = e?.message || String(e); }
    }
    res.json({ hasKey, authorized, ...(error ? { error } : {}) });
  } catch (err) { next(err); }
});
```

Help Resource + Example Prompt (optional)
Add short curated instructions the client can read:
```
// In src/index.ts after server creation
mcp.resource('myservice_help_usage', 'help://myservice/usage', async (u) => ({
  contents: [{ uri: u.toString(), text: 'How to use MyService tools...'}],
}));

mcp.prompt('myservice.examples', 'Examples for MyService', async () => ({
  description: 'Quick examples',
  messages: [
    { role: 'assistant', content: { type: 'text', text: 'myservice_do_thing { "id": "123" }' } },
  ],
}));
```

Tool Design Tips
- Prefer typed tools for common tasks rather than a single raw “execute” tool.
- Document pagination params (e.g., `limit`, `next_token`, `all`, caps like `max_pages`, `max_items`) to keep outputs small enough for MCP clients.
- Return concise summaries or a compact shape by default; allow a “raw” option if needed.
- Convert provider errors into friendly tool error messages; include HTTP status and hints.

Auth Patterns
- OAuth: mirror Google/WHOOP patterns (start/callback/status endpoints, token persistence under `data/<service>`).
- API Keys: validate presence, add a status route, avoid logging sensitive values.
- LAN/Local: provide discovery windows and fallbacks (see Kasa for LAN, WHOOP for cloud OAuth).

Observability
- Use `logger` for structured logs: `this.logger.info({...}, 'message')`.
- Catch and wrap errors in tool results; avoid throwing raw exceptions.

Quality Gates
- Lint: `npm run lint` (or `npm run lint:fix`)
- Types: `npm run typecheck`
- Build: `npm run build`
- Docker: `docker-compose up -d --build`

Documentation
- Add/Update: docs/handlers/<SERVICE>.md with setup and examples.
- Update: docs/handlers/README.md index if it’s a new category.
