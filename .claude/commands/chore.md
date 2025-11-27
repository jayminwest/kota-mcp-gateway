# Chore Planning

Create a new plan in `docs/specs/*.md` to resolve the `Chore` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan and use the `Relevant Files` guidance to focus on the right parts of the KOTA MCP Gateway.

## Instructions
- IMPORTANT: You're writing a plan to resolve a chore described in the provided `Chore` payload.
- IMPORTANT: Do **not** execute the work now; produce the plan using the `Plan Format` below.
- Research the codebase beforehand: read `README.md`, check `docs/specs/` for context, and skim `docs/handlers/` or `docs/webhooks/` as needed.
- Keep the scope tight and efficient; we want the minimal set of tasks to accomplish the chore.
- Create the plan file under `docs/specs/`, naming it for the chore. Create the directory if needed.
- Use the plan format exactly as given; replace every `<placeholder>` with concrete content.
- THINK HARD about the steps, dependencies, and validation to avoid rework.
- Follow the project conventions and existing patterns.
- If you rely on any new tooling, note it in the `Notes` section (include pertinent `npm` commands).

## Relevant Files
Focus on these areas while planning the chore:
- `README.md` – setup, build commands, and architecture.
- `src/**` – Express server, handlers, middleware, utilities.
- `docs/handlers/**` & `docs/webhooks/**` – integration docs that may require updates.
- `docs/specs/**` – prior plans/specifications (extend here).
- `scripts/**` – automation and helper scripts.
- `public/kwc/**` – frontend assets when the chore affects the Kendama UI.

Ignore directories outside this list unless the chore explicitly requires them.

## Plan Format
```md
# Chore: <chore name>

## Chore Description
<describe the chore in detail>

## Relevant Files
Use these files to resolve the chore:

<find and list the files that are relevant to the chore describe why they are relevant in bullet points. If there are new files that need to be created to accomplish the chore, list them in an h3 'New Files' section.>

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. use as many h3 headers as needed to accomplish the chore. Order matters, start with the foundational shared changes required to fix the chore then move on to the specific changes required to fix the chore. Your last step should be running the `Validation Commands` to validate the chore is complete with zero regressions.>

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

<list commands you'll use to validate with 100% confidence the chore is complete with zero regressions. every command must execute without errors so be specific about what you want to run to validate the chore is complete with zero regressions. Don't validate with curl commands.>
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Notes
<optionally list any additional notes or context that are relevant to the chore that will be helpful to the developer>
```

## Chore
$ARGUMENTS

## Report
- Summarize the work you've just done in a concise bullet point list.
- Include the path to the plan you created under `docs/specs/*.md`.
