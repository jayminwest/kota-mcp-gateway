# Update Docs From PR Diff

Use this workflow to review an open PR, inspect its diff, and update gateway documentation accordingly.

## Variables
pr_number: $ARGUMENT

## Read
- README.md (ensure context for any new behavior)
- docs/specs/ (identify existing plans that cover the PR scope)
- docs/handlers/ and docs/webhooks/ (service-specific docs to adjust)
- src/**, scripts/**, public/kwc/** (files touched by the PR for reference)

## Run
1. `gh pr view $pr_number --json title,body,author` (capture PR context)
2. `gh pr diff $pr_number --name-only` (list changed files)
3. `gh pr diff $pr_number` (inspect detailed changes)
4. `git switch main && git pull` (ensure local base is current)
5. `gh pr checkout $pr_number` (pull the PR branch locally)
6. Update docs under `docs/handlers/`, `docs/webhooks/`, `docs/specs/`, and README as required by the diff.
7. `git status`
8. `npm run lint` (confirm markdown/code snippets stay valid if applicable)

## Report
- Summarize doc updates made in concise bullet points.
- Provide `git diff --stat` for the documentation changes.
- Highlight any remaining documentation gaps or follow-up tasks.
