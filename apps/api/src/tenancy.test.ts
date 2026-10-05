import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from './db/client';
import { providers } from './db/schema';
import { eq } from 'drizzle-orm';
import {
  Browser,
  buildApp,
  completion,
  createTestDb,
  fakeFetch,
  gatewayPost,
  json,
  MemoryCache,
} from './test/helpers';

/**
 * Tenant isolation. Two workspaces share one gateway, one cache and one
 * database; nothing one does may be visible to, or served to, the other.
 */
let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});

const body = { model: 'gpt-test', messages: [{ role: 'user', content: 'Same question' }] };

async function twoTenants() {
  const cache = new MemoryCache();
  const f = fakeFetch((call) => {
    const auth = (call.init.headers as Record<string, string>).authorization;
    return json(completion(`answer for ${auth}`));
  });
  const app = buildApp({ db, cache, fetch: f.impl });
  const alice = new Browser(app);
  const bob = new Browser(app);
  const a = await alice.onboard(`alice-${randomUUID()}@example.com`, 'sk-alice-provider');
  const b = await bob.onboard(`bob-${randomUUID()}@example.com`, 'sk-bob-provider');
  return { app, cache, f, alice, bob, a, b };
}

describe('tenant isolation', () => {
  it('never serves one tenant a response cached for another', async () => {
    const { app, cache, f, a, b } = await twoTenants();

    const aliceRes = await gatewayPost(app, a.gatewayKey, body);
    const bobRes = await gatewayPost(app, b.gatewayKey, body);

    expect(aliceRes.headers.get('x-twynn-cache')).toBe('MISS');
    expect(bobRes.headers.get('x-twynn-cache')).toBe('MISS');
    expect(f.calls).toHaveLength(2);
    expect(cache.store.size).toBe(2);

    const aliceText = JSON.stringify(await aliceRes.json());
    const bobText = JSON.stringify(await bobRes.json());
    expect(aliceText).toContain('sk-alice-provider');
    expect(bobText).toContain('sk-bob-provider');
    expect(bobText).not.toContain('sk-alice-provider');

    // Each tenant's repeat request hits only its own entry.
    const aliceAgain = await gatewayPost(app, a.gatewayKey, body);
    expect(aliceAgain.headers.get('x-twynn-cache')).toBe('HIT');
    expect(JSON.stringify(await aliceAgain.json())).toBe(aliceText);
  });

  it('routes each tenant to its own provider credentials', async () => {
    const { app, f, a, b } = await twoTenants();
    await gatewayPost(app, a.gatewayKey, body);
    await gatewayPost(app, b.gatewayKey, { ...body, temperature: 0.5 });
    const auths = f.calls.map((c) => (c.init.headers as Record<string, string>).authorization);
    expect(auths).toEqual(['Bearer sk-alice-provider', 'Bearer sk-bob-provider']);
  });

  it('keeps each tenant’s keys invisible to the other', async () => {
    const { alice, bob, a } = await twoTenants();
    const bobKeys = await bob.json('GET', '/api/keys');
    expect(bobKeys.keys.map((k: { id: string }) => k.id)).not.toContain(a.keyId);
    const aliceKeys = await alice.json('GET', '/api/keys');
    expect(aliceKeys.keys).toHaveLength(1);
  });

  it('does not let one tenant revoke another’s key', async () => {
    const { app, bob, a } = await twoTenants();
    expect((await bob.call('DELETE', `/api/keys/${a.keyId}`)).status).toBe(404);
    expect((await gatewayPost(app, a.gatewayKey, body)).status).toBe(200);
  });

  it('keeps provider settings per tenant', async () => {
    const { alice, bob } = await twoTenants();
    await bob.call('PUT', '/api/provider', { baseUrl: 'https://bob.example.com/v1' });
    const aliceProvider = await alice.json('GET', '/api/provider');
    expect(aliceProvider.provider.baseUrl).not.toBe('https://bob.example.com/v1');
    await bob.call('DELETE', '/api/provider');
    expect((await alice.json('GET', '/api/provider')).provider).not.toBeNull();
  });

  it('cannot decrypt a provider key copied into another tenant’s row', async () => {
    const { app, alice, bob, b } = await twoTenants();
    const aliceWs = (await alice.json('GET', '/api/auth/me')).workspace.id;
    const bobWs = (await bob.json('GET', '/api/auth/me')).workspace.id;
    const [aliceRow] = await db.select().from(providers).where(eq(providers.workspaceId, aliceWs));
    await db
      .update(providers)
      .set({ apiKeyEncrypted: aliceRow?.apiKeyEncrypted ?? '' })
      .where(eq(providers.workspaceId, bobWs));

    // Bob's gateway call fails closed instead of using Alice's key.
    const res = await gatewayPost(app, b.gatewayKey, body);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('sk-alice-provider');
  });
});
