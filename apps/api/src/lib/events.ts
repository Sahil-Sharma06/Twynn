import type { RequestEvent } from '@twynn/shared';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

export type EventListener = (event: RequestEvent) => void;

/** Per-workspace live events. Delivery is best-effort: missed events are recoverable via the API. */
export interface EventBus {
  publish(workspaceId: string, event: RequestEvent): Promise<void>;
  subscribe(workspaceId: string, listener: EventListener): () => void;
}

const CHANNEL_PREFIX = 'twynn:events:';

/** Fans out to local listeners; shared by both implementations. */
class Listeners {
  private readonly byWorkspace = new Map<string, Set<EventListener>>();

  add(workspaceId: string, listener: EventListener): () => void {
    const set = this.byWorkspace.get(workspaceId) ?? new Set();
    set.add(listener);
    this.byWorkspace.set(workspaceId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.byWorkspace.delete(workspaceId);
    };
  }

  emit(workspaceId: string, event: RequestEvent, logger?: Logger): void {
    for (const listener of this.byWorkspace.get(workspaceId) ?? []) {
      try {
        listener(event);
      } catch (err) {
        logger?.warn({ err }, 'event listener failed');
      }
    }
  }
}

export class MemoryEventBus implements EventBus {
  private readonly listeners = new Listeners();

  async publish(workspaceId: string, event: RequestEvent) {
    this.listeners.emit(workspaceId, event);
  }

  subscribe(workspaceId: string, listener: EventListener) {
    return this.listeners.add(workspaceId, listener);
  }
}

/**
 * Redis pub/sub bus so events reach dashboards connected to any API instance.
 * `subscriber` must be a dedicated connection; it is put into subscriber mode.
 */
export async function createRedisEventBus(
  publisher: Redis,
  subscriber: Redis,
  logger: Logger,
): Promise<EventBus> {
  const listeners = new Listeners();
  subscriber.on('pmessage', (_pattern, channel, message) => {
    try {
      listeners.emit(channel.slice(CHANNEL_PREFIX.length), JSON.parse(message), logger);
    } catch (err) {
      logger.warn({ err }, 'malformed event message');
    }
  });
  await subscriber.psubscribe(`${CHANNEL_PREFIX}*`);

  return {
    async publish(workspaceId, event) {
      await publisher.publish(`${CHANNEL_PREFIX}${workspaceId}`, JSON.stringify(event));
    },
    subscribe: (workspaceId, listener) => listeners.add(workspaceId, listener),
  };
}
