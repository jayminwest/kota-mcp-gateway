# Feature: KOTA Entry Point Layer (Issue #17)

## User Story

As a Claude Code user working with KOTA, I want a single, self-documenting entry point (`kota()`) that teaches me how to access different contexts through its responses, so that I can efficiently load relevant information without needing external documentation and reduce token overhead from loading unnecessary context at session start.

**Success Definition:** The `kota()` tool provides guidance when called without parameters, validates scope requests, loads context bundles from YAML files, returns structured context with next-action suggestions, and enables self-directed LLM exploration of available scopes. Session start context is reduced by >60% while maintaining full access to information through on-demand loading.

## Objectives & Non-Goals

**Objectives:**
- Create a single `kota()` MCP tool as the primary entry point for context access
- Implement self-documenting behavior that guides LLM usage through responses
- Support scope-based context loading from YAML configuration files
- Provide structured context responses with embedded usage guidance
- Enable scope listing, loading (single/multiple), and metadata inspection
- Support scope editing via `kota.edit()` with git-tracked changes
- Implement scope refresh via `kota.refresh()` to re-fetch data sources
- Store scope configurations in `~/kota_md/scopes/` as YAML files
- Reduce session startup context by deferring data loading to on-demand requests

**Non-Goals:**
- Automatic scope recommendation based on conversation analysis (future enhancement)
- Real-time scope updates without explicit refresh (future enhancement)
- Scope inheritance or composition (future enhancement)
- Migration of existing context snapshot or memory data to scope format
- UI for scope management (file-based and MCP tool only)
- Integration with Claude Desktop's native context switching
- Automatic data fetcher execution on scope load (MVP: return static config, phase 2: execute fetchers)

## Current State & Constraints

**Current Behavior:**
- Context is primarily loaded at session start via multiple handler tools
- The gateway registers 18+ handler bundles (gmail, calendar, memory, daily, etc.) at startup
- Each handler exposes 3-15 tools, creating a large tool surface area
- Context management exists via `toolkit_get_context` and `toolkit_set_context` for bundle enabling/disabling
- Memory handler provides key-value storage with fuzzy search (`memory_get`, `memory_set`)
- No dedicated scope or context bundling layer exists
- Large initial context loads increase token usage and cognitive overhead

**Technical Constraints:**
- Must integrate with existing handler architecture (BaseHandler pattern)
- Should leverage existing utilities (logger, config, memory store, file I/O)
- Scope files must be git-friendly (plain text YAML, readable diffs)
- Must handle missing scope files, invalid YAML, and fetch errors gracefully
- Data fetchers reference existing handler tools (e.g., `slack_get_messages`, `memory_get`)
- Git integration for scope edits requires safe commit practices (user attribution, meaningful messages)

**Dependencies:**
- Existing handler infrastructure (`BaseHandler`, `ToolSpec`, MCP SDK)
- YAML parsing library (install `js-yaml` or equivalent)
- File system utilities for reading/writing scope configs
- Git CLI for committing scope changes (via Bash utility)
- Existing handler tools for data fetching (slack, rize, github, memory, etc.)

## Experience & Acceptance Criteria

### MCP Tool Flows

**Case 1: No Scope Provided (Guidance)**
```typescript
// MCP tool call
kota()

// Response
{
  "status": "guidance",
  "message": "Scope required. Specify which context you need.",
  "usage": {
    "single_scope": "kota('GEOSYNC')",
    "multiple_scopes": "kota(['GEOSYNC', 'PERSONAL'])",
    "list_all_scopes": "kota('list')"
  },
  "available_scopes": [
    {"name": "GEOSYNC", "description": "Client work for Sunil Bollera"},
    {"name": "PERSONAL", "description": "Personal life context"},
    {"name": "KOTADB", "description": "Product development context"},
    {"name": "FINANCIAL", "description": "Financial tracking"},
    {"name": "PROFESSIONAL_MISC", "description": "Miscellaneous work"}
  ]
}
```

**Case 2: Invalid Scope**
```typescript
// MCP tool call
kota('NOTREAL')

// Response
{
  "status": "error",
  "message": "Scope 'NOTREAL' not found",
  "available_scopes": ["GEOSYNC", "PERSONAL", "KOTADB", "FINANCIAL", "PROFESSIONAL_MISC"],
  "usage": {
    "correct_format": "kota('GEOSYNC')",
    "see_all": "kota('list')"
  }
}
```

