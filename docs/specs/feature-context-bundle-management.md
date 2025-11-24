# Feature: Context-Based Bundle Management

## User Story

As a KOTA gateway user, I want to define active contexts and selectively disable bundles to tailor the MCP gateway to my current workflow, so that I can minimize cognitive overhead by hiding irrelevant tools and improve performance by avoiding unnecessary handler initialization.

**Success Definition:** The gateway reads a `.kota/context.json` file at startup and respects the `disabled_bundles` list, preventing those bundles from auto-enabling. Users can manage contexts and bundle states via MCP tools and the configuration file, with changes persisting across restarts.

## Objectives & Non-Goals

**Objectives:**
- Load context configuration from `~/.kota/context.json` at gateway startup
- Respect `disabled_bundles` list during bundle registration, skipping auto-enable for specified bundles
- Provide MCP tools for runtime context management (`toolkit_set_context`, `toolkit_get_context`, `toolkit_disable_bundle`)
- Persist context changes to the configuration file for durability across restarts
- Support manual editing of `context.json` for power users
- Maintain backward compatibility: if no context file exists, all bundles auto-enable as before

**Non-Goals:**
- Automatic context switching based on time of day, location, or other heuristics (future enhancement)
- Context-specific tool parameter defaults or behavior modifications
- UI for context management (CLI/file-based only for this iteration)
- Integration with external context providers (calendar, location services, etc.)
- Multi-profile support (single context configuration per user)

## Current State & Constraints

**Current Behavior:**
- All handler bundles are defined in `src/index.ts` with `autoEnable: true` (lines 561-695)
- The `BundleRegistry` class (lines 65-143) manages bundle registration and enabling
- `ToolkitHandler` provides `toolkit_list_bundles` and `toolkit_enable_bundle` tools
- No mechanism exists to conditionally disable bundles at startup
- The `~/.kota` directory already exists and contains various subdirectories (`memory`, `conversations`, `logs`, `system`)

**Technical Constraints:**
- Must maintain backward compatibility with existing deployments
- Context configuration should be optional (gateway works without it)
- Must integrate cleanly with the existing `BundleRegistry` architecture
- Should not impact startup performance significantly (< 50ms overhead)
- Must handle file I/O errors gracefully (missing file, parse errors, permission issues)

**Dependencies:**
- Node.js file system APIs for JSON configuration loading
- Existing `BundleRegistry` and `ToolkitHandler` implementations
- `~/.kota` directory structure (already established)

## Experience & Acceptance Criteria

### MCP Tool Flows

**Getting Current Context:**
```typescript
// MCP tool call
toolkit_get_context {}

// Response
{
  "active_contexts": ["work", "health"],
  "disabled_bundles": ["kwc", "spotify", "kasa"],
  "updated": "2025-11-23T17:45:00.000Z",
  "config_path": "/Users/username/.kota/context.json",
  "exists": true
}
```

**Setting Context and Disabled Bundles:**
```typescript
// MCP tool call
toolkit_set_context {
  "active_contexts": ["work", "finance"],
  "disabled_bundles": ["whoop", "kasa", "spotify", "kwc"]
}

// Response
{
  "success": true,
  "active_contexts": ["work", "finance"],
  "disabled_bundles": ["whoop", "kasa", "spotify", "kwc"],
  "updated": "2025-11-23T18:00:00.000Z",
  "persisted": true,
  "restart_required": true,
  "message": "Context updated. Restart the gateway for bundle changes to take effect."
}
```

**Disabling a Bundle (Runtime + Persistence):**
```typescript
// MCP tool call
toolkit_disable_bundle {
  "bundle": "spotify"
}

// Response
{
  "success": true,
  "bundle": "spotify",
  "disabled": true,
  "persisted": true,
  "restart_required": true,
  "message": "Bundle 'spotify' will be disabled on next restart."
}
```

