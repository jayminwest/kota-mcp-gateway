import { loadConfig } from '../src/utils/config.js';
import { logger } from '../src/utils/logger.js';
import { AttentionConfigService, AttentionPipeline, CodexClassificationAgent, DispatchManager, SlackDispatchTransport } from '../src/attention/index.js';
import type { RawAttentionEvent } from '../src/attention/index.js';

async function main() {
  const config = loadConfig();
  const attentionConfigService = new AttentionConfigService({ dataDir: config.DATA_DIR, logger });
  const attentionConfig = await attentionConfigService.load();
  const dispatch = new DispatchManager({ logger });
  const slackTarget = attentionConfig.dispatchTargets?.slack;
  if (slackTarget?.channelId) {
    const slackTransport = new SlackDispatchTransport({
      logger,
      appConfig: config,
      attentionConfig,
    });
    dispatch.registerTransport('slack', slackTransport.send.bind(slackTransport));
  }
  const classifier = new CodexClassificationAgent({ logger, config: attentionConfig });
  const pipeline = new AttentionPipeline({
    logger,
    config: attentionConfig,
    classifier,
    dispatch,
  });

  const sampleEvent: RawAttentionEvent = {
    source: 'whoop',
    kind: 'recovery',
    payload: {
      status: 'critical',
      readiness_score: 23,
      strain: 18.9,
      sleep_need: 9.2,
      sleep_obtained: 5.4,
      notes: 'HRV crashed, strain unusually high after back-to-back workouts.',
    },
    metadata: {
      priority: 9,
      athleteState: 'exhausted',
    },
  };

  const result = await pipeline.process(sampleEvent);
  logger.info({ result }, 'Attention pipeline test run complete');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  logger.error({ err }, 'Attention pipeline test run failed');
  process.exitCode = 1;
});
