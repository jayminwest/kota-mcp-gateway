# Claude Commands Alignment Audit

**Date**: 2025-10-04
**Scope**: Align all `.claude/commands/*.md` files with KOTA MCP Gateway conventions

## Overview

This audit documents the comprehensive update of all Claude command files to align with KOTA MCP Gateway's architecture, conventions, and workflows. All commands now follow consistent patterns for Git workflow, issue tracking, branch naming, and KOTA-specific tooling.

## Core Conventions Established

### Git Workflow
- **Base branch**: `develop` (not `main`)
- **Branch naming**: `<type>/<issue-number>-<slug>`
  - `feature/123-add-spotify-handler`
  - `bug/456-fix-whoop-ingestion`
  - `chore/789-update-mcp-sdk`

### Commit Messages
- **Format**: Conventional Commits with issue references
- **Pattern**: `<type>(<scope>): <description> (#<issue-number>)`
- **Types**: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`
- **Scopes**: `handlers`, `webhooks`, `utils`, `middleware`, `routes`, `attention`
- **Examples**:
  - `feat(handlers): add Spotify playback controls (#123)`
  - `fix(webhooks): correct WHOOP sleep ingestion (#456)`
  - `chore(deps): update @modelcontextprotocol/sdk (#789)`

### Tooling Standards
- **Package manager**: `npm` (not pnpm/Turbo/yarn)
- **Commands**: `npm ci`, `npm run build`, `npm run lint`, `npm run typecheck`
- **Architecture**: Express + MCP (not Supabase/React)
- **Language**: TypeScript with strict typing

### Issue Integration
- All planning commands require `gh issue view <issue-number>`
- Spec filenames embed issue numbers: `docs/specs/<type>-<number>-<slug>.md`
- PR titles include issue references: `feat(handlers): description (#123)`
- Plan documents reference issues in title: `# Feature: Name (Issue #123)`

## Commands Updated

### Planning Commands

#### `/bug` (bug.md)
**Purpose**: Create bug fix planning document

**Key Changes**:
- Added Pre-Plan Git/GitHub Checklist (fetch, status, gh issue view, PR search)
- Added Git & Branch Strategy section with `develop` base
- Branch pattern: `bug/<issue-number>-<slug>`
- Updated plan format to include issue number in title
- Added KOTA-specific validation commands
- Specified KOTA scopes in commit examples

**Plan Template Updates**:
```md
# Bug: <bug name> (Issue #<number>)
## Git & Branch Strategy
- Base branch: `develop`
- Working branch: `bug/<issue-number>-<slug>`
- Commit: `fix(handlers): adjust subscription check (#<issue-number>)`
```

#### `/feature` (feature.md)
**Purpose**: Create feature planning document

**Key Changes**:
- Replaced Supabase/pnpm/Turbo references with KOTA patterns
- Updated to focus on MCP handler design, Express routes, utility impacts
- Added Pre-Plan Git/GitHub Checklist
- Branch pattern: `feature/<issue-number>-<slug>`
- Updated Architecture section to cover MCP handlers, data storage patterns
- Added KOTA-specific validation (MCP tool invocation, health checks)
- Updated Release section for KOTA docs (`docs/handlers/`, README)

**Plan Template Updates**:
```md
# Feature: <feature name> (Issue #<number>)
## Experience & Acceptance Criteria
<describe MCP tool flows, Express routes, handler updates>
## Architecture & Data Changes
<MCP handler design, Express routes, utilities, shared types, data storage patterns>
```

#### `/chore` (chore.md)
**Purpose**: Create maintenance task planning document

**Key Changes**:
- Added Pre-Plan Git/GitHub Checklist
- Branch pattern: `chore/<issue-number>-<slug>`
- Added Deliverables section
- Updated Relevant Files to include root config and `.github/**`
- Replaced pnpm/Turbo with npm tooling
- Added KOTA-specific touchpoints

**Plan Template Updates**:
```md
# Chore: <chore name> (Issue #<number>)
## Touchpoints
<list affected directories/files with short rationales>
## Deliverables
<enumerate expected artifacts or state "None">
```

### Execution Commands

#### `/implement` (implement.md)
**Purpose**: Execute an approved plan

**Key Changes**:
- Added Pre-Execution Git Checklist (status, branch check, fetch/pull)
- Specified KOTA conventions: npm, TypeScript, BaseHandler pattern
- Updated commit scope examples to KOTA patterns
- Emphasized `git add` (not `git add --patch`) for simplicity
- Added reference to reviewing specs in `docs/handlers/`, `docs/webhooks/`, `docs/specs/`

**Key Sections**:
```md
## Pre-Execution Git Checklist
1. `git status --short` – confirm clean tree
2. `git branch --show-current` – verify/create branch
3. `git fetch --all --prune` and `git pull --rebase` if tracking remote
```

### Workflow Commands

#### `/commit` (commit.md)
**Purpose**: Generate git commit with proper formatting

**Key Changes**:
- Converted from custom format to Conventional Commits
- Added KOTA-specific scopes (handlers, webhooks, utils, middleware, routes, attention)
- Made issue number mandatory in commit message
- Updated variable names: `issue_type`, `issue_number`, `scope`
- Added comprehensive scope guidance

**Commit Format**:
```md
<type>(<scope>): <description> (#<issue_number>)
```

#### `/generate_branch_name` (generate_branch_name.md)
**Purpose**: Generate git branch name

**Key Changes**:
- Updated format from `<type>-<number>-<adw_id>-<slug>` to `<type>/<number>-<slug>`
- Changed base branch from `main` to `develop`
- Added `git fetch --all --prune` before checkout
- Simplified variable names: removed `adw_id`
- Added branch name examples

**Branch Format**:
```md
<type>/<number>-<slug>
Examples: feature/123-add-spotify-handler
```

#### `/pull_request` (pull_request.md)
**Purpose**: Create pull request

**Key Changes**:
- Updated PR title format to Conventional Commits with issue reference
- Changed base branch from `main` to `develop`
- Added KOTA-specific scope guidance
- Updated diff commands to compare against `origin/develop`
- Simplified PR body structure for KOTA project
- Removed `adw_id` variable

**PR Title Format**:
```md
<type>(<scope>): <description> (#<issue_number>)
```

#### `/docs-update` (docs-update.md)
**Purpose**: Update docs based on PR diff

**Key Changes**:
- Added Pre-Execution Checklist with `gh pr view` and `gh pr diff --name-only`
- Changed base branch from `main` to `develop`
- Added KOTA-specific doc update guidance (MCP tools, Express routes, handlers)
- Added validation commands (npm run lint, npm run typecheck)
- Added commit step for doc updates
- Enhanced reporting requirements (commit hash)

**Doc Update Targets**:
- `docs/handlers/` – MCP tool documentation
- `docs/webhooks/` – webhook ingestion docs
- `docs/specs/` – implementation plans
- `README.md` – architecture/setup changes

### Handler Commands

#### `/handler-create` (handler-create.md)
**Purpose**: Create new MCP handler

**Key Changes**:
- Added Pre-Execution Checklist (fetch, status, name conflict check)
- Detailed bundle registration flow in `src/index.ts`
- Added guidance on `autoEnable` flag and tags
- Specified MCP help resource and prompt example registration
- Added auth/status endpoint guidance
- Comprehensive validation commands including health check and MCP tool test

**Handler Registration Steps**:
```md
1. Design handler (prefix, tools, schemas)
2. Create `src/handlers/<service>.ts` extending BaseHandler
3. Add bundle to `bundleDefinitions` in src/index.ts
4. Add config to .env.example and src/utils/config.ts
5. Document in docs/handlers/<SERVICE>.md
```

#### `/handler-edit` (handler-edit.md)
**Purpose**: Edit existing MCP handler

**Key Changes**:
- Added Pre-Execution Checklist
- Expanded implementation steps (handler, utilities, registration, docs)
- Added BaseHandler contract reference
- Detailed update sections for tools, utilities, middleware, config
- Added bundle definition update guidance
- Comprehensive validation including MCP tool testing

**Update Workflow**:
```md
1. Update handler (getTools, execute, schemas)
2. Update utilities and middleware
3. Update registration and help resources
4. Update documentation
```

### Setup Commands

#### `/install` (install.md)
**Purpose**: Initialize KOTA MCP Gateway

**Key Changes**:
- Removed git remote/init steps (not needed for existing repo)
- Focused on KOTA-specific setup
- Added verification step (typecheck + lint)
- Updated reporting to focus on `.env` configuration
- Added next steps (npm start, health check, MCP client config)

**Install Steps**:
```md
1. cp .env.example .env
2. npm ci
3. npm run build
4. npm run typecheck && npm run lint
```

### Unchanged Commands

#### `/classify_issue` (classify_issue.md)
**Status**: ✅ Already aligned

**Reason**: Command mapping logic already KOTA-specific (routes to /bug, /feature, /chore)

#### `/tools` (tools.md)
**Status**: ✅ No changes needed

**Reason**: Generic tool listing, no project-specific conventions

#### `/prime` (prime.md)
**Status**: ✅ Reviewed as part of task

**Reason**: Already KOTA-aligned, executes architecture familiarization

## File Structure Updates

### Spec File Naming
- **Before**: `docs/specs/feature-<slug>.md`
- **After**: `docs/specs/feature-<number>-<slug>.md`
- **Examples**:
  - `docs/specs/bug-1234-missing-subscription.md`
  - `docs/specs/feature-2070-team-dashboard.md`
  - `docs/specs/chore-1425-update-tailwind.md`

### Relevant Files Sections
All planning commands now reference:
- `src/**` – Express server, MCP handlers, routes, utilities
- `docs/handlers/**` – service-specific behavior docs
- `docs/webhooks/**` – webhook ingestion flow docs
- `docs/specs/**` – existing specs and plans
- `scripts/**` – helper scripts for debugging/validation
- `public/kwc/**` – Kendama UI assets (if applicable)
- Root config files – `package.json`, `tsconfig.json`, `eslint.config.js`
- `.github/**` – GitHub Actions workflows (chore command)

## Validation Commands Standardized

All commands now use consistent validation:

```bash
npm run lint
npm run typecheck
npm run build
npm test (if tests exist)
curl http://localhost:8084/health (for runtime validation)
```

Handler-specific commands also include:
- Manual MCP tool invocation examples
- Auth/status endpoint checks (e.g., `curl http://localhost:8084/auth/github/status`)

## Pre-Execution Checklists

All planning and execution commands now include:

### Planning Commands (bug, feature, chore)
```bash
1. git fetch --all --prune
2. git status --short (must be clean)
3. gh issue view <issue-number>
4. gh pr list --search "#<issue-number>" (check for related PRs)
```

### Execution Commands (implement)
```bash
1. git status --short (confirm clean tree)
2. git branch --show-current (verify branch)
3. git fetch --all --prune
4. git pull --rebase (if tracking remote)
```

### Handler Commands (handler-create, handler-edit)
```bash
1. git fetch --all --prune
2. git status --short (confirm clean tree)
3. [Additional handler-specific checks]
```

## Git & Branch Strategy Template

All planning commands include this section:

```md
## Git & Branch Strategy

- Base branch: `develop`
- Working branch: `<type>/<issue-number>-<slug>`
- Commands:
  - `git checkout develop && git pull origin develop`
  - `git checkout -b <type>/<issue-number>-<slug>`
- Commit strategy: Conventional Commit messages referencing the issue
  (`<type>(<scope>): <description> (#<issue-number>)`).
```

## Statistics

### Files Modified
- Total command files: 14
- Files updated: 11
- Files unchanged: 2 (classify_issue.md, tools.md)
- Files reviewed: 1 (prime.md)

### Changes Summary
```
11 files changed, 373 insertions(+), 179 deletions(-)

.claude/commands/bug.md                  |  74 ++++++++++++++------
.claude/commands/chore.md                |  80 +++++++++++++++-------
.claude/commands/commit.md               |  28 +++++---
.claude/commands/docs-update.md          |  34 +++++++---
.claude/commands/feature.md              | 113 +++++++++++++++++--------------
.claude/commands/generate_branch_name.md |  27 +++++---
.claude/commands/handler-create.md       |  45 +++++++++---
.claude/commands/handler-edit.md         |  40 +++++++++--
.claude/commands/implement.md            |  31 +++++++--
.claude/commands/install.md              |  32 +++++----
.claude/commands/pull_request.md         |  48 +++++++------
```

## Key Improvements

### 1. Consistency
- All commands use same Git workflow (develop base, issue-based branches)
- Standardized commit message format across all commands
- Unified validation command structure

### 2. KOTA-Specific Patterns
- MCP handler registration flow documented
- Express + MCP architecture emphasized
- KOTA-specific scopes (handlers, webhooks, utils, middleware, routes, attention)
- Bundle system integration (autoEnable, tags)

### 3. Issue Integration
- GitHub issue references mandatory in all planning
- Issue numbers in filenames, titles, commits, PRs
- `gh` CLI integration for issue/PR workflow

### 4. Documentation Flow
- Clear mapping between code and docs
- Handler docs in `docs/handlers/`
- Webhook docs in `docs/webhooks/`
- Specs/plans in `docs/specs/`

### 5. Validation Rigor
- Pre-execution checklists prevent mistakes
- Comprehensive validation commands
- Runtime testing (health checks, MCP tool invocation)

## Usage Examples

### Bug Fix Workflow
```bash
# Planning
/bug "Users report WHOOP sleep data not syncing"

# Generates: docs/specs/bug-456-fix-whoop-sleep-sync.md
# Creates branch: bug/456-fix-whoop-sleep-sync
# Commits: fix(webhooks): correct WHOOP sleep ingestion (#456)

# Execution
/implement <plan content>

# PR Creation
/pull_request 456 bug
# PR Title: fix(webhooks): correct WHOOP sleep ingestion (#456)
```

### Feature Workflow
```bash
# Planning
/feature "Add Spotify playback controls to MCP tools"

# Generates: docs/specs/feature-123-spotify-playback.md
# Creates branch: feature/123-spotify-playback
# Commits: feat(handlers): add Spotify playback controls (#123)

# Execution
/implement <plan content>

# PR Creation
/pull_request 123 feature
# PR Title: feat(handlers): add Spotify playback controls (#123)
```

### Chore Workflow
```bash
# Planning
/chore "Update MCP SDK to latest version"

# Generates: docs/specs/chore-789-update-mcp-sdk.md
# Creates branch: chore/789-update-mcp-sdk
# Commits: chore(deps): update @modelcontextprotocol/sdk (#789)

# Execution
/implement <plan content>

# PR Creation
/pull_request 789 chore
# PR Title: chore(deps): update @modelcontextprotocol/sdk (#789)
```

## Future Enhancements

### Potential Additions
1. **Test command**: `/test` for running specific test suites
2. **Deploy command**: `/deploy` for production deployment checklist
3. **Migration command**: `/migrate` for database/data migration planning
4. **Review command**: `/review` for code review checklist

### Documentation Gaps
1. No automated handler test generation
2. Missing integration test patterns
3. No performance testing guidelines

### Automation Opportunities
1. Auto-generate handler boilerplate from templates
2. Auto-update handler documentation from code
3. Auto-validate MCP tool schemas

## Conclusion

All Claude commands are now fully aligned with KOTA MCP Gateway conventions. The updates ensure:

✅ **Consistent Git workflow** with `develop` base and issue-based branches
✅ **Conventional Commits** with KOTA-specific scopes
✅ **GitHub issue integration** throughout planning and execution
✅ **KOTA architecture patterns** (Express + MCP, BaseHandler, bundle system)
✅ **npm tooling** replacing pnpm/Turbo/Supabase references
✅ **Comprehensive validation** with pre-execution checklists
✅ **Clear documentation flow** mapping code to docs

The command system is now production-ready for KOTA MCP Gateway development workflows.
