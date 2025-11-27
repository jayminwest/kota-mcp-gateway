# Generate Git Branch Name

Generate a concise Git branch name for work on the KOTA MCP Gateway, following the repository's branch naming conventions.

## Variables

issue_type: $1
issue_number: $2
issue: $3

## Instructions

- Generate a branch name in the format: `<issue_type>/<issue_number>-<concise_slug>`
- The `<issue_type>` should be: `feature`, `bug`, or `chore`
- The `<concise_slug>` should be:
  - 3-6 words maximum
  - All lowercase
  - Words separated by hyphens
  - Descriptive of the primary change within this gateway
  - No special characters except hyphens
- Extract the issue number, title, and body from the issue JSON
- Examples:
  - `feature/123-add-spotify-handler`
  - `bug/456-fix-whoop-ingestion`
  - `chore/789-update-mcp-sdk`

## Run

1. `git fetch --all --prune` (sync remote refs)
2. `git checkout develop` (switch to develop branch)
3. `git pull origin develop` (pull latest changes from develop)
4. `git checkout -b <branch_name>` (create and switch to new branch)

## Report

Return ONLY the branch name that was created (no other text)
