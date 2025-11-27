# Feature: Entry Point Discovery Layer

## Overview

Add a unified discovery and invocation layer on top of existing MCP tools. All current tools remain unchanged - this adds new capabilities for agents to explore and understand the system.

**Goal:** Enable agents to discover bundles and their capabilities through structured metadata, while keeping all existing direct tool access.

## What Gets Added

### Three New Tools

1. **`kota_discover_bundles`** - Search/browse available bundles
2. **`kota_describe_bundle`** - Get detailed bundle information
3. **`kota_entry_point`** - Invoke actions through unified interface

All existing tools (`memory_set`, `gmail_send_message`, etc.) remain unchanged.

## Bundle Metadata Structure

```typescript
interface BundleMetadata {
  key: string;                    // e.g., "memory", "gmail"
  name: string;                   // Human-readable name
  description: string;            // What this bundle provides
  category: string;               // "core" | "optional"
  tags: string[];                 // Searchable keywords
  enabled: boolean;               // Current status
  actions: BundleAction[];        // Available actions
  relationships?: BundleRelation[]; // Links to related bundles
  examples?: BundleExample[];     // Usage examples
}

interface BundleAction {
  name: string;                   // e.g., "set", "get"
  description: string;
  tool_name: string;              // Full tool name: "memory_set"
  inputSchema: z.ZodRawShape;
  examples?: ActionExample[];
}

interface BundleRelation {
  type: "depends_on" | "related_to";
  bundle_key: string;
  description: string;
}

interface BundleExample {
  title: string;
  scenario: string;
  steps: Array<{
    tool: string;
    args: any;
  }>;
}
```

## Tool Specifications

### 1. kota_discover_bundles

**Purpose:** Browse or search available bundles

**Input Schema:**
```typescript
{
  query?: string,        // Search across names, descriptions, tags
  category?: string,     // Filter by category
  tags?: string[],       // Filter by tags
  enabled_only?: boolean // Only show enabled bundles (default: true)
}
```

**Output:**
```json
{
  "bundles": [
    {
      "key": "memory",
      "name": "KOTA Memory Store",
      "description": "Persistent memory storage for preferences, patterns, and state",
      "category": "core",
      "tags": ["storage", "persistence", "memory"],
      "enabled": true,
      "action_count": 7
    }
  ],
  "total_count": 18,
  "categories": {
    "core": 10,
    "optional": 8
  }
}
```

**Examples:**
```typescript
// List all bundles
kota_discover_bundles({})

// Search for memory-related bundles
kota_discover_bundles({ query: "storage memory" })

// Filter by category
kota_discover_bundles({ category: "core" })

// Filter by tags
kota_discover_bundles({ tags: ["health", "tracking"] })
```

### 2. kota_describe_bundle

**Purpose:** Get detailed information about a specific bundle

**Input Schema:**
```typescript
{
  bundle: string,           // Bundle key
  include_examples?: boolean // Include usage examples (default: true)
}
```

**Output:**
```json
{
  "key": "memory",
  "name": "KOTA Memory Store",
  "description": "Persistent memory storage for preferences, patterns, and state",
  "category": "core",
  "tags": ["storage", "persistence", "memory"],
  "enabled": true,
  "actions": [
    {
      "name": "set",
      "description": "Persist a memory key/value pair with optional category",
      "tool_name": "memory_set",
      "inputSchema": {
        "key": { "type": "string", "description": "..." },
        "value": { "type": "any", "description": "..." },
        "category": { "type": "string", "optional": true }
      },
      "examples": [
        {
          "title": "Store user preference",
          "args": { "key": "theme", "value": "dark", "category": "preferences" }
        }
      ]
    },
    {
      "name": "get",
      "description": "Retrieve memory by key or fuzzy query",
      "tool_name": "memory_get",
      "inputSchema": { "query": { "type": "string" } }
    }
  ],
  "relationships": [
    {
      "type": "related_to",
      "bundle_key": "daily",
      "description": "Daily logs may reference memories for context"
    }
  ],
  "examples": [
    {
      "title": "Store and retrieve preference",
      "scenario": "Remember user's communication style",
      "steps": [
        { "tool": "memory_set", "args": { "key": "comm_style", "value": "concise" } },
        { "tool": "memory_get", "args": { "query": "comm_style" } }
      ]
    }
  ]
}
```