**Case 3: List All Scopes**
```typescript
// MCP tool call
kota('list')

// Response
{
  "status": "success",
  "available_scopes": [
    {
      "name": "GEOSYNC",
      "description": "Client work for Sunil Bollera",
      "last_modified": "2025-11-25T10:00:00Z",
      "modified_by": "jaymin",
      "data_sources": ["memories", "slack", "github", "rize", "files"],
      "tools": 3,
      "file_path": "~/kota_md/scopes/geosync.scope.yaml"
    },
    {
      "name": "PERSONAL",
      "description": "Personal life context",
      "last_modified": "2025-11-20T08:00:00Z",
      "modified_by": "kota-agent",
      "data_sources": ["calendar", "whoop", "daily_logs"],
      "tools": 5,
      "file_path": "~/kota_md/scopes/personal.scope.yaml"
    }
  ],
  "usage": {
    "load_scope": "kota('GEOSYNC')",
    "load_multiple": "kota(['GEOSYNC', 'PERSONAL'])"
  }
}
```

**Case 4: Successful Load (Single Scope)**
```typescript
// MCP tool call
kota('GEOSYNC')

// Response
{
  "status": "success",
  "scope": "GEOSYNC",
  "loaded_at": "2025-11-25T10:30:00Z",
  "last_modified": "2025-11-25T10:00:00Z",
  "modified_by": "jaymin",

  "context": {
    "overview": "Client work for Sunil Bollera on GeoSync platform. Phase 1 reduced to #220 + #222, $4k total.",
    "memories": {
      "slack.sunil": { /* memory data */ },
      "geosync_boundary_nov_2025": { /* memory data */ }
    },
    "recent_activity": {
      "slack": [ /* recent messages */ ],
      "rize": { "hours_this_week": 12 }
    },
    "files": [
      {
        "path": "knowledge/businesses/active/geosync/geosync-phase1-sow-nov2025.md",
        "excerpt": "First 200 characters..."
      }
    ]
  },

  "exposed_tools": [
    "slack_get_messages",
    "github_activity_summary",
    "rize_time_entries"
  ],

  "next_actions": {
    "edit_this_scope": {
      "tool": "kota.edit",
      "example": "kota.edit('GEOSYNC', {add: {'data_sources.files': [...]}}, 'Need SOW reference')"
    },
    "load_additional": {
      "tool": "kota",
      "example": "kota('PERSONAL')"
    },
    "refresh_data": {
      "tool": "kota.refresh",
      "example": "kota.refresh('GEOSYNC')"
    }
  }
}
```

**Case 5: Edit Scope**
```typescript
// MCP tool call
kota.edit(
  'GEOSYNC',
  {
    'add': {
      'data_sources.recent_activity.github': {
        'fetch': 'github_activity_summary',
        'params': {'repo': 'jayminwest/geosync-platform', 'days': 7}
      }
    }
  },
  'Need recent commit activity for context'
)

// Response
{
  "status": "success",
  "scope": "GEOSYNC",
  "modification": "added data_sources.recent_activity.github",
  "git_commit": "abc123def",
  "commit_message": "Agent: Need recent commit activity for context",
  "file_path": "~/kota_md/scopes/geosync.scope.yaml",

  "next_actions": {
    "reload_scope": "kota('GEOSYNC') # to see updated context",
    "undo": "git revert abc123def # if modification was incorrect"
  }
}
```

**Case 6: Refresh Scope**
```typescript
// MCP tool call
kota.refresh('GEOSYNC')

// Response
{
  "status": "success",
  "scope": "GEOSYNC",
  "refreshed_at": "2025-11-25T11:00:00Z",
  "changes_detected": {
    "slack": "2 new messages since last load",
    "github": "no changes",
    "rize": "4 new hours logged"
  },
  "next_actions": {
    "view_updated": "kota('GEOSYNC') # to see refreshed context"
  }
}
```

### Scope Configuration Format

**File Location:** `~/kota_md/scopes/`

**Example: `geosync.scope.yaml`**
```yaml
scope:
  name: GEOSYNC
  description: "Client work for Sunil Bollera / GeoSync platform"
  last_modified: "2025-11-25T10:00:00Z"
  modified_by: "jaymin"

overview: |
  Client work for Sunil Bollera on GeoSync platform.
  Phase 1 reduced to #220 + #222, $4k total.
  Focus: MVP delivery by end of Q4 2025.

data_sources:
  memories:
    - key: "slack.sunil"
      fetch: memory_get
      params:
        query: "slack.sunil"
    - key: "geosync_boundary_nov_2025"
      fetch: memory_get
      params:
        query: "geosync_boundary_nov_2025"

  recent_activity:
    slack:
      fetch: slack_get_messages
      params:
        limit: 5
        channel: "sunil-dm"
    rize:
      fetch: rize_time_entries
      params:
        client_name: "Sunil Bollera"
        days: 7

  files:
    - path: "knowledge/businesses/active/geosync/geosync-phase1-sow-nov2025.md"
      excerpt_length: 200

exposed_tools:
  - slack_get_messages
  - github_activity_summary
  - rize_time_entries
```

