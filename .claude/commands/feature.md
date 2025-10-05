# Feature Planning

Author a comprehensive plan for a new capability in `docs/specs/*.md`. Include the issue number in the filename (e.g., `docs/specs/feature-2070-team-dashboard.md`).

## Pre-Plan Git/GitHub Checklist

1. `git fetch --all --prune`
2. `git status --short` (must be clean)
3. `gh issue view <issue-number>` – capture user story, acceptance criteria, labels
4. Review related discussions/PRs: `gh pr list --search "#<issue-number>"`

## Instructions

- Anchor the plan to the user value described in issue #<number>.
- Reference the issue at the top of the spec and in subsequent sections.
- Consider MCP handler design, Express routes, utility impacts, and rollout strategy.
- Use KOTA conventions: `npm` package manager, TypeScript, Express + MCP architecture.
- Log additional tooling in **Notes** section.
- IMPORTANT: You're writing a plan to implement a net-new feature. Do **not** implement the feature now; produce the plan using the `Plan Format` below.
- Research the codebase fully: begin with `README.md`, review `docs/specs/` for prior art, and inspect `docs/handlers/`, `docs/webhooks/`, and existing handler implementations in `src/`.
- Follow current conventions for handlers, middleware, utils, and documentation.
- Create the plan file within `docs/specs/`, naming it after the feature with issue number. Create the directory if missing.
- Use the plan format exactly as provided; replace each `<placeholder>` with the correct details.
- THINK HARD about design, extensibility, and potential regressions.
- Keep the solution aligned with the gateway's modular structure (handlers, utilities, transport, docs).

## Relevant Files

Investigate across:

- `src/index.ts` & `src/**` – server bootstrap, handler registration, utilities, middleware
- `docs/handlers/**` & `docs/webhooks/**` – documentation patterns to keep updated
- `docs/specs/**` – existing specifications and planning docs (extend here)
- `scripts/**` – automation or helper scripts that might need updates
- `public/kwc/**` – UI artifacts if the feature touches Kendama dashboards
- `README.md` – global architecture, setup, and runtime expectations

Expand scope only if the feature evidence requires it.

## Plan Format

```md
# Feature: <feature name> (Issue #<number>)

## User Story

<"As a ..." story plus success definition>

## Objectives & Non-Goals

<bullets for desired outcomes and explicit non-goals>

## Current State & Constraints

<overview of existing behavior, technical constraints, dependencies>

## Experience & Acceptance Criteria

<describe MCP tool flows, Express routes, handler updates; include a checklist with `- [ ]` items>

## Architecture & Data Changes

<detail MCP handler design, Express routes, utilities, shared types, data storage patterns>

## Git & Branch Strategy

- Base branch: `develop`
- Working branch: `feature/<issue-number>-<slug>`
- Commands:
  - `git checkout develop && git pull origin develop`
  - `git checkout -b feature/<issue-number>-<slug>`
- Commit strategy: Conventional Commit messages referencing the issue (`feat(handlers): add dashboard filters (#<issue-number>)`).

## Phased Implementation Plan

IMPORTANT: Execute every phase in order, top to bottom.

<use h3 sections per phase with bullet tasks, including git checkpoints (`git status`, `git add`), interim commits, branch pushes, and PR preparation steps.>

## Testing & QA Strategy

<list automated tests (if applicable), static analysis, manual QA scenarios, observability updates>

## Validation Commands

<commands to verify correctness end-to-end>
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test` (if tests exist)
- Manual MCP tool invocation examples
- Health check: `curl http://localhost:8084/health`

## Release & Follow-Up

<deployment considerations, documentation updates (`docs/handlers/`, `README.md`), analytics/telemetry, post-launch review items>

## Notes

<optional references, open questions, stakeholder callouts>
```

## Feature
$ARGUMENTS

## Report
- Summarize the work you've just done in a concise bullet point list.
- Include the path to the plan you created under `docs/specs/*.md`.
