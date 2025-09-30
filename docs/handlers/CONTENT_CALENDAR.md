# Content Calendar Handler

The content calendar handler keeps a lightweight editorial backlog: ideas, drafts, scheduled pieces, and published work. It stores structured records under `./data/kota_content_calendar` so downstream automations and agents can keep context about campaigns, owners, timelines, and supporting assets.

## Tools

Tools share the `content_calendar_` prefix; the former `editorial_` alias has been removed to reduce manifest size.

- `content_calendar_create_item { title, status?, channel?, owner?, scheduled_for?, tags?, notes?, assets?, metadata? }`
  - Create a record with optional scheduling windows, brief, CTA, and supporting assets.
- `content_calendar_update_item { id, ...fields }`
  - Patch an entry. Pass `null` to clear optional fields (e.g., `scheduled_for: null`). Use `append_tags` / `append_notes` to merge without overwriting.
- `content_calendar_get_item { id }`
  - Return the stored record including history snapshots and metadata.
- `content_calendar_list_items { status?, channel?, scheduled_from?, scheduled_to?, search?, sort?, limit? }`
  - List entries with filters. `sort` supports `scheduled` (default), `created`, or `updated`.
- `content_calendar_delete_item { id }`
  - Remove the record and any written snapshots from disk.

## Record Shape

Each item captures:

- `title`, `status`, `channel`, `owner`
- Scheduling (`scheduledFor`, `dueAt`, `publishAt`)
- Context (`summary`, `description`, `brief`, `callToAction`, `campaign`)
- Supporting metadata (`tags[]`, `notes[]`, `assets[]`, `metadata`)
- Audit metadata (`createdAt`, `updatedAt`, `history[]` with status changes, field updates, and appended notes)

Assets are stored with a `label` and optional `type`, `url`, `path`, and `notes`. Tags/notes are deduplicated and normalised before persistence.

## Storage

- Primary ledger: `./data/kota_content_calendar/calendar.json`
- Per-item snapshots: `./data/kota_content_calendar/items/<id>.json`

Directories are created on demand. Snapshots help with git-friendly diffs or external backup tasks.

## Usage Tips

- Generate a short slug when you need deterministic IDs, otherwise they are derived from the title (with `-1`, `-2`, … suffixes for collisions).
- Include `status_note` when calling `update_item` to log why a status changed (e.g., "Ready for edit", "Waiting on assets").
- Use `append_notes` to drop running commentary without clobbering the structured note list.
- Filter upcoming work with `content_calendar_list_items { "status": ["scheduled", "in_review"], "scheduled_from": "2024-05-01T00:00:00Z" }`.

## Validation

- `npm run lint`
- `npm run typecheck`
- Optional smoke: `content_calendar_list_items {}` before/after changes to verify persistence.
