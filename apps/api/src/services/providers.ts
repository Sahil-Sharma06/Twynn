import { eq } from 'drizzle-orm';
import type { ProviderInput, ProviderView } from '@twynn/shared';
import type { Database } from '../db/client';
import { providers } from '../db/schema';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { GatewayError } from '../lib/errors';

const HINT_LENGTH = 4;

export interface ProviderCredentials {
  baseUrl: string;
  apiKey: string;
}

function hint(apiKey: string): string {
  return apiKey.length > HINT_LENGTH * 2 ? `…${apiKey.slice(-HINT_LENGTH)}` : '…';
}

const normaliseBaseUrl = (url: string) => url.replace(/\/+$/, '');

export class ProviderStore {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: Buffer,
  ) {}

  async get(workspaceId: string): Promise<ProviderView | null> {
    const [row] = await this.db
      .select({
        baseUrl: providers.baseUrl,
        apiKeyHint: providers.apiKeyHint,
        updatedAt: providers.updatedAt,
      })
      .from(providers)
      .where(eq(providers.workspaceId, workspaceId));
    return row ? { ...row, updatedAt: row.updatedAt.toISOString() } : null;
  }

  /** Creates or updates the workspace's provider. A new provider requires an API key. */
  async upsert(workspaceId: string, input: ProviderInput): Promise<ProviderView> {
    const baseUrl = normaliseBaseUrl(input.baseUrl);
    const secret = input.apiKey && {
      apiKeyEncrypted: encryptSecret(this.encryptionKey, input.apiKey, workspaceId),
      apiKeyHint: hint(input.apiKey),
    };

    if (!secret) {
      const [row] = await this.db
        .update(providers)
        .set({ baseUrl, updatedAt: new Date() })
        .where(eq(providers.workspaceId, workspaceId))
        .returning({ workspaceId: providers.workspaceId });
      if (!row) {
        throw new GatewayError(
          400,
          'invalid_request_error',
          'An API key is required when connecting a provider for the first time.',
          'api_key_required',
          'apiKey',
        );
      }
    } else {
      await this.db
        .insert(providers)
        .values({ workspaceId, baseUrl, ...secret })
        .onConflictDoUpdate({
          target: providers.workspaceId,
          set: { baseUrl, ...secret, updatedAt: new Date() },
        });
    }
    const view = await this.get(workspaceId);
    if (!view) throw new Error('provider missing after upsert');
    return view;
  }

  async remove(workspaceId: string): Promise<boolean> {
    const rows = await this.db
      .delete(providers)
      .where(eq(providers.workspaceId, workspaceId))
      .returning({ workspaceId: providers.workspaceId });
    return rows.length > 0;
  }

  /** Decrypted credentials for proxying. Never expose the result through the dashboard API. */
  async credentials(workspaceId: string): Promise<ProviderCredentials | null> {
    const [row] = await this.db
      .select({ baseUrl: providers.baseUrl, apiKeyEncrypted: providers.apiKeyEncrypted })
      .from(providers)
      .where(eq(providers.workspaceId, workspaceId));
    if (!row) return null;
    return {
      baseUrl: row.baseUrl,
      apiKey: decryptSecret(this.encryptionKey, row.apiKeyEncrypted, workspaceId),
    };
  }
}
