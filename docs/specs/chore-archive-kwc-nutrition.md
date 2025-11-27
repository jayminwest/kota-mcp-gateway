# Chore: Archive KWC and Nutrition Tooling

## Task Summary

Archive all Kendama World Cup (KWC) related tooling and nutrition handler infrastructure while preserving existing data files. Remove handlers, routes, utilities, documentation, and UI components from the codebase while maintaining data integrity for historical reference.

## Context

The KWC handler (Kendama run logger with lineup tracking and analytics) and nutrition handler (aliased to daily handler) are no longer actively used and add maintenance burden to the gateway. Archiving these components will:
- Reduce the MCP tool surface area
- Simplify the codebase and reduce cognitive load
- Preserve historical data for potential future analysis
- Remove unused web UIs and REST endpoints
- Clean up configuration variables and documentation

The nutrition handler was already simplified to a re-export of DailyHandler, and daily handler aliases for nutrition/vitals tools were previously removed from MCP. This chore completes the cleanup by removing all remaining nutrition infrastructure.

## Touchpoints

**Handlers:**
- `src/handlers/kwc.ts` – KWC MCP handler (delete)
- `src/handlers/nutrition.ts` – Nutrition re-export shim (delete)

**Routes:**
- `src/routes/kwc.ts` – KWC REST API router (delete)

**Utilities:**
- `src/utils/kwc-store.ts` – KWC data persistence layer (delete)
- `src/utils/kwc-analytics.ts` – KWC analytics calculations (delete)

**Public Assets:**
- `public/kwc/` – Entire directory including web UI and analytics dashboard (delete)
  - `index.html`, `app.js`, `styles.css` – Main run logger UI
  - `stats.html`, `stats.js` – Analytics dashboard

**Documentation:**
- `docs/handlers/kwc.md` – KWC handler guide (delete)
- `docs/handlers/NUTRITION.md` – Nutrition handler redirect (delete)
- `docs/handlers/DAILY.md` – Remove nutrition/vitals alias references
- `README.md` – Remove KWC endpoints, bundle references, and notes

**Configuration:**
- `.env.example` – Remove KWC_TIMEZONE variable
- `src/utils/config.ts` – Remove KWC_TIMEZONE from config schema

**Main Server:**
- `src/index.ts` – Remove:
  - KWC handler imports and bundle registration
  - KWC store and router setup
  - KWC web UI routes (`/kwc`, `/kwc/stats`, static serving)
  - KWC help resources and prompts
  - Nutrition/vitals help resource aliases

**Data Preservation:**
- `data/kota_kwc/` – Preserve entirely (no changes to data directory)

## Git & Branch Strategy

- Base branch: `main`
- Working branch: `chore/archive-kwc-nutrition`
- Setup commands:
  - `git checkout main && git pull origin main`
  - `git checkout -b chore/archive-kwc-nutrition`
- Commit guidance: Use atomic commits with descriptive messages:
  - `chore: remove KWC handler and infrastructure`
  - `chore: remove nutrition handler shim`
  - `chore: clean up documentation and config`
  - `chore: update README for KWC/nutrition removal`

## Step by Step Tasks

### 1. Environment Setup

- Ensure working directory is clean: `git status --short`
- Checkout and update base branch: `git checkout main && git pull origin main`
- Create working branch: `git checkout -b chore/archive-kwc-nutrition`

### 2. Remove KWC Backend Infrastructure

**Delete handlers:**
- Remove `src/handlers/kwc.ts`
- Remove `src/handlers/nutrition.ts`

**Delete routes:**
- Remove `src/routes/kwc.ts`

**Delete utilities:**
- Remove `src/utils/kwc-store.ts`
- Remove `src/utils/kwc-analytics.ts`

**Git checkpoint:**
```bash
git status
git add src/handlers/kwc.ts src/handlers/nutrition.ts
git add src/routes/kwc.ts
git add src/utils/kwc-store.ts src/utils/kwc-analytics.ts
git commit -m "chore: remove KWC and nutrition handler infrastructure"
```

### 3. Remove KWC Frontend Assets

**Delete public directory:**
- Remove entire `public/kwc/` directory

**Git checkpoint:**
```bash
git status
git add public/kwc/
git commit -m "chore: remove KWC web UI and analytics dashboard"
```

### 4. Update Main Server (src/index.ts)

**Remove imports (lines ~32, 36-37):**
- Remove: `import { KwcHandler } from './handlers/kwc.js';`
- Remove: `import { KwcStore } from './utils/kwc-store.js';`
- Remove: `import { createKwcRouter, createKwcAnalyticsRouter } from './routes/kwc.js';`

**Remove KWC web UI routes (lines ~174, 178-200):**
- Remove: `const kwcPublicDir` declaration
- Remove: `app.get('/kwc', ...)` route handler
- Remove: `app.get('/kwc/stats', ...)` route handler
- Remove: `app.use('/kwc', express.static(...))` middleware

**Remove KWC store and API setup (lines ~237-239):**
- Remove: `const kwcStore = new KwcStore(...)`
- Remove: `app.use('/kwc/api/analytics', ...)`
- Remove: `app.use('/kwc/api', ...)`

**Remove KWC bundle definition (lines ~642-647):**
- Remove entire bundle definition object with key: `'kwc'`

