import type { Logger } from '../utils/logger.js';
import { logger as rootLogger } from '../utils/logger.js';
import type { AttentionConfig, AttentionEvent, AttentionPipelineResult, DispatchRequest, RawAttentionEvent } from './types.js';
import { AttentionIngestionService } from './ingestion.js';
import type { ClassificationAgent } from './classification.js';
import { ThresholdDecider } from './threshold.js';
import { PrimaryAgentCoordinator } from './primary-agent.js';
import { DispatchManager } from './dispatch.js';

export interface AttentionPipelineOptions {
  logger?: Logger;
  config: AttentionConfig;
  ingestion?: AttentionIngestionService;
  classifier?: ClassificationAgent;
  threshold?: ThresholdDecider;
  primaryAgent?: PrimaryAgentCoordinator;
  dispatch?: DispatchManager;
}

export class AttentionPipeline {
  private readonly logger: Logger;
  private readonly config: AttentionConfig;
  private readonly ingestion: AttentionIngestionService;
  private readonly classifier: ClassificationAgent;
  private readonly threshold: ThresholdDecider;
  private readonly primaryAgent: PrimaryAgentCoordinator;
  private readonly dispatch: DispatchManager;

  constructor(options: AttentionPipelineOptions) {
    this.logger = options.logger ?? rootLogger.child({ component: 'attention-pipeline' });
    this.config = options.config;
    this.ingestion = options.ingestion ?? new AttentionIngestionService({ logger: this.logger });
    this.classifier = options.classifier ?? (() => {
      throw new Error('Classification agent must be provided');
    })();
    this.threshold = options.threshold ?? new ThresholdDecider({ logger: this.logger, config: this.config });
    this.primaryAgent = options.primaryAgent ?? new PrimaryAgentCoordinator({ logger: this.logger, config: this.config });
    this.dispatch = options.dispatch ?? new DispatchManager({ logger: this.logger });
  }

  async process(event: RawAttentionEvent): Promise<AttentionPipelineResult> {
    const attentionEvent = await this.ingest(event);
    const classification = await this.classifier.classify({ event: attentionEvent });
    const sourceKey = `${attentionEvent.source}:${attentionEvent.kind}`;
    const decision = this.threshold.decide(sourceKey, classification);

    if (decision.action === 'discard') {
      return {
        outcome: 'discarded',
        classification,
        decision,
      } satisfies AttentionPipelineResult;
    }

    const directive = await this.primaryAgent.run(attentionEvent, classification);
    const dispatchResults = directive.shouldNotify
      ? await this.dispatch.dispatch(this.buildDispatchRequests(attentionEvent, directive))
      : [];

    return {
      outcome: directive.shouldNotify ? 'dispatched' : 'escalated',
      classification,
      decision,
      primaryDirective: directive,
      dispatchResults,
    } satisfies AttentionPipelineResult;
  }

  private async ingest(event: RawAttentionEvent): Promise<AttentionEvent> {
    return this.ingestion.ingest(event);
  }

  private buildDispatchRequests(event: AttentionEvent, directive: Awaited<ReturnType<PrimaryAgentCoordinator['run']>>): DispatchRequest[] {
    if (!directive.shouldNotify) {
      return [];
    }
    const channels = directive.recommendedChannels.length
      ? directive.recommendedChannels
      : this.config.channelPreferences[event.source] ?? [];
    if (!channels.length) {
      this.logger.info({ source: event.source }, 'No channels configured for attention dispatch');
      return [];
    }
    return channels.map<DispatchRequest>((channel) => ({
      channel,
      audience: event.metadata?.audience as string | undefined ?? 'default',
      payload: {
        summary: directive.summary,
        escalationLevel: directive.escalationLevel,
        context: directive.contextInjections,
        event: {
          source: event.source,
          kind: event.kind,
          receivedAt: event.receivedAt,
        },
        followUpActions: directive.followUpActions,
      },
    }));
  }
}
