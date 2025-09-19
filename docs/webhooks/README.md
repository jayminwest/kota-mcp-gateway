# Webhook Ingestion

The webhook subsystem mirrors the handler architecture and lets external services append entries to the daily tracker without manual input.

## Webhook Docs Index

- WHOOP: WHOOP.md
- Calendar: CALENDAR.md
- iOS Shortcut: IOS.md

## Configuration Overview

Webhook configuration lives at `data/config/webhooks.json` (create the file if it does not exist).

```jsonc
{
  "debug": false,
  "webhooks": {
    "whoop": {
      "enabled": true,
      "secret": "webhook_signing_secret",
      "endpoints": {
        "auth_token": "encrypted_token"
      }
    },
    "calendar": {
      "enabled": false,
      "calendar_ids": ["primary", "work"]
    }
  }
}
```

- `secret` – HMAC key used for signature verification (`x-webhook-signature` header).
- `endpoints.auth_token` – bearer token expected on the `Authorization` header.
- `debug` – set to `true` to log incoming payloads at debug level.

## Developer Workflow

- `npm run webhook:test whoop` prints a sample payload and curl snippet.
- Use `daily_get_day` / `vitals_get_day` to verify stored entries after webhook ingestion.
- Incoming requests are archived under `data/webhooks/events/YYYY/MM/DD-events.json` for audit and replay.
- MCP clients can inspect stored deliveries via the `webhooks_list_dates` and `webhooks_get_events` tools.

## Extensibility

Add a new webhook under `src/webhooks/<source>.ts` by extending `BaseWebhook` and registering routes via `registerEndpoint`. Once the source appears in `webhooks.json` with `enabled: true`, the gateway auto-registers it on `/webhooks/<source>/*`.
