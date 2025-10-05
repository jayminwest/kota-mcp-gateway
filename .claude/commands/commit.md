# Generate Git Commit

Create a git commit with a properly formatted Conventional Commit message that reflects the changes to the KOTA MCP Gateway, referencing the associated issue number.

## Variables
issue_type: $1
issue_number: $2
scope: $3

## Instructions

- Generate a Conventional Commit message in the format: `<type>(<scope>): <description> (#<issue_number>)`
- The `<type>` should be: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, etc.
- The `<scope>` should be: `handlers`, `webhooks`, `utils`, `middleware`, `routes`, `attention`, etc.
- The `<description>` should be:
  - Present tense (e.g., "add", "fix", "update", not "added", "fixed", "updated")
  - 50 characters or less (excluding issue reference)
  - Descriptive of the actual changes made to this gateway
  - No period at the end
- Always include the issue number at the end: `(#<issue_number>)`
- Examples:
  - `feat(handlers): add Spotify playback controls (#123)`
  - `fix(webhooks): correct WHOOP sleep ingestion (#456)`
  - `chore(deps): update @modelcontextprotocol/sdk (#789)`
  - `docs(handlers): document GitHub activity tools (#234)`

## Run

1. Run `git diff HEAD` to understand what changes have been made
2. Run `git add -A` to stage all changes
3. Run `git commit -m "<generated_commit_message>"` to create the commit

## Report

Return ONLY the commit message that was used (no other text)
