KOTA Memory Handler
===================

Overview
--------
The KOTA memory handler exposes a lightweight key-value store that Claude Code (or any MCP client) can use to persist user-specific context across sessions. Data lives locally under `./data/kota_memory`, making it auditable via git while remaining private to the machine.

Storage Layout
--------------
```
data/kota_memory/
  metadata.json     # version, counts, byte usage, last cleanup timestamp
  preferences.json  # user preferences, habits, guardrails
  connections.json  # people, teams, accounts, identifiers
  patterns.json     # behavioural patterns (e.g., work_hour_limit)
  shortcuts.json    # shorthand phrases → expanded meaning
  state.json        # active/ephemeral context
  archive.json      # archived entries (expired + cleared state snapshots)
```

Limits & Hygiene
----------------
- **100 entries per category** (oldest entry evicted if over).
- **4KB per entry** (after merge/update checks).
- **50KB total** across all files (oldest entries trimmed on overflow).
- **90-day expiry**: entries unused for 90 days are archived (never deleted) for later reference.
- Metadata is updated on every write so you can audit counts/byte usage at a glance.

Tools
-----
All tools are prefixed with `memory_` when registered through MCP.

| Tool | Purpose | Notes |
|------|---------|-------|
| `memory_set { key, value, category? }` | Persist a key/value pair. | Category is optional; heuristics route keys when omitted. Response includes `created_at`/`last_updated` in the host timezone. |
| `memory_get { query }` | Retrieve an entry via exact or fuzzy match. | Returns terse JSON with confidence score plus `created_at`/`last_updated` (host timezone). |
| `memory_update { key, addition }` | Merge new info into an existing entry. | Supports object merge, array append, and string concatenation. Response echoes updated timestamps (host timezone). |
| `memory_list {}` | List stored active keys only. | Keys are returned as `category:key`. |
| `memory_list_archived {}` | List archived keys. | Keys include timestamp suffix, e.g., `state:project@2025-01-02T...`. |
| `memory_delete { key }` | Remove an active entry. | Case-insensitive match. Response returns last-known timestamps before deletion (host timezone). |
| `memory_clear_state {}` | Archive and reset the current state. | Archives each state entry with a timestamped suffix. |
| `memory_save_conversation_notes { summary, flow?, tone?, highlights?, nextSteps?, additionalContext?, capturedAt?, metadata? }` | Snapshot the active conversation context. | Persists notes under `state:conversation_notes` for quick recall. |

Example MCP Calls
-----------------
```
# Store a connection (category inferred as "connections")
memory_set {
  "key": "Sunil",
  "value": { "name": "Sunil Nagaraj", "company": "GeoSync", "slack_dm": "D098X745TDY" }
}

# Retrieve later via fuzzy query
memory_get { "query": "sunil slack" }

# Update an existing guardrail
memory_update {
  "key": "work_hour_limit",
  "addition": { "daily_hours": 8, "weekdays": ["Mon", "Tue", "Wed", "Thu", "Fri"] }
}

# Inspect stored keys
memory_list {}

# Remove stale entries when needed
memory_delete { "key": "old_campaign" }

# Reset the working slate for today while keeping yesterday's context
memory_clear_state {}

# Capture conversation notes so another agent can rehydrate context
memory_save_conversation_notes {
  "summary": "Reviewed growth metrics and discussed Q2 hiring plan",
  "flow": "Started with ARR review, dug into churn, ended on recruiting needs",
  "tone": "Collaborative and data-driven",
  "highlights": [
    "Customer churn down 2% MoM",
    "Need hiring plan for 3 backend engineers"
  ],
  "nextSteps": [
    "Share revised hiring targets with finance",
    "Prepare churn analysis memo"
  ]
}
```

Operational Tips
----------------
- Keep payloads succinct to stay within the 4KB ceiling; prefer identifiers and summaries over raw transcripts.
- Auto-cleaning runs before each operation, so unused data disappears automatically once the 90-day window passes.
- Metadata (`metadata.json`) captures counts, byte usage, and cleanup timestamps for quick audits.
- The handler surfaces detailed error messages when size limits are exceeded—adjust the payload or split it into multiple entries.