**YAML Schema:**
- `scope.name` (string, required): Uppercase scope identifier
- `scope.description` (string, required): Human-readable description
- `scope.last_modified` (ISO 8601 string, required): Last modification timestamp
- `scope.modified_by` (string, required): Username or agent identifier
- `overview` (string, optional): Narrative overview of the scope
- `data_sources` (object, optional): Nested data fetching specifications
  - Each key is a category (e.g., `memories`, `recent_activity`, `files`)
  - Each value specifies `fetch` (handler tool name) and `params` (tool arguments)
- `exposed_tools` (array of strings, optional): Handler tools to highlight for this scope

### Acceptance Criteria Checklist

- [ ] `kota()` tool registered with MCP server
- [ ] Calling `kota()` without arguments returns guidance with available scopes
- [ ] Calling `kota('list')` returns metadata for all scopes
- [ ] Calling `kota('SCOPE')` loads scope from YAML and returns context
- [ ] Calling `kota(['SCOPE1', 'SCOPE2'])` loads multiple scopes
- [ ] Invalid scope names return helpful error messages with available scopes
- [ ] Missing scope files handled gracefully with error status
- [ ] Malformed YAML logged as error and returns graceful failure
- [ ] `kota.edit()` updates scope YAML and commits change to git
- [ ] `kota.refresh()` re-executes data fetchers and updates cached context
- [ ] Scope directory created automatically if missing (`~/kota_md/scopes/`)
- [ ] All responses include `next_actions` guidance
- [ ] Data fetchers execute and populate context structure
- [ ] File path resolution works for `~/kota_md/` references
- [ ] Git commits include agent attribution and reason

## Architecture & Data Changes

### Kota Handler (New Handler)

**New File: `src/handlers/kota.ts`**

Responsibilities:
- Register `kota`, `kota.edit`, and `kota.refresh` MCP tools
- Load scope YAML files from `~/kota_md/scopes/`
- Parse and validate YAML structure
- Execute data fetchers (call other handler tools)
- Build structured context responses with guidance
- Handle git commits for scope edits
- Cache loaded scopes to avoid redundant fetches

**Tool Specifications:**

1. **`kota(scope)`**
   - Input: `{ scope?: string | string[] }`
   - Returns: Guidance, error, list, or loaded context
   - Supports: no args (guidance), 'list', single scope, array of scopes

2. **`kota.edit(scope, modification, reason)`**
   - Input: `{ scope: string, modification: object, reason: string }`
   - Modification format: `{ add: {...}, remove: {...}, update: {...} }`
   - Returns: Success with git commit hash and undo instructions

3. **`kota.refresh(scope)`**
   - Input: `{ scope: string }`
   - Returns: Refresh status with detected changes

### Scope Manager Utility

**New File: `src/utils/scope-manager.ts`**

Responsibilities:
- Resolve `~/kota_md/scopes/` directory path
- List available scope files (*.scope.yaml)
- Load and parse YAML scope configuration
- Validate scope structure against schema
- Save scope configuration with atomic writes
- Execute data fetcher calls via handler registry
- Build context structure from fetcher results
- Detect changes between cached and refreshed data

**Interface:**
```typescript
export interface ScopeConfig {
  scope: {
    name: string;
    description: string;
    last_modified: string;
    modified_by: string;
  };
  overview?: string;
  data_sources?: Record<string, any>;
  exposed_tools?: string[];
}

export interface LoadedScope {
  name: string;
  loaded_at: string;
  last_modified: string;
  modified_by: string;
  context: Record<string, any>;
  exposed_tools: string[];
  file_path: string;
}

export class ScopeManager {
  constructor(opts: { logger: Logger; config: HandlerConfig; handlerRegistry: HandlerRegistry });

  async listScopes(): Promise<ScopeMetadata[]>;
  async loadScope(name: string): Promise<LoadedScope>;
  async saveScope(name: string, config: ScopeConfig): Promise<void>;
  async executeFetchers(dataSourcesConfig: any): Promise<Record<string, any>>;
  async refreshScope(name: string): Promise<RefreshResult>;
  resolveScopePath(name: string): string;
}
```

