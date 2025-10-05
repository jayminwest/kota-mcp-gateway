# Generate Git Branch Name

Based on the `Instructions` below, take the `Variables` and follow the `Run` section to generate a concise Git branch name for work on the KOTA MCP Gateway. Then follow the `Report` section to report the results of your work.

## Variables
issue_class: $1
adw_id: $2
issue: $3

## Instructions
- Generate a branch name in the format: `<issue_class>-<issue_number>-<adw_id>-<concise_name>`
- The `<concise_name>` should be:
  - 3-6 words maximum
  - All lowercase
  - Words separated by hyphens
  - Descriptive of the primary change within this gateway
  - No special characters except hyphens
- Extract the issue number, title, and body from the issue JSON

## Run
Run `git checkout main` to switch to the main branch
Run `git pull` to pull the latest changes from the main branch
Run `git checkout -b <branch_name>` to create and switch to the new branch

## Report
After generating the branch name:
Return ONLY the branch name that was created (no other text)
