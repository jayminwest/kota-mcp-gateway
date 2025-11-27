/**
 * Simple implementation of ContextBundleRegistry for managing context bundles.
 *
 * This registry provides in-memory storage and retrieval of context bundles
 * with support for searching by name, description, and tags.
 */

import { ContextBundle, ContextBundleRegistry } from '../types/context.js';

/**
 * Simple in-memory registry for context bundles.
 *
 * Features:
 * - O(1) lookup by name using Map
 * - Case-insensitive search across name, description, and tags
 * - Thread-safe operations (Map operations are atomic)
 *
 * @example
 * const registry = new SimpleContextBundleRegistry();
 *
 * registry.register(startupBundle);
 * registry.register(geosyncBundle);
 *
 * const startup = registry.get('startup');
 * const allBundles = registry.list();
 * const searchResults = registry.search('work');
 */
export class SimpleContextBundleRegistry implements ContextBundleRegistry {
  /**
   * Internal storage for context bundles, keyed by bundle name
   */
  private bundles = new Map<string, ContextBundle>();

  /**
   * Register a new context bundle.
   *
   * If a bundle with the same name already exists, it will be replaced.
   *
   * @param bundle - Context bundle to register
   *
   * @example
   * registry.register({
   *   name: 'startup',
   *   description: 'Load startup context including codebase structure',
   *   tags: ['workspace', 'codebase'],
   *   execute: async (opts) => { ... }
   * });
   */
  register(bundle: ContextBundle): void {
    this.bundles.set(bundle.name, bundle);
  }

  /**
   * Retrieve a context bundle by name.
   *
   * @param name - Bundle name (exact match, case-sensitive)
   * @returns Context bundle or undefined if not found
   *
   * @example
   * const bundle = registry.get('startup');
   * if (bundle) {
   *   const result = await bundle.execute(opts);
   * }
   */
  get(name: string): ContextBundle | undefined {
    return this.bundles.get(name);
  }

  /**
   * List all registered context bundles.
   *
   * @returns Array of all context bundles in the registry
   *
   * @example
   * const allBundles = registry.list();
   * console.log(`Found ${allBundles.length} bundles`);
   * allBundles.forEach(b => console.log(`- ${b.name}: ${b.description}`));
   */
  list(): ContextBundle[] {
    return Array.from(this.bundles.values());
  }

  /**
   * Search for context bundles by query.
   *
   * The search is case-insensitive and matches against:
   * - Bundle name
   * - Bundle description
   * - Bundle tags
   *
   * @param query - Search query string
   * @returns Array of matching context bundles (empty if no matches)
   *
   * @example
   * // Find bundles related to "work"
   * const results = registry.search('work');
   *
   * // Search is case-insensitive
   * registry.search('WORKSPACE'); // matches 'workspace' tag
   *
   * // Matches in name, description, or tags
   * registry.search('startup'); // finds startup bundle
   */
  search(query: string): ContextBundle[] {
    // Normalize query for case-insensitive matching
    const normalizedQuery = query.toLowerCase();

    // Filter bundles that match the query
    return this.list().filter((bundle) => {
      // Check if query matches name
      if (bundle.name.toLowerCase().includes(normalizedQuery)) {
        return true;
      }

      // Check if query matches description
      if (bundle.description.toLowerCase().includes(normalizedQuery)) {
        return true;
      }

      // Check if query matches any tag
      if (bundle.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))) {
        return true;
      }

      return false;
    });
  }
}