**Remove help resources (lines ~768, 869-889):**
- Remove: `'- help://kwc/usage'` from help index
- Remove: `'- help://nutrition/usage, help://vitals/usage'` from daily help reference (line 765, 856-857)
- Remove: `registerHelpResource('nutrition_help_usage', ...)` (line 866)
- Remove: `registerHelpResource('vitals_help_usage', ...)` (line 867)
- Remove: `const kwcHelpText` and `registerHelpResource('kwc_help_usage', ...)` (lines 869-889)

**Remove prompts (lines ~1098-1109):**
- Remove: `mcp.prompt('kwc.examples', ...)` entire block

**Verify compilation:**
```bash
npm run typecheck
```

**Git checkpoint:**
```bash
git status
git add src/index.ts
git commit -m "chore: remove KWC and nutrition references from main server"
```

### 5. Update Configuration

**Update .env.example:**
- Remove KWC comment header and `KWC_TIMEZONE` variable (lines ~17-19)

**Update src/utils/config.ts:**
- Remove `KWC_TIMEZONE` from config schema (line ~15)

**Verify compilation:**
```bash
npm run typecheck
```

**Git checkpoint:**
```bash
git status
git add .env.example src/utils/config.ts
git commit -m "chore: remove KWC configuration variables"
```

### 6. Update Documentation

**Delete handler docs:**
- Remove `docs/handlers/kwc.md`
- Remove `docs/handlers/NUTRITION.md`

**Update docs/handlers/DAILY.md:**
- Remove line 20 reference about legacy aliases: `> Legacy aliases (\`nutrition_*\`, \`vitals_*\`) have been retired...`
- Simplify to just state the tools are for daily logging

**Update README.md:**
- Remove line 8: "Webhook ingestion pipeline that maps external events into daily vitals"
- Update line 8 to: "Webhook ingestion pipeline that maps external events into daily logs"
- Remove line 20: `KWC` from REST API routers list
- Remove lines 39-44: All `/kwc` endpoint documentation
- Remove line 96: `"kwc"` from disabled_bundles example
- Remove line 101: `kwc` from Available Bundle Keys list
- Remove lines 142-146: All KWC notes section

**Git checkpoint:**
```bash
git status
git add docs/handlers/kwc.md docs/handlers/NUTRITION.md docs/handlers/DAILY.md README.md
git commit -m "chore: update documentation to remove KWC and nutrition references"
```

### 7. Final Validation

**Run all validation commands:**
```bash
npm run lint
npm run typecheck
npm run build
```

**Verify data preservation:**
```bash
ls -la data/kota_kwc/
```

**Manual verification:**
- Confirm no remaining references: `git grep -i "kwc" -- ':!data' ':!docs/specs/chore-archive-kwc-nutrition.md'`
- Confirm no remaining references: `git grep -i "nutrition" -- ':!data' ':!docs/specs/chore-archive-kwc-nutrition.md' ':!docs/handlers/DAILY.md'`
- Verify only legitimate nutrition references remain (e.g., in DAILY.md describing historical context)

### 8. Push and Create PR

**Push branch:**
```bash
git push origin chore/archive-kwc-nutrition
```

**Create pull request:**
```bash
gh pr create --base main --head chore/archive-kwc-nutrition \
  --title "chore: archive KWC and nutrition tooling" \
  --body "## Summary
Archives all Kendama World Cup (KWC) related tooling and nutrition handler infrastructure while preserving existing data files.

## Changes
- Removed KWC handler, routes, utilities, and web UI
- Removed nutrition handler shim (was already just a daily handler re-export)
- Removed KWC configuration variables
- Cleaned up documentation and README
- Preserved all data in \`data/kota_kwc/\` for historical reference

## Context
These components are no longer actively used and add maintenance burden. The nutrition handler was already simplified to an alias of the daily handler, and this completes the cleanup by removing all remaining infrastructure.

## Validation
- ✅ All TypeScript compilation checks pass
- ✅ Linting passes
- ✅ Build succeeds
- ✅ No remaining code references to KWC or nutrition (except historical data)
- ✅ Data preserved in \`data/kota_kwc/\`

## Notes
This is a pure removal/cleanup chore with no functional impact on remaining handlers. The data is preserved for potential future analysis or restoration if needed."
```

## Validation Commands

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Full build
npm run build

# Verify no remaining references (should only find data files and this spec)
git grep -i "kwc" -- ':!data' ':!docs/specs/chore-archive-kwc-nutrition.md'
git grep -i "nutrition" -- ':!data' ':!docs/specs/chore-archive-kwc-nutrition.md' ':!docs/handlers/DAILY.md'

# Confirm data preservation
ls -la data/kota_kwc/
```

## Deliverables

1. Clean codebase with all KWC and nutrition infrastructure removed
2. Updated documentation reflecting the removal
3. Preserved historical data in `data/kota_kwc/`
4. This specification document for future reference
5. Pull request with atomic commits and clear changelog

## Notes

- **Data preservation**: All files in `data/kota_kwc/` remain untouched. This includes `lineup.json` and `runs.json` which contain historical Kendama training data.
- **No migrations needed**: Since we're removing functionality rather than changing it, no data migrations are required.
- **Bundle count**: This removes 2 bundles (kwc, nutrition) from the available bundle keys, simplifying the toolkit surface area.
- **Future restoration**: If KWC functionality is needed again, this spec and the preserved data files provide a complete reference for restoration.
- **Daily handler**: The daily handler remains fully functional and is the recommended tool for all daily logging needs (formerly covered by nutrition aliases).
