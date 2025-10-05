# Update Docs From PR Diff

Review an open PR, inspect its diff, and update gateway documentation accordingly to keep docs in sync with code changes.

## Variables

pr_number: $ARGUMENT

## Pre-Execution Checklist

1. `git fetch --all --prune` (sync remote refs)
2. `git status --short` (confirm clean working tree)
3. `gh pr view $pr_number --json title,body,author,baseRefName,headRefName` (capture PR context)
4. `gh pr diff $pr_number --name-only` (list changed files)

## Read

- README.md (ensure context for any new behavior)
- docs/specs/ (identify existing plans that cover the PR scope)
- docs/handlers/ and docs/webhooks/ (service-specific docs to adjust)
- src/**, scripts/**, public/kwc/** (files touched by the PR for reference)

## Run

1. `gh pr diff $pr_number` (inspect detailed changes)
2. `git switch develop && git pull` (ensure local base is current)
3. `gh pr checkout $pr_number` (pull the PR branch locally)
4. Update docs under `docs/handlers/`, `docs/webhooks/`, `docs/specs/`, and README as required by the diff:
   - Add/update handler documentation for new MCP tools
   - Document new Express routes or webhooks
   - Update README if architecture or setup changes
   - Add usage examples where appropriate
5. `git status`
6. `npm run lint` (confirm markdown/code snippets stay valid if applicable)
7. `npm run typecheck` (verify any TypeScript examples)
8. Stage and commit documentation updates: `git add docs/ README.md && git commit -m "docs: update for PR #$pr_number changes"`

## Report

- Summarize doc updates made in concise bullet points.
- Provide `git diff --stat` for the documentation changes.
- Highlight any remaining documentation gaps or follow-up tasks.
- Note the commit hash created for the doc updates.
