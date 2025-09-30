# WHOOP Webhooks

Automates the ingestion of sleep, recovery, and workout events directly from WHOOP into the daily tracker.

## What You Need

- WHOOP Developer account (https://developer.whoop.com)
- Registered application with webhook subscription capability
- Your own bearer token and the app “Secret Key” from the WHOOP developer dashboard (used for webhook signatures)

## Generate Credentials

1. Sign in at https://developer.whoop.com and open **My Apps**.
2. Create or select an application that has webhook access.
3. Under **Webhooks**:
   - Set the delivery URL to `https://<your-domain>/webhooks/whoop/<event>` (sleep, recovery, workout).
   - Copy the app **Secret Key** (dashboard → App settings → Secret key). WHOOP uses it to sign webhook deliveries via `X-WHOOP-Signature` and `X-WHOOP-Signature-Timestamp`.
   - (Optional) Generate a static bearer token for your own testing. Store it in `webhooks.whoop.endpoints.auth_token`; the gateway skips Authorization checks when this field is empty because WHOOP currently does not send custom headers.
4. Save the configuration; WHOOP may send a test request immediately.

## Configure KOTA

Create `data/config/webhooks.json` (or update it) with:

```jsonc
{
  "debug": false,
  "webhooks": {
    "whoop": {
      "enabled": true,
      "secret": "<whoop_app_secret_key>",
      "endpoints": {
        "auth_token": "<bearer_token_used_by_whoop>" // optional; leave blank if WHOOP cannot send custom headers
      },
      "signature_header": "X-WHOOP-Signature",
      "signature_timestamp_header": "X-WHOOP-Signature-Timestamp"
    }
  }
}
```

Restart the gateway after editing the file.

## Event Mapping

Incoming payloads append entries with:
- `POST /webhooks/whoop/sleep` → sleep session (duration, average HR, strain, calories)
- `POST /webhooks/whoop/recovery` → recovery note with HRV/resting HR metadata
- `POST /webhooks/whoop/workout` → activity entry, sport translated to “Kendama training” when WHOOP reports “lacrosse”

Each event is logged under `data/webhooks/events/YYYY/MM/DD-events.json` before storage in the daily journal.

## Testing

1. Run `npm run webhook:test whoop` to see a sample payload and curl command.
2. Replace `<auth_token>` with your configured token. WHOOP signs requests as `Base64(HMAC_SHA256(secret_key, timestamp + raw_body))`. Example curl for local testing:
   ```bash
   timestamp=$(date +%s%3N)
   payload='{"id":"sleep_123", "start":"2025-09-19T00:00:00Z"}'
   signature=$(printf '%s%s' "$timestamp" "$payload" | openssl dgst -sha256 -mac HMAC -macopt key:"<whoop_app_secret_key>" -binary | openssl base64)
   curl -X POST https://localhost:8084/webhooks/whoop/sleep \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <auth_token>" \
     -H "X-WHOOP-Signature: $signature" \
     -H "X-WHOOP-Signature-Timestamp: $timestamp" \
     --data "$payload"
   ```
   _(Drop the Authorization header if you left `auth_token` blank in `webhooks.json`.)_
3. Verify the entry with `daily_get_day { "date": "YYYY-MM-DD" }`.

## Troubleshooting

- **401 Unauthorized** – only applicable if you populated `auth_token`; confirm the header matches your configured value.
- **Signature mismatch** – WHOOP prepends the timestamp and base64-encodes the HMAC. Confirm `X-WHOOP-Signature` and `X-WHOOP-Signature-Timestamp` are forwarded and the Secret Key matches your app settings.
- **Duplicate suppression** – WHOOP resends events with the same id. The gateway ignores duplicates for one hour. Inspect `data/webhooks/events/...` to confirm receipt.
- **No data in daily logs** – check the process logs for `Daily handler error` entries; malformed payloads are rejected before storage.
