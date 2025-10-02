# KWC Handler

The Kendama World Cup (KWC) handler exposes the same run data that powers the local `/kwc` web UI. Use these tools to automate run logging, tweak your 10-trick lineup, or audit historical attempts directly from an MCP client.

## Tools

- `kwc_get_lineup {}`
  - Returns the current lineup, derived scores, and the last update timestamp.
- `kwc_set_lineup { tricks }`
  - Replaces the lineup. Each trick requires a `code` (e.g., `9-5`) and optional `label`; scores auto-derive from the trick level.
- `kwc_list_runs { date?, limit? }`
  - Lists recorded runs (newest first). Pass `date` to filter a specific day or `limit` (1-200) to cap the response size. Each run includes `totalScore` and `totalRunTimeSeconds` for quick summaries.
- `kwc_add_run { date, tricks, notes? }`
  - Records a run. Supply the 10-trick sequence with attempt durations in seconds. The response echoes `totalScore` and `totalRunTimeSeconds` for the new entry.
- `kwc_delete_run { recorded_at }`
  - Deletes a run using the `recorded_at` timestamp returned by `kwc_add_run` / `kwc_list_runs`.

> Scores are inferred from the trick level—`9-1` is always worth 9 points, `8-4` is 8 points, etc. Submit the trick codes in the order you performed them to keep totals accurate.

## Lineup Payload

```jsonc
{
  "tricks": [
    { "code": "9-1", "label": "Moon Circle" },
    { "code": "9-5" },
    { "code": "8-4", "label": "Bird Trick" }
  ]
}
```

## Run Payload

```jsonc
{
  "date": "2025-10-02",
  "notes": "Solid flow, slowed down on 8-4",
  "tricks": [
    {
      "code": "9-1",
      "attempts": [
        { "durationSeconds": 40 },
        { "durationSeconds": 10 }
      ]
    },
    {
      "code": "8-4",
      "attempts": [
        { "durationSeconds": 77 }
      ],
      "label": "Bird Trick"
    }
  ]
}
```

Each trick needs at least one `attempts[]` entry. Durations are stored exactly as provided, so round or average them beforehand if you prefer a single value per trick.

## Storage

All data persists under `./data/kota_kwc/`:

- `lineup.json` — current lineup + last update timestamp
- `runs.json` — append-only log of recorded runs (newest entries last)

Lineup and run operations share the same JSON backing as the `/kwc` browser UI, so updates through either path stay in sync.

## Verification Tips

- Call `kwc_list_runs { "limit": 5 }` before and after logging to confirm the snapshot changed.
- Use `kwc_get_lineup {}` to double-check trick ordering after MCP edits.
- Run `npm run lint` / `npm run typecheck` if you modify the handler or store implementation.
