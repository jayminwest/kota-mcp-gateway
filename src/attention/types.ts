export interface RawAttentionEvent {
  source: string;
  kind: string;
  payload: unknown;
  receivedAt?: string;
  dedupeKey?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface AttentionEvent extends RawAttentionEvent {
  receivedAt: string;
  normalized: Record<string, unknown>;
}

export interface ClassificationInput {
  event: AttentionEvent;
  ambientContext?: Record<string, unknown>;
}

export interface ClassificationResult {
  urgencyScore: number;
  relevance: 'none' | 'low' | 'medium' | 'high';
  filtered: boolean;
  reasons: string[];
  context: Record<string, unknown>;
  tags: string[];
  version: string;
}

export interface ThresholdDecision {
  action: 'discard' | 'escalate';
  threshold: number;
  score: number;
  ruleId: string;
  notes?: string;
}

export interface PrimaryAgentDirective {
  shouldNotify: boolean;
  escalationLevel: 'monitor' | 'notify' | 'urgent';
  summary: string;
  recommendedChannels: string[];
  contextInjections: Record<string, unknown>;
  followUpActions: Array<{
    label: string;
    tool?: string;
    args?: Record<string, unknown>;
  }>;
}

export interface AttentionDispatchPayload {
  summary?: string;
  escalationLevel?: string;
  context?: Record<string, unknown>;
  event?: {
    source: string;
    kind: string;
    receivedAt: string;
  };
  followUpActions?: Array<{
    label: string;
    tool?: string;
    args?: Record<string, unknown>;
  }>;
  [key: string]: unknown;
}

export interface DispatchRequest {
  channel: string;
  audience: string;
  payload: AttentionDispatchPayload;
  metadata?: Record<string, unknown>;
}

export interface DispatchResult {
  channel: string;
  delivered: boolean;
  messageId?: string;
  error?: string;
  retryAt?: string;
}

export interface AttentionPipelineResult {
  outcome: 'discarded' | 'escalated' | 'dispatched';
  classification: ClassificationResult;
  decision: ThresholdDecision;
  primaryDirective?: PrimaryAgentDirective;
  dispatchResults?: DispatchResult[];
}

export interface SlackDispatchTarget {
  channelId: string;
  threadTs?: string;
  mentionUserId?: string;
  suppressMentions?: boolean;
  useDedicatedToken?: boolean;
}

export interface AttentionConfig {
  thresholds: Record<string, number>;
  channelPreferences: Record<string, string[]>;
  defaultThreshold: number;
  guardrails: {
    codexPolicyUri?: string;
    maxCodexTokens?: number;
    allowTools?: string[];
    codexBaseUrl?: string;
    codexModel?: string;
    codexApiKey?: string;
    requireApiKey?: boolean;
    sendCodexHeaders?: boolean;
    codexProvider?: 'codex' | 'ollama';
  };
  dispatchTargets?: {
    slack?: SlackDispatchTarget;
  };
}
