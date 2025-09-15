GitHub Handler

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
- `github_activity_summary { start?, end?, detail?, username?, max_items? }`
  - `detail`: `numbers` | `titles` | `full` (default: `numbers`)
  - `start`/`end`: ISO or `YYYY-MM-DD`. Defaults to last 7 days.
  - `max_items`: limits listed items for `titles`/`full` (default 20).

Examples
```
github_activity_summary { "detail": "numbers" }
github_activity_summary { "start": "2025-09-01", "end": "2025-09-15", "detail": "titles", "max_items": 10 }
```

Notes
- Uses GitHub GraphQL contributions and search. Mentions are pulled via `search(type: ISSUE, query: "mentions:<login> updated:<range>")`.
- For actual repo changes (labels, merges, etc.), prefer the `gh` CLI from the agent.

