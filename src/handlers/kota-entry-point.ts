import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec, HandlerConfig } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { BundleMetadataGenerator } from '../utils/bundle-metadata.js';
import type {
  ContextBundleRegistry,
  ContextCache,
  ContextResult,
  HandlerRegistry
} from '../types/context.js';
import { pacificNowIso } from '../utils/time.js';

/**
 * Discovery filter schema
 */
const DiscoverFilterSchema = z.object({
  category: z.enum(['tool', 'context', 'all']).optional(),
  tags: z.array(z.string()).optional(),
}).strict();

/**
 * Discovery input schema
 */
const DiscoverSchema = z.object({
  query: z.string().optional().describe('Search term to match bundle/action names, descriptions, or tags'),
  filter: DiscoverFilterSchema.optional().describe('Filter criteria for bundles'),
}).strict();

/**
 * Invoke input schema
 */
const InvokeSchema = z.object({
  bundle: z.string().min(1).describe('Bundle key (e.g., "memory", "gmail")'),
  action: z.string().min(1).describe('Action name (e.g., "set", "search")'),
  args: z.record(z.string(), z.any()).optional().describe('Action arguments'),
}).strict();

/**
 * Context input schema
 */
const ContextSchema = z.object({
  context: z.string().min(1).describe('Context bundle name (e.g., "startup")'),
  refresh: z.boolean().optional().describe('Force refresh cache (default: false)'),
}).strict();

/**
 * Simple in-memory cache implementation for context results
 */
class SimpleContextCache implements ContextCache {
  private cache = new Map<string, { result: ContextResult; expiresAt: number }>();

  /**
   * Retrieve a cached context result
   */
  get(key: string): ContextResult | undefined {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.result;
  }

  /**
   * Store a context result in cache
   */
  set(key: string, value: ContextResult, ttl: number): void {
    this.cache.set(key, {
      result: value,
      expiresAt: Date.now() + (ttl * 1000),
    });
  }

  /**
   * Clear all cached results
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Check if a key exists in cache
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }
}

/**
 * KOTA Entry Point Handler
 *
 * Consolidates all MCP tool access through three main operations:
 * 1. Discovery - Search and browse available bundles and actions
 * 2. Invocation - Route calls to handler actions
 * 3. Context Loading - Execute context bundles with caching
 */
export class KotaEntryPointHandler extends BaseHandler {
  readonly prefix = 'kota';
  private metadataGenerator: BundleMetadataGenerator;
  private contextRegistry: ContextBundleRegistry;
  private contextCache: ContextCache;
  private handlerRegistry: HandlerRegistry;

  constructor(opts: {
    logger: Logger;
    config: HandlerConfig;
    bundleRegistry: any; // BundleRegistry from index.ts
    contextRegistry: ContextBundleRegistry;
  }) {
    super(opts);
    this.metadataGenerator = new BundleMetadataGenerator(opts.bundleRegistry);
    this.contextRegistry = opts.contextRegistry;
    this.contextCache = new SimpleContextCache();

    // Create a HandlerRegistry adapter from the BundleRegistry
    this.handlerRegistry = this.createHandlerRegistry(opts.bundleRegistry);
  }

  /**
   * Create a HandlerRegistry adapter from BundleRegistry
   */
  private createHandlerRegistry(bundleRegistry: any): HandlerRegistry {
    return {
      execute: async (bundle: string, action: string, args: any): Promise<any> => {
        // Access the enabled handlers map via reflection
        const enabledMap = (bundleRegistry as any).enabled as Map<string, { handler: any; tools: string[] }> | undefined;
        if (!enabledMap) {
          throw new Error('Bundle registry not initialized');
        }

        const bundleData = enabledMap.get(bundle);
        if (!bundleData) {
          throw new Error(`Bundle not found or not enabled: ${bundle}`);
        }

        const handler = bundleData.handler;
        if (!handler || typeof handler.execute !== 'function') {
          throw new Error(`Invalid handler for bundle: ${bundle}`);
        }

        return await handler.execute(action, args);
      },

      getHandler: (bundle: string): any => {
        const enabledMap = (bundleRegistry as any).enabled as Map<string, { handler: any; tools: string[] }> | undefined;
        if (!enabledMap) return undefined;

        const bundleData = enabledMap.get(bundle);
        return bundleData?.handler;
      },

      listBundles: (): Array<{ key: string; enabled: boolean }> => {
        return bundleRegistry.listBundles().map((b: any) => ({
          key: b.key,
          enabled: b.enabled,
        }));
      },
    };
  }

