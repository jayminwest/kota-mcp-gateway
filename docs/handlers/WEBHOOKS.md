# Webhooks Handler

> Bundle: `webhooks` (auto-enabled). `toolkit_list_bundles {}` highlights it alongside other integrations.

Expose stored webhook deliveries (WHOOP, iOS Shortcuts, etc.) to MCP clients. Each incoming delivery is persisted under `data/webhooks/events/<YYYY>/<MM>/<DD>-events.json`; the handler provides read-only tools to inspect those files without streaming massive payloads into the LLM context.

## Tools

### `webhooks_list_dates`
- **Purpose:** List dates that have webhook events, ordered newest first by default.
- **Args:**
  - `limit` (optional, default 14, max 90)
  - `order` (`"asc" | "desc"`, default `"desc"`)
  - `source` (filter for a specific source such as `whoop` or `ios`)
  - `event_types` (string array filter, e.g. `["sleep", "recovery"]`)
- **Result:** `{ dates: [{ date, eventCount, sources, eventTypes, lastReceivedAt, filePath, fileSize }] }`.

### `webhooks_get_events`
- **Purpose:** Fetch events for a single date with pagination to avoid large dumps.
- **Args:**
  - `date` (ISO string, defaults to today in UTC)
  - `limit` (default 20, max 50)
  - `offset` (default 0, max 500)
  - `source` / `event_types` filters
  - `include_payload` (boolean, default `false`)
  - `payload_preview_length` (default 240, controls preview truncation)
- **Result:** `{ date, total, events: [{ index, receivedAt, source, eventType, dedupeKey, metadata, payloadPreview, payload? }] }`.
- `payload` is only returned when `include_payload` is `true`; otherwise a truncated JSON preview is provided.

### `webhooks_search`
- **Purpose:** Search webhook payloads and metadata for a text fragment across the archive.
- **Args:**
  - `query` (required text)
  - `limit` (default 20, max 50)
  - `source`, `event_types`, `start_date`, `end_date` filters
  - `include_payload` / `payload_preview_length`
- **Result:** `{ query, total, events: [...] }` filtered by the search criteria.

### `webhooks_get_by_type`
- **Purpose:** Pull the most recent events of a specific type (e.g., `sleep`, `activity`) across the last `N` days.
- **Args:**
  - `event_type` (required)
  - `days` (default 7, max 90)
  - `limit` (default 50, max 100)
  - `source`, `include_payload`, `payload_preview_length`
- **Result:** `{ eventType, events: [...] }` ordered newest first.

### `webhooks_aggregate`
- **Purpose:** Summarize webhook activity by day or ISO week.
- **Args:**
  - `window` (`"daily"` | `"weekly"`, default daily)
  - Optional `start_date`, `end_date`, `source`, `event_types`
- **Result:** `{ window, buckets: [{ key, startDate, endDate, totalEvents, sources, eventTypes, firstEventAt, lastEventAt }] }`.

## Usage Notes

- Start with `webhooks_list_dates` to discover available days, then call `webhooks_get_events` for a specific date.
- Keep `limit` small (default 20) to preserve the assistant’s context window. Increase in small increments if needed.
- For WHOOP deliveries, the `source` is `whoop` with `eventType` values like `sleep`, `recovery`, or `workout`.
- iOS Shortcuts deliveries appear under `source: "ios"` with event types matching the endpoint (`note`, `activity`, `food`).
- The `context_snapshot` Shortcut posts to `/webhooks/ios/context-snapshot`; snapshots are stored under `data/context-snapshots/` and surfaced via the `context_get_recent` MCP tool.
- Raw files remain on the server; the handler is read-only and does not modify the stored JSON.
- Incoming events are normalized automatically: duplicate deliveries (based on dedupe key + archive) are skipped, entry times are reduced to `HH:mm`, and time-of-day tags (`morning`/`afternoon`/`evening`/`night`) are appended. Standardized templates (`activity_event`, `nutrition_event`, `context_event`) are written to entry metadata for downstream analysis.
