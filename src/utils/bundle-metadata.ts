import type { z } from 'zod';

/**
 * Metadata for a single action within a handler bundle
 */
export interface BundleActionMetadata {
  /** Action name (e.g., 'set', 'get', 'list') */
  name: string;
  /** Human-readable description of what the action does */
  description: string;
  /** Fully-qualified tool name (e.g., 'memory_set', 'gmail_search') */
  tool_name: string;
  /** JSON schema defining the input parameters */
  inputSchema: any;
}

/**
 * Complete metadata for a handler bundle
 */
export interface BundleMetadata {
  /** Unique bundle identifier (e.g., 'memory', 'gmail') */
  key: string;
  /** Human-readable name derived from the key */
  name: string;
  /** Bundle description from the registry definition */
  description: string;
  /** Category derived from tags: 'core' if contains 'core' tag, otherwise 'optional' */
  category: 'core' | 'optional';
  /** Tags associated with this bundle (e.g., ['core', 'google'], ['optional', 'health']) */
  tags: string[];
  /** Whether the bundle is currently enabled in the registry */
  enabled: boolean;
  /** List of actions/tools provided by this bundle */
  actions: BundleActionMetadata[];
}

/**
 * Internal representation of a bundle definition from the registry
 * Matches the BundleDefinition interface in src/index.ts
 */
interface BundleDefinition {
  key: string;
  description: string;
  factory: () => any;
  autoEnable?: boolean;
  tags?: string[];
}

/**
 * Internal representation of the BundleRegistry
 * Matches the BundleRegistry class in src/index.ts
 */
interface BundleRegistry {
  /** Private field accessed via reflection - contains all bundle definitions */
  definitions?: Map<string, BundleDefinition>;
  /** Private field accessed via reflection - contains enabled bundles with their handlers */
  enabled?: Map<string, { handler: any; tools: string[] }>;
  /** Public method to list all bundles */
  listBundles(): Array<{
    key: string;
    description: string;
    enabled: boolean;
    autoEnabled: boolean;
    tags: string[];
  }>;
}

/**
 * Generates structured metadata from handler bundles in the registry.
 * Supports searching and filtering bundle metadata by various criteria.
 *
 * @example
 * ```typescript
 * const generator = new BundleMetadataGenerator(registry);
 * const allMetadata = generator.generateAll();
 * const coreOnly = generator.filterByCategory('core');
 * const healthBundles = generator.filterByTags(['health']);
 * const searchResults = generator.search('memory');
 * ```
 */
export class BundleMetadataGenerator {
  /**
   * Creates a new bundle metadata generator
   * @param registry - The BundleRegistry instance to extract metadata from
   */
  constructor(private registry: BundleRegistry) {}

  /**
   * Generates complete metadata for all bundles in the registry.
   *
   * @returns Map of bundle keys to their metadata
   */
  generateAll(): Map<string, BundleMetadata> {
    const result = new Map<string, BundleMetadata>();
    const bundles = this.registry.listBundles();

    for (const bundleInfo of bundles) {
      const metadata = this.generateBundleMetadata(bundleInfo);
      if (metadata) {
        result.set(bundleInfo.key, metadata);
      }
    }

    return result;
  }

  /**
   * Searches for bundles matching a query string.
   * Searches across bundle key, name, description, tags, and action names.
   *
   * @param query - Search string (case-insensitive)
   * @returns Array of matching bundle metadata
   *
   * @example
   * ```typescript
   * // Find all bundles related to "google"
   * const results = generator.search('google');
   * // Results might include 'gmail', 'calendar' with 'google' tag
   * ```
   */
  search(query: string): BundleMetadata[] {
    const lowerQuery = query.toLowerCase();
    const allMetadata = Array.from(this.generateAll().values());

    return allMetadata.filter(metadata => {
      // Search in key, name, and description
      if (metadata.key.toLowerCase().includes(lowerQuery)) return true;
      if (metadata.name.toLowerCase().includes(lowerQuery)) return true;
      if (metadata.description.toLowerCase().includes(lowerQuery)) return true;

      // Search in tags
      if (metadata.tags.some(tag => tag.toLowerCase().includes(lowerQuery))) return true;

      // Search in action names and descriptions
      if (metadata.actions.some(action =>
        action.name.toLowerCase().includes(lowerQuery) ||
        action.description.toLowerCase().includes(lowerQuery)
      )) return true;

      return false;
    });
  }