  getTools(): ToolSpec[] {
    return [
      {
        action: 'discover',
        description: 'Search and browse available bundles and actions with optional filtering',
        inputSchema: {
          query: DiscoverSchema.shape.query,
          filter: DiscoverSchema.shape.filter,
        },
      },
      {
        action: 'invoke',
        description: 'Invoke a specific action on a bundle with arguments',
        inputSchema: {
          bundle: InvokeSchema.shape.bundle,
          action: InvokeSchema.shape.action,
          args: InvokeSchema.shape.args,
        },
      },
      {
        action: 'context',
        description: 'Load and execute a context bundle with caching support',
        inputSchema: {
          context: ContextSchema.shape.context,
          refresh: ContextSchema.shape.refresh,
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'discover':
          return await this.handleDiscover(args);
        case 'invoke':
          return await this.handleInvoke(args);
        case 'context':
          return await this.handleContext(args);
        default:
          return {
            content: [{ type: 'text', text: `Unknown action: ${action}` }],
            isError: true,
          };
      }
    } catch (err: any) {
      this.logger.error({ err, action }, 'KOTA entry point handler error');
      const message = err?.message || String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }

  /**
   * Handle discovery - search and filter bundles and actions
   */
  private async handleDiscover(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(DiscoverSchema, raw);

    // Start with all metadata
    let results = Array.from(this.metadataGenerator.generateAll().values());

    // Apply category filter if specified
    if (parsed.filter?.category && parsed.filter.category !== 'all') {
      if (parsed.filter.category === 'tool') {
        // Tool bundles are those currently in the system (all current bundles are tools)
        // Context bundles would be a separate registry
        results = results;
      } else if (parsed.filter.category === 'context') {
        // For now, context bundles come from the context registry
        // We'll add those results separately
        results = [];
      }
    }

    // Apply tags filter if specified
    if (parsed.filter?.tags && parsed.filter.tags.length > 0) {
      results = this.metadataGenerator.filterByTags(parsed.filter.tags);
    }

    // Apply search query if specified
    if (parsed.query) {
      results = this.metadataGenerator.search(parsed.query);
    }

    // If category is 'context' or 'all', include context bundles
    const includeContextBundles =
      !parsed.filter?.category ||
      parsed.filter.category === 'all' ||
      parsed.filter.category === 'context';

    let contextBundles: any[] = [];
    if (includeContextBundles) {
      const allContextBundles = this.contextRegistry.list();

      // Filter context bundles by query if specified
      if (parsed.query) {
        contextBundles = this.contextRegistry.search(parsed.query).map(bundle => ({
          key: bundle.name,
          name: bundle.name.charAt(0).toUpperCase() + bundle.name.slice(1),
          description: bundle.description,
          category: 'context' as const,
          tags: bundle.tags,
          enabled: true,
          actions: [],
        }));
      } else {
        contextBundles = allContextBundles.map(bundle => ({
          key: bundle.name,
          name: bundle.name.charAt(0).toUpperCase() + bundle.name.slice(1),
          description: bundle.description,
          category: 'context' as const,
          tags: bundle.tags,
          enabled: true,
          actions: [],
        }));
      }

      // Apply tags filter to context bundles if specified
      if (parsed.filter?.tags && parsed.filter.tags.length > 0) {
        const lowerTags = parsed.filter.tags.map(t => t.toLowerCase());
        contextBundles = contextBundles.filter(bundle => {
          const bundleTags = bundle.tags.map((t: string) => t.toLowerCase());
          return lowerTags.every(tag => bundleTags.includes(tag));
        });
      }
    }

    // Combine results
    const combinedResults = [
      ...results.map(r => ({
        ...r,
        category: r.category as 'core' | 'optional',
      })),
      ...contextBundles,
    ];

    const response = {
      total: combinedResults.length,
      bundles: combinedResults,
      query: parsed.query,
      filter: parsed.filter,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
    };
  }

  /**
   * Handle invocation - route to handler action
   */
  private async handleInvoke(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(InvokeSchema, raw);

    this.logger.info(
      { bundle: parsed.bundle, action: parsed.action },
      'Invoking handler action'
    );

    try {
      const result = await this.handlerRegistry.execute(
        parsed.bundle,
        parsed.action,
        parsed.args || {}
      );

      // If result is already a CallToolResult, return it directly
      if (result && typeof result === 'object' && 'content' in result) {
        return result as CallToolResult;
      }

      // Otherwise, wrap it
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (err: any) {
      this.logger.error(
        { err, bundle: parsed.bundle, action: parsed.action },
        'Handler invocation failed'
      );
      throw err;
    }
  }

  /**
   * Handle context loading - execute context bundle with caching
   */
  private async handleContext(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(ContextSchema, raw);

    // Check cache unless refresh is requested
    const cacheKey = `context:${parsed.context}`;
    if (!parsed.refresh) {
      const cached = this.contextCache.get(cacheKey);
      if (cached) {
        this.logger.info(
          { context: parsed.context, cached: true },
          'Returning cached context result'
        );

        return {
          content: [{ type: 'text', text: JSON.stringify({
            ...cached,
            _cached: true,
          }) }],
        };
      }
    }

    // Look up context bundle
    const bundle = this.contextRegistry.get(parsed.context);
    if (!bundle) {
      throw new Error(`Context bundle not found: ${parsed.context}`);
    }

    this.logger.info(
      { context: parsed.context, refresh: parsed.refresh },
      'Executing context bundle'
    );

    // Execute the context bundle
    const result = await bundle.execute({
      handlers: this.handlerRegistry,
      cache: this.contextCache,
      refresh: parsed.refresh,
      args: {},
    });

    // Cache the result if TTL is specified
    const ttl = result.ttl_seconds || 300; // Default 5 minutes
    this.contextCache.set(cacheKey, result, ttl);

    this.logger.info(
      { context: parsed.context, ttl },
      'Context bundle executed and cached'
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
}