**Enabling a Bundle (Runtime + Persistence):**
```typescript
// MCP tool call (enhanced existing)
toolkit_enable_bundle {
  "bundle": "spotify",
  "persist": true
}

// Response
{
  "bundle": "spotify",
  "enabled": true,
  "alreadyEnabled": false,
  "registeredTools": ["spotify_get_current", "spotify_recent_tracks", ...],
  "persisted": true,
  "message": "Bundle 'spotify' enabled and removed from disabled list."
}
```

### File-Based Configuration

**~/.kota/context.json Schema:**
```json
{
  "active_contexts": ["work", "health", "finance"],
  "disabled_bundles": ["kwc", "spotify", "kasa"],
  "updated": "2025-11-23T17:45:00.000Z"
}
```

**Field Descriptions:**
- `active_contexts` (string[]): Human-readable context labels (informational, not enforced by gateway)
- `disabled_bundles` (string[]): Bundle keys to skip during auto-enable at startup
- `updated` (ISO 8601 string): Timestamp of last configuration update

### Acceptance Criteria Checklist

- [ ] Context configuration loads from `~/.kota/context.json` at gateway startup
- [ ] If context file is missing or malformed, gateway starts normally with all bundles enabled
- [ ] Bundles listed in `disabled_bundles` are not auto-enabled during startup
- [ ] `toolkit_get_context` returns current context state including file existence
- [ ] `toolkit_set_context` updates context file and returns success confirmation
- [ ] `toolkit_disable_bundle` adds bundle to disabled list and persists change
- [ ] `toolkit_enable_bundle` with `persist: true` removes bundle from disabled list
- [ ] Manual edits to `context.json` are respected on next gateway restart
- [ ] Invalid bundle keys in `disabled_bundles` are logged as warnings but don't crash startup
- [ ] Context configuration is documented in README.md and docs/handlers/TOOLKIT.md
- [ ] Unit tests verify context loading, parsing, and error handling
- [ ] Integration test confirms disabled bundles are not registered at startup

## Architecture & Data Changes

### Context Configuration Service

**New File: `src/utils/context-config.ts`**

Responsibilities:
- Load context configuration from `~/.kota/context.json`
- Validate and parse JSON structure
- Save context updates with atomic write (write to temp file, then rename)
- Handle file I/O errors gracefully with appropriate logging
- Provide default context when file is missing

**Interface:**
```typescript
export interface ContextConfig {
  active_contexts: string[];
  disabled_bundles: string[];
  updated: string; // ISO 8601 timestamp
}

export interface ContextConfigService {
  load(): Promise<ContextConfig | null>;
  save(config: ContextConfig): Promise<void>;
  getPath(): string;
  exists(): Promise<boolean>;
}
```

**Implementation Details:**
- Use `os.homedir()` to resolve `~/.kota/context.json` path
- Default context: `{ active_contexts: [], disabled_bundles: [], updated: new Date().toISOString() }`
- Atomic writes: write to `.context.json.tmp`, then `fs.rename()` to `context.json`
- Error handling: log warnings for parse errors, return `null` to allow graceful degradation

### BundleRegistry Enhancements

**Modifications to `src/index.ts` (BundleRegistry class):**

1. **Constructor accepts disabled bundles list:**
```typescript
class BundleRegistry {
  private readonly definitions = new Map<string, BundleDefinition>();
  private readonly order: string[] = [];
  private readonly enabled = new Map<string, { handler: BaseHandler; tools: string[] }>();
  private readonly disabledBundles: Set<string>;

  constructor(private readonly opts: {
    logger: typeof logger;
    mcp: McpServer;
    disabledBundles?: string[];
  }) {
    this.disabledBundles = new Set(opts.disabledBundles ?? []);
  }

  // ...
}
```

2. **Update `addBundle` to respect disabled list:**
```typescript
addBundle(def: BundleDefinition): void {
  if (this.definitions.has(def.key)) {
    throw new Error(`Bundle already registered: ${def.key}`);
  }
  this.definitions.set(def.key, def);
  this.order.push(def.key);

  // Only auto-enable if not in disabled list
  if (def.autoEnable && !this.disabledBundles.has(def.key)) {
    this.enableBundle(def.key);
  } else if (this.disabledBundles.has(def.key)) {
    this.opts.logger.info({ bundle: def.key }, 'Bundle auto-enable skipped (disabled in context)');
  }
}
```

