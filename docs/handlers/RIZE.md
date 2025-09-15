Rize GraphQL Setup and Usage

Endpoint
- GraphQL endpoint: `https://api.rize.io/api/v1/graphql`

Auth
- Add `RIZE_API_KEY` to `.env` (Bearer token)

Tools
- `rize_execute_query` — Run arbitrary GraphQL queries
  - Args: `{ "query": "...", "variables": { ... } }`
- `rize_introspect` — Fetch schema metadata
  - Args: `{ "partial": true }` (set false for more detail; may be large)

Examples
- Introspect (partial): `{ "partial": true }`
- Query (example):
  - Query string:
    ```
    query Sessions($from: String!, $to: String!) {
      sessions(from: $from, to: $to) {
        id
        start
        end
        app
        category
      }
    }
    ```
  - Variables:
    `{ "from": "2025-09-01T00:00:00Z", "to": "2025-09-15T23:59:59Z" }`

Notes
- Schema names may differ; use `rize_introspect` first to discover available types/fields.
- Large results: paginate or limit fields to avoid hitting client token limits.
