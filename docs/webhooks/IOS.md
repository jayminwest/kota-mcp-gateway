# iOS Shortcut Webhook

Lightweight endpoints intended for on-demand events triggered from iOS Shortcuts (or any other client you control).

## Configuration

Update `data/config/webhooks.json`:

```jsonc
{
  "webhooks": {
    "ios": {
      "enabled": true,
      "secret": "",            // optional: provide if you sign requests yourself
      "endpoints": {
        "auth_token": "<random_bearer_token>"
      }
    }
  }
}
```

- Generate a token with `openssl rand -base64 32`.
- Restart the gateway after editing the file.

## Available Endpoints

- `POST /webhooks/ios/note`
- `POST /webhooks/ios/activity`
- `POST /webhooks/ios/food`

**Shared headers:**
- `Content-Type: application/json`
- `Authorization: Bearer <random_bearer_token>`

## Payloads

All endpoints accept JSON in the form:

```jsonc
{
  "date": "2025-09-20",   // defaults to today if omitted
  "time": "16:30",         // optional HH:mm
  "name": "Manual note",   // defaults per endpoint
  "category": "note",      // optional override
  "duration_minutes": 25,   // activity only
  "metrics": { "strain": 4.2 },
  "notes": "Triggered from phone",
  "tags": ["ios", "shortcut"],
  "metadata": { "source": "shortcut" }
}
```

Data is appended to the daily tracker via `daily_append_entries`. The handler defaults categories to:
- Note endpoint → `note`
- Activity endpoint → `activity`
- Food endpoint → `food`

## iOS Shortcut Example

1. Create a new Shortcut.
2. Add “Text” action containing the payload (use “Format Date” to build `date` and `time`).
3. Add “Get Contents of URL”:
   - URL: `https://<your-ngrok-or-server>/webhooks/ios/activity`
   - Method: POST
   - Request Body: JSON → the Text output
   - Headers:
     - `Content-Type: application/json`
     - `Authorization: Bearer <random_bearer_token>`
4. Optional: add “Show Result” to display the response.

Run the Shortcut; you should see `{ "status": "ok" }`. Verify via:
- `daily_get_day { "date": "YYYY-MM-DD" }`
- `data/webhooks/events/YYYY/MM/DD-events.json`

## Curl Test

```bash
token="<random_bearer_token>"
payload='{"date":"2025-09-20","name":"Focus","category":"note","notes":"Triggered manually"}'

curl -X POST https://<your-host>/webhooks/ios/note \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $token" \
  --data "$payload"
```

## Troubleshooting

- **401 Unauthorized** – check the bearer token matches `webhooks.ios.endpoints.auth_token`.
- **Missing date** – provide YYYY-MM-DD or let the server default to today.
- **Duplicate entries** – send a unique `id` field if Shortcuts might retry (`dedupeKey` uses the payload `id`).