### 3. kota_entry_point

**Purpose:** Invoke actions through unified interface (alternative to direct tool calls)

**Input Schema:**
```typescript
{
  bundle: string,           // Bundle key
  action: string,           // Action name
  args?: Record<string, any> // Action arguments
}
```

**Output:** Same as direct tool call

**Examples:**
```typescript
// Equivalent to memory_set(...)
kota_entry_point({
  bundle: "memory",
  action: "set",
  args: { key: "theme", value: "dark" }
})

// Equivalent to gmail_send_message(...)
kota_entry_point({
  bundle: "gmail",
  action: "send_message",
  args: { to: "user@example.com", subject: "Hi", body: "..." }
})
```

## Implementation

### 1. Bundle Metadata Generator

**File:** `src/utils/bundle-metadata.ts`

```typescript
export class BundleMetadataGenerator {
  constructor(private registry: BundleRegistry) {}

  generateAll(): Map<string, BundleMetadata> {
    const metadata = new Map();

    for (const bundle of this.registry.listBundles()) {
      const handler = this.registry.getHandler(bundle.key);
      metadata.set(bundle.key, this.generateForHandler(bundle, handler));
    }

    return metadata;
  }

  private generateForHandler(
    bundle: ToolkitBundleInfo,
    handler: BaseHandler
  ): BundleMetadata {
    const tools = handler.getTools();
    const actions = tools.map(tool => ({
      name: tool.action,
      description: tool.description,
      tool_name: `${handler.prefix}_${tool.action}`,
      inputSchema: tool.inputSchema ?? {},
      examples: this.getActionExamples(handler.prefix, tool.action),
    }));

    return {
      key: bundle.key,
      name: this.formatName(bundle.description),
      description: bundle.description,
      category: bundle.tags?.includes('core') ? 'core' : 'optional',
      tags: bundle.tags ?? [],
      enabled: bundle.enabled,
      actions,
      relationships: this.inferRelationships(bundle.key, handler),
      examples: this.getWorkflowExamples(bundle.key),
    };
  }

  private inferRelationships(key: string, handler: BaseHandler): BundleRelation[] {
    // Infer from handler dependencies
    // Example: gmail depends on google auth
    const relationships: BundleRelation[] = [];

    // Add hardcoded relationships for now
    const relationshipMap: Record<string, BundleRelation[]> = {
      gmail: [
        { type: 'related_to', bundle_key: 'calendar', description: 'Both use Google OAuth' }
      ],
      calendar: [
        { type: 'related_to', bundle_key: 'gmail', description: 'Both use Google OAuth' }
      ],
      memory: [
        { type: 'related_to', bundle_key: 'daily', description: 'Daily logs reference memories' }
      ],
      // Add more as needed
    };

    return relationshipMap[key] ?? [];
  }

  private getActionExamples(prefix: string, action: string): ActionExample[] {
    // Return examples if available
    // Could load from docs or hardcode common ones
    return [];
  }

  private getWorkflowExamples(bundleKey: string): BundleExample[] {
    // Return workflow examples if available
    return [];
  }

  private formatName(description: string): string {
    // Convert "Gmail message, draft, and send actions" -> "Gmail Integration"
    return description.split(',')[0].trim();
  }
}
```

### 2. Entry Point Handler

**File:** `src/handlers/entry-point.ts`

