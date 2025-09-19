Rize GraphQL Setup and Usage

Endpoint
- GraphQL endpoint: `https://api.rize.io/api/v1/graphql`

Auth
- Add `RIZE_API_KEY` to `.env` (Bearer token)

Tools
- `rize_current_user` — Fetch the authenticated user (name, email)
  - Args: `{}`
- `rize_recent_projects` — List recently created or updated projects (default 10)
  - Args: `{ "first": 10 }`
- `rize_recent_tasks` — List recently created or updated tasks (default 10)
  - Args: `{ "first": 10 }`
- `rize_time_entries` — Fetch client time entries within a date window and return summary totals
  - Args: `{ "startTime": "2024-05-01T00:00:00Z", "endTime": "2024-05-31T23:59:59Z", "client_name": "Acme", "limit": 50 }`

Examples
- Current user: `{}`
- Recent projects (5): `{ "first": 5 }`
- Time entries with summary: `{ "startTime": "2024-06-01T00:00:00Z", "endTime": "2024-06-07T00:00:00Z", "client_name": "Acme", "limit": 25 }`

Notes
- Tools run curated queries so you do not need to remember the schema.
- Large result sets are truncated to `limit` (defaults to 100).
