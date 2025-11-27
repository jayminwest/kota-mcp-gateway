# Feature: Unified KOTA Entry Point

## Problem Statement

**Current State:**
- **81 MCP tools** registered at startup → massive token overhead for agents
- **10 slash commands** (`/kota-startup`, `/geosync-context`, etc.) → load context upfront
- Agents get overwhelmed with tool choices and pre-loaded context
- No way to discover available capabilities dynamically
- Context loading is all-or-nothing at session start

**Token Overhead:**
- Each MCP tool: ~150-300 tokens (name, description, schema)
- 81 tools × 250 tokens avg = **~20,250 tokens** just for tool definitions
- Slash commands load even more context upfront (calendar, slack, github, etc.)
- Total session start: **30,000-50,000+ tokens** before any work begins

**Goal:**
Reduce session start to **<5,000 tokens** by consolidating everything into:
1. **Single MCP tool** for invocation (`kota`)
2. **On-demand context loading** instead of upfront prompts
3. **Self-service discovery** mechanism

---

## Architecture Overview

### Three-Layer System

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Single Entry Point (MCP Tool)            │
│  → kota(request)                                    │
│  → Handles all invocations + discovery             │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│  Layer 2: Context Bundles (Replaces Slash Commands)│
│  → startup, geosync, context-refresh, weekly-review │
│  → Discoverable, executable, on-demand             │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│  Layer 3: Handler Actions (Existing Infrastructure)│
│  → memory.set, gmail.list, slack.get_messages       │
│  → 81 actions across 18 handler bundles            │
└─────────────────────────────────────────────────────┘
```

---

## Layer 1: Single Entry Point Tool

### Tool Signature

**Name:** `kota`

**Input Schema:**
```typescript
{
  type: "discover" | "invoke" | "context",

  // For type: "discover"
  query?: string,           // Search bundles/contexts/actions
  filter?: {
    category?: string,      // "tool" | "context" | "all"
    tags?: string[]
  },

  // For type: "invoke"
  bundle?: string,          // Handler bundle (e.g., "memory")
  action?: string,          // Action name (e.g., "set")
  args?: Record<string, any>,

  // For type: "context"
  context?: string,         // Context bundle (e.g., "startup", "geosync")
  refresh?: boolean         // Force refresh cached data
}
```

### Example Usage

**Discovery:**
```typescript
// What can KOTA do?
kota({ type: "discover" })

// Returns:
{
  "bundles": {
    "tools": ["memory", "gmail", "calendar", "slack", ...],  // 18 bundles
    "contexts": ["startup", "geosync", "context-refresh", ...]  // 10 contexts
  },
  "quick_start": {
    "load_startup_context": { type: "context", context: "startup" },
    "search_capabilities": { type: "discover", query: "email" },
    "invoke_memory": { type: "invoke", bundle: "memory", action: "set", args: {...} }
  }
}

// Search for email-related capabilities
kota({ type: "discover", query: "email" })

// Returns:
{
  "matches": [
    {
      "category": "tool",
      "bundle": "gmail",
      "actions": ["list_messages", "send_message", "create_draft"],
      "description": "Gmail integration"
    }
  ]
}
```

**Tool Invocation:**
```typescript
// Set memory (replaces memory_set MCP tool)
kota({
  type: "invoke",
  bundle: "memory",
  action: "set",
  args: { key: "theme", value: "dark" }
})

// Same result as calling memory_set directly, but:
// - No need to know tool exists
// - Agent discovered it via kota({ type: "discover", query: "storage" })
```

**Context Loading:**
```typescript
// Load startup context (replaces /kota-startup slash command)
kota({ type: "context", context: "startup" })

// Returns synthesized context:
{
  "context_name": "startup",
  "loaded_at": "2025-11-27T15:00:00Z",
  "data": {
    "current_date": "2025-11-27",
    "identity": { /* from KOTA.md */ },
    "recent_memories": [...],
    "calendar_today": [...],
    "slack_urgent": [...],
    "work_context": {...}
  },
  "next_steps": [
    "Check calendar for today's meetings",
    "Review Slack for client messages",
    "Update memory with session notes at end"
  ]
}

