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
| `memory_list { category? }` | List stored active keys, optionally filtered by category. | Keys are returned as `category:key`. Filter by category (e.g., `"state"`) to see only those keys. |
| `memory_list_archived {}` | List archived keys. | Keys include timestamp suffix, e.g., `state:project@2025-01-02T...`. |
| `memory_delete { key }` | Remove an active entry. | Case-insensitive match. Response returns last-known timestamps before deletion (host timezone). |
| `memory_clear_state {}` | Archive and reset the current state. | Archives each state entry with a timestamped suffix. |
| `memory_save_conversation_notes { summary, flow?, tone?, highlights?, nextSteps?, additionalContext?, capturedAt?, metadata? }` | Snapshot the active conversation context. | Persists notes under `state:conversation_notes` for quick recall. |

Query Semantics
---------------
The `memory_get` action uses fuzzy matching with the following behavior:

1. **Exact key match** (confidence = 1.0):
   - Query exactly matches a memory key
   - Example: `query: "current_work_context"` matches key `current_work_context`

2. **Substring match** (confidence ≥ 0.85):
   - Query is contained in key or vice versa
   - Example: `query: "work"` matches key `current_work_context`

3. **Fuzzy match** (confidence ≥ 0.6):
   - Uses Levenshtein distance for similarity
   - Example: `query: "work contxt"` matches key `work_context` (typo tolerance)

4. **Value search** (confidence × 0.9):
   - Searches within memory values if key match score < 0.6
   - Example: `query: "GeoSync"` finds `{"company": "GeoSync"}` in connections

5. **Category prefix** (recommended for precision):
   - Prefix with category to limit search scope
   - Example: `query: "state:current_work_context"` searches only state category

Returns `null` if best match has confidence < 0.6. Returns match with highest confidence score.

Example MCP Calls
-----------------

### Storing Memories

```json
// Store with explicit category
memory_set {
  "key": "Sunil",
  "value": { "name": "Sunil Nagaraj", "company": "GeoSync", "slack_dm": "D098X745TDY" },
  "category": "connections"
}

// Store with auto-inferred category (contains "preference")
memory_set {
  "key": "notification_preferences",
  "value": { "slack": true, "email": false }
}
```

### Retrieving Memories

```json
// Exact key match (fastest, most reliable)
memory_get { "query": "notification_preferences" }

// Fuzzy search across keys
memory_get { "query": "sunil slack" }

// Category-prefixed for precision
memory_get { "query": "state:current_work_context" }
```

### Listing Keys

```json
// List all memory keys
memory_list {}

// List only state category keys
memory_list { "category": "state" }

// List only preferences
memory_list { "category": "preferences" }
```

### Updating Memories

```json
// Merge into existing object
memory_update {
  "key": "work_hour_limit",
  "addition": { "daily_hours": 8, "weekdays": ["Mon", "Tue", "Wed", "Thu", "Fri"] }
}

// Append to array
memory_update {
  "key": "focus_topics",
  "addition": ["Context bundling", "Memory optimization"]
}
```

### Common Patterns

**Check if memory exists before creating:**
```json
// 1. Try to get
memory_get { "query": "project_goals" }

// 2. If null, create
memory_set {
  "key": "project_goals",
  "value": ["Launch MVP", "Gather feedback"],
  "category": "state"
}
```

**List all state entries for cleanup:**
```json
// 1. List state keys
memory_list { "category": "state" }

// 2. Review keys
// ["state:current_work_context", "state:conversation_notes", ...]

// 3. Clear if needed
memory_clear_state {}
```

**Retrieve with fallback:**
```json
// 1. Try exact key
memory_get { "query": "state:current_work_context" }

// 2. If null, try fuzzy
memory_get { "query": "work context" }

// 3. If still null, use default value
```

**Capture conversation notes:**
```json
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
