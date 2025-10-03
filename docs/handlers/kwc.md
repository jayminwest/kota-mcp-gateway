# KWC Handler

The Kendama World Cup (KWC) handler exposes the same run data that powers the local `/kwc` web UI. Use these tools to automate run logging, tweak your 10-trick lineup, or audit historical attempts directly from an MCP client.

## Tools

- `kwc_get_lineup {}`
  - Returns the current lineup, derived scores, and the last update timestamp.
- `kwc_set_lineup { tricks }`
  - Replaces the lineup. Each trick requires a `code` (e.g., `9-5`) and optional `label`; scores auto-derive from the trick level.
- `kwc_list_runs { date?, limit? }`
  - Lists recorded runs (newest first). Pass `date` to filter a specific day or `limit` (1-200) to cap the response size. Each run includes `totalScore` and `totalRunTimeSeconds` for quick summaries.
  - Responses also include `trickSummaries[]` with per-trick average attempt durations.
- `kwc_add_run { date, tricks, notes? }`
  - Records a run. Supply the 10-trick sequence with attempt durations in seconds. The response echoes `totalScore` and `totalRunTimeSeconds` for the new entry.
- `kwc_delete_run { recorded_at }`
  - Deletes a run using the `recorded_at` timestamp returned by `kwc_add_run` / `kwc_list_runs`.
- `kwc_update_run { recorded_at, date, tricks, notes? }`
  - Overwrites a run in-place using the same payload as `kwc_add_run`. Use this to correct attempt durations without creating duplicate entries.
- `kwc_get_trick_stats { trick_code, days? }`
  - Computes medians, interquartile range (IQR), and outlier attempts for a trick. Lower IQR = more consistent.
- `kwc_get_run_stats { days?, top? }`
  - Aggregates run-level totals (median total time, outlier counts) and returns the most consistent runs (lowest trick variance).
- `kwc_get_trend { trick_code?, days?, window? }`
  - Produces rolling median and IQR trends. Provide `trick_code` for a single trick or omit to surface the top improving/regressing tricks.

> Scores are inferred from the trick level—`9-1` is always worth 9 points, `8-4` is 8 points, etc. Submit the trick codes in the order you performed them to keep totals accurate.

## Configuration

- Set `KWC_TIMEZONE` in `.env` to control the timezone used for `recordedAt`/`updatedAt` timestamps. The default is `America/Los_Angeles` (Pacific Time). All stored values include the UTC offset so downstream consumers can parse them without extra context.

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

## Trick Consistency Example

```jsonc
kwc_get_trick_stats {
  "trick_code": "9-1",
  "days": 30
}

=> {
  "trick": "9-1",
  "runsObserved": 14,
  "sampleCount": 28,
  "medianSeconds": 42,
"interquartileRangeSeconds": 6.5,
"outliers": [95.3]
}
```

## Trend Example

```jsonc
kwc_get_trend {
  "trick_code": "8-4",
  "days": 60
}

=> {
  "trick": "8-4",
  "windowSize": 14,
  "direction": "improving",
  "consistency": "more-consistent",
  "points": [
    { "date": "2025-09-01", "rollingMedian": 78.2, "rollingIqr": 9.1, "sample": 5 },
    { "date": "2025-09-08", "rollingMedian": 71.5, "rollingIqr": 6.4, "sample": 7 }
  ]
}
```

## Storage

All data persists under `./data/kota_kwc/`:

- `lineup.json` — current lineup + last update timestamp
- `runs.json` — append-only log of recorded runs (newest entries last)

Lineup and run operations share the same JSON backing as the `/kwc` browser UI, so updates through either path stay in sync.

The analytics dashboard at `/kwc/stats` consumes the same MCP calculations via `GET /kwc/api/analytics`.

## Verification Tips

- Call `kwc_list_runs { "limit": 5 }` before and after logging to confirm the snapshot changed.
- Use `kwc_get_lineup {}` to double-check trick ordering after MCP edits.
- Run `npm run lint` / `npm run typecheck` if you modify the handler or store implementation.
