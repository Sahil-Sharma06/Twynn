import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { GatewayError } from './errors';

/** Counts events per key within a window. Returns the count including this one. */
export interface Counter {
  hit(key: string, windowSeconds: number): Promise<number>;
}

/**
 * Redis fixed-window counter. Fails open (reports 0) when Redis is unavailable: limits
 * protect the service, and taking the gateway down with Redis would defeat the purpose.
 */
export function createRedisCounter(redis: Redis, logger: Logger): Counter {
  return {
    async hit(key, windowSeconds) {
      try {
        const results = await redis
          .multi()
          .incr(key)
          .expire(key, windowSeconds + 1, 'NX')
          .exec();
        const count = results?.[0]?.[1];
        return typeof count === 'number' ? count : 0;
      } catch (err) {
        logger.warn({ err }, 'rate limit counter unavailable; allowing request');
        return 0;
      }
    },
  };
}

/** In-process counter for tests and single-instance development. */
export class MemoryCounter implements Counter {
  private readonly counts = new Map<string, number>();
  async hit(key: string): Promise<number> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count;
  }
}

export interface Limit {
  /** Short name used in the counter key, e.g. "key-minute". */
  name: string;
  /** Allowed events per window; 0 disables the limit. */
  max: number;
  windowSeconds: number;
}

export interface LimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window ends. */
  resetSeconds: number;
}

export class RateLimiter {
  constructor(
    private readonly counter: Counter,
    private readonly now: () => number = Date.now,
  ) {}

  async check(limit: Limit, id: string): Promise<LimitResult> {
    const nowSeconds = this.now() / 1000;
    const window = Math.floor(nowSeconds / limit.windowSeconds);
    const resetSeconds = Math.max(1, Math.ceil((window + 1) * limit.windowSeconds - nowSeconds));
    if (limit.max <= 0) return { allowed: true, limit: 0, remaining: 0, resetSeconds };
    const count = await this.counter.hit(
      `twynn:rl:${limit.name}:${id}:${window}`,
      limit.windowSeconds,
    );
    return {
      allowed: count <= limit.max,
      limit: limit.max,
      remaining: Math.max(0, limit.max - count),
      resetSeconds,
    };
  }

  /** Checks a limit and throws a 429 in the OpenAI error shape when it is exceeded. */
  async enforce(limit: Limit, id: string, message: string): Promise<LimitResult> {
    const result = await this.check(limit, id);
    if (!result.allowed) {
      throw new GatewayError(429, 'rate_limit_error', message, 'rate_limit_exceeded', null, {
        'retry-after': String(result.resetSeconds),
        ...rateLimitHeaders(result),
      });
    }
    return result;
  }
}

export function rateLimitHeaders(result: LimitResult): Record<string, string> {
  if (result.limit === 0) return {};
  return {
    'x-ratelimit-limit': String(result.limit),
    'x-ratelimit-remaining': String(result.remaining),
    'x-ratelimit-reset': String(result.resetSeconds),
  };
}

/**
 * The caller's IP. X-Forwarded-For is only trusted behind a known reverse proxy, since
 * anyone can send it; otherwise the socket address is used.
 */
export async function clientIp(c: Context, trustProxy: boolean): Promise<string> {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    const { getConnInfo } = await import('@hono/node-server/conninfo');
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // not running on a Node socket (e.g. in-process tests)
  }
}

/** Limits applied to gateway traffic and to sign-in, from configuration. */
export interface Guard {
  limiter: RateLimiter;
  /** Requests per minute per gateway key; 0 disables. */
  keyPerMinute: number;
  /** Playground requests per minute per workspace; 0 disables. */
  playgroundPerMinute: number;
  /** Gateway and playground requests per workspace per UTC day; 0 disables. */
  dailyQuota: number;
  trustProxy: boolean;
  auth: AuthLimits;
}

export interface AuthLimits {
  loginPerEmail: Limit;
  loginPerIp: Limit;
  signupPerIp: Limit;
}

/** Brute-force protection for sign-in. Fixed, deliberately conservative values. */
export const AUTH_LIMITS = {
  loginPerEmail: { name: 'login-email', max: 10, windowSeconds: 15 * 60 },
  loginPerIp: { name: 'login-ip', max: 50, windowSeconds: 15 * 60 },
  signupPerIp: { name: 'signup-ip', max: 10, windowSeconds: 60 * 60 },
} as const satisfies AuthLimits;
