# Bug Planning

Create a new plan in `docs/specs/*.md` to resolve the `Bug` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan and use the `Relevant Files` guidance to focus on the right areas of the KOTA MCP Gateway.

## Instructions
- IMPORTANT: You're writing a plan to resolve a bug based on the provided `Bug` that will improve the gateway.
- IMPORTANT: The `Bug` describes the issue to be resolved. Do **not** implement the fix now; craft the plan using the `Plan Format` below.
- Research the codebase to understand the regression: start with `README.md`, then explore `docs/specs/` (if present), `docs/handlers/`, `docs/webhooks/`, and supporting scripts.
- Be thorough and precise so we fix the root cause and prevent regressions while keeping changes focused.
- Create the plan file under `docs/specs/`, naming it to match the bug. Create the folder if it does not yet exist.
- Use the plan format exactly as provided; replace every `<placeholder>` with real content.
- THINK HARD about the bug, its root cause, and the minimal fix.
- Avoid unnecessary scope creep. Keep the solution surgical.
- If a new library is required, note it in the `Notes` section (use `npm` commands and document them).
- Respect the requested files in the `Relevant Files` section.
- Start your investigation by reading `README.md`.

## Relevant Files
Focus on the following files and directories when preparing the plan:
- `README.md` – project overview, setup, and architecture notes.
- `src/**` – Express server, MCP handlers, routes, and utilities.
- `docs/handlers/**` – service-specific behavior and expectations.
- `docs/webhooks/**` – webhook ingestion flow documentation.
- `docs/specs/**` – existing specs and plans (extend this set).
- `scripts/**` – helper scripts used during debugging or validation.
- `public/kwc/**` – Kendama UI assets if the bug touches the KWC surfaces.

Ignore directories not listed above unless the bug explicitly depends on them.

## Plan Format
```md
# Bug: <bug name>

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

<find and list the files that are relevant to the bug describe why they are relevant in bullet points. If there are new files that need to be created to fix the bug, list them in an h3 'New Files' section.>

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. use as many h3 headers as needed to fix the bug. Order matters, start with the foundational shared changes required to fix the bug then move on to the specific changes required to fix the bug. Include tests that will validate the bug is fixed with zero regressions. Your last step should be running the `Validation Commands` to validate the bug is fixed with zero regressions.>

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

<list commands you'll use to validate with 100% confidence the bug is fixed with zero regressions. every command must execute without errors so be specific about what you want to run to validate the bug is fixed with zero regressions. Include commands to reproduce the bug before and after the fix.>
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Notes
<optionally list any additional notes or context that are relevant to the bug that will be helpful to the developer>
```

## Bug
$ARGUMENTS

## Report
- Summarize the work you've just done in a concise bullet point list.
- Include the path to the plan you created under `docs/specs/*.md`.
