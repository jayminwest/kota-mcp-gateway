# Toolkit Handler

The toolkit handler surfaces the gateway's tool bundles. Every bundle is auto-enabled on startup by default, but you can customize which bundles load using context configuration. The toolkit provides both runtime bundle management and persistent context configuration tools.

## Tools

### Bundle Management

- `toolkit_list_bundles {}`
  - Lists all bundles with their description, tags, and enabled status. Run this early in a conversation to decide which bundles are relevant to reference in reasoning.
- `toolkit_enable_bundle { bundle, persist? }`
  - Re-enables a bundle by key (for example `"whoop"` or `"webhooks"`). If `persist: true`, removes the bundle from the disabled list in `~/.kota/context.json`.
- `toolkit_disable_bundle { bundle }`
  - Disables a bundle and persists the change to `~/.kota/context.json`. Takes effect on next gateway restart.

### Context Management

- `toolkit_get_context {}`
  - Returns current context configuration including active contexts, disabled bundles, last updated timestamp, config file path, and existence status.
- `toolkit_set_context { active_contexts, disabled_bundles }`
  - Updates the context configuration file with new active contexts and disabled bundles. Changes take effect on next restart.

> Bundle keys align with handler names (e.g., `whoop`, `kasa`, `workspace`, `webhooks`). Available bundles: toolkit, gmail, calendar, memory, daily, context_snapshot, kwc, content_calendar, whoop, kasa, kraken, rize, slack, spotify, github, stripe, workspace, webhooks, tasks.

## Example Workflows

### Runtime Bundle Management

1. `toolkit_list_bundles {}` → inspect available bundles and their status.
2. `toolkit_enable_bundle { "bundle": "whoop", "persist": true }` → enable WHOOP bundle and remove from disabled list.
3. Call the newly available tools, e.g., `whoop_get_recovery { "start": "2024-05-01" }`.

### Context Configuration

1. `toolkit_get_context {}` → view current context and disabled bundles.
2. `toolkit_set_context { "active_contexts": ["work", "health"], "disabled_bundles": ["kwc", "spotify", "kasa"] }` → set work/health context and disable non-essential bundles.
3. Restart gateway to apply changes.
4. `toolkit_list_bundles {}` → verify disabled bundles are not loaded.

### Disabling a Bundle

1. `toolkit_disable_bundle { "bundle": "spotify" }` → mark Spotify for disable on restart.
2. Restart gateway to apply the change.

Even with automatic loading, calling `toolkit_list_bundles {}` early reminds the LLM which specialised tools exist so it can reference the right bundle when reasoning about next steps. Use context management to tailor the gateway to your current workflow and minimize cognitive overhead.