```typescript
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { HandlerConfig, ToolSpec } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { BundleMetadataGenerator } from '../utils/bundle-metadata.js';
import type { BundleRegistry } from '../index.js'; // Need to export this

const DiscoverBundlesSchema = z.object({
  query: z.string().optional().describe('Search query'),
  category: z.string().optional().describe('Filter by category'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  enabled_only: z.boolean().optional().default(true).describe('Only enabled bundles'),
}).strip();

const DescribeBundleSchema = z.object({
  bundle: z.string().describe('Bundle key to describe'),
  include_examples: z.boolean().optional().default(true).describe('Include examples'),
}).strip();

const EntryPointSchema = z.object({
  bundle: z.string().describe('Bundle key'),
  action: z.string().describe('Action name'),
  args: z.record(z.any()).optional().describe('Action arguments'),
}).strip();

export class EntryPointHandler extends BaseHandler {
  readonly prefix = 'kota';
  private metadataGenerator: BundleMetadataGenerator;
  private registry: BundleRegistry;

  constructor(opts: {
    logger: Logger;
    config: HandlerConfig;
    registry: BundleRegistry;
  }) {
    super(opts);
    this.registry = opts.registry;
    this.metadataGenerator = new BundleMetadataGenerator(opts.registry);
  }

  getTools(): ToolSpec[] {
    return [
      {
        action: 'discover_bundles',
        description: 'Browse or search available handler bundles',
        inputSchema: DiscoverBundlesSchema.shape,
      },
      {
        action: 'describe_bundle',
        description: 'Get detailed information about a specific bundle',
        inputSchema: DescribeBundleSchema.shape,
      },
      {
        action: 'entry_point',
        description: 'Invoke an action through unified interface',
        inputSchema: EntryPointSchema.shape,
      },
    ];
  }

  async execute(action: string, args: unknown): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'discover_bundles':
          return await this.handleDiscoverBundles(args);
        case 'describe_bundle':
          return await this.handleDescribeBundle(args);
        case 'entry_point':
          return await this.handleEntryPoint(args);
        default:
          return {
            content: [{ type: 'text', text: `Unknown action: ${action}` }],
            isError: true,
          };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'Entry point handler error');
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: err?.message || String(err) }) }],
        isError: true,
      };
    }
  }

  private async handleDiscoverBundles(raw: unknown): Promise<CallToolResult> {
    const { query, category, tags, enabled_only } = this.parseArgs(DiscoverBundlesSchema, raw);

    const allMetadata = this.metadataGenerator.generateAll();
    let bundles = Array.from(allMetadata.values());

    // Filter by enabled status
    if (enabled_only) {
      bundles = bundles.filter(b => b.enabled);
    }

    // Filter by category
    if (category) {
      bundles = bundles.filter(b => b.category === category);
    }

    // Filter by tags
    if (tags && tags.length > 0) {
      bundles = bundles.filter(b =>
        tags.some(tag => b.tags.includes(tag))
      );
    }

    // Search by query
    if (query) {
      const lowerQuery = query.toLowerCase();
      bundles = bundles.filter(b =>
        b.name.toLowerCase().includes(lowerQuery) ||
        b.description.toLowerCase().includes(lowerQuery) ||
        b.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      );
    }

    // Build category counts
    const categories: Record<string, number> = {};
    for (const bundle of bundles) {
      categories[bundle.category] = (categories[bundle.category] || 0) + 1;
    }

    // Return summary view (not full details)
    const summaries = bundles.map(b => ({
      key: b.key,
      name: b.name,
      description: b.description,
      category: b.category,
      tags: b.tags,
      enabled: b.enabled,
      action_count: b.actions.length,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          bundles: summaries,
          total_count: summaries.length,
          categories,
        }, null, 2),
      }],
    };
  }

  private async handleDescribeBundle(raw: unknown): Promise<CallToolResult> {
    const { bundle, include_examples } = this.parseArgs(DescribeBundleSchema, raw);

    const allMetadata = this.metadataGenerator.generateAll();
    const metadata = allMetadata.get(bundle);

    if (!metadata) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: `Unknown bundle: ${bundle}` }),
        }],
        isError: true,
      };
    }

    // Return full metadata
    const result = { ...metadata };
    if (!include_examples) {
      delete result.examples;
      result.actions.forEach(a => delete a.examples);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }

  private async handleEntryPoint(raw: unknown): Promise<CallToolResult> {
    const { bundle, action, args } = this.parseArgs(EntryPointSchema, raw);

    // Get the handler for this bundle
    const handler = this.registry.getHandler(bundle);
    if (!handler) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: `Unknown bundle: ${bundle}` }),
        }],
        isError: true,
      };
    }

    // Delegate to the handler
    return await handler.execute(action, args ?? {});
  }
}
```

### 3. Update BundleRegistry

**File:** `src/index.ts`

Add method to get handler by bundle key:

