# Create Pull Request

Create a pull request that documents work on the KOTA MCP Gateway, following Conventional Commit conventions and linking to the associated issue.

## Variables

issue_number: $1
issue_type: $2

## Instructions

- Generate a pull request title in the format: `<type>(<scope>): <description> (#<issue_number>)`
- The `<type>` should be: `feat`, `fix`, `chore`, `docs`, etc.
- The `<scope>` should be: `handlers`, `webhooks`, `utils`, `middleware`, etc.
- The PR body should include:
  - **Summary**: Brief description of changes and context
  - **Issue**: `Closes #<issue_number>`
  - **Implementation Plan**: Link to plan file in `docs/specs/` if applicable
  - **Changes**: Bullet list of key modifications across `src/`, `docs/`, `scripts/`
  - **Testing**: Commands run for validation
  - **Documentation**: Updates to `docs/handlers/`, `docs/webhooks/`, or README
- Examples of PR titles:
  - `feat(handlers): add Spotify playback controls (#123)`
  - `fix(webhooks): correct WHOOP sleep ingestion (#456)`
  - `chore(deps): update @modelcontextprotocol/sdk (#789)`

## Run

1. `git fetch --all --prune` (sync remote refs)
2. `git diff origin/develop...HEAD --stat` (summary of changed files)
3. `git log origin/develop..HEAD --oneline` (commits to be included)
4. `git diff origin/develop...HEAD --name-only` (list of changed files)
5. `git push -u origin HEAD` (push current branch)
6. `gh pr create --title "<pr_title>" --body "<pr_body>" --base develop` (create PR)
7. Capture the PR URL from the output

## Report

Return ONLY the PR URL that was created (no other text)