// Agent gets exactly what they need, when they need it
// No 50k token dump at session start
```

---

## Layer 2: Context Bundles

### What Are Context Bundles?

Context bundles are **executable workflows** that replace slash commands. They:
- Fetch data from multiple handlers
- Synthesize it into a coherent narrative
- Return structured output
- Are discoverable via `kota({ type: "discover" })`
- Cache results (5-minute TTL)

### Bundle Registry

| Bundle | Replaces | Data Sources | Output |
|--------|----------|--------------|--------|
| `startup` | `/kota-startup` | memory, calendar, slack, whoop, git | Full session context |
| `geosync` | `/geosync-context` | slack, github, rize, memory | Client situation report |
| `refresh` | `/context-refresh` | memory, git, slack, calendar | Quick re-orientation |
| `daily` | `/daily-snapshot` | github, rize, kwc, whoop | Progress capture |
| `weekly` | `/weekly-review` | All sources | Weekly synthesis |
| `memory-audit` | `/memory-audit` | memory | Memory health check |
| `pattern` | `/pattern-extraction` | memory, daily logs | Pattern identification |
| `decision` | `/decision-review` | memory, daily logs | Decision tracking |

### Context Bundle Implementation

**File:** `src/contexts/startup.ts`

```typescript
import type { ContextBundle, ContextResult } from '../types/context.js';

export const startupBundle: ContextBundle = {
  name: 'startup',
  description: 'Full session initialization context',
  tags: ['core', 'session'],

  async execute(opts: { handlers: HandlerRegistry; cache: ContextCache }) {
    const { handlers, cache } = opts;

    // Check cache first
    const cached = cache.get('startup');
    if (cached && !opts.refresh) return cached;

    // Gather data from handlers
    const [memories, calendar, slack, whoop] = await Promise.all([
      handlers.execute('memory', 'get', { query: 'current_work_context' }),
      handlers.execute('calendar', 'list_events', { start: 'today', end: 'today+1d' }),
      handlers.execute('slack', 'get_messages', { channel: 'D098X745TDY', limit: 5 }),
      handlers.execute('whoop', 'get_recovery', { limit: 1 })
    ]);

    // Synthesize
    const result: ContextResult = {
      context_name: 'startup',
      loaded_at: new Date().toISOString(),
      data: {
        current_date: new Date().toISOString().split('T')[0],
        identity: 'KOTA - Knowledge-Oriented Thinking Aide',
        recent_memories: memories,
        calendar_today: calendar.events,
        slack_urgent: slack.messages.filter(m => m.unread),
        recovery_today: whoop.recovery?.[0]
      },
      next_steps: [
        'Check calendar for today\'s meetings',
        'Review Slack for client messages (especially Sunil)',
        'Update memory with session notes at end'
      ],
      ttl_seconds: 300  // Cache for 5 minutes
    };

    cache.set('startup', result, 300);
    return result;
  }
};
```

### Context Bundle Benefits

**Before (Slash Command):**
```markdown
# /kota-startup
1. Read KOTA.md
2. Run date command
3. Call memory_get for current_work_context
4. Call calendar_list_events for today
5. Call slack_get_messages for Sunil
6. Call whoop_get_recovery for latest
7. Synthesize into narrative
8. Present to user
```
- Agent must parse markdown
- Execute 6+ separate tool calls
- No caching
- No discoverability

**After (Context Bundle):**
```typescript
kota({ type: "context", context: "startup" })
```
- Single call
- Automatic data fetching
- Built-in caching
- Discoverable via `kota({ type: "discover" })`
- Structured output

---

## Layer 3: Handler Action Routing

### Execution Flow

```typescript
// Agent calls:
kota({ type: "invoke", bundle: "memory", action: "set", args: {...} })

// Internal routing:
1. Validate bundle exists ("memory")
2. Get handler from BundleRegistry
3. Validate action exists ("set")
4. Execute: handler.execute("set", args)
5. Return result

// Same as calling memory_set directly, but discoverable
```

### Handler Metadata

Each handler bundle exposes metadata:
```typescript
{
  "bundle": "memory",
  "description": "Persistent storage for preferences, patterns, state",
  "category": "core",
  "tags": ["storage", "persistence"],
  "actions": [
    {
      "name": "set",
      "description": "Store key/value pair",
      "schema": { key: "string", value: "any", category: "enum?" },
      "example": { key: "theme", value: "dark", category: "preferences" }
    },
    {
      "name": "get",
      "description": "Retrieve by key or fuzzy query",
      "schema": { query: "string" },
      "example": { query: "theme" }
    }
  ]
}
```

---

## Implementation Plan

### Phase 1: Core Entry Point (Week 1)

**Tasks:**
1. Create `src/handlers/kota-entry-point.ts`
2. Implement `kota` MCP tool with 3 request types
3. Implement discovery system (bundle metadata generator)
4. Add handler action routing
5. Register as single MCP tool

**Deliverable:** Agents can discover bundles and invoke actions via `kota()`

**Validation:**
```typescript
// Discovery works
kota({ type: "discover" })

