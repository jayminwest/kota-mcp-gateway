# KOTA Entry Point Handler

## Overview

The KOTA entry point layer provides a self-documenting, scope-based context loading system that reduces token overhead at session start by deferring data loading to on-demand requests.

Instead of loading all available context at the beginning of every session, KOTA allows you to load specific "scopes" - bundles of related context - only when needed.

## Key Concepts

### Scopes

A **scope** is a named bundle of context that includes:
- **Overview**: High-level description of the scope
- **Data Sources**: Configurations for fetching data from handlers (memories, slack, github, etc.)
- **Exposed Tools**: Handler tools relevant to this scope
- **Metadata**: Last modified timestamp and author

Scopes are stored as YAML files in `~/kota_md/scopes/` and are git-tracked for version control.

### Self-Documenting Design

Every KOTA response includes:
- Clear status indicators (success/error/guidance)
- Usage examples for next actions
- Available scopes when guidance is needed
- Suggestions for related operations

This design enables LLMs to explore and use KOTA without external documentation.

## MCP Tools

### `kota.load`

Load scope context. Supports multiple modes:

**No arguments (guidance):**
```typescript
kota.load({})
// Returns: guidance with available scopes and usage examples
```

**List all scopes:**
```typescript
kota.load({ scope: "list" })
// Returns: metadata for all scopes (name, description, data sources, etc.)
```

**Load single scope:**
```typescript
kota.load({ scope: "GEOSYNC" })
// Returns: loaded context with data from configured sources
```

**Load multiple scopes:**
```typescript
kota.load({ scope: ["GEOSYNC", "PERSONAL"] })
// Returns: combined context from multiple scopes
```

**Response Structure:**
```json
{
  "status": "success",
  "scope": "GEOSYNC",
  "loaded_at": "2025-11-26T10:30:00Z",
  "last_modified": "2025-11-26T10:00:00Z",
  "modified_by": "jaymin",
  "context": {
    "overview": "Client work for Sunil Bollera...",
    "memories": { ... },
    "recent_activity": { ... },
    "files": [ ... ]
  },
  "exposed_tools": ["slack_get_messages", "github_activity_summary"],
  "next_actions": {
    "edit_this_scope": { ... },
    "load_additional": { ... },
    "refresh_data": { ... }
  }
}
```

### `kota.edit`

Edit a scope configuration and commit changes to git.

```typescript
kota.edit({
  scope: "GEOSYNC",
  modification: {
    add: {
      "data_sources.recent_activity.github": {
        fetch: "github_activity_summary",
        params: { repo: "jayminwest/geosync-platform", days: 7 }
      }
    }
  },
  reason: "Need recent commit activity for context"
})
```

**Modification Operations:**
- `add`: Add new fields or append to arrays
- `remove`: Delete fields by path
- `update`: Update existing fields

**Path Notation:**
Uses dot notation to specify nested paths:
- `"data_sources.memories"` → `config.data_sources.memories`
- `"scope.description"` → `config.scope.description`

**Git Integration:**
Each edit creates a git commit with:
- Conventional commit format: `feat(scopes): {reason}`
- Modified-By attribution
- Undo instructions via `git revert`

**Response:**
```json
{
  "status": "success",
  "scope": "GEOSYNC",
  "modification": "added data_sources.recent_activity.github",
  "git_commit": "abc123def",
  "commit_message": "feat(scopes): Need recent commit activity...",
  "file_path": "~/kota_md/scopes/geosync.scope.yaml",
  "next_actions": {
    "reload_scope": "kota.load({ scope: 'GEOSYNC' })",
    "undo": "git revert abc123def"
  }
}
```

### `kota.refresh`

Clear cache and reload a scope to get fresh data.

```typescript
kota.refresh({ scope: "GEOSYNC" })
```

**Response:**
```json
{
  "status": "success",
  "scope": "GEOSYNC",
  "refreshed_at": "2025-11-26T11:00:00Z",
  "changes_detected": {
    "note": "MVP: Data fetchers not yet implemented. Cache cleared."
  },
  "next_actions": {
    "view_updated": "kota.load({ scope: 'GEOSYNC' })"
  }
}
```

## Scope Configuration Format

Scopes are defined in YAML files at `~/kota_md/scopes/{scope_name}.scope.yaml`.

### Example: `geosync.scope.yaml`

```yaml
scope:
  name: GEOSYNC
  description: "Client work for Sunil Bollera / GeoSync platform"
  last_modified: "2025-11-26T00:00:00Z"
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
    - path: "~/kota_md/businesses/geosync/geosync-phase1-sow-nov2025.md"
      excerpt_length: 500

exposed_tools:
  - slack_get_messages
  - github_activity_summary
  - rize_time_entries
```

### Schema

**Required Fields:**
- `scope.name` (string): Uppercase scope identifier (e.g., "GEOSYNC")
- `scope.description` (string): Human-readable description
- `scope.last_modified` (ISO 8601 string): Last modification timestamp
- `scope.modified_by` (string): Username or agent identifier

**Optional Fields:**
- `overview` (string): Narrative overview of the scope
- `data_sources` (object): Nested data fetching specifications
- `exposed_tools` (array of strings): Handler tools to highlight

### Data Sources

Data sources can be structured as:

**Array Format (for ordered/keyed items):**
```yaml
data_sources:
  memories:
    - key: "slack.sunil"
      fetch: memory_get
      params:
        query: "slack.sunil"
```

