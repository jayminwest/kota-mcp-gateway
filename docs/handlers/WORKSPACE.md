Workspace Handler

> Enable via `toolkit_enable_bundle { "bundle": "workspace" }` before using these tools.

Overview
Provides a structured overview of the configured `DATA_DIR` (default `data`). The default call returns a lightweight digest (counts, hotspots, recent activity); switch to explore/detailed modes for full trees and metadata when needed.

Setup
No additional configuration. The handler reads from `DATA_DIR` in the gateway process working directory.

MCP Tools
- `workspace_map { path?, search?, max_depth?, limit?, include_snippets?, context?, mode?, exclude?, time_format? }`
  - `path`: relative directory inside `DATA_DIR` to scope (default `.`).
  - `search`: case-insensitive query across names, tags, topics, cross-references.
  - `max_depth`: maximum directory depth to traverse (default 4).
  - `limit`: cap on matched files when `search` is provided (default 50).
  - `include_snippets`: include body snippets for matching files (default `false`, only applies when `context` is `detailed`).
  - `context`: `summary` (default) trims metadata/snippets; `detailed` returns full metadata.
  - `mode`: `summary` (default) returns a compact digest; `explore` shows the tree; `detailed` dumps full metadata (aliases: `full` → `explore`, `stats` → `summary`).
  - `exclude`: string or array of relative folders/paths to skip (e.g., `"archive"`, `"knowledge/tmp"`).
  - `time_format`: `absolute` (ISO, default), `relative` (`"2 hours ago"`), or `both`.

Examples
```
workspace_map {}
workspace_map { "mode": "explore", "path": "conversations" }
workspace_map { "search": "geo-sync", "limit": 10 }
workspace_map { "mode": "detailed", "path": "knowledge", "max_depth": 3, "include_snippets": true }
workspace_map { "mode": "summary", "exclude": ["archive", "logs"] }
workspace_map { "time_format": "both", "exclude": "node_modules" }
```

Notes
- Front matter (`---`) is parsed for titles, tags, key_concepts, related references, and optional `kota_version` fields.
- Cross-references include front-matter `related` plus Markdown links (`[label](path)`) and `[[wiki]]` style references.
- Directory summaries roll up child file counts, dominant topics, file-type distribution, and hidden counts when depth limits truncate output (`truncatedNote`).
- Summary context removes empty metadata fields and compresses repeated topics to keep payloads lightweight.
- Time formatting defaults to ISO strings; switch to `relative` or `both` for human-friendly deltas.
- Default response is a lightweight stats digest; use `mode: "explore"` or `"detailed"` for full trees and metadata.
- When `search` finds nothing, the handler responds with `Empty results (workspace search)`.
- Output is JSON with `tree` and optional `matches` arrays; file paths are relative to `DATA_DIR`.