**Implementation Details:**
- Use `os.homedir()` to resolve `~/kota_md/scopes/`
- Use `js-yaml` library for YAML parsing
- Atomic writes: write to `.scope.yaml.tmp`, then `fs.rename()`
- Data fetcher execution: call handler tools via registry lookup
- Error handling: log warnings for missing files, parse errors, fetch failures
- Caching: store loaded scopes in memory with TTL (5 minutes)

### Git Integration Utility

**New File: `src/utils/scope-git.ts`**

Responsibilities:
- Commit scope changes with attribution
- Generate conventional commit messages
- Provide undo instructions

**Interface:**
```typescript
export interface ScopeGitCommitResult {
  commit_hash: string;
  commit_message: string;
  undo_command: string;
}

export class ScopeGitManager {
  constructor(opts: { logger: Logger });

  async commitScopeChange(filePath: string, reason: string, modifiedBy: string): Promise<ScopeGitCommitResult>;
}
```

**Implementation:**
- Execute git commands via `child_process.exec()`
- Commit message format: `feat(scopes): {reason}\n\nModified-By: {modifiedBy}\nGenerated with Claude Code`
- Attribution preserved in commit metadata

### Handler Registry Enhancement

**Update: `src/index.ts`**

The Kota handler needs access to the handler registry to execute data fetchers. We'll expose the registry or a fetch method to the handler.

**Option A: Expose Handler Registry**
```typescript
// In main()
const handlerRegistry = new Map<string, BaseHandler>();

// After registering handlers
for (const [key, { handler }] of registry.getEnabledHandlers()) {
  handlerRegistry.set(key, handler);
}

// Pass to KotaHandler
const kotaHandler = new KotaHandler({ logger, config, handlerRegistry });
```

**Option B: Expose Fetch Function**
```typescript
// Create a fetch function that calls handler tools
async function fetchData(toolName: string, args: any): Promise<any> {
  // Parse tool name: "handler_action"
  // Look up handler in registry
  // Execute handler.execute(action, args)
  // Return result
}

// Pass to KotaHandler
const kotaHandler = new KotaHandler({ logger, config, fetchData });
```

**Recommendation:** Option B is cleaner and maintains encapsulation.

### Startup Integration

**Modified `main()` function in `src/index.ts`:**

```typescript
async function main() {
  const config = loadConfig();
  // ... existing setup ...

  // Create fetch function for data fetchers
  const fetchData = async (toolName: string, args: any): Promise<any> => {
    // Implementation to call handler tools
  };

  // Register Kota handler
  registry.addBundle({
    key: 'kota',
    description: 'Context bundling and scope management',
    autoEnable: true,
    factory: () => new KotaHandler({ logger, config, fetchData }),
    tags: ['core'],
  });

  // ... rest of initialization ...
}
```

### Data Storage

**Location:** `~/kota_md/scopes/`

**File Naming:** `{scope_name}.scope.yaml` (lowercase with underscores)

**Example Files:**
- `~/kota_md/scopes/geosync.scope.yaml`
- `~/kota_md/scopes/personal.scope.yaml`
- `~/kota_md/scopes/kotadb.scope.yaml`
- `~/kota_md/scopes/financial.scope.yaml`

**Git Tracking:**
- Scope files stored in `~/kota_md/` (assumed to be a git repository)
- Each scope edit creates a git commit
- Commit history provides audit trail

## Git & Branch Strategy

- **Base branch:** `develop`
- **Working branch:** `feature/17-kota-entry-point`
- **Commands:**
  ```bash
  git checkout develop && git pull origin develop
  git checkout -b feature/17-kota-entry-point
  ```
- **Commit strategy:** Conventional Commits referencing issue #17
  - `feat(handlers): add kota entry point handler (#17)`
  - `feat(utils): add scope manager utility (#17)`
  - `feat(utils): add scope git integration (#17)`
  - `docs(handlers): document kota entry point layer (#17)`
  - `test(handlers): add kota handler tests (#17)`

## Phased Implementation Plan

IMPORTANT: Execute every phase in order, top to bottom.

### Phase 1: Project Setup & Dependencies

**Objective:** Install dependencies and set up scope directory structure.

**Tasks:**
1. Install `js-yaml` dependency: `npm install js-yaml`
2. Install type definitions: `npm install -D @types/js-yaml`
3. Create `~/kota_md/scopes/` directory if missing
4. Verify git repository exists in `~/kota_md/`
5. Run `npm run typecheck` and `npm run lint` to ensure clean baseline
6. Commit: `chore(deps): add js-yaml for scope configuration parsing (#17)`

