/**
 * Type definitions for the context bundle system.
 *
 * Context bundles are executable workflows that load data from multiple handlers
 * and synthesize it into a coherent result. They replace the previous slash command
 * system with a more flexible and composable architecture.
 */

/**
 * A context bundle is an executable workflow that loads data from multiple handlers
 * and synthesizes it into a coherent result. Replaces slash commands.
 */
export interface ContextBundle {
  /**
   * Unique identifier for this context bundle
   */
  name: string;

  /**
   * Human-readable description of what this bundle provides
   */
  description: string;

  /**
   * Tags for categorization and search
   */
  tags: string[];

  /**
   * Execute the context bundle and return synthesized result
   *
   * @param opts - Execution options including handler registry, cache, and arguments
   * @returns Promise resolving to the context result
   */
  execute(opts: ContextExecutionOptions): Promise<ContextResult>;
}

/**
 * Options passed to a context bundle during execution
 */
export interface ContextExecutionOptions {
  /**
   * Access to handler registry for data fetching
   */
  handlers: HandlerRegistry;

  /**
   * Cache for storing/retrieving results
   */
  cache: ContextCache;

  /**
   * Force refresh (ignore cache)
   */
  refresh?: boolean;

  /**
   * Additional arguments passed by caller
   */
  args?: Record<string, any>;
}

/**
 * Result returned by a context bundle execution
 */
export interface ContextResult {
  /**
   * Name of the context bundle that produced this result
   */
  context_name: string;

  /**
   * ISO timestamp when this context was loaded
   */
  loaded_at: string;

  /**
   * The actual context data (flexible structure)
   */
  data: Record<string, any>;

  /**
   * Suggested next actions for agent
   */
  next_steps?: string[];

  /**
   * Cache TTL in seconds
   */
  ttl_seconds?: number;
}

/**
 * Cache interface for context results
 */
export interface ContextCache {
  /**
   * Retrieve a cached context result
   *
   * @param key - Cache key
   * @returns Cached result or undefined if not found/expired
   */
  get(key: string): ContextResult | undefined;

  /**
   * Store a context result in cache
   *
   * @param key - Cache key
   * @param value - Context result to cache
   * @param ttl - Time to live in seconds
   */
  set(key: string, value: ContextResult, ttl: number): void;

  /**
   * Clear all cached results
   */
  clear(): void;

  /**
   * Check if a key exists in cache
   *
   * @param key - Cache key
   * @returns True if key exists and is not expired
   */
  has(key: string): boolean;
}

/**
 * Registry for context bundles
 */
export interface ContextBundleRegistry {
  /**
   * Register a new context bundle
   *
   * @param bundle - Context bundle to register
   */
  register(bundle: ContextBundle): void;

  /**
   * Get a context bundle by name
   *
   * @param name - Bundle name
   * @returns Context bundle or undefined if not found
   */
  get(name: string): ContextBundle | undefined;

  /**
   * List all registered context bundles
   *
   * @returns Array of all context bundles
   */
  list(): ContextBundle[];

  /**
   * Search for context bundles by query
   *
   * @param query - Search query (matches name, description, or tags)
   * @returns Array of matching context bundles
   */
  search(query: string): ContextBundle[];
}

/**
 * Handler registry interface (subset needed for context bundles)
 */
export interface HandlerRegistry {
  /**
   * Execute a handler action
   *
   * @param bundle - Bundle key (e.g., 'kotadb')
   * @param action - Action name (e.g., 'search_code')
   * @param args - Action arguments
   * @returns Promise resolving to action result
   */
  execute(bundle: string, action: string, args: any): Promise<any>;

  /**
   * Get a handler by bundle key
   *
   * @param bundle - Bundle key
   * @returns Handler instance or undefined if not found
   */
  getHandler(bundle: string): any; // BaseHandler type

  /**
   * List all available handler bundles
   *
   * @returns Array of bundle metadata
   */
  listBundles(): Array<{ key: string; enabled: boolean }>;
}
