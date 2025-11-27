# Feature: KWC Session Auto-Enrichment

## Feature Description
Automatically enrich Kendama World Cup (KWC) training session data with contextual information from iOS context snapshots. When a run is logged via `kwc_add_run` or retrieved via `kwc_list_runs`, the system correlates run timestamps with nearby iOS context snapshots (within a ±30 minute window) to augment run metadata with location, weather conditions, and auto-generated tags. This enrichment enables location- and weather-based filtering (e.g., "show outdoor sessions" or "runs at Botanical Garden") and surfaces performance correlations (e.g., "3 of 5 PRs at this venue" or "avg time 15% slower in rain"). All enrichment is stored in the existing run `metadata` field with graceful fallback when no context snapshot is available, requiring no schema changes.

## User Story
As a Kendama athlete
I want my training runs automatically enriched with location and weather context
So that I can analyze performance patterns by venue, indoor/outdoor conditions, and weather factors without manual data entry

## Problem Statement
Currently, KWC run logging captures only trick attempt timings and optional notes. Athletes who train at multiple venues (parks, gyms, competitions) have no automated way to:
1. Track which sessions occurred at which locations
2. Correlate performance with weather conditions (temperature, precipitation, wind)
3. Filter runs by venue or indoor/outdoor status
4. Identify performance patterns tied to environmental factors

The iOS context snapshot webhook already captures rich location and weather data, but this information exists in isolation from KWC run data. Manual tagging is tedious and error-prone, discouraging athletes from maintaining detailed session logs.

## Solution Statement
Implement a correlation engine that matches KWC run timestamps with iOS context snapshots within a ±30 minute window. When a run is added or listed, the system:

1. **Searches** for the nearest context snapshot (by timestamp proximity)
2. **Extracts** location name, coordinates, weather conditions (temp, sky/condition), and distance from home
3. **Derives** auto-tags: `indoor`/`outdoor` (heuristic: no weather data or location name contains "gym"/"center"), venue name (parsed from location)
4. **Enriches** the run's `metadata` field with a structured `context` object containing location, weather, tags, and snapshot reference
5. **Returns** enriched data in `kwc_list_runs` responses without additional API calls
6. **Enables** filtering via optional `kwc_list_runs` parameters: `location`, `tag`, `indoor`, `outdoor`
7. **Surfaces** analytics: correlate enriched metadata with performance metrics (trick stats, run times) to flag venue-based patterns

The implementation leverages existing `ContextSnapshotService.getRecent()` for snapshot retrieval and stores enrichment in the existing `metadata?: Record<string, unknown>` field on runs, ensuring backward compatibility.

## Relevant Files
Use these files to implement the feature:

- **`src/handlers/kwc.ts`** (lines 167-254)
  - Core handler for KWC MCP tools (`kwc_add_run`, `kwc_list_runs`, `kwc_update_run`)
  - Currently calls `store.addRun()` and `store.listRuns()` without enrichment
  - Needs integration of enrichment service in `handleAddRun` and `handleListRuns`
  - Add optional filter parameters to `ListRunsArgsSchema` for location/tag filtering

- **`src/utils/kwc-store.ts`** (lines 1-289)
  - Manages KWC run persistence (`runs.json`)
  - `KwcRunInput` interface includes `metadata?: Record<string, unknown>` field (not currently used)
  - `addRun()`, `updateRun()`, `findRun()` methods handle run CRUD
  - No changes needed to storage layer (metadata field already exists)

- **`src/utils/context-snapshots.ts`** (lines 1-602)
  - `ContextSnapshotService` provides `getRecent(limit)` for snapshot retrieval
  - `ContextSnapshotRecord` includes `ios.location`, `ios.weather`, `capturedAt` timestamp
  - Location field typically contains `{ name, latitude, longitude }` (varies by iOS shortcut)
  - Weather field typically contains `{ condition, temperature_f }` or similar

