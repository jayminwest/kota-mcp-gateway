# Implement the Approved Plan

Execute the supplied plan verbatim, grounded in the associated GitHub issue (#<number>) and branch strategy.

## Pre-Execution Git Checklist

1. `git status --short` – confirm the working tree is clean before you start.
2. `git branch --show-current` – if you are still on `develop` with a clean tree, immediately create the plan's branch (e.g., `git checkout -b feature/<issue-number>-<slug>`). Otherwise ensure you are on the branch specified in the plan (`bug/<#>-...`, `chore/<#>-...`, `feature/<#>-...`).
3. `git fetch --all --prune` and, if your branch tracks a remote, run `git pull --rebase` to sync.

## Instructions

1. Read the full plan end-to-end.
2. Follow each step exactly in order, using the repo conventions:
   - Package manager: `npm` (use `npm ci`, `npm install`, `npm run build`, etc.)
   - TypeScript configuration in `tsconfig.json`
   - Service handlers extend `BaseHandler` in `src/handlers/`
   - Review relevant specs in `docs/handlers/`, `docs/webhooks/`, or `docs/specs/`
   - Consider how changes map onto the Express + MCP server architecture
3. After each major change set, run `git status` and stage with `git add` as appropriate.
4. Craft Conventional Commit messages referencing the issue (`fix(handlers): ... (#<issue-number>)`). Keep commits atomic per plan direction.
5. If any step is blocked or conflicts arise, stop and report instead of improvising.
6. Push updates as needed: `git push -u origin <branch>`.

## Plan
$ARGUMENTS

## Reporting

- Provide a bullet summary of completed steps aligned with the plan.
- Include `git status --short` and `git diff --stat` outputs (or summarized) to show repo state.
- Note commits pushed (hash + subject) and any skipped/deferred plan steps with explanations.
- Report the files and total lines changed with `git diff --stat`.
