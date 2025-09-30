GitHub Handler

> Bundle: `github` (auto-enabled). Run `toolkit_list_bundles {}` to keep engineering resources top of mind.

Overview
Summarizes your GitHub activity over a time window using the GraphQL API. Focuses on counts and titles for PRs/issues, plus mention activity. Commit counts are included; commit messages are not listed.

Setup
- Add to `.env`:
```
GITHUB_TOKEN=ghp_...
GITHUB_USERNAME=<optional default username>
```
- Token scopes: `public_repo` is sufficient for public activity; include `repo` for private contributions.

Endpoints
- `GET /auth/github/status` → `{ authenticated, login, rateLimit }`

MCP Tools
- `github_activity_summary { start?, end?, detail?, username?, max_items?, repo?, repos? }`
  - `detail`: `numbers` | `titles` | `full` (default: `numbers`)
  - `start`/`end`: ISO or `YYYY-MM-DD`. Defaults to last 7 days.
  - `max_items`: limits listed items for `titles`/`full` (default 20).
  - `repo`: single repository to scope results (`owner/name`).
  - `repos`: string or array of repositories (`owner/name`, max 10). Combines with `repo` if both supplied.

Examples
```
github_activity_summary { "detail": "numbers" }
github_activity_summary { "start": "2025-09-01", "end": "2025-09-15", "detail": "titles", "max_items": 10 }
github_activity_summary { "repos": "jayminwest/kota-db" }
github_activity_summary { "repos": ["jayminwest/kota-db", "kotadb/kota-db-site"], "detail": "full" }
```

Notes
- Uses GitHub GraphQL contributions and search. Mentions are pulled via `search(type: ISSUE, query: "mentions:<login> updated:<range>")`; repo filters append `repo:<owner>/<name>`.
- For actual repo changes (labels, merges, etc.), prefer the `gh` CLI from the agent.