- **`src/utils/kwc-analytics.ts`** (lines 1-384)
  - `decorateRun()` adds computed fields (`totalScore`, `totalRunTimeSeconds`, etc.)
  - Currently no enrichment logic; ideal place to integrate context correlation
  - Analytics functions (`computeTrickStats`, `buildTrendAnalysis`) can be extended to analyze enrichment metadata

- **`docs/handlers/kwc.md`** (lines 1-126)
  - Documentation for KWC handler tools
  - Needs update to describe new enrichment behavior and filtering parameters

- **`docs/handlers/CONTEXT_SNAPSHOT.md`** (lines 1-70)
  - Documents context snapshot webhook and MCP tool
  - Reference for understanding snapshot data structure

### New Files
- **`src/utils/kwc-enrichment.ts`**
  - New utility module for run enrichment logic
  - Exports `enrichRunWithContext()` function that correlates run timestamp with snapshots
  - Exports `filterRunsByEnrichment()` helper for location/tag filtering
  - Exports TypeScript interfaces for enriched metadata structure
  - Implements distance calculation (optional: Haversine formula for home distance)
  - Implements indoor/outdoor classification heuristics

- **`src/utils/kwc-enrichment-analytics.ts`**
  - Optional analytics module for venue/weather correlation insights
  - Exports `computeVenuePerformance()` to correlate location with trick stats
  - Exports `computeWeatherImpact()` to analyze weather effects on run times
  - Used by new analytics MCP tools or incorporated into existing analytics responses

## Implementation Plan

### Phase 1: Foundation
Create the enrichment utility layer that handles context snapshot correlation, metadata extraction, and tag derivation. This establishes the core enrichment logic without coupling to the handler or storage layers, enabling isolated testing.

### Phase 2: Core Implementation
Integrate enrichment into the KWC handler's `add_run` and `list_runs` operations. Modify the handler to invoke enrichment on run addition (storing enriched metadata) and optionally apply enrichment to existing runs during list operations. Add filtering parameters to `list_runs` for location/tag queries.

### Phase 3: Integration
Extend analytics to surface enrichment-based insights (venue performance, weather correlations). Update documentation to reflect new enrichment behavior, filtering capabilities, and analytics features. Add comprehensive tests for enrichment logic, filtering, and analytics.

## Step by Step Tasks

### 1. Create enrichment type definitions
- Define `RunEnrichmentMetadata` interface with `context`, `location`, `weather`, `tags`, `snapshotId` fields
- Define `EnrichmentConfig` interface for correlation window (default ±30min), home coordinates, indoor/outdoor keywords
- Define `LocationInfo`, `WeatherInfo`, `EnrichmentTags` sub-interfaces
- Export all types from `src/utils/kwc-enrichment.ts`

### 2. Implement context snapshot correlation
- Create `findNearestSnapshot()` function that accepts run `recordedAt` timestamp and snapshot array
- Use timestamp proximity algorithm: calculate absolute difference, return snapshot within ±30min window
- Return `null` if no snapshots fall within the window
- Add unit tests for proximity matching (exact match, near match, out of range)

### 3. Implement location parsing and tag derivation
- Create `parseLocation()` function to extract location name, coordinates from snapshot `ios.location`
- Handle various location formats (string name, object with name/lat/lng, null/missing)
- Create `deriveIndoorOutdoorTag()` heuristic:
  - Check if location name contains indoor keywords ("gym", "center", "hall", "studio", "indoor")
  - If weather data is missing/null → likely indoor
  - Default to `outdoor` if weather present and no indoor keywords
- Create `deriveTags()` function that returns array: `[indoor|outdoor, <venue-name>]`
- Add unit tests for location parsing edge cases and tag derivation logic

### 4. Implement weather extraction
- Create `parseWeather()` function to extract temperature, condition from snapshot `ios.weather`
- Handle various weather formats (temperature_f, temp_f, condition, sky, description)
- Normalize temperature to Fahrenheit (single unit for consistency)
- Return structured `WeatherInfo` object with `temperatureF`, `condition`, `raw` fields
- Add unit tests for weather parsing with different snapshot formats