**Validation:**
```bash
npm run typecheck
npm run lint
ls -la ~/kota_md/scopes/
```

### Phase 2: Scope Manager Utility

**Objective:** Create core utility for loading, parsing, and managing scope configurations.

**Tasks:**
1. Create `src/utils/scope-manager.ts`
2. Implement `ScopeManager` class with:
   - `constructor(opts)`
   - `resolveScopePath(name: string): string`
   - `listScopes(): Promise<ScopeMetadata[]>`
   - `loadScopeConfig(name: string): Promise<ScopeConfig>`
   - `saveScopeConfig(name: string, config: ScopeConfig): Promise<void>`
3. Add YAML parsing with error handling
4. Add file path resolution for `~/kota_md/scopes/`
5. Add validation for scope structure
6. Implement atomic writes for scope saves
7. Write unit tests for scope manager
8. Run `npm run typecheck && npm run lint`
9. Commit: `feat(utils): add scope manager for YAML configuration (#17)`

**Validation:**
```bash
npm run typecheck
npm run lint
npm test -- scope-manager
```

### Phase 3: Scope Git Integration

**Objective:** Implement git commit functionality for scope edits.

**Tasks:**
1. Create `src/utils/scope-git.ts`
2. Implement `ScopeGitManager` class with:
   - `constructor(opts)`
   - `commitScopeChange(filePath, reason, modifiedBy): Promise<ScopeGitCommitResult>`
3. Add git command execution via `child_process`
4. Format commit messages with attribution
5. Generate undo instructions
6. Handle git errors gracefully (not a git repo, uncommitted changes, etc.)
7. Write unit tests for git manager
8. Run `npm run typecheck && npm run lint`
9. Commit: `feat(utils): add git integration for scope changes (#17)`

**Validation:**
```bash
npm run typecheck
npm run lint
npm test -- scope-git
# Manual test: create scope file, commit change, verify git log
```

### Phase 4: Data Fetcher Integration

**Objective:** Enable scope manager to execute data fetchers via handler tools.

**Tasks:**
1. Extend `ScopeManager` with `executeFetchers(dataSourcesConfig): Promise<Record<string, any>>`
2. Create fetch function in `src/index.ts` that calls handler tools
3. Implement data source parsing (extract tool name and params)
4. Execute handler tools and collect results
5. Handle fetch errors gracefully (tool not found, execution failure)
6. Add caching for fetched data (5-minute TTL)
7. Implement `refreshScope(name: string): Promise<RefreshResult>`
8. Test with mock handlers
9. Run `npm run typecheck && npm run lint`
10. Commit: `feat(utils): add data fetcher execution to scope manager (#17)`

**Validation:**
```bash
npm run typecheck
npm run lint
npm test -- scope-manager
```

### Phase 5: Kota Handler Implementation

**Objective:** Create the main Kota handler with MCP tools.

**Tasks:**
1. Create `src/handlers/kota.ts`
2. Implement `KotaHandler` class extending `BaseHandler`
3. Define tool specifications for `kota`, `kota.edit`, `kota.refresh`
4. Implement `execute()` method with action routing
5. Implement `handleKota(args)` for scope loading:
   - No args → return guidance
   - 'list' → return scope metadata
   - Single scope → load and return context
   - Array of scopes → load multiple and merge contexts
6. Implement `handleKotaEdit(args)` for scope modification
7. Implement `handleKotaRefresh(args)` for scope refresh
8. Add self-documenting responses with `next_actions`
9. Add error handling for invalid scopes, missing files, parse errors
10. Write unit tests for kota handler
11. Run `npm run typecheck && npm run lint`
12. Commit: `feat(handlers): implement kota entry point handler (#17)`

**Validation:**
```bash
npm run typecheck
npm run lint
npm test -- kota
npm run build
```

### Phase 6: Handler Registration & Integration

**Objective:** Register Kota handler in the main server and wire up dependencies.

**Tasks:**
1. Update `src/index.ts` to create fetch function for data fetchers
2. Register Kota handler bundle in bundle definitions
3. Set `autoEnable: true` and add to 'core' tags
4. Pass `fetchData` function to KotaHandler constructor
5. Update handler count in README if needed
6. Test startup with kota bundle enabled
7. Verify kota tools registered in MCP server
8. Run `npm run build && npm start`
9. Check health endpoint and MCP tool list
10. Commit: `feat(server): register kota handler bundle (#17)`

