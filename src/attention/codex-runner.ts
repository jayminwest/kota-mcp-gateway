import type { Logger } from '../utils/logger.js';
import { logger as rootLogger } from '../utils/logger.js';
import type { AttentionEvent, ClassificationResult } from './types.js';

export interface CodexRunnerOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  policyUri?: string;
  maxOutputTokens?: number;
  allowTools?: string[];
  requireApiKey?: boolean;
  sendCodexHeaders?: boolean;
  provider?: 'codex' | 'ollama';
  logger?: Logger;
}

export class CodexGuardedRunner {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly policyUri?: string;
  private readonly maxOutputTokens: number;
  private readonly allowTools: string[];
  private readonly logger: Logger;
  private readonly requireApiKey: boolean;
  private readonly sendCodexHeaders: boolean;
  private readonly provider: 'codex' | 'ollama';

  constructor(options: CodexRunnerOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.CODEX_API_KEY ?? process.env.OPENAI_API_KEY;
    this.baseUrl = (options.baseUrl ?? process.env.CODEX_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.provider = options.provider
      ?? (this.baseUrl.includes('11434') || this.baseUrl.includes('ollama') ? 'ollama' : 'codex');
    this.model = options.model
      ?? process.env.CODEX_MODEL
      ?? process.env.OPENAI_MODEL
      ?? (this.provider === 'ollama' ? 'gpt-oss:20b' : 'o4-mini');
    this.policyUri = options.policyUri ?? process.env.CODEX_POLICY_URI ?? process.env.OPENAI_POLICY_URI;
    this.maxOutputTokens = options.maxOutputTokens ?? Number(process.env.CODEX_MAX_OUTPUT_TOKENS ?? 512);
    this.allowTools = options.allowTools ?? [];
    this.logger = options.logger ?? rootLogger.child({ component: 'attention-codex-runner' });
    this.requireApiKey = options.requireApiKey ?? this.provider !== 'ollama';
    this.sendCodexHeaders = options.sendCodexHeaders ?? this.provider === 'codex';
  }

  isConfigured(): boolean {
    if (this.requireApiKey) {
      return Boolean(this.apiKey);
    }
    return true;
  }

  async classify(event: AttentionEvent): Promise<ClassificationResult | undefined> {
    if (this.requireApiKey && !this.apiKey) {
      this.logger.warn('Codex classification skipped: API key required but not configured');
      return undefined;
    }

    try {
      if (this.provider === 'ollama') {
        return await this.classifyWithOllama(event);
      }
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (this.apiKey) {
        headers.authorization = `Bearer ${this.apiKey}`;
      }
      if (this.sendCodexHeaders) {
        headers['x-codex-mode'] = 'non_interactive_ci';
      }
      if (this.policyUri) {
        headers['x-codex-guardrails-policy'] = this.policyUri;
      }

      const response = await fetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers,
        body: JSON.stringify(this.buildPayload(event)),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.warn({ status: response.status, text }, 'Codex classification request failed');
        return undefined;
      }

      const payload = (await response.json()) as any;
      const content = payload?.output?.[0]?.content ?? payload?.content;
      if (!content) {
        this.logger.warn({ payload }, 'Codex classification returned unexpected payload');
        return undefined;
      }

      const text = Array.isArray(content)
        ? content.map((part: any) => part.text).filter(Boolean).join('\n')
        : content.toString();

      return this.parseClassification(text);
    } catch (err) {
      this.logger.error({ err }, 'Codex classification request threw error');
      return undefined;
    }
  }

  private buildPayload(event: AttentionEvent): Record<string, unknown> {
    const schema = this.getSchema();

    const guardrailSettings = {
      allow_tools: this.allowTools,
      temperature: 0,
      max_output_tokens: this.maxOutputTokens,
    };

    return {
      model: this.model,
      input: [
        {
          role: 'system',
          content: `You are a non-interactive Codex classifier. Obey the guardrails. Only return JSON matching the schema. Use conservative scoring when uncertain.${this.policyUri ? ` Policy: ${this.policyUri}` : ''}`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                event,
                instructions: 'Derive urgency (0-10), relevance tier, filter boolean, rationales, context snippets (if safe).',
              }),
            },
          ],
        },
      ],
      guardrails: guardrailSettings,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'AttentionClassification',
          schema,
        },
      },
    };
  }

  private getSchema() {
    return {
      type: 'object',
      properties: {
        urgencyScore: { type: 'number', minimum: 0, maximum: 10 },
        relevance: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
        filtered: { type: 'boolean' },
        reasons: { type: 'array', items: { type: 'string' } },
        context: { type: 'object', additionalProperties: true },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['urgencyScore', 'relevance', 'filtered', 'reasons'],
      additionalProperties: false,
    } as const;
  }

  private parseClassification(text: string): ClassificationResult | undefined {
    const jsonPayload = this.extractJson(text);
    if (!jsonPayload) {
      this.logger.warn({ text }, 'Unable to locate JSON payload in classification response');
      return undefined;
    }

    try {
      const parsed = JSON.parse(jsonPayload) as ClassificationResult;
      if (typeof parsed.urgencyScore !== 'number') return undefined;
      return {
        urgencyScore: Math.min(10, Math.max(0, parsed.urgencyScore)),
        relevance: parsed.relevance ?? 'low',
        filtered: Boolean(parsed.filtered),
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
        context: parsed.context ?? {},
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        version: `codex-${this.model}`,
      } satisfies ClassificationResult;
    } catch (err) {
      this.logger.warn({ err, text: jsonPayload }, 'Failed to parse JSON payload from classification response');
      return undefined;
    }
  }

  private extractJson(text: string): string | undefined {
    let working = text.trim();
    working = working.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    const codeBlockMatch = working.match(/```json\s*([\s\S]*?)```/i) || working.match(/```\s*([\s\S]*?)```/i);
    if (codeBlockMatch) {
      working = codeBlockMatch[1].trim();
    }

    if (!working.startsWith('{')) {
      const firstBrace = working.indexOf('{');
      const lastBrace = working.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        working = working.slice(firstBrace, lastBrace + 1).trim();
      }
    }

    if (!working.startsWith('{') || !working.endsWith('}')) {
      return undefined;
    }
    return working;
  }

  private buildOllamaUrl(path: string): string {
    const base = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    if (path.startsWith('/')) {
      return `${base}${path}`;
    }
    return `${base}/${path}`;
  }

  private async classifyWithOllama(event: AttentionEvent): Promise<ClassificationResult | undefined> {
    const url = this.buildOllamaUrl('/api/chat');
    const body = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are a classification service. Return a strict JSON object with urgencyScore (0-10), relevance (none|low|medium|high), filtered (boolean), reasons (array of strings), optional context object, and optional tags array. No extra text.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            event,
            instructions: 'Assess urgency, relevance, and provide concise reasons. Mark filtered=true only when the event should be silently ignored.',
          }),
        },
      ],
      options: {
        temperature: 0,
      },
      stream: false,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const msg = await response.text();
        this.logger.warn({ status: response.status, msg }, 'Ollama classification request failed');
        return undefined;
      }
      const payload = await response.json();
      const content = payload?.message?.content;
      if (!content) {
        this.logger.warn({ payload }, 'Ollama classification returned unexpected payload');
        return undefined;
      }
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      return this.parseClassification(text);
    } catch (err) {
      this.logger.error({ err }, 'Ollama classification request threw error');
      return undefined;
    }
  }
}
