# Daily Handler

The daily handler captures holistic day logs covering nutrition, supplements, substances, activities, training sessions, and free-form notes. Use it when you have parsed structured data from a conversation and want to persist it for later review.

## Tools

Primary prefixes use `daily_*`. The same actions are also available under the `nutrition_*` and `vitals_*` aliases for backward compatibility.

- `daily_log_day { date, entries, summary?, notes?, totals?, rawText?, metadata?, timezone? }`
  - Overwrites the full log for the given `date`.
- `daily_append_entries { date, entries, summary?, notes?, totals?, rawText?, metadata?, timezone? }`
  - Appends entries to an existing day, creating it if missing.
- `daily_get_day { date }`
  - Retrieves the stored log and metadata for the date.
- `daily_list_days {}`
  - Lists recorded dates with entry counts and timestamps.
- `daily_delete_day { date }`
  - Removes the stored log for the date.

> Aliases: replace the `daily_` prefix with `nutrition_` or `vitals_` to invoke the exact same endpoints.

## Entry Structure

Each `entries[]` item should capture the parsed details. Supported categories:

- `food`, `drink`, `snack`
- `supplement`, `substance`
- `note`
- `activity`, `training`

### Food / Intake Example

```jsonc
{
  "name": "Eggs",
  "category": "food",
  "meal": "breakfast",
  "quantity": {
    "value": 2,
    "unit": "count",
    "grams": 120
  },
  "macros": {
    "calories": 156,
    "protein_g": 13
  },
  "time": "08:15",
  "notes": "Scrambled with butter",
  "tags": ["high-protein"],
  "sourceText": "2 scrambled eggs with butter"
}
```

### Activity / Training Example

```jsonc
{
  "name": "Kendama session",
  "category": "activity",
  "time": "16:17",
  "duration_minutes": 42,
  "metrics": {
    "heart_rate_avg": 118,
    "strain": 8.4
  },
  "notes": "Focused on tricks 9-4 and 10-4"
}
```

Provide the best structured data available. Use `metrics` for optional activity data (heart rate, strain, calories, reps, sets). Keep `macros`, `micros`, and dosage data structured so downstream tooling can compare days.

## Example Workflow

1. User message: “Breakfast: 2 eggs (120g) cooked in 5g butter. Lunch: 150g grilled chicken, 200g rice. Took 1000 IU vitamin D. Evening: 5mg THC gummy. Kendama at 16:17 for 42 minutes and 17:49 for 18 minutes.”
2. Agent parses into entries grouped by meal, substances, and activities.
3. Agent calls `daily_log_day` (or `nutrition_log_day`) with structured entries and optional `summary`, `notes`, `rawText`, and `totals`.

## Storage

Entries are persisted under `./data/kota_daily/logs.json`. Existing logs stored at `./data/kota_nutrition/logs.json` are migrated on read so no historical data is lost.

## Validation Tips

- Run `npm run lint` and `npm run typecheck` after modifying handler logic.
- Use `daily_list_days {}` before and after logging to verify changes (aliases work too).
- Include the raw free-form text in `rawText` when available to preserve original context.