**Validation:**
```bash
npm run build
npm start &
sleep 5
curl http://localhost:8084/health
# MCP client: list tools, verify kota, kota.edit, kota.refresh present
```

### Phase 7: Create Example Scopes

**Objective:** Create example scope files for testing and demonstration.

**Tasks:**
1. Create `~/kota_md/scopes/geosync.scope.yaml` with GEOSYNC example
2. Create `~/kota_md/scopes/personal.scope.yaml` with PERSONAL example
3. Create `~/kota_md/scopes/kotadb.scope.yaml` with KOTADB example
4. Validate YAML syntax with `yamllint` or equivalent
5. Test loading each scope via MCP client
6. Verify data fetchers execute correctly
7. Test editing a scope and verify git commit
8. Test refreshing a scope and verify changes detected
9. Commit example scopes to `~/kota_md/` repository
10. Document example scope patterns

**Validation:**
```bash
# MCP client tests:
# 1. kota() → expect guidance
# 2. kota('list') → expect 3 scopes
# 3. kota('GEOSYNC') → expect loaded context
# 4. kota(['GEOSYNC', 'PERSONAL']) → expect merged context
# 5. kota.edit('GEOSYNC', {...}, 'test edit') → expect git commit
# 6. kota.refresh('GEOSYNC') → expect refresh status
```

### Phase 8: Documentation

**Objective:** Comprehensive documentation for Kota entry point layer.

**Tasks:**
1. Create `docs/handlers/KOTA.md` with:
   - Overview of Kota entry point concept
   - Tool reference (`kota`, `kota.edit`, `kota.refresh`)
   - Scope configuration format (YAML schema)
   - Data fetcher configuration examples
   - Usage examples for common scenarios
   - Troubleshooting section
2. Update `README.md`:
   - Add "Context Bundling" section
   - Document `kota()` tool usage
   - Link to `docs/handlers/KOTA.md`
3. Update `docs/handlers/README.md` to include Kota handler
4. Add help resource in `src/index.ts` (`help://kota/usage`)
5. Add MCP prompt for kota examples
6. Run `npm run lint` on documentation
7. Commit: `docs(handlers): add kota entry point documentation (#17)`

**Validation:**
```bash
npm run lint
cat docs/handlers/KOTA.md
grep -i kota README.md
```

### Phase 9: Testing & Validation

**Objective:** Comprehensive testing across all scenarios.

**Tasks:**
1. Unit tests:
   - `src/utils/scope-manager.test.ts` (load, save, list, validate)
   - `src/utils/scope-git.test.ts` (commit, attribution, undo)
   - `src/handlers/kota.test.ts` (all tool actions, error cases)
2. Integration tests:
   - Startup with kota handler enabled
   - Load scope with data fetchers
   - Edit scope and verify git commit
   - Refresh scope and detect changes
   - Error handling (missing scope, invalid YAML, fetch failure)
3. Manual QA scenarios:
   - Fresh installation (no scopes)
   - Create scope via `kota.edit`
   - Load multiple scopes simultaneously
   - Refresh stale scope
   - Invalid scope name handling
   - Malformed YAML handling
4. Performance testing:
   - Measure scope load time (target < 500ms)
   - Measure cache hit rate
   - Verify token reduction in session start
5. Document test results
6. Commit: `test(handlers): add comprehensive kota handler tests (#17)`

**Validation Commands:**
```bash
npm run typecheck
npm run lint
npm run build
npm test
npm start &
sleep 5

# Manual MCP client tests (via Claude Code or npx client)
# 1. kota() → guidance with available scopes
# 2. kota('INVALID') → error with suggestions
# 3. kota('list') → scope metadata list
# 4. kota('GEOSYNC') → loaded context with next_actions
# 5. kota(['GEOSYNC', 'PERSONAL']) → merged contexts
# 6. kota.edit('GEOSYNC', {add: {...}}, 'test reason') → git commit
# 7. kota.refresh('GEOSYNC') → refresh status
# 8. Verify ~/kota_md/scopes/ git log shows commits

# Health check
curl http://localhost:8084/health
```

### Phase 10: Git & PR Preparation

**Objective:** Prepare clean commit history and create pull request.

**Tasks:**
1. Review all commits for conventional commit format
2. Ensure all commits reference issue #17
3. Squash any fixup commits
4. Rebase on latest `develop`
5. Run full test suite and validation
6. Push branch to remote
7. Create pull request with comprehensive description
8. Link to issue #17
9. Request review

