# Context Snapshot Aggregation

> Bundle: `context_snapshot` (auto-enabled). `toolkit_list_bundles {}` shows it under core integrations.

The context snapshot pipeline lets an iOS Shortcut trigger a webhook that captures the current environment (location, weather, now playing, WHOOP status, calendar event, active Rize task). Each snapshot is persisted to disk and exposed via an MCP tool for quick recall.

## Webhook Endpoint

- Route: `POST /webhooks/ios/context-snapshot`
- Auth: Reuses the iOS webhook settings (`auth_token`, optional HMAC signature)
- Payload fields:
  - `timestamp` (required ISO string/epoch/Date) — moment of capture on device
  - `location` (object) — latitude/longitude, name, etc.
  - `weather` (object) — current conditions from the Shortcut
  - Additional keys (notes, shortcut metadata, etc.) are stored under `ios.extras`
- Storage: `data/context-snapshots/YYYY-MM-DD.json`
  - Append-only array per day
  - Server time is stored as `recordedAt`; the device timestamp is normalized to Pacific time (`capturedAt`)

Each integration is queried live when the webhook fires:
- Spotify — `getCurrentlyPlaying`
- WHOOP — most recent recovery (`getRecoveries(limit: 1)`)
- Google Calendar — in-progress event surrounding the device timestamp
- Rize — pulls `currentSession` (active focus session). If none is running, the most recent session within ~72h is returned (id, title, type, start/end timestamps, duration).

Failures are logged at `warn` level and the corresponding field is set to `null`; snapshot creation continues even if a dependency is unavailable.

### Example payload

```json
{
  "timestamp": "2024-07-08T09:15:23-07:00",
  "location": {
    "name": "Home",
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "weather": {
    "condition": "Sunny",
    "temperature_f": 68.2
  },
  "notes": "Morning focus session"
}
```

Test locally with the shared auth token:

```bash
curl -X POST \
  http://localhost:8084/webhooks/ios/context-snapshot \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"timestamp":"2024-07-08T16:10:00Z"}'
```

## MCP Tool

- `context_get_recent { "limit": 5 }`
  - `limit` defaults to 5, max 50
  - Returns chronological snapshots `{ limit, count, snapshots: [...] }`
  - Each snapshot includes `ios`, `spotify`, `whoop`, `calendar`, `rize`, and optional `errors`

Snapshots are already chronologically sorted. The tool surfaces the enriched JSON exactly as stored on disk so downstream agents can inspect fields such as `spotify.track`, `whoop.recoveryScore`, or `rize.project.name` without guessing serialization details.

## Troubleshooting

- Missing Spotify/Google/WHOOP/Rize credentials will surface as warnings and `null` fields. Check `/auth/*/status` routes or the relevant docs to reconnect services.
- Files live under `data/context-snapshots/`; remove a daily file to prune snapshots if needed.
- Enable request logging (`LOG_LEVEL=debug`) to view the raw iOS payload and downstream fetch attempts.
