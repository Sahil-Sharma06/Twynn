import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { cacheEntries } from '../db/schema';
import { Browser, buildApp, createTestDb, silentLogger } from '../test/helpers';
import { EntryStore } from './entries';

let db: Database;
let workspaceId: string;
beforeAll(async () => {
  db = await createTestDb();
  const browser = new Browser(buildApp({ db }));
  await browser.call('POST', '/api/auth/signup', {
    email: `${randomUUID()}@example.com`,
    password: 'correct horse battery',
  });
  workspaceId = ((await browser.json('GET', '/api/auth/me')) as { workspace: { id: string } })
    .workspace.id;
});

async function storedEntry(store: EntryStore) {
  const exactKey = `test:${randomUUID()}`;
  await store.upsert({
    workspaceId,
    exactKey,
    model: 'gpt-4o-mini',
    prompt: 'hi',
    twin: null,
    response: '{}',
    ttlSeconds: 3600,
  });
  const [row] = await db.select().from(cacheEntries).where(eq(cacheEntries.exactKey, exactKey));
  return { exactKey, id: row!.id };
}

const hitsOf = async (id: string) =>
  (await db.select().from(cacheEntries).where(eq(cacheEntries.id, id)))[0];

describe('batched hit counts', () => {
  it('buffers hits in memory and writes them together on flush', async () => {
    const store = new EntryStore(db, silentLogger, 60_000); // no timer flush during the test
    const { exactKey, id } = await storedEntry(store);
    for (let i = 0; i < 3; i++) store.recordHit({ exactKey });
    store.recordHit({ id });
    store.recordHit({ id });
    expect((await hitsOf(id))?.hitCount).toBe(0);

    await store.flushHits();
    const row = await hitsOf(id);
    expect(row?.hitCount).toBe(5);
    expect(row?.lastHitAt).not.toBeNull();

    await store.flushHits(); // nothing pending: no change
    expect((await hitsOf(id))?.hitCount).toBe(5);
  });

  it('flushes on its own after the interval', async () => {
    const store = new EntryStore(db, silentLogger, 10);
    const { id } = await storedEntry(store);
    store.recordHit({ id });
    await expect.poll(async () => (await hitsOf(id))?.hitCount).toBe(1);
  });
});