```typescript
class BundleRegistry {
  // ... existing code ...

  getHandler(bundleKey: string): BaseHandler | undefined {
    return this.enabled.get(bundleKey)?.handler;
  }

  // Expose registry for entry point handler
  getRegistry(): BundleRegistry {
    return this;
  }
}
```

### 4. Register Entry Point Handler

**File:** `src/index.ts`

Add to bundle definitions:

```typescript
const bundleDefinitions: BundleDefinition[] = [
  {
    key: 'entry_point',
    description: 'Unified discovery and invocation layer',
    autoEnable: true,
    factory: () => new EntryPointHandler({ logger, config, registry }),
    tags: ['core', 'discovery'],
  },
  // ... existing bundles
];
```

## Usage Examples

### Example 1: Agent Discovers Memory Bundle

```typescript
// Agent wants to understand storage options
const discovery = await kota_discover_bundles({ query: "storage" });
// Returns: memory, daily bundles

// Agent wants details on memory
const details = await kota_describe_bundle({ bundle: "memory" });
// Returns: Full memory bundle with all actions

// Agent uses direct tool (preferred for performance)
await memory_set({ key: "preference", value: "dark_mode" });

// OR agent uses entry point (alternative)
await kota_entry_point({
  bundle: "memory",
  action: "set",
  args: { key: "preference", value: "dark_mode" }
});
```

### Example 2: Agent Explores Health Bundles

```typescript
// Find health-related bundles
const health = await kota_discover_bundles({ tags: ["health"] });
// Returns: whoop, daily bundles

// Get details on whoop
const whoop = await kota_describe_bundle({ bundle: "whoop" });
// Returns: All whoop actions with schemas

// Use direct tool
await whoop_get_recovery({ limit: 7 });
```

### Example 3: Agent Discovers Related Bundles

```typescript
// Agent using gmail, discovers related bundles
const gmail = await kota_describe_bundle({ bundle: "gmail" });
// Returns: relationships: [{ type: "related_to", bundle_key: "calendar" }]

// Agent explores calendar
const calendar = await kota_describe_bundle({ bundle: "calendar" });
// Now understands both gmail and calendar capabilities
```

## Testing

### Unit Tests

**File:** `src/handlers/entry-point.test.ts`

- Test discover_bundles with various filters
- Test describe_bundle returns correct metadata
- Test entry_point delegates to correct handler
- Test error handling for unknown bundles/actions

### Integration Tests

- Verify all bundles are discoverable
- Verify describe_bundle returns valid schemas
- Verify entry_point produces same results as direct tools
- Test search functionality across all bundles

## Documentation Updates

### README.md

Add section after "Context Management":

```markdown
## Discovery Layer

Explore available capabilities through unified discovery tools:

**Browse bundles:**
```typescript
kota_discover_bundles({})  // List all
kota_discover_bundles({ category: "core" })  // Core bundles only
kota_discover_bundles({ tags: ["health"] })  // Health-related
```

**Get bundle details:**
```typescript
kota_describe_bundle({ bundle: "memory" })
```

**Invoke through entry point:**
```typescript
kota_entry_point({ bundle: "memory", action: "set", args: {...} })
```

All existing direct tools remain available (e.g., `memory_set`, `gmail_send_message`).
```

## Effort Estimate

**Total: 1-2 weeks**

- Bundle metadata generator: 2-3 days
- Entry point handler: 2-3 days
- Integration with registry: 1 day
- Testing: 2-3 days
- Documentation: 1 day

## Success Criteria

- ✅ All bundles discoverable via kota_discover_bundles
- ✅ All actions visible in kota_describe_bundle
- ✅ kota_entry_point produces identical results to direct tools
- ✅ No performance impact on existing direct tool calls
- ✅ Bundle metadata is accurate and complete

## Future Enhancements

**Phase 2 (Optional):**
- Add explicit relationship definitions to handlers
- Rich workflow examples for common patterns
- Bundle dependency validation
- Auto-generated API documentation from metadata

**Phase 3 (Optional):**
- Bundle versioning support
- Deprecation warnings in metadata
- Cross-bundle workflow recommendations
- Agent learning analytics

---

**Status:** Ready for Implementation
**Estimated Effort:** 1-2 weeks
**Breaking Changes:** None