### 5. Implement distance calculation (optional)
- Create `calculateDistance()` function using Haversine formula for lat/lng pairs
- Accept home coordinates from `EnrichmentConfig` (sourced from env or config file)
- Return distance in miles (or km, configurable)
- If home coords not configured or snapshot lacks coords → return `null`
- Add unit tests for distance calculation (known coordinate pairs)

### 6. Create main enrichment function
- Create `enrichRunWithContext()` function accepting run, snapshots array, config
- Orchestrate: find nearest snapshot → parse location → parse weather → derive tags → calculate distance
- Build `RunEnrichmentMetadata` object and return it
- If no snapshot found → return `null` (graceful fallback)
- Add integration tests combining all sub-functions

### 7. Update KwcRunInput metadata typing
- Extend `KwcRunInput` type to hint that `metadata?.context` can contain `RunEnrichmentMetadata`
- Add TypeScript type guard `hasEnrichment()` to check if run metadata includes enrichment
- Update `kwc-store.ts` imports to reference enrichment types (for type safety)

### 8. Integrate enrichment into kwc_add_run handler
- Modify `KwcHandler.handleAddRun()` to instantiate `ContextSnapshotService`
- Fetch recent snapshots (e.g., last 50) via `contextSnapshots.getRecent(50)`
- Call `enrichRunWithContext()` with run timestamp, snapshots, config
- If enrichment result is non-null → merge into `args.metadata.context`
- Pass enriched metadata to `store.addRun()`
- Add handler-level test: mock snapshot service, verify enrichment stored

### 9. Integrate enrichment into kwc_list_runs handler
- Modify `KwcHandler.handleListRuns()` to optionally enrich runs missing context metadata
- Decision: enrich on-the-fly (for historical runs) or only return stored enrichment
  - **Recommended**: Only return stored enrichment (avoids performance overhead)
  - Alternative: Add `enrich: boolean` parameter to trigger on-the-fly enrichment
- For now: trust that `add_run` handles enrichment; `list_runs` just returns metadata as-is
- Future enhancement: background job to backfill enrichment for historical runs

### 10. Add filtering parameters to kwc_list_runs
- Extend `ListRunsArgsSchema` with optional fields:
  - `location?: string` (partial match on enrichment context location name)
  - `tag?: string` (exact match on enrichment tags array)
  - `indoor?: boolean` (filter for indoor tag)
  - `outdoor?: boolean` (filter for outdoor tag)
- Create `filterRunsByEnrichment()` utility in `kwc-enrichment.ts`
- Apply filters after retrieving runs in `handleListRuns()`
- Add handler tests for filtering: location match, tag match, indoor/outdoor flags

### 11. Update kwc_update_run to preserve/re-enrich
- Modify `KwcHandler.handleUpdateRun()` to re-run enrichment on updated runs
- Fetch snapshots and call `enrichRunWithContext()` with updated run timestamp
- Merge new enrichment into metadata (preserving other metadata fields)
- Add test: update run date, verify enrichment updates to match new timestamp's snapshot

### 12. Create analytics: venue performance correlation
- Create `src/utils/kwc-enrichment-analytics.ts`
- Implement `computeVenuePerformance(runs, trickCode?)` function:
  - Group runs by location name (from enrichment metadata)
  - For each venue: compute median trick time, IQR, run count
  - Identify "PR venues" (best median times) and "slow venues"
  - Return structured summary: `{ venue: string, runCount, medianSeconds, iqr, rank }`
- Add unit tests with sample enriched runs

### 13. Create analytics: weather impact analysis
- Implement `computeWeatherImpact(runs)` function in `kwc-enrichment-analytics.ts`:
  - Segment runs by weather condition (sunny, cloudy, rainy, etc.)
  - Segment by temperature ranges (<60F, 60-75F, >75F)
  - Compute median run times and trick stats per segment
  - Return comparison: "avg time 15% slower in rain vs sunny"
- Add unit tests with sample enriched runs (varied weather)

