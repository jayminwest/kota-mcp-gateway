# Create Pull Request

Based on the `Instructions` below, take the `Variables` and follow the `Run` section to create a pull request that documents work on the KOTA MCP Gateway. Then follow the `Report` section to report the results of your work.

## Variables
branch_name: $1
issue: $2
plan_file: $3
adw_id: $4

## Instructions
- Generate a pull request title in the format: `<issue_type>: #<issue_number> - <issue_title>`
- The PR body should include:
  - A summary section that captures the issue context and relevant notes from `docs/specs/` or the linked plan
  - A link to the implementation plan file (e.g., under `docs/specs/`)
  - A reference to the issue (`Closes #<issue_number>`)
  - The ADW tracking ID
  - A checklist of what was done (commands run, handlers touched, docs updated)
  - A summary of key changes made across `src/`, `docs/`, or `scripts/`
- Extract issue number, type, and title from the issue JSON
- Examples of PR titles:
  - `feat: #123 - Add Gmail label sync`
  - `bug: #456 - Fix Slack webhook retries`
  - `chore: #789 - Update logger defaults`

## Run
1. Run `git diff origin/main...HEAD --stat` to see a summary of changed files
2. Run `git log origin/main..HEAD --oneline` to see the commits that will be included
3. Run `git diff origin/main...HEAD --name-only` to get a list of changed files
4. Run `git push -u origin <branch_name>` to push the branch
5. Set `GH_TOKEN` from `GITHUB_PAT` if available, then run `gh pr create --title "<pr_title>" --body "<pr_body>" --base main` to create the PR
6. Capture the PR URL from the output

## Report
Return ONLY the PR URL that was created (no other text)
