import type { Logger } from '../../utils/logger.js';
import { logger as rootLogger } from '../../utils/logger.js';
import type { AppConfig } from '../../utils/config.js';
import { getSlackUserToken, slackApi } from '../../utils/slack.js';
import type { AttentionConfig, DispatchRequest, DispatchResult, SlackDispatchTarget } from '../types.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

interface SlackTransportOptions {
  logger?: Logger;
  appConfig: AppConfig;
  attentionConfig: AttentionConfig;
}

export class SlackDispatchTransport {
  private readonly logger: Logger;
  private readonly appConfig: AppConfig;
  private readonly target?: SlackDispatchTarget;

  constructor(options: SlackTransportOptions) {
    this.logger = options.logger ?? rootLogger.child({ component: 'attention-slack-transport' });
    this.appConfig = options.appConfig;
    this.target = options.attentionConfig.dispatchTargets?.slack;
  }

  async send(request: DispatchRequest): Promise<DispatchResult> {
    if (!this.target?.channelId) {
      this.logger.warn('Slack dispatch requested but no channel configured');
      return { channel: request.channel, delivered: false, error: 'slack_not_configured' };
    }

    if (request.channel !== 'slack') {
      return { channel: request.channel, delivered: false, error: 'unsupported_channel' };
    }

    const token = await this.resolveToken();
    if (!token) {
      return { channel: request.channel, delivered: false, error: 'slack_token_unavailable' };
    }

    const message = this.buildMessage(request);

    try {
      const response = await slackApi(token, 'chat.postMessage', {
        channel: this.target.channelId,
        thread_ts: this.target.threadTs,
        text: message.fallback,
        blocks: message.blocks,
        unfurl_links: false,
        unfurl_media: false,
      });
      const ts = response.ts as string | undefined;
      return {
        channel: request.channel,
        delivered: true,
        messageId: ts,
      } satisfies DispatchResult;
    } catch (err) {
      this.logger.error({ err }, 'Failed to dispatch Slack notification');
      return { channel: request.channel, delivered: false, error: (err as Error).message };
    }
  }

  private async resolveToken(): Promise<string | undefined> {
    const dedicated = await this.resolveDedicatedToken();
    if (dedicated) {
      return dedicated;
    }

    if (this.target?.useDedicatedToken) {
      this.logger.error('Dedicated attention Slack token required but not configured');
      return undefined;
    }

    try {
      return await getSlackUserToken(this.appConfig, this.logger);
    } catch (err) {
      this.logger.error({ err }, 'Unable to resolve Slack user token');
      return undefined;
    }
  }

  private async resolveDedicatedToken(): Promise<string | undefined> {
    const envToken = process.env.ATTENTION_SLACK_USER_TOKEN || process.env.ATTENTION_SLACK_BOT_TOKEN;
    if (envToken) {
      return envToken;
    }

    const dir = path.resolve(this.appConfig.DATA_DIR, 'attention', 'slack');
    const file = path.join(dir, 'tokens.json');
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as { userToken?: string; botToken?: string } | string;
      if (typeof parsed === 'string') {
        return parsed;
      }
      return parsed.userToken || parsed.botToken;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn({ err, file }, 'Failed to read dedicated attention Slack token file');
      }
      return undefined;
    }
  }

  private buildMessage(request: DispatchRequest): { fallback: string; blocks: unknown[] } {
    const summary = typeof request.payload.summary === 'string'
      ? request.payload.summary
      : 'Attention alert';
    const escalationLevel = typeof request.payload.escalationLevel === 'string'
      ? request.payload.escalationLevel
      : undefined;
    const escalation = escalationLevel
      ? `:warning: Escalation level: *${escalationLevel.toUpperCase()}*`
      : undefined;
    const contextLines: string[] = [];
    const context = (request.payload.context && typeof request.payload.context === 'object'
      ? request.payload.context
      : {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(context)) {
      const val = typeof value === 'string' ? value : JSON.stringify(value);
      contextLines.push(`• *${key}*: ${val}`);
    }

    const followUps = Array.isArray(request.payload.followUpActions)
      ? request.payload.followUpActions
          .map(action => `• ${action.label}${action.tool ? ` _(tool: ${action.tool})_` : ''}`)
      : [];

    const mention = this.target?.mentionUserId && !this.target.suppressMentions
      ? `<@${this.target.mentionUserId}> `
      : '';

    const fallbackParts = [summary];
    if (escalation) fallbackParts.push(escalation.replace(/[*_]/g, ''));
    if (contextLines.length) fallbackParts.push(contextLines.map(line => line.replace(/[*_]/g, '')).join('\n'));
    if (followUps.length) fallbackParts.push(`Follow-ups:\n${followUps.map(line => line.replace(/[*_]/g, '')).join('\n')}`);

    const blocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${mention}*${summary}*`,
        },
      },
    ];

    if (escalation) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: escalation,
          },
        ],
      });
    }

    if (contextLines.length) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: contextLines.join('\n'),
        },
      });
    }

    if (followUps.length) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Suggested actions*\n${followUps.join('\n')}`,
        },
      });
    }

    const eventInfo = (request.payload.event && typeof request.payload.event === 'object'
      ? request.payload.event
      : undefined) as { source?: string; kind?: string; receivedAt?: string } | undefined;
    if (eventInfo) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Source: *${eventInfo.source ?? 'unknown'}* • Kind: *${eventInfo.kind ?? 'unknown'}* • Received: ${eventInfo.receivedAt ?? 'unknown'}`,
          },
        ],
      });
    }

    return {
      fallback: fallbackParts.join('\n'),
      blocks,
    };
  }
}