**Commands:**
```bash
git fetch origin develop
git rebase origin/develop
git log --oneline feature/17-kota-entry-point
npm run typecheck && npm run lint && npm run build && npm test
git push -u origin feature/17-kota-entry-point

gh pr create --base develop --head feature/17-kota-entry-point \
  --title "feat: kota entry point layer for context bundling (#17)" \
  --body-file docs/specs/feature-17-kota-entry-point.md
```

## Testing & QA Strategy

### Unit Tests

**`src/utils/scope-manager.test.ts`:**
- List scopes from directory
- Load valid scope configuration
- Handle missing scope file (returns null)
- Handle malformed YAML (returns null, logs error)
- Save scope with atomic write
- Validate scope structure (required fields)
- Execute data fetchers (mock handlers)
- Refresh scope and detect changes

**`src/utils/scope-git.test.ts`:**
- Commit scope change with attribution
- Generate conventional commit message
- Provide undo instructions
- Handle git errors gracefully (not a repo, uncommitted changes)

**`src/handlers/kota.test.ts`:**
- `kota()` with no args returns guidance
- `kota('list')` returns scope metadata
- `kota('SCOPE')` loads and returns context
- `kota(['SCOPE1', 'SCOPE2'])` loads multiple scopes
- Invalid scope returns error with suggestions
- `kota.edit()` updates YAML and commits to git
- `kota.refresh()` re-executes fetchers and detects changes
- Error handling for missing files, parse errors, fetch failures

### Integration Tests

**Startup scenarios:**
1. Gateway starts with kota handler registered
2. Kota tools appear in MCP tool list
3. Scope directory created if missing

**Runtime scenarios:**
1. Load scope with multiple data sources
2. Data fetchers execute and populate context
3. Edit scope and verify file updated + git commit
4. Refresh scope and verify changes detected
5. Cache invalidation after refresh
6. Multiple scope loading merges contexts correctly

### Manual QA Scenarios

1. **Fresh Installation:**
   - Start gateway without scope files
   - Call `kota()` (expect guidance, empty scope list)
   - Create first scope via file or edit tool
   - Verify scope loads correctly

2. **Scope Loading:**
   - Call `kota('GEOSYNC')` with existing scope
   - Verify all data sources fetched
   - Check `next_actions` guidance present
   - Load multiple scopes and verify merged response

3. **Scope Editing:**
   - Edit scope via `kota.edit()`
   - Verify YAML file updated
   - Check git commit created with attribution
   - Reload scope and verify changes applied

4. **Error Handling:**
   - Request invalid scope name (expect helpful error)
   - Create malformed YAML (expect graceful failure)
   - Trigger data fetcher error (expect partial context with error note)

5. **Performance:**
   - Load scope with 5+ data sources
   - Measure total load time (target < 500ms)
   - Verify caching reduces subsequent loads

### Performance Testing

**Scope Load Time:**
- Measure time to load scope with 5 data sources
- Target: < 500ms per scope
- Cache hit should be < 10ms

**Token Reduction:**
- Measure session start context before Kota
- Measure session start context after Kota (with on-demand loading)
- Target: >60% reduction in upfront context

**Cache Effectiveness:**
- Monitor cache hit rate for repeated loads
- Verify cache invalidation after refresh
- Check memory usage for cached scopes

## Validation Commands

**Pre-deployment checks:**
```bash
# Linting and type checking
npm run lint
npm run typecheck

# Build verification
npm run build

# Test suite
npm test

# Startup health check
npm start &
sleep 5
curl http://localhost:8084/health
# Expected: {"status":"ok","uptime":...}

# Scope directory check
ls -la ~/kota_md/scopes/
# Expected: *.scope.yaml files present

# MCP tool verification (via MCP client)
# 1. kota() → guidance response
# 2. kota('list') → scope metadata
# 3. kota('SCOPE') → loaded context
# 4. kota.edit('SCOPE', {...}, 'reason') → git commit
# 5. kota.refresh('SCOPE') → refresh status

# Git verification
cd ~/kota_md
git log --oneline --grep="feat(scopes)" | head -5
# Expected: scope edit commits with attribution
```

**Post-deployment validation:**
```bash
# Health endpoint
curl http://localhost:8084/health

# Scope directory exists
ls -la ~/kota_md/scopes/

# Log inspection for kota bundle registration
# Should see: "Bundle registered: kota"
# Should see: "Tool registered: kota"
```

## Release & Follow-Up

### Deployment Considerations

1. **Backward Compatibility:**
   - No breaking changes to existing handlers or tools
   - Kota handler is additive (new functionality)
   - Existing context management tools remain functional
   - Gateway operates normally without scope files