### 14. Add optional analytics to kwc_get_trick_stats
- Extend `handleGetTrickStats()` to include venue breakdown if enrichment present
- Add optional response field: `venueBreakdown: Array<{ venue, sampleCount, medianSeconds }>`
- Only include if >50% of runs have enrichment metadata
- Add integration test: enrich runs, call trick_stats, verify breakdown

### 15. Add optional analytics to kwc_get_run_stats
- Extend `handleGetRunStats()` to include weather/venue insights
- Add optional response fields: `topVenues`, `weatherImpact`
- Surface findings like "3 of 5 fastest runs at Botanical Garden"
- Add integration test: enrich runs, call run_stats, verify insights

### 16. Update handler documentation
- Modify `docs/handlers/kwc.md` to document enrichment behavior:
  - Explain automatic context correlation on `kwc_add_run`
  - List new filtering parameters for `kwc_list_runs` (location, tag, indoor, outdoor)
  - Show example enriched run metadata structure
  - Document optional analytics fields (venueBreakdown, topVenues, weatherImpact)
- Add "Enrichment" section with example JSON showing enriched metadata

### 17. Update context snapshot documentation
- Modify `docs/handlers/CONTEXT_SNAPSHOT.md` to mention KWC integration:
  - Note that snapshots are now correlated with KWC runs
  - Explain ±30min correlation window
  - Reference kwc.md for enrichment details

### 18. Add environment variable for home coordinates
- Update `.env.example` with optional `KWC_HOME_LAT` and `KWC_HOME_LNG` variables
- Modify `src/utils/config.ts` to load these variables (type: `number | undefined`)
- Use in enrichment config for distance calculation
- Document in `README.md` under KWC configuration section

### 19. Write unit tests for enrichment utilities
- Test `findNearestSnapshot()`: exact match, near match, no match, empty array
- Test `parseLocation()`: valid object, string only, null, missing fields
- Test `parseWeather()`: valid object, missing fields, null
- Test `deriveIndoorOutdoorTag()`: indoor keywords, weather present/absent
- Test `calculateDistance()`: known coordinates, missing coords, no home coords
- Test `enrichRunWithContext()`: full enrichment, no snapshot, partial data
- Achieve >90% coverage for `kwc-enrichment.ts`

### 20. Write integration tests for handler enrichment
- Mock `ContextSnapshotService.getRecent()` to return test snapshots
- Test `kwc_add_run`: verify enrichment stored in metadata
- Test `kwc_list_runs`: verify enriched runs returned, filtering works
- Test `kwc_update_run`: verify enrichment updates on timestamp change
- Test `kwc_add_run` with no snapshots: verify graceful fallback (no enrichment)
- Test filtering: location partial match, tag exact match, indoor/outdoor boolean

### 21. Write integration tests for analytics enrichment
- Create sample runs with varied enrichment (multiple venues, weather conditions)
- Test `kwc_get_trick_stats`: verify venue breakdown included
- Test `kwc_get_run_stats`: verify topVenues and weatherImpact included
- Test analytics with <50% enrichment: verify optional fields omitted
- Verify performance insights accuracy (e.g., "3 of 5 PRs at venue X")

### 22. Add logging for enrichment operations
- Log enrichment success/failure at `debug` level in `enrichRunWithContext()`
- Log snapshot correlation window hits/misses
- Log filtering operations (how many runs matched filters)
- Use structured logging with fields: `runDate`, `snapshotId`, `enrichmentStatus`

### 23. Run validation commands
- Execute `npm run lint` to verify code style compliance
- Execute `npm run typecheck` to verify TypeScript types
- Execute `npm run build` to ensure clean build
- Execute `npm run health` (if available) or manual health check via `curl http://localhost:8084/health`
- Execute full test suite (if `npm test` exists): verify all tests pass
- Manual end-to-end test:
  1. Add a KWC run via MCP tool
  2. Verify enrichment appears in metadata
  3. List runs with location filter
  4. Verify filtering works
  5. Call trick_stats and verify venue breakdown

## Testing Strategy

