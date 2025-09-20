import type { Logger } from '../utils/logger.js';
import { logger as rootLogger } from '../utils/logger.js';
import type { AttentionConfig, ClassificationInput, ClassificationResult } from './types.js';
import { CodexGuardedRunner } from './codex-runner.js';

export interface ClassificationAgentOptions {
  logger?: Logger;
  config: AttentionConfig;
  codexRunner?: CodexGuardedRunner;
}

export interface ClassificationAgent {
  classify(input: ClassificationInput): Promise<ClassificationResult>;
}

export class CodexClassificationAgent implements ClassificationAgent {
  private readonly logger: Logger;
  private readonly config: AttentionConfig;
  private readonly codexRunner: CodexGuardedRunner;

  constructor(options: ClassificationAgentOptions) {
    this.logger = options.logger ?? rootLogger.child({ component: 'attention-classifier' });
    this.config = options.config;
    this.codexRunner = options.codexRunner ?? new CodexGuardedRunner({
      logger: this.logger,
      policyUri: this.config.guardrails.codexPolicyUri,
      maxOutputTokens: this.config.guardrails.maxCodexTokens,
      allowTools: this.config.guardrails.allowTools,
      baseUrl: this.config.guardrails.codexBaseUrl,
      model: this.config.guardrails.codexModel,
      apiKey: this.config.guardrails.codexApiKey,
      requireApiKey: this.config.guardrails.requireApiKey,
      sendCodexHeaders: this.config.guardrails.sendCodexHeaders,
      provider: this.config.guardrails.codexProvider,
    });
  }

  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    this.logger.debug({ source: input.event.source, kind: input.event.kind }, 'Classifying attention event');
    const codexResult = await this.codexRunner.classify(input.event);
    if (codexResult) {
      return codexResult;
    }

    const urgencyScore = this.estimateScore(input);
    return {
      urgencyScore,
      relevance: urgencyScore >= 7 ? 'high' : urgencyScore >= 4 ? 'medium' : 'low',
      filtered: urgencyScore < 1,
      reasons: ['fallback_heuristic'],
      context: input.ambientContext ?? {},
      tags: [],
      version: 'fallback-heuristic',
    } satisfies ClassificationResult;
  }

  private estimateScore(input: ClassificationInput): number {
    const base = typeof input.event.metadata?.priority === 'number' ? input.event.metadata.priority : 0;
    if (base > 0) {
      return Math.min(10, base);
    }
    if (this.containsUrgentKeywords(input)) {
      return 9;
    }
    if (input.event.kind.toLowerCase().includes('critical')) {
      return 9;
    }
    return 3;
  }

  private containsUrgentKeywords(input: ClassificationInput): boolean {
    const candidates: string[] = [];
    const collect = (value: unknown) => {
      if (!value) return;
      if (typeof value === 'string') {
        candidates.push(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(collect);
        return;
      }
      if (typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach(collect);
      }
    };
    collect(input.event.payload);
    collect(input.event.metadata);
    if (!candidates.length) {
      return false;
    }
    const text = candidates.join(' ').toLowerCase();
    return ['urgent', 'asap', 'notify user', 'notify asap', 'immediately'].some((keyword) => text.includes(keyword));
  }
}