3. **Add method to get disabled bundles:**
```typescript
getDisabledBundles(): string[] {
  return Array.from(this.disabledBundles);
}
```

### ToolkitHandler Enhancements

**New Tools Added:**

1. **`toolkit_get_context`**: Retrieve current context configuration
2. **`toolkit_set_context`**: Update context configuration and persist to file
3. **`toolkit_disable_bundle`**: Add bundle to disabled list and persist

**Enhanced Tool:**

4. **`toolkit_enable_bundle`**: Add optional `persist` parameter to remove from disabled list

**Implementation Approach:**
- Inject `ContextConfigService` into `ToolkitHandler` constructor
- Store reference to `BundleRegistry` to query disabled bundles
- Update `ToolkitApi` interface to include context methods

### Startup Flow Changes

**Modified `main()` function in `src/index.ts`:**

```typescript
async function main() {
  const config = loadConfig();
  // ... existing setup ...

  // Load context configuration
  const contextService = new ContextConfigService({ logger });
  const contextConfig = await contextService.load();
  const disabledBundles = contextConfig?.disabled_bundles ?? [];

  if (disabledBundles.length > 0) {
    logger.info({ disabledBundles }, 'Context configuration loaded, some bundles will be disabled');
  }

  // ... MCP server setup ...

  const registry = new BundleRegistry({
    logger,
    mcp,
    disabledBundles
  });

  // ... rest of initialization ...

  const toolkitApi: ToolkitApi = {
    listBundles: () => registry.listBundles(),
    enableBundle: (bundle: string) => registry.enableBundle(bundle),
    disableBundle: (bundle: string) => registry.disableBundle(bundle),
    getDisabledBundles: () => registry.getDisabledBundles(),
    contextService,
  };

  // ... bundle registration ...
}
```

### Shared Types

**Updates to `src/handlers/toolkit.ts`:**

```typescript
export interface ToolkitApi {
  listBundles(): ToolkitBundleInfo[];
  enableBundle(bundle: string): EnableBundleResult;
  disableBundle(bundle: string): DisableBundleResult;
  getDisabledBundles(): string[];
  contextService: ContextConfigService;
}

export interface DisableBundleResult {
  bundle: string;
  disabled: boolean;
  persisted: boolean;
  restart_required: boolean;
  message: string;
}
```

### Data Storage

**Location:** `~/.kota/context.json`

**Format:**
```json
{
  "active_contexts": ["work", "health"],
  "disabled_bundles": ["kwc", "spotify"],
  "updated": "2025-11-23T17:45:00.000Z"
}
```

**Persistence Strategy:**
- Atomic writes to prevent corruption
- Manual edits supported and encouraged for power users
- Git-friendly format (plain JSON, readable diffs)

## Git & Branch Strategy

- **Base branch:** `develop`
- **Working branch:** `feature/context-bundle-management`
- **Commands:**
  ```bash
  git checkout develop && git pull origin develop
  git checkout -b feature/context-bundle-management
  ```
- **Commit strategy:** Conventional Commits with descriptive messages
  - `feat(toolkit): add context-based bundle management`
  - `feat(config): add context configuration service`
  - `docs(toolkit): document context management tools`
  - `test(toolkit): add context configuration tests`

## Phased Implementation Plan

### Phase 1: Context Configuration Service

**Objective:** Create the core configuration loading and saving utility.

**Tasks:**
1. Create `src/utils/context-config.ts` with `ContextConfigService` class
2. Implement `load()` method with JSON parsing and error handling
3. Implement `save()` method with atomic writes
4. Add helper methods: `getPath()`, `exists()`, `getDefault()`
5. Write unit tests for config service (happy path, missing file, malformed JSON, write errors)
6. Commit: `feat(config): add context configuration service`

**Validation:**
```bash
npm run typecheck
npm run lint
npm test -- context-config
```

