import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const ConfigSchema = z.object({
  NODE_ENV: z.string().default('production'),
  PORT: z.coerce.number().default(8081),
  LOG_LEVEL: z.string().default('info'),
  HEALTH_PATH: z.string().default('/health'),

  DATA_DIR: z.string().default('data'),
  KNOWLEDGE_BASE_PATH: z.string().default('data/knowledge'),

  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  WHOOP_API_KEY: z.string().optional(),
  WHOOP_CLIENT_ID: z.string().optional(),
  WHOOP_CLIENT_SECRET: z.string().optional(),
  WHOOP_REDIRECT_URI: z.string().optional(),
  WHOOP_TOKEN_AUTH_METHOD: z.enum(["basic", "post"]).optional(),

  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_PUBLIC_KEY: z.string().optional(),

  KASA_USERNAME: z.string().optional(),
  KASA_PASSWORD: z.string().optional(),
  KASA_LAN_ONLY: z.coerce.boolean().optional(),
  KASA_LAN_DISCOVERY_MS: z.coerce.number().optional().default(3000),

  KRAKEN_API_KEY: z.string().optional(),
  KRAKEN_API_SECRET: z.string().optional(),
  RIZE_API_KEY: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().optional(),

  MCP_AUTH_TOKEN: z.string().optional(),

  // GitHub
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_USERNAME: z.string().optional(),

  // Stripe
  STRIPE_API_KEY: z.string().optional(),
  STRIPE_ACCOUNT: z.string().optional(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}