  /**
   * Filters bundles by category.
   *
   * @param category - Either 'core' or 'optional'
   * @returns Array of matching bundle metadata
   *
   * @example
   * ```typescript
   * // Get all core bundles
   * const coreBundles = generator.filterByCategory('core');
   * ```
   */
  filterByCategory(category: 'core' | 'optional'): BundleMetadata[] {
    const allMetadata = Array.from(this.generateAll().values());
    return allMetadata.filter(metadata => metadata.category === category);
  }

  /**
   * Filters bundles that have ALL of the specified tags.
   *
   * @param tags - Array of tags to match (uses AND logic)
   * @returns Array of matching bundle metadata
   *
   * @example
   * ```typescript
   * // Find bundles that are both 'core' and 'google'
   * const googleCore = generator.filterByTags(['core', 'google']);
   * // Results: ['gmail', 'calendar']
   *
   * // Find health-related bundles
   * const health = generator.filterByTags(['health']);
   * // Results might include: ['whoop', 'daily']
   * ```
   */
  filterByTags(tags: string[]): BundleMetadata[] {
    if (tags.length === 0) return [];

    const lowerTags = tags.map(t => t.toLowerCase());
    const allMetadata = Array.from(this.generateAll().values());

    return allMetadata.filter(metadata => {
      const bundleTags = metadata.tags.map(t => t.toLowerCase());
      // Check if all requested tags are present in the bundle
      return lowerTags.every(tag => bundleTags.includes(tag));
    });
  }

  /**
   * Generates metadata for a single bundle.
   *
   * @param bundleInfo - Bundle info from registry.listBundles()
   * @returns Bundle metadata or null if handler not accessible
   */
  private generateBundleMetadata(bundleInfo: {
    key: string;
    description: string;
    enabled: boolean;
    tags: string[];
  }): BundleMetadata | null {
    const actions = this.extractActions(bundleInfo.key);

    return {
      key: bundleInfo.key,
      name: this.formatBundleName(bundleInfo.key),
      description: bundleInfo.description,
      category: bundleInfo.tags.includes('core') ? 'core' : 'optional',
      tags: bundleInfo.tags,
      enabled: bundleInfo.enabled,
      actions,
    };
  }

  /**
   * Extracts action metadata from a bundle's handler.
   *
   * @param bundleKey - The bundle key to extract actions from
   * @returns Array of action metadata
   */
  private extractActions(bundleKey: string): BundleActionMetadata[] {
    try {
      // Access the enabled handlers map via reflection
      const enabledMap = (this.registry as any).enabled as Map<string, { handler: any; tools: string[] }> | undefined;
      if (!enabledMap) return [];

      const bundleData = enabledMap.get(bundleKey);
      if (!bundleData) return [];

      const handler = bundleData.handler;
      if (!handler || typeof handler.getTools !== 'function') return [];

      // Get the handler's prefix for constructing tool names
      const prefix = handler.prefix || bundleKey;
      const aliases = handler.aliases || [];
      const allPrefixes = [prefix, ...aliases];
      const primaryPrefix = allPrefixes[0];

      // Extract tool specifications from the handler
      const toolSpecs = handler.getTools();
      const actions: BundleActionMetadata[] = [];

      for (const spec of toolSpecs) {
        actions.push({
          name: spec.action,
          description: spec.description || '',
          tool_name: `${primaryPrefix}_${spec.action}`,
          inputSchema: this.normalizeInputSchema(spec.inputSchema),
        });
      }

      return actions;
    } catch (err) {
      // If we can't access the handler, return empty array
      return [];
    }
  }

  /**
   * Normalizes a Zod schema shape into a plain object for serialization.
   *
   * @param schema - Zod schema shape or undefined
   * @returns Plain object representation or empty object
   */
  private normalizeInputSchema(schema: z.ZodRawShape | undefined): any {
    if (!schema) return {};

    // Convert Zod schema to a plain object
    // For now, we'll just pass through the schema object
    // In a more sophisticated implementation, you could traverse
    // the Zod schema and extract detailed type information
    try {
      return schema;
    } catch {
      return {};
    }
  }

  /**
   * Converts a bundle key to a human-readable name.
   *
   * @param key - Bundle key (e.g., 'memory', 'gmail', 'content_calendar')
   * @returns Formatted name (e.g., 'Memory', 'Gmail', 'Content Calendar')
   */
  private formatBundleName(key: string): string {
    return key
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
