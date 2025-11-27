# Daily Handler

The daily handler captures holistic day logs covering nutrition, supplements, substances, activities, training sessions, and free-form notes. Use it when you need consistent day-to-day tracking—either by filling the templated checklist or by adding detailed structured entries.

## Tools

- `daily_get_template { date?, includeExamples? }`
  - Returns the standard checklist/meals skeleton so the agent can fill it before logging.
- `daily_log_day { date, template?, entries?, summary?, notes?, totals?, rawText?, metadata?, timezone? }`
  - Overwrites the full log for the given `date`. Supply at least a `template` payload or one `entries[]` item.
- `daily_append_entries { date, template?, entries?, summary?, notes?, totals?, rawText?, metadata?, timezone? }`
  - Appends data to an existing day (creating it when missing). Supply at least a `template` payload or one `entries[]` item.
- `daily_get_day { date }`
  - Retrieves the stored log and metadata for the date.
- `daily_list_days {}`
  - Lists recorded dates with entry counts and timestamps.
- `daily_delete_day { date }`
  - Removes the stored log for the date.

## Daily Template

The template keeps each day consistent and LLM-friendly. Daily constants live in the checklist; only deviations belong in `exceptions`. Meals are short names—no macros unless they matter that day.

```jsonc
{
  "template": {
    "checklist": {
      "morning_supplements": true,
      "coffee_cups": 2,
      "substances": 6,
      "kendama_session": true
    },
    "summary": {
      "supplements": "standard",
      "coffee": 2,
      "substances": 6,
      "kendama": "90min session"
    },
    "exceptions": [
      "Skipped Rhodiola today",
      "Extra coffee (4 cups)"
    ],
    "meals": [
      { "slot": "lunch", "description": "Chipotle bowl" },
      { "slot": "dinner", "description": "Rice and chicken" },
      { "slot": "late", "description": "Greek yogurt" }
    ],
    "notes": ["Felt good, new GoPro arrived"]
  }
}
```

Call `daily_get_template` to retrieve the scaffold above (optionally with example strings). When saving the day, confirm the checklist values, add any deviations to `exceptions`, and keep meal descriptions concise.

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

> Most manual updates should modify the template. Reserve `entries[]` for webhook data or situations where richer structure is essential.

## Example Workflow

1. Call `daily_get_template { "date": "2025-09-24" }` to fetch the skeleton.
2. Update `exceptions`, `meals`, and `notes` with what actually changed that day (e.g., “Extra coffee (4 cups)”).
3. Only add `entries[]` when you have rich structured data (such as workout telemetry from a webhook); otherwise submit the updated `template` via `daily_log_day`.

## Storage

Entries are persisted under `./data/kota_daily/logs.json`. Existing logs stored at `./data/kota_nutrition/logs.json` are migrated on read so no historical data is lost.

## Validation Tips

- Run `npm run lint` and `npm run typecheck` after modifying handler logic.
- Use `daily_list_days {}` before and after logging to verify changes (aliases work too).
- Include the raw free-form text in `rawText` when available to preserve original context.
