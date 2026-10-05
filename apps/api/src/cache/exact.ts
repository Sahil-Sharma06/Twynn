import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

export interface ExactCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** Redis-backed exact cache. Failures degrade to a miss so the cache never breaks the gateway. */
export function createRedisExactCache(redis: Redis, logger: Logger): ExactCache {
  return {
    async get(key) {
      try {
        return await redis.get(key);
      } catch (err) {
        logger.warn({ err }, 'exact cache read failed; treating as miss');
        return null;
      }
    },
    async set(key, value, ttlSeconds) {
      try {
        await redis.set(key, value, 'EX', ttlSeconds);
      } catch (err) {
        logger.warn({ err }, 'exact cache write failed');
      }
    },
  };
}