// Invocation works
kota({ type: "invoke", bundle: "memory", action: "set", args: {...} })

// Same result as memory_set, but via unified interface
```

### Phase 2: Context Bundles (Week 2)

**Tasks:**
1. Create `src/contexts/` directory
2. Implement context bundle interface
3. Convert slash commands to context bundles:
   - startup.ts
   - geosync.ts
   - refresh.ts
   - daily.ts
   - weekly.ts
4. Add context caching system
5. Register context bundles in discovery

**Deliverable:** Agents can load context on-demand

**Validation:**
```typescript
// Context loading works
kota({ type: "context", context: "startup" })

// Returns full startup context (replaces /kota-startup)
// Subsequent calls return cached version
```

### Phase 3: Migration & Documentation (Week 3)

**Tasks:**
1. Update README with new single-tool approach
2. Document migration path for existing users
3. Add deprecation warnings to slash commands
4. Create examples for common workflows
5. Performance testing (token count reduction)

**Deliverable:** Complete migration guide, usage docs

**Success Metrics:**
- Session start tokens: 50k → <5k (90% reduction)
- Agent tool choices: 81 → 1 (simpler cognitive load)
- Context loading: upfront → on-demand

---

## Backward Compatibility

### Transition Period

**Months 1-3:**
- ✅ Old MCP tools remain registered (memory_set, gmail_send, etc.)
- ✅ Slash commands still work
- ✅ New `kota` tool available
- ⚠️ Deprecation warnings in responses

**Months 4-6:**
- ⚠️ Old MCP tools issue deprecation warnings
- ✅ Slash commands redirect to context bundles
- ✅ `kota` is primary interface

**Month 7+:**
- ❌ Old MCP tools removed (breaking change)
- ✅ Only `kota` tool exposed
- ✅ Context bundles are standard

### Migration Guide

**For users:**
```
Before: memory_set({ key: "x", value: "y" })
After:  kota({ type: "invoke", bundle: "memory", action: "set", args: { key: "x", value: "y" } })

Before: /kota-startup
After:  kota({ type: "context", context: "startup" })
```

**For agents:**
```
Before: Choose from 81 tools at session start
After:  Call kota({ type: "discover" }) to explore capabilities on-demand
```

---

## Success Criteria

### Quantitative Metrics

- [ ] Session start token count: **<5,000 tokens** (down from 50,000+)
- [ ] Tool registration count: **1 MCP tool** (down from 81)
- [ ] Context load time: **<2 seconds** per bundle
- [ ] Cache hit rate: **>80%** for repeated context loads
- [ ] Discovery query time: **<100ms**

### Qualitative Goals

- [ ] Agents can discover capabilities without documentation
- [ ] Context loading is explicit and on-demand
- [ ] All existing functionality accessible via `kota()`
- [ ] No loss of capability during migration
- [ ] Clear migration path for existing users

---

## Open Questions

1. **Should we keep old tools during transition?**
   - Recommendation: Yes, 6-month deprecation period

2. **How to handle context bundle versioning?**
   - Recommendation: Version in bundle metadata, support v1 indefinitely

3. **Should context bundles be user-extensible?**
   - Recommendation: Phase 2 feature - allow custom bundles in `~/kota_md/contexts/`

4. **How to handle context bundle conflicts?**
   - Recommendation: Last-write-wins with timestamp tracking

5. **Should we support context bundle composition?**
   - Recommendation: Phase 3 feature - allow bundles to reference other bundles

---

## Next Steps

Ready to implement? The recommended approach:

1. **Week 1:** Build core `kota` entry point with discovery + invocation
2. **Week 2:** Convert 3-5 critical slash commands to context bundles
3. **Week 3:** Migration guide, docs, performance validation
4. **Week 4:** User testing, refinement, backward compatibility testing

Total effort: **3-4 weeks** for complete implementation
