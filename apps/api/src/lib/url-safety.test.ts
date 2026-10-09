import { describe, expect, it } from 'vitest';
import { UpstreamClient } from '../upstream/client';
import {
  createHostGuard,
  providerUrlProblem,
  resolvedHostProblem,
  type Lookup,
} from './url-safety';

describe('providerUrlProblem', () => {
  it('accepts public https providers', () => {
    expect(providerUrlProblem('https://api.openai.com/v1', true)).toBeNull();
    expect(providerUrlProblem('https://openrouter.ai/api/v1', true)).toBeNull();
  });

  it('allows local http providers outside production', () => {
    expect(providerUrlProblem('http://localhost:11434/v1', false)).toBeNull();
  });

  it.each([
    'http://api.openai.com/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://10.0.0.5/v1',
    'https://172.16.0.1/v1',
    'https://192.168.1.10/v1',
    'https://169.254.169.254/latest',
    'https://[::1]/v1',
    'https://[fd00::1]/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'https://metadata.google.internal/v1',
  ])('rejects %s in production', (url) => {
    expect(providerUrlProblem(url, true)).not.toBeNull();
  });

  it.each([
    'ftp://example.com',
    'https://user:pass@example.com/v1',
    'https://example.com/v1?x=1',
    'not a url',
  ])('always rejects %s', (url) => {
    expect(providerUrlProblem(url, false)).not.toBeNull();
  });
});

describe('resolved host checks', () => {
  const resolvesTo =
    (...addresses: string[]): Lookup =>
    async () =>
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('rejects public-looking names that resolve to private or metadata addresses', async () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '192.168.0.9',
      '::1',
      'fd00::1',
    ]) {
      expect(await resolvedHostProblem('https://api.example.com/v1', resolvesTo(ip))).toBe(
        'Must resolve only to public addresses.',
      );
    }
  });

  it('rejects a host if any one of its addresses is private', async () => {
    expect(
      await resolvedHostProblem(
        'https://api.example.com/v1',
        resolvesTo('93.184.216.34', '10.0.0.5'),
      ),
    ).not.toBeNull();
  });

  it('accepts hosts resolving only to public addresses, and reports lookup failures', async () => {
    expect(
      await resolvedHostProblem('https://api.example.com/v1', resolvesTo('93.184.216.34')),
    ).toBeNull();
    const failing: Lookup = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await resolvedHostProblem('https://nope.example/v1', failing)).toBe(
      'The host could not be resolved.',
    );
    expect(await resolvedHostProblem('https://[::1]/v1', resolvesTo())).toBe(
      'Must be a public host.',
    );
  });

  it('caches results per host for the guard', async () => {
    let lookups = 0;
    const counting: Lookup = async () => {
      lookups++;
      return [{ address: '93.184.216.34', family: 4 }];
    };
    const guard = createHostGuard(counting, 60_000);
    await guard('https://api.example.com/v1');
    await guard('https://api.example.com/v1/other');
    expect(lookups).toBe(1);
  });

  it('stops an upstream call to a host that resolves privately', async () => {
    let fetched = false;
    const client = new UpstreamClient({
      timeoutMs: 1000,
      maxRetries: 0,
      fetch: async () => {
        fetched = true;
        return new Response('{}');
      },
      hostGuard: createHostGuard(resolvesTo('10.0.0.1')),
    });
    await expect(
      client.postBuffered({
        baseUrl: 'https://rebind.example/v1',
        path: '/x',
        body: '{}',
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_base_url' });
    expect(fetched).toBe(false);
  });
});
