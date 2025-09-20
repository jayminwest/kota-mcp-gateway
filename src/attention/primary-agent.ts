import type { Logger } from '../utils/logger.js';
import { logger as rootLogger } from '../utils/logger.js';
import type { AttentionConfig, AttentionEvent, ClassificationResult, PrimaryAgentDirective } from './types.js';

export interface PrimaryAgentDependencies {
  fetchContext?: (event: AttentionEvent) => Promise<Record<string, unknown>>;
  planResponse?: (args: {
    event: AttentionEvent;
    classification: ClassificationResult;
    config: AttentionConfig;
    context: Record<string, unknown>;
  }) => Promise<PrimaryAgentDirective>;
}

export interface PrimaryAgentCoordinatorOptions {
  logger?: Logger;
  config: AttentionConfig;
  dependencies?: PrimaryAgentDependencies;
}

export class PrimaryAgentCoordinator {
  private readonly logger: Logger;
  private readonly config: AttentionConfig;
  private readonly dependencies: PrimaryAgentDependencies;

  constructor(options: PrimaryAgentCoordinatorOptions) {
    this.logger = options.logger ?? rootLogger.child({ component: 'attention-primary-agent' });
    this.config = options.config;
    this.dependencies = options.dependencies ?? {};
  }

  async run(event: AttentionEvent, classification: ClassificationResult): Promise<PrimaryAgentDirective> {
    const context = await this.dependencies.fetchContext?.(event);
    if (this.dependencies.planResponse) {
      return this.dependencies.planResponse({
        event,
        classification,
        config: this.config,
        context: context ?? {},
      });
    }

    this.logger.debug({ source: event.source, kind: event.kind }, 'Primary agent fallback path');
    return {
      shouldNotify: classification.relevance === 'high',
      escalationLevel: classification.urgencyScore >= 9 ? 'urgent' : classification.urgencyScore >= 7 ? 'notify' : 'monitor',
      summary: 'Primary agent placeholder response',
      recommendedChannels: this.config.channelPreferences[event.source] ?? ['slack'],
      contextInjections: context ?? {},
      followUpActions: [],
    } satisfies PrimaryAgentDirective;
  }
}
