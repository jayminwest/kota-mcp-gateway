# Webhooks Handler

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

## Usage Notes

- Start with `webhooks_list_dates` to discover available days, then call `webhooks_get_events` for a specific date.
- Keep `limit` small (default 20) to preserve the assistant’s context window. Increase in small increments if needed.
- For WHOOP deliveries, the `source` is `whoop` with `eventType` values like `sleep`, `recovery`, or `workout`.
- iOS Shortcuts deliveries appear under `source: "ios"` with event types matching the endpoint (`note`, `activity`, `food`).
- Raw files remain on the server; the handler is read-only and does not modify the stored JSON.
