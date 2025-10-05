# Chore Planning

Document a routine maintenance task in `docs/specs/*.md`, embedding the issue number in the filename (e.g., `docs/specs/chore-1425-update-tailwind.md`).

## Pre-Plan Git/GitHub Checklist

1. `git fetch --all --prune`
2. `git status --short` (must be clean)
3. `gh issue view <issue-number>` – extract scope, labels, and acceptance criteria
4. Check for related PRs: `gh pr list --search "#<issue-number>"`

## Instructions

- Confirm the work qualifies as a chore (tooling, config, docs upkeep) per issue #<number>.
- Reference the issue explicitly in the plan.
- Use KOTA conventions: `npm` package manager, TypeScript, Express + MCP architecture.
- Log any additional tools under **Notes** section.
- IMPORTANT: You're writing a plan to resolve a chore. Do **not** execute the work now; produce the plan using the `Plan Format` below.
- Research the codebase beforehand: read `README.md`, check `docs/specs/` for context, and skim `docs/handlers/` or `docs/webhooks/` as needed.
- Keep the scope tight and efficient; we want the minimal set of tasks to accomplish the chore.
- Create the plan file under `docs/specs/`, naming it for the chore with issue number. Create the directory if needed.
- Use the plan format exactly as given; replace every `<placeholder>` with concrete content.
- THINK HARD about the steps, dependencies, and validation to avoid rework.
- Follow the project conventions and existing patterns.

## Relevant Files

Focus on the directories/files cited in the issue:

- `src/**` – Express server, handlers, middleware, utilities
- `docs/handlers/**` & `docs/webhooks/**` – integration docs that may require updates
- `docs/specs/**` – prior plans/specifications (extend here)
- `scripts/**` – automation and helper scripts
- `public/kwc/**` – frontend assets when the chore affects the Kendama UI
- Root config files (`package.json`, `tsconfig.json`, `eslint.config.js`, etc.)
- `.github/**` – GitHub Actions workflows and templates
- `README.md` – setup, build commands, and architecture

Expand scope only if the chore evidence requires it.

## Plan Format

```md
# Chore: <chore name> (Issue #<number>)

## Task Summary

<state the goal in one or two sentences>

## Context

<why this chore is needed now>

## Touchpoints

<list affected directories/files with short rationales>

## Git & Branch Strategy

- Base branch: `develop`
- Working branch: `chore/<issue-number>-<slug>`
- Setup commands:
  - `git checkout develop && git pull origin develop`
  - `git checkout -b chore/<issue-number>-<slug>`
- Commit guidance: Conventional Commit messages referencing the issue (`chore: update lint config (#<issue-number>)`).

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

<outline steps (h3 headers + bullets) including git hygiene checkpoints (`git status`, `git add`), commits, pushes, and PR prep (`gh pr create --base develop --head chore/<issue-number>-<slug>`). End with running Validation Commands.>

## Validation Commands

<commands/checks proving the chore is complete (lint, format check, targeted build/test runs, manual verifications).>
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test` (if tests exist)

## Deliverables

<enumerate expected artifacts (updated config, regenerated docs) or state "None".>

## Notes

<optional context, follow-ups, communication reminders.>
```

## Chore
$ARGUMENTS

## Report
- Summarize the work you've just done in a concise bullet point list.
- Include the path to the plan you created under `docs/specs/*.md`.
