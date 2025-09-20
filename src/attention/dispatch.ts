import type { Logger } from '../utils/logger.js';
import { logger as rootLogger } from '../utils/logger.js';
import type { DispatchRequest, DispatchResult } from './types.js';

export type DispatchTransport = (request: DispatchRequest) => Promise<DispatchResult>;

export interface DispatchManagerOptions {
  logger?: Logger;
  transports?: Record<string, DispatchTransport>;
}

export class DispatchManager {
  private readonly logger: Logger;
  private readonly transports: Map<string, DispatchTransport>;

  constructor(options: DispatchManagerOptions = {}) {
    this.logger = options.logger ?? rootLogger.child({ component: 'attention-dispatch' });
    this.transports = new Map(Object.entries(options.transports ?? {}));
  }

  registerTransport(channel: string, transport: DispatchTransport): void {
    this.transports.set(channel, transport);
  }

  async dispatch(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const request of requests) {
      const transport = this.transports.get(request.channel);
      if (!transport) {
        this.logger.warn({ channel: request.channel }, 'No dispatch transport registered');
        results.push({ channel: request.channel, delivered: false, error: 'transport_not_registered' });
        continue;
      }
      try {
        const result = await transport(request);
        results.push(result);
      } catch (err) {
        this.logger.error({ err, channel: request.channel }, 'Dispatch transport failed');
        results.push({ channel: request.channel, delivered: false, error: (err as Error).message });
      }
    }
    return results;
  }
}