### Unit Tests
- **Enrichment utilities** (`kwc-enrichment.ts`):
  - `findNearestSnapshot()`: boundary cases (exact match, 29min59s, 30min01s, no match)
  - `parseLocation()`: all location formats (object, string, null, partial data)
  - `parseWeather()`: all weather formats (various key names, units, null)
  - `deriveIndoorOutdoorTag()`: indoor keywords (case-insensitive), weather presence, edge cases
  - `calculateDistance()`: Haversine accuracy (known test coordinates), null handling
  - `enrichRunWithContext()`: full enrichment success, partial data, no snapshot, null config

- **Analytics utilities** (`kwc-enrichment-analytics.ts`):
  - `computeVenuePerformance()`: multiple venues, single venue, no enrichment
  - `computeWeatherImpact()`: varied weather, missing weather, temperature segmentation

### Integration Tests
- **Handler operations**:
  - `kwc_add_run`: mock ContextSnapshotService, verify enriched metadata persisted
  - `kwc_list_runs`: verify enriched runs returned, filtering by location/tag/indoor/outdoor
  - `kwc_update_run`: verify enrichment refreshed on timestamp change
  - `kwc_get_trick_stats`: verify venue breakdown when enrichment present
  - `kwc_get_run_stats`: verify topVenues/weatherImpact insights

- **End-to-end workflow**:
  1. Create context snapshot via webhook
  2. Add KWC run within ±30min window
  3. List runs, verify enrichment appears
  4. Filter by location, verify correct subset
  5. Get trick stats, verify venue breakdown

### Edge Cases
- **No snapshots available**: verify graceful fallback (no enrichment, no errors)
- **Snapshots outside ±30min window**: verify no correlation, metadata empty
- **Multiple snapshots in window**: verify nearest one selected (smallest time delta)
- **Missing location/weather in snapshot**: verify partial enrichment (tags may be incomplete)
- **Invalid snapshot data**: verify parsing fails gracefully, logs warning, returns null
- **Run without recordedAt timestamp**: verify enrichment skipped (cannot correlate)
- **Historical runs (pre-enrichment)**: verify `list_runs` returns existing metadata without error
- **Concurrent add_run calls**: verify enrichment isolation (no race conditions)
- **Large snapshot arrays (>1000 records)**: verify performance acceptable (<100ms)
- **Home coordinates not configured**: verify distance field omitted (not error)
- **Filtering with no matches**: verify empty array returned (not error)

## Acceptance Criteria
1. **Enrichment on add_run**: When `kwc_add_run` is called and a context snapshot exists within ±30min, the returned run includes `metadata.context` with location, weather, tags, and optional distance.
2. **Graceful fallback**: When no context snapshot exists within the window, `kwc_add_run` succeeds without enrichment, and `metadata.context` is `null` or omitted.
3. **Filtering by location**: `kwc_list_runs({ location: "Botanical" })` returns only runs where `metadata.context.location.name` contains "Botanical" (case-insensitive partial match).
4. **Filtering by indoor/outdoor**: `kwc_list_runs({ indoor: true })` returns only runs with `indoor` tag; `{ outdoor: true }` returns only runs with `outdoor` tag.
5. **Tag accuracy**: Indoor/outdoor tags are correctly derived (indoor when location name contains gym/center/hall/studio or weather is null, outdoor otherwise).
6. **Update refreshes enrichment**: `kwc_update_run` with a new date/time re-runs enrichment to match the updated timestamp's nearest snapshot.
7. **Analytics integration**: `kwc_get_trick_stats` includes optional `venueBreakdown` when >50% of runs have enrichment. `kwc_get_run_stats` includes `topVenues` and `weatherImpact` insights.
8. **Performance**: Enrichment adds <100ms overhead to `kwc_add_run` (measured with 100 snapshots in memory).
9. **Documentation**: `docs/handlers/kwc.md` accurately describes enrichment behavior, filtering parameters, and enriched metadata structure.
10. **Backward compatibility**: Existing runs without enrichment metadata continue to work; `kwc_list_runs` returns them unchanged.
11. **Type safety**: All enrichment types are properly defined; TypeScript compilation succeeds with no `any` types in enrichment code.
12. **Test coverage**: Enrichment utilities achieve >90% code coverage; handler integration tests cover all filtering scenarios.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` – verify code style compliance (ESLint passes)
- `npm run typecheck` – verify TypeScript types (tsc passes with no errors)
- `npm run build` – verify clean build (dist/ contains compiled output)
- `npm test` – run full test suite (if available; all tests pass)
- `curl http://localhost:8084/health` – verify server health (returns `{ status: 'ok' }`)

