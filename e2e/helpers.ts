import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const GATEWAY = 'http://localhost:3000/v1/chat/completions';
export const MOCK_PROVIDER = 'http://localhost:4010/v1';
export const WEB = 'http://localhost:5173';
export const FRANCE = 'What is the capital of France?';
export const FRANCE_TWIN = 'Which city is the capital of France?';

export const uniqueEmail = () => `e2e-${randomUUID()}@example.com`;

/** Sends a chat completion through the gateway with a Twynn key, as an app would. */
export async function ask(request: APIRequestContext, key: string, content: string) {
  const res = await request.post(GATEWAY, {
    headers: { authorization: `Bearer ${key}` },
    data: { model: 'gpt-4o-mini', messages: [{ role: 'user', content }] },
  });
  expect(res.status()).toBe(200);
  return res;
}

/**
 * Signs up and onboards through the dashboard API (sharing the page's cookies), then
 * sends real traffic: a miss, an exact hit and a twin hit.
 */
export async function seedWorkspace(page: Page): Promise<{ key: string }> {
  const api = page.request;
  const headers = { origin: WEB };
  const post = async (path: string, data: unknown, method = 'POST') => {
    const res = await api.fetch(`${WEB}/api${path}`, { method, headers, data });
    expect(res.ok(), `${method} ${path}`).toBe(true);
    return res;
  };
  await post('/auth/signup', { email: uniqueEmail(), password: 'correct horse battery' });
  await post('/provider', { baseUrl: MOCK_PROVIDER, apiKey: 'sk-e2e-mock' }, 'PUT');
  const { key } = (await (await post('/keys', { name: 'e2e' })).json()) as { key: string };
  for (const prompt of [FRANCE, FRANCE, FRANCE_TWIN, 'Tell me something unrelated']) {
    await ask(api, key, prompt);
  }
  return { key };
}