**Object Format (for named items):**
```yaml
data_sources:
  recent_activity:
    slack:
      fetch: slack_get_messages
      params:
        limit: 5
```

**File References:**
```yaml
data_sources:
  files:
    - path: "~/kota_md/path/to/file.md"
      excerpt_length: 500  # Optional: truncate to N chars
```

### Data Fetcher Execution

When a scope is loaded:
1. KOTA parses the `data_sources` configuration
2. For each fetcher, calls the specified handler tool with params
3. Collects results into the `context` object
4. Handles errors gracefully (partial results on failure)

**Handler Tool Format:**
- Tool name: `{handler_prefix}_{action}`
- Example: `memory_get` → handler prefix `memory`, action `get`

## Common Workflows

### Creating a New Scope

1. Create YAML file at `~/kota_md/scopes/{name}.scope.yaml`
2. Define required metadata and data sources
3. Test loading: `kota.load({ scope: "NAME" })`

**Or use kota.edit to create programmatically:**
```typescript
// First create minimal config file, then use kota.edit to build it out
```

### Editing an Existing Scope

```typescript
kota.edit({
  scope: "GEOSYNC",
  modification: {
    add: {
      "data_sources.files": [{
        path: "~/kota_md/businesses/geosync/new-doc.md",
        excerpt_length: 300
      }]
    }
  },
  reason: "Adding new documentation reference"
})
```

### Loading Context for a Task

```typescript
// Start of session
kota.load({ scope: "list" })  // See what's available

// Load relevant scope
kota.load({ scope: "GEOSYNC" })  // Get client context

// Work on task...

// Refresh if data might be stale
kota.refresh({ scope: "GEOSYNC" })
kota.load({ scope: "GEOSYNC" })  // Reload with fresh data
```

### Combining Multiple Scopes

```typescript
kota.load({ scope: ["GEOSYNC", "PERSONAL", "KOTADB"] })
// Returns merged context from all three scopes
```

## Error Handling

### Invalid Scope Name
```json
{
  "status": "error",
  "message": "Scope 'NOTREAL' not found",
  "available_scopes": ["GEOSYNC", "PERSONAL", "KOTADB"],
  "usage": {
    "correct_format": "kota.load({ scope: 'GEOSYNC' })",
    "see_all": "kota.load({ scope: 'list' })"
  }
}
```

### Missing Scope File
Same as invalid scope name - file not found treated as scope not existing.

### Malformed YAML
Logged as error, scope treated as not found.

### Data Fetcher Failure
Partial results returned with error notes:
```json
{
  "context": {
    "overview": "...",
    "memories": { "slack.sunil": {...} },
    "recent_activity": {
      "slack": { "error": "Channel not found" },
      "rize": { ... }  // Other fetchers continue
    }
  }
}
```

## Caching

- **Cache TTL**: 5 minutes
- **Cache Key**: Scope name
- **Invalidation**:
  - Automatic after TTL
  - Manual via `kota.refresh({ scope: "NAME" })`
  - On scope edit via `kota.edit`

## Architecture

### Components

**ScopeManager (`src/utils/scope-manager.ts`):**
- Loads/saves scope YAML configurations
- Executes data fetchers
- Manages scope cache
- Resolves file paths

**ScopeGitManager (`src/utils/scope-git.ts`):**
- Commits scope changes to git
- Formats conventional commit messages
- Provides undo instructions

**KotaHandler (`src/handlers/kota.ts`):**
- Registers MCP tools
- Routes actions to appropriate methods
- Builds self-documenting responses

### Data Flow

```
User → MCP Tool Call
  → KotaHandler.execute(action, args)
    → ScopeManager.loadScope(name)
      → ScopeManager.loadScopeConfig(name)  // Read YAML
      → ScopeManager.executeFetchers(config)  // Call handlers
        → fetchData(toolName, params)  // Via registry
          → Handler.execute(action, args)
      → Cache result
    → Return formatted response
```

## Troubleshooting

### Scope not loading
1. Check file exists: `ls ~/kota_md/scopes/`
2. Validate YAML syntax: `cat ~/kota_md/scopes/{name}.scope.yaml`
3. Check logs for parse errors

### Data fetcher failing
1. Verify handler is enabled: `toolkit_list_bundles`
2. Test tool directly: `{handler}_{action}` with same params
3. Check logs for execution errors

### Git commit failing
1. Ensure `~/kota_md/` is a git repository
2. Check for uncommitted changes that might block
3. Verify git user config is set

### Stale data
1. Use `kota.refresh({ scope: "NAME" })` to clear cache
2. Reload scope: `kota.load({ scope: "NAME" })`

## Future Enhancements

- **Scope templates**: Pre-configured patterns for common use cases
- **Scope inheritance**: Base scopes with overrides
- **Automatic recommendations**: Suggest scopes based on conversation
- **Scope composition**: Combine scopes with merge strategies
- **Real-time updates**: Auto-refresh on data source changes
- **Dependency validation**: Warn if required tools unavailable
- **UI for scope management**: Web interface for editing

## Related Documentation

- [Handler Architecture](../README.md)
- [Memory Handler](./MEMORY.md)
- [Workspace Handler](./WORKSPACE.md)
- [Context Configuration](../../README.md#context-configuration)