**Manual end-to-end validation**:
1. Start server: `npm start` (or `docker-compose up`)
2. Create context snapshot via webhook:
   ```bash
   curl -X POST http://localhost:8084/webhooks/ios/context-snapshot \
     -H 'Content-Type: application/json' \
     -H 'Authorization: Bearer <TOKEN>' \
     -d '{
       "timestamp": "2025-10-04T14:30:00-07:00",
       "location": {"name": "Botanical Garden", "latitude": 37.7749, "longitude": -122.4194},
       "weather": {"condition": "Sunny", "temperature_f": 72}
     }'
   ```
3. Add KWC run via MCP tool (within 30min of snapshot):
   ```json
   kwc_add_run {
     "date": "2025-10-04",
     "tricks": [{ "code": "9-1", "attempts": [{ "durationSeconds": 45 }] }]
   }
   ```
4. Verify enrichment in response: check `metadata.context` includes location, weather, tags
5. List runs with location filter:
   ```json
   kwc_list_runs { "location": "Botanical" }
   ```
6. Verify only matching runs returned
7. Call trick stats and verify venue breakdown:
   ```json
   kwc_get_trick_stats { "trick_code": "9-1", "days": 30 }
   ```
8. Verify `venueBreakdown` field present (if >50% enrichment)

## Notes

### Future Enhancements
- **Backfill historical runs**: Background job or MCP tool to enrich existing runs by correlating with archived snapshots
- **Configurable correlation window**: Allow users to adjust ±30min window via env var (e.g., `KWC_ENRICHMENT_WINDOW_MINUTES`)
- **Advanced indoor/outdoor detection**: Use weather API to verify conditions (e.g., if temp is very different from outdoor forecast → indoor)
- **Venue aliases**: Map multiple location names to canonical venue (e.g., "SF Botanical Garden" → "Botanical Garden")
- **Export enriched data**: Add CSV/JSON export endpoint with enriched metadata for external analysis
- **MCP prompt for analytics**: Create `kwc.venue-analysis` prompt to surface venue performance insights conversationally

### Design Decisions
- **±30min window**: Chosen to balance correlation accuracy (snapshots close to run time) with flexibility (user may log run slightly before/after snapshot)
- **Store enrichment in metadata**: Avoids schema changes, preserves backward compatibility, allows flexible enrichment structure evolution
- **Enrich on add, not list**: Performance optimization—enrichment happens once at run creation, not repeatedly on every list operation
- **Partial enrichment acceptable**: If snapshot lacks weather or location, store what's available (graceful degradation)
- **Indoor/outdoor heuristic**: Simple keyword-based approach prioritizes fast implementation; can be refined later with external APIs or ML

### Dependencies
- No new npm packages required (uses existing zod, logger, ContextSnapshotService)
- Optional: If implementing advanced distance calculations, consider `geolib` package (but Haversine is simple enough to implement inline)

### Performance Considerations
- Snapshot retrieval limited to last 50 records (via `getRecent(50)`)—sufficient for ±30min window unless snapshots are extremely frequent
- Correlation algorithm is O(n) where n = snapshot count (50 max → <1ms)
- Filtering runs by enrichment is O(m) where m = run count (acceptable for <1000 runs)
- Analytics computation scales with run count; recommend caching analytics results for large datasets (future optimization)

### Backward Compatibility
- Existing runs without `metadata.context` continue to work
- `kwc_list_runs` returns runs as-is (no breaking changes)
- New filtering parameters are optional (default behavior unchanged)
- Analytics fields are optional (clients can ignore if not interested)
