import type { Logger } from 'pino';
import type { Database } from '../db/client';
import { findActiveKey, touchKeyLastUsed } from './keys';
import type { ProviderCredentials, ProviderStore } from './providers';

export interface Tenant {
  workspaceId: string;
  keyId: string;
  provider: ProviderCredentials | null;
}

/** Maps a raw gateway key to its tenant, or null when the key is unknown or revoked. */
export type TenantResolver = (rawKey: string) => Promise<Tenant | null>;

export function createTenantResolver(
  db: Database,
  providers: ProviderStore,
  logger: Logger,
): TenantResolver {
  return async (rawKey) => {
    const key = await findActiveKey(db, rawKey);
    if (!key) return null;
    // Bookkeeping only; never delay or fail the request for it.
    touchKeyLastUsed(db, key.id).catch((err) =>
      logger.warn({ err, keyId: key.id }, 'failed to update key last_used_at'),
    );
    return {
      workspaceId: key.workspaceId,
      keyId: key.id,
      provider: await providers.credentials(key.workspaceId),
    };
  };
}