### Phase 2: BundleRegistry Integration

**Objective:** Modify `BundleRegistry` to accept and respect disabled bundles list.

**Tasks:**
1. Update `BundleRegistry` constructor to accept `disabledBundles` parameter
2. Modify `addBundle()` to skip auto-enable for disabled bundles
3. Add `getDisabledBundles()` method to registry
4. Add `disableBundle()` method (marks bundle for disable on restart, doesn't unregister)
5. Update startup logs to indicate disabled bundles
6. Test bundle registration with disabled list
7. Commit: `feat(bundles): respect context-based disabled bundles at startup`

**Validation:**
```bash
npm run typecheck
npm run build
# Manual test: create ~/.kota/context.json with disabled_bundles, restart gateway
curl http://localhost:8084/health
# MCP call: toolkit_list_bundles should show disabled bundles as enabled: false
```

### Phase 3: Startup Integration

**Objective:** Load context configuration in `main()` and pass to `BundleRegistry`.

**Tasks:**
1. Import `ContextConfigService` in `src/index.ts`
2. Load context config before creating `BundleRegistry`
3. Pass `disabled_bundles` to registry constructor
4. Add startup logging for context configuration status
5. Handle missing/invalid context files gracefully
6. Test startup with various context configurations (missing, empty, valid, invalid)
7. Commit: `feat(startup): load and apply context configuration`

**Validation:**
```bash
npm run build
# Test 1: No context file (all bundles enabled)
rm ~/.kota/context.json
npm start
# Verify all bundles load

# Test 2: Valid context file (some bundles disabled)
echo '{"active_contexts":["work"],"disabled_bundles":["spotify","kwc"],"updated":"2025-11-23T18:00:00.000Z"}' > ~/.kota/context.json
npm start
# Verify spotify and kwc are NOT enabled
```

### Phase 4: ToolkitHandler Enhancements

**Objective:** Add MCP tools for context management.

**Tasks:**
1. Extend `ToolkitApi` interface with context methods
2. Update `ToolkitHandler` constructor to accept `contextService`
3. Implement `toolkit_get_context` tool
4. Implement `toolkit_set_context` tool with validation and persistence
5. Implement `toolkit_disable_bundle` tool
6. Enhance `toolkit_enable_bundle` with optional `persist` parameter
7. Add input schemas for new tools
8. Write unit tests for toolkit context operations
9. Commit: `feat(toolkit): add context management MCP tools`

**Validation:**
```bash
npm run typecheck
npm run lint
npm test -- toolkit
npm run build && npm start
# MCP calls via client:
# 1. toolkit_get_context {}
# 2. toolkit_set_context {"active_contexts":["work"],"disabled_bundles":["spotify"]}
# 3. Verify ~/.kota/context.json updated
# 4. toolkit_disable_bundle {"bundle":"kwc"}
# 5. toolkit_enable_bundle {"bundle":"spotify","persist":true}
```

### Phase 5: Documentation Updates

**Objective:** Document the new feature for users and developers.

**Tasks:**
1. Update `docs/handlers/TOOLKIT.md` with new context management tools
2. Add Context Management section to `README.md`
3. Create example `~/.kota/context.json` in documentation
4. Document bundle keys for easy reference
5. Add troubleshooting section for context configuration issues
6. Update `.env.example` comments to mention context configuration
7. Commit: `docs(toolkit): document context-based bundle management`

**Validation:**
```bash
npm run lint
git add docs/ README.md .env.example
git status
```

### Phase 6: Testing & Validation

**Objective:** Comprehensive testing across scenarios.

**Tasks:**
1. Integration test: Full startup with context configuration
2. Test invalid bundle keys in disabled list (should log warning, not crash)
3. Test manual file edits (add/remove bundles, change contexts)
4. Test concurrent access (unlikely but should handle gracefully)
5. Test file permission errors (read-only context.json)
6. Performance test: measure startup time impact (< 50ms overhead)
7. Document test scenarios and results
8. Commit: `test(toolkit): add context management integration tests`

**Validation Commands:**
```bash
npm run typecheck
npm run lint
npm run build
npm test
# Manual scenarios:
# 1. Fresh install (no context file)
# 2. Valid context with disabled bundles
# 3. Malformed JSON in context file
# 4. Invalid bundle keys in disabled list
# 5. Manual edit and restart
# 6. MCP tool usage across all new commands
```

### Phase 7: Git & PR Preparation

**Objective:** Prepare clean commit history and create pull request.

**Tasks:**
1. Review all commits for conventional commit format
2. Squash fixup commits if any
3. Rebase on latest `develop`
4. Push branch to remote
5. Create pull request with comprehensive description
6. Link related issues (if any)
7. Request review

**Commands:**
```bash
git status
git log --oneline feature/context-bundle-management
git rebase -i develop
git push -u origin feature/context-bundle-management
gh pr create --base develop --head feature/context-bundle-management \
  --title "feat: context-based bundle management" \
  --body "$(cat docs/specs/feature-context-bundle-management.md)"
```

## Testing & QA Strategy

### Unit Tests

**`src/utils/context-config.test.ts`:**
- Load valid context file
- Load missing context file (returns null)
- Load malformed JSON (returns null, logs error)
- Save context with atomic write
- Handle write permission errors
- Verify path resolution (`~/.kota/context.json`)

**`src/handlers/toolkit.test.ts`:**
- `toolkit_get_context` returns current config
- `toolkit_set_context` validates input and persists
- `toolkit_disable_bundle` adds to disabled list
- `toolkit_enable_bundle` with `persist: true` removes from disabled list
- Invalid bundle keys handled gracefully

### Integration Tests

**Startup scenarios:**
1. No context file → all bundles enabled
2. Empty disabled list → all bundles enabled
3. Valid disabled list → specified bundles not enabled
4. Invalid bundle keys → warning logged, valid bundles processed
5. Malformed JSON → fallback to all enabled, error logged

**Runtime scenarios:**
1. Set context via MCP → file updated
2. Disable bundle via MCP → added to file
3. Enable bundle with persist → removed from file
4. Manual file edit → changes respected on restart

### Manual QA Scenarios

1. **Fresh Installation:**
   - Start gateway without context file
   - Verify all bundles load
   - Create context via `toolkit_set_context`
   - Restart and verify changes applied

2. **Power User Workflow:**
   - Manually edit `~/.kota/context.json`
   - Add multiple bundles to disabled list
   - Restart gateway
   - Verify bundles not loaded
   - Use MCP tool to re-enable one bundle
   - Verify file updated correctly

3. **Error Handling:**
   - Create malformed JSON in context file
   - Start gateway (should succeed with warning)
   - Create read-only context file
   - Attempt `toolkit_set_context` (should fail gracefully)

### Performance Testing

**Startup Time Impact:**
- Measure startup time without context config
- Measure startup time with context config
- Ensure overhead < 50ms
- Profile file I/O operations

**Load Testing:**
- Test with maximum disabled bundles (all but core bundles)
- Verify no memory leaks
- Check log volume (should be reasonable)

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

# MCP tool verification
# (via MCP client like Claude Desktop or npx @modelcontextprotocol/server-http-client)
# 1. toolkit_get_context {}
# 2. toolkit_list_bundles {} (verify disabled bundles show enabled: false)
# 3. toolkit_set_context {"active_contexts":["test"],"disabled_bundles":["spotify"]}
# 4. Restart gateway
# 5. toolkit_list_bundles {} (verify spotify disabled)

# File verification
cat ~/.kota/context.json
# Expected: Valid JSON with updated timestamp

# Bundle status check
# MCP call: toolkit_list_bundles {}
# Verify bundles in disabled_bundles have enabled: false
```

**Post-deployment validation:**
```bash
# Health endpoint
curl http://localhost:8084/health

# Context file check
ls -la ~/.kota/context.json

# Log inspection for context loading
# Should see log line: "Context configuration loaded, some bundles will be disabled"
```

## Release & Follow-Up

### Deployment Considerations

1. **Backward Compatibility:**
   - No breaking changes to existing deployments
   - Gateway works without context file (all bundles enabled)
   - Existing `.env` configuration unchanged

2. **Migration Path:**
   - No migration required for existing users
   - Optional feature, users can adopt gradually
   - Documentation includes examples for common use cases

3. **Rollback Plan:**
   - If issues occur, remove or rename `~/.kota/context.json`
   - Gateway falls back to all-enabled behavior
   - No data loss risk (context file is independent of application data)

### Documentation Updates

**Files to update:**
- [x] `docs/specs/feature-context-bundle-management.md` (this file)
- [ ] `docs/handlers/TOOLKIT.md` (add context management section)
- [ ] `README.md` (add Context Management section after Setup)
- [ ] `.env.example` (add comment about context configuration)

**Documentation sections to add:**

**README.md:**
```markdown
## Context Management

Control which handler bundles load at startup by defining contexts in `~/.kota/context.json`:

```json
{
  "active_contexts": ["work", "health"],
  "disabled_bundles": ["kwc", "spotify", "kasa"],
  "updated": "2025-11-23T17:45:00.000Z"
}
```

**Available Bundle Keys:** toolkit, gmail, calendar, memory, daily, context_snapshot, kwc, content_calendar, whoop, kasa, kraken, rize, slack, spotify, github, stripe, workspace, webhooks, tasks

**MCP Tools:**
- `toolkit_get_context` - View current context configuration
- `toolkit_set_context` - Update contexts and disabled bundles
- `toolkit_disable_bundle` - Disable a bundle (persisted)
- `toolkit_enable_bundle` - Enable a bundle (with `persist: true` to remove from disabled list)

Restart the gateway after context changes to apply bundle enable/disable updates.
```

### Analytics & Telemetry

**Metrics to track (if analytics implemented in future):**
- Context configuration file usage rate
- Most commonly disabled bundles
- Average disabled bundle count per user
- Context switch frequency
- Startup time delta with context configuration

### Post-Launch Review

**Items to monitor:**
- User feedback on context management workflow
- Performance impact on startup time
- Context file corruption issues (if any)
- Feature adoption rate
- Common use cases and patterns

**Potential Future Enhancements:**
- Automatic context switching based on time/location/calendar
- Context-specific tool parameter defaults
- Multiple context profiles with quick switching
- Context templates for common workflows
- Integration with Claude Desktop context switching
- Bundle dependency resolution (warn if disabling bundle with dependents)
- Hot-reload context changes without restart

## Notes

**Design Decisions:**

1. **File-based vs. Memory-based:**
   - Chose file-based (`~/.kota/context.json`) for persistence and manual editability
   - Could integrate with memory handler in future for LLM-driven context management
   - File format is Git-friendly for version control

2. **Restart Required:**
   - Bundle enable/disable requires restart for simplicity
   - Runtime bundle unloading is complex (tool unregistration, cleanup, etc.)
   - Clear UX: changes persist to file, applied on restart

3. **Context Labels:**
   - `active_contexts` field is informational for now
   - Future versions could enforce context-specific behavior
   - Provides semantic meaning for disabled bundles list

4. **Error Handling:**
   - Graceful degradation: missing/invalid file → all bundles enabled
   - Warnings logged for malformed config, invalid bundle keys
   - No crashes on config errors (availability over correctness)

5. **Bundle Keys:**
   - Aligned with handler names for consistency
   - Documented in README and toolkit documentation
   - Validation against known bundle keys (warn on unknown)

**Open Questions:**
- Should `active_contexts` drive bundle enabling automatically? (Future enhancement)
- Should we support context inheritance/composition? (Future enhancement)
- Should context file support comments? (Use JSON5 instead of JSON?)
- Should we add a CLI tool for context management? (Separate from MCP tools)

**Stakeholder Callouts:**
- This feature enhances user control over tool availability
- Reduces cognitive load for focused workflows
- Improves startup performance when many bundles are disabled
- Maintains full backward compatibility
- Enables future context-aware features
