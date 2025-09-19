import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Logger } from './logger.js';

const WebhookEndpointConfigSchema = z.object({
  base_url: z.string().optional(),
  auth_token: z.string().optional(),
});

const WebhookSourceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  secret: z.string().optional(),
  signature_header: z.string().default('x-webhook-signature').optional(),
  signature_timestamp_header: z.string().default('x-webhook-signature-timestamp').optional(),
  id_header: z.string().optional(),
  endpoints: WebhookEndpointConfigSchema.optional(),
  calendar_ids: z.array(z.string()).optional(),
});

const WebhookConfigSchema = z.object({
  debug: z.boolean().default(false).optional(),
  webhooks: z.record(WebhookSourceConfigSchema).default({}),
});

export type WebhookEndpointConfig = z.infer<typeof WebhookEndpointConfigSchema>;
export type WebhookSourceConfig = z.infer<typeof WebhookSourceConfigSchema>;
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

export async function loadWebhookConfig(dataDir: string, logger: Logger): Promise<WebhookConfig> {
  const configPath = path.resolve(dataDir, 'config', 'webhooks.json');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = WebhookConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn({ error: parsed.error.format() }, 'Invalid webhook configuration, using defaults');
      return { webhooks: {} };
    }
    return parsed.data;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      logger.warn({ err, configPath }, 'Failed to load webhook configuration, using defaults');
    }
    return { webhooks: {} };
  }
}