2. **Migration Path:**
   - No forced migration required
   - Users can gradually adopt scope-based workflows
   - Documentation includes migration guide from memory/context_snapshot
   - Example scopes provided for common use cases

3. **Rollback Plan:**
   - If issues occur, disable kota bundle via `toolkit_disable_bundle`
   - Restart gateway without kota handler
   - Scope files preserved (no data loss)
   - Fall back to existing handler-based workflows

### Documentation Updates

**Files to update:**
- [x] `docs/specs/feature-17-kota-entry-point.md` (this file)
- [ ] `docs/handlers/KOTA.md` (new file with comprehensive guide)
- [ ] `README.md` (add Context Bundling section)
- [ ] `docs/handlers/README.md` (list Kota handler)

**Documentation sections to add:**

**README.md:**
```markdown
## Context Bundling

KOTA provides a self-documenting entry point for context access via the `kota()` tool. Instead of loading all context at session start, you can load specific scopes on-demand.

**Quick Start:**
```typescript
// List available scopes
kota('list')

// Load a scope
kota('GEOSYNC')

// Load multiple scopes
kota(['GEOSYNC', 'PERSONAL'])

// Edit a scope
kota.edit('GEOSYNC', {add: {...}}, 'Adding GitHub activity')

// Refresh a scope
kota.refresh('GEOSYNC')
```

**Scope Configuration:**
Scopes are defined in YAML files at `~/kota_md/scopes/`. Each scope specifies data sources to fetch and tools to expose.

See [docs/handlers/KOTA.md](docs/handlers/KOTA.md) for full documentation.
```

### Analytics & Telemetry

**Metrics to track (if analytics implemented in future):**
- Scope load frequency by scope name
- Average data fetchers per scope
- Scope edit frequency
- Scope refresh frequency
- Cache hit rate
- Average load time per scope
- Token reduction percentage vs. traditional context loading
- Most common scope combinations

### Post-Launch Review

**Items to monitor:**
- User adoption of scope-based workflows
- Performance impact of data fetcher execution
- Scope file corruption or git conflicts
- Feature requests for scope composition, inheritance
- Common pain points in scope configuration

**Potential Future Enhancements:**
- Automatic scope recommendation based on conversation context
- Scope inheritance and composition (base scopes + overrides)
- Real-time scope updates without explicit refresh
- Scope templates for common patterns (client work, personal, finance)
- Integration with Claude Desktop context switching
- Scope dependency resolution (warn if data fetcher tool unavailable)
- Hot-reload scope changes without restart
- Scope versioning and rollback
- Scope sharing across users (team contexts)
- Visual scope editor (web UI)

## Notes

**Design Decisions:**

1. **YAML vs JSON:**
   - Chose YAML for human readability and editability
   - Supports comments for documentation
   - More forgiving syntax for manual editing
   - Standard format for configuration files

2. **Scope Storage Location:**
   - `~/kota_md/scopes/` chosen to align with existing `~/kota_md/` workspace
   - Git-tracked for version control and audit trail
   - Separate from gateway code for user ownership

3. **Self-Documenting Responses:**
   - Every response includes `next_actions` with usage examples
   - Reduces need for external documentation
   - Teaches LLM how to use the tool through responses
   - Enables self-directed exploration

4. **Data Fetcher Design:**
   - MVP: Return static configuration (no fetcher execution)
   - Phase 2: Execute fetchers and populate context
   - Deferred to reduce initial complexity
   - Allows testing of core tool flow before adding fetcher logic

5. **Git Integration:**
   - Each scope edit creates a git commit
   - Attribution preserved in commit metadata
   - Enables undo via git revert
   - Provides audit trail for agent modifications

6. **Caching Strategy:**
   - 5-minute TTL for loaded scopes
   - Reduces redundant fetches within a session
   - Explicit refresh available via `kota.refresh()`
   - Balance between freshness and performance

**Open Questions:**
- Should scopes support inheritance/composition? (Future enhancement)
- Should we validate data fetcher tool names at load time?
- Should scope edits auto-push to remote git repository?
- Should we support scope templates or initialization wizard?
- Should `exposed_tools` automatically register subset of tools?

**Stakeholder Callouts:**
- This feature fundamentally changes how context is loaded in KOTA sessions
- Reduces upfront token usage significantly (target >60% reduction)
- Enables focused, on-demand context loading
- Maintains full backward compatibility with existing workflows
- Provides foundation for future context-aware features
- Aligns with Claude Code's modular, tool-based architecture
