import type { Logger } from '../utils/logger.js';
import { logger as rootLogger } from '../utils/logger.js';
import type { AttentionConfig, ClassificationResult, ThresholdDecision } from './types.js';

export interface ThresholdDeciderOptions {
  logger?: Logger;
  config: AttentionConfig;
}

export class ThresholdDecider {
  private readonly logger: Logger;
  private readonly config: AttentionConfig;

  constructor(options: ThresholdDeciderOptions) {
    this.logger = options.logger ?? rootLogger.child({ component: 'attention-threshold' });
    this.config = options.config;
  }

  decide(sourceKey: string, classification: ClassificationResult): ThresholdDecision {
    const threshold = this.config.thresholds[sourceKey] ?? this.config.defaultThreshold;
    const action = classification.urgencyScore >= threshold ? 'escalate' : 'discard';
    const decision: ThresholdDecision = {
      action,
      threshold,
      score: classification.urgencyScore,
      ruleId: sourceKey,
      notes: action === 'escalate' ? 'score_above_threshold' : 'below_threshold',
    };
    this.logger.debug({ sourceKey, action, score: classification.urgencyScore, threshold }, 'Threshold decision computed');
    return decision;
  }
}
