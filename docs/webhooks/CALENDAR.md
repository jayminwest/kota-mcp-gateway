# Calendar Webhooks

Use calendar events to automatically log scheduled activities and time blocks into the daily tracker.

## Supported Sources

The gateway expects POST requests at `/webhooks/calendar/event`. Any calendar system (Google, Outlook, Notion, etc.) can integrate as long as it can hit an HTTPS endpoint and include your shared bearer token.

## What You Need

- Calendar provider capable of outbound webhooks or automation (Google Calendar push notifications, Google Apps Script, Zapier, Make, Outlook subscriptions, etc.)
- Shared bearer token to authenticate calls into the gateway
- (Optional) Signing secret if your automation supports HMAC signatures

## Configure KOTA

Add a calendar block to `data/config/webhooks.json`:

```jsonc
{
  "webhooks": {
    "calendar": {
      "enabled": true,
      "secret": "<optional_hmac_secret>",
      "endpoints": {
        "auth_token": "<bearer_token_to_use_in_requests>"
      },
      "calendar_ids": ["primary", "team", "projects"]
    }
  }
}
```

Restart the gateway after saving the file. If you omit `secret`, signature validation is skipped.

## Building the Webhook

### Google Calendar (Apps Script)

1. Open https://script.google.com and create a new project.
2. Add the script:
   ```js
   const WEBHOOK_URL = 'https://your-domain/webhooks/calendar/event';
   const AUTH_TOKEN = 'Bearer <bearer_token_to_use_in_requests>';

   function onCalendarEvent(e) {
     const event = e.calendarEvent;
     const payload = {
       id: event.getId(),
       title: event.getTitle(),
       start: event.getStartTime(),
       end: event.getEndTime(),
       calendarId: event.getOriginalCalendarId(),
       attendees: event.getGuestList()?.map(g => g.getEmail()),
       status: event.isAllDayEvent() ? 'all-day' : 'confirmed'
     };

     const options = {
       method: 'post',
       contentType: 'application/json',
       payload: JSON.stringify(payload),
       headers: { Authorization: AUTH_TOKEN },
       muteHttpExceptions: true,
     };

     UrlFetchApp.fetch(WEBHOOK_URL, options);
   }
   ```
3. Add a trigger for **From calendar** → **On event updated**.
4. Deploy and authorize the script.

### Outlook / Microsoft 365

1. Register an application in Azure AD with Calendar.Read permission.
2. Use the Graph API `subscriptions` endpoint to watch events with notification URL `https://your-domain/webhooks/calendar/event`.
3. Include the bearer token in the `clientState` field or set a static token and add it as the `Authorization` header in your relay service.
4. If Graph cannot add custom headers, proxy notifications through an Azure Function or Logic App that signs the request before forwarding it to KOTA.

### Automation Platforms (Zapier/Make)

- Create a trigger for new/updated events.
- Add a webhook/HTTP action pointing at `/webhooks/calendar/event` with JSON payload matching:
  ```json
  {
    "id": "abc123",
    "title": "Deep Work Block",
    "start": "2025-09-18T14:00:00-07:00",
    "end": "2025-09-18T15:30:00-07:00",
    "calendarId": "primary",
    "status": "confirmed"
  }
  ```
- Send the bearer token in the `Authorization` header.

## Event Mapping

- `title` → entry name
- `start` → entry `time`
- `end` → used to compute `duration_minutes`
- `status`, `location`, and `attendees` are stored in `metadata`
- If `calendarId` is present it is written alongside the event metadata

## Testing

Use curl to simulate a delivery:

```bash
curl -X POST https://localhost:8084/webhooks/calendar/event \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <bearer_token>' \
  --data '{
    "id": "focus-block-001",
    "title": "Deep work",
    "start": "2025-09-18T09:00:00-07:00",
    "end": "2025-09-18T10:30:00-07:00",
    "calendarId": "primary",
    "status": "confirmed",
    "location": "Home office"
  }'
```

Confirm ingestion with `daily_get_day` for the target date.

## Troubleshooting

- **401 Unauthorized** – check the bearer token and watch for trailing spaces in automation tools.
- **Events skipped** – duplicate suppression occurs when the same `id` arrives quickly. Ensure every event has a stable unique identifier.
- **Incorrect duration** – calendar systems sometimes send separate start/end timezones. Include ISO 8601 timestamps with offsets to avoid conversion issues.
- **No attendees captured** – some APIs only deliver attendee data on certain triggers; confirm the automation sends the `attendees` array if needed.
