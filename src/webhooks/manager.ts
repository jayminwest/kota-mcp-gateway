import express from 'express';
import type { Logger } from '../utils/logger.js';
import type { AppConfig } from '../utils/config.js';
import { DailyStore } from '../utils/daily.js';
import type { WebhookConfig } from '../utils/webhook-config.js';
import { WebhookEventLogger } from '../utils/webhook-events.js';
import { WebhookDeduper } from '../utils/webhook-dedupe.js';
import { WhoopWebhook } from './whoop.js';
import { CalendarWebhook } from './calendar.js';
import { IOSWebhook } from './ios.js';
import type { BaseWebhook } from './base.js';

interface WebhookManagerOptions {
  app: express.Application;
  config: AppConfig;
  logger: Logger;
  webhookConfig: WebhookConfig;
}

export class WebhookManager {
  private readonly app: express.Application;
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly webhookConfig: WebhookConfig;

  constructor(opts: WebhookManagerOptions) {
    this.app = opts.app;
    this.config = opts.config;
    this.logger = opts.logger;
    this.webhookConfig = opts.webhookConfig;
  }

  register(): void {
    const router = express.Router();

    const eventLogger = new WebhookEventLogger(this.config.DATA_DIR, this.logger.child({ component: 'webhook-event-logger' }));

    const handlers: Array<{ key: string; factory: (settings: NonNullable<WebhookConfig['webhooks'][string]>) => BaseWebhook }> = [
      {
        key: 'whoop',
        factory: (settings) =>
          new WhoopWebhook({
            logger: this.logger.child({ source: 'whoop_webhook' }),
            config: this.config,
            store: new DailyStore(this.config, this.logger.child({ component: 'daily-store', source: 'webhooks' })),
            settings,
            eventLogger,
            deduper: new WebhookDeduper(),
            debug: this.webhookConfig.debug,
          }),
      },
      {
        key: 'calendar',
        factory: (settings) =>
          new CalendarWebhook({
            logger: this.logger.child({ source: 'calendar_webhook' }),
            config: this.config,
            store: new DailyStore(this.config, this.logger.child({ component: 'daily-store', source: 'webhooks' })),
            settings,
            eventLogger,
            deduper: new WebhookDeduper(),
            debug: this.webhookConfig.debug,
          }),
      },
      {
        key: 'ios',
        factory: (settings) =>
          new IOSWebhook({
            logger: this.logger.child({ source: 'ios_webhook' }),
            config: this.config,
            store: new DailyStore(this.config, this.logger.child({ component: 'daily-store', source: 'webhooks' })),
            settings,
            eventLogger,
            deduper: new WebhookDeduper(),
            debug: this.webhookConfig.debug,
          }),
      },
    ];

    for (const { key, factory } of handlers) {
      const settings = this.webhookConfig.webhooks[key];
      if (!settings?.enabled) {
        this.logger.info({ key }, 'Webhook source disabled; skipping');
        continue;
      }
      const handler = factory(settings);
      handler.register(router);
    }

    this.app.use('/webhooks', router);
  }
}
