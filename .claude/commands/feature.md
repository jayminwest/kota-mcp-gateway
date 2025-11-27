# Feature Planning

Create a new plan in `docs/specs/*.md` to implement the `Feature` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan and use the `Relevant Files` guidance to stay aligned with the KOTA MCP Gateway architecture.

## Instructions
- IMPORTANT: You're writing a plan to implement a net-new feature described in the provided `Feature` payload.
- IMPORTANT: Do **not** implement the feature now; produce the plan using the `Plan Format` below.
- Research the codebase fully: begin with `README.md`, review `docs/specs/` for prior art, and inspect `docs/handlers/`, `docs/webhooks/`, and existing handler implementations in `src/`.
- Follow current conventions for handlers, middleware, utils, and documentation.
- Create the plan file within `docs/specs/`, naming it after the feature. Create the directory if missing.
- Use the plan format exactly as provided; replace each `<placeholder>` with the correct details.
- THINK HARD about design, extensibility, and potential regressions.
- Keep the solution aligned with the gateway's modular structure (handlers, utilities, transport, docs).
- If you need new dependencies, record them in `Notes` with the appropriate `npm` commands.
- Respect the `Relevant Files` guidance when planning.

## Relevant Files
Review these areas while shaping the feature plan:
- `README.md` – global architecture, setup, and runtime expectations.
- `src/index.ts` & `src/**` – server bootstrap, handler registration, utilities, middleware.
- `docs/handlers/**` & `docs/webhooks/**` – documentation patterns to keep updated.
- `docs/specs/**` – existing specifications and planning docs (extend here).
- `scripts/**` – automation or helper scripts that might need updates.
- `public/kwc/**` – UI artifacts if the feature touches Kendama dashboards.

Ignore other directories unless the feature explicitly requires them.

## Plan Format
```md
# Feature: <feature name>

## Feature Description
<describe the feature in detail, including its purpose and value to users>

## User Story
As a <type of user>
I want to <action/goal>
So that <benefit/value>

## Problem Statement
<clearly define the specific problem or opportunity this feature addresses>

## Solution Statement
<describe the proposed solution approach and how it solves the problem>

## Relevant Files
Use these files to implement the feature:

<find and list the files that are relevant to the feature describe why they are relevant in bullet points. If there are new files that need to be created to implement the feature, list them in an h3 'New Files' section.>

## Implementation Plan
### Phase 1: Foundation
<describe the foundational work needed before implementing the main feature>

### Phase 2: Core Implementation
<describe the main implementation work for the feature>

### Phase 3: Integration
<describe how the feature will integrate with existing functionality>

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. use as many h3 headers as needed to implement the feature. Order matters, start with the foundational shared changes required then move on to the specific implementation. Include creating tests throughout the implementation process. Your last step should be running the `Validation Commands` to validate the feature works correctly with zero regressions.>

## Testing Strategy
### Unit Tests
<describe unit tests needed for the feature>

### Integration Tests
<describe integration tests needed for the feature>

### Edge Cases
<list edge cases that need to be tested>

## Acceptance Criteria
<list specific, measurable criteria that must be met for the feature to be considered complete>

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

<list commands you'll use to validate with 100% confidence the feature is implemented correctly with zero regressions. every command must execute without errors so be specific about what you want to run to validate the feature works as expected. Include commands to test the feature end-to-end.>
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run health`

## Notes
<optionally list any additional notes, future considerations, or context that are relevant to the feature that will be helpful to the developer>
```

## Feature
$ARGUMENTS

## Report
- Summarize the work you've just done in a concise bullet point list.
- Include the path to the plan you created under `docs/specs/*.md`.
