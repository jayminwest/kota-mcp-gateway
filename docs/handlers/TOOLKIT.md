# Toolkit Handler

The toolkit handler surfaces the gateway's tool bundles. Every bundle is auto-enabled on startup so the LLM has immediate access, but `toolkit_list_bundles` is the quickest way to confirm what's available (and provides bundle names to mention when planning a task). If a bundle ever gets disabled, `toolkit_enable_bundle` brings it back online.

## Tools

- `toolkit_list_bundles {}`
  - Lists all bundles with their description, tags, and enabled status. Run this early in a conversation to decide which bundles are relevant to reference in reasoning.
- `toolkit_enable_bundle { bundle }`
  - Re-enables a bundle by key (for example `"whoop"` or `"webhooks"`). Helpful if a bundle was previously disabled.

> Bundle keys align with handler names (e.g., `whoop`, `kasa`, `workspace`, `webhooks`). Every bundle loads automatically; the toolkit simply makes it easy to reference and manage them.

## Example Workflow

1. `toolkit_list_bundles {}` → inspect available bundles and their status.
2. `toolkit_enable_bundle { "bundle": "whoop" }` → register all WHOOP tools when you actually need them.
3. Call the newly available tools, e.g., `whoop_get_recovery { "start": "2024-05-01" }`.

Even with automatic loading, calling `toolkit_list_bundles {}` early reminds the LLM which specialised tools exist so it can reference the right bundle when reasoning about next steps.
