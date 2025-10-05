# Bug Planning

Create a new plan in `docs/specs/*.md` to resolve the bug with the minimal, root-cause-focused change set. Embed the issue number in the filename (e.g., `docs/specs/bug-1234-missing-subscription.md`).

## Pre-Plan Git/GitHub Checklist

1. `git fetch --all --prune`
2. `git status --short` (must be clean)
3. `gh issue view <issue-number>` – capture summary, labels, assignees, blockers
4. Note existing branches/PRs tied to the issue: `gh pr list --search "#<issue-number>"`

## Instructions

- Investigate starting from `README.md` and linked documentation.
- Keep scope constrained to fixing the bug documented in issue #<number>.
- Reference the issue explicitly in the plan intro.
- Use KOTA conventions: `npm` package manager, TypeScript, Express + MCP architecture.
- Document any new tool/library usage in **Notes** section.
- IMPORTANT: You're writing a plan to resolve a bug. Do **not** implement the fix now; craft the plan using the `Plan Format` below.
- Research the codebase to understand the regression: start with `README.md`, then explore `docs/specs/` (if present), `docs/handlers/`, `docs/webhooks/`, and supporting scripts.
- Be thorough and precise so we fix the root cause and prevent regressions while keeping changes focused.
- Create the plan file under `docs/specs/`, naming it to match the bug with issue number. Create the folder if it does not yet exist.
- Use the plan format exactly as provided; replace every `<placeholder>` with real content.
- THINK HARD about the bug, its root cause, and the minimal fix.
- Avoid unnecessary scope creep. Keep the solution surgical.

## Relevant Files

Focus primarily on:

- `src/**` – Express server, MCP handlers, routes, and utilities
- `docs/handlers/**` – service-specific behavior and expectations
- `docs/webhooks/**` – webhook ingestion flow documentation
- `docs/specs/**` – existing specs and plans (extend this set)
- `scripts/**` – helper scripts used during debugging or validation
- `public/kwc/**` – Kendama UI assets if the bug touches the KWC surfaces
- `README.md` – project overview, setup, and architecture notes

Expand scope only if the issue evidence requires it.

## Plan Format
```md
# Bug: <bug name> (Issue #<number>)

## Bug Description

<describe the bug in detail, including symptoms and expected vs actual behavior>

## Problem Statement

<clearly define the specific problem that needs to be solved>

## Solution Statement

<describe the proposed solution approach to fix the bug>

## Steps to Reproduce

<list exact steps to reproduce the bug>

## Root Cause Analysis

<analyze and explain the root cause of the bug>

## Relevant Files

Use these files to fix the bug:

<find and list the files that are relevant to the bug and describe why they are relevant in bullet points. If new files are required, add them in an h3 'New Files' section.>

## Git & Branch Strategy

- Base branch: `develop`
- Working branch: `bug/<issue-number>-<slug>`
- Commands:
  - `git checkout develop && git pull origin develop`
  - `git checkout -b bug/<issue-number>-<slug>`
  - Plan commits using Conventional Commits referencing the issue (e.g., `fix(handlers): adjust subscription check (#<issue-number>)`).

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

<list step-by-step tasks as h3 headers plus bullet points. Include checkpoints for `git status`, `git add`, interim commits, and pushing to origin. The final step must run the Validation Commands and prepare the PR (`gh pr create --base develop --head bug/<issue-number>-<slug>` if applicable).>

## Validation Commands

Execute every command to prove the bug is fixed with zero regressions.

<list all commands needed for validation. Include a command to demonstrate the bug before and after the fix when possible.>
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test` (if tests exist)

## Notes

<optionally list additional context (linked issues/PRs, tools installed, open questions).>
```

## Bug
$ARGUMENTS

## Report
- Summarize the work you've just done in a concise bullet point list.
- Include the path to the plan you created under `docs/specs/*.md`.
