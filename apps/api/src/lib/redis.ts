import { Redis } from 'ioredis';
import type { Logger } from 'pino';

export function createRedis(url: string, logger: Logger): Redis {
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 5_000,
    // Fail fast while disconnected so the cache degrades to a miss instead of stalling requests.
    enableOfflineQueue: false,
    commandTimeout: 1_000,
  });
  redis.on('error', (err) => logger.error({ err }, 'redis error'));
  return redis;
}
