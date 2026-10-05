import { describe, expect, it } from 'vitest';
import { canonicalize, exactCacheKey } from './key';

const base = {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'What is a twin prime?' }],
  temperature: 0,
};

describe('canonicalize', () => {
  it('sorts keys at every depth and keeps array order', () => {
    expect(JSON.stringify(canonicalize({ b: 1, a: [{ d: 1, c: 2 }, 3] }))).toBe(
      '{"a":[{"c":2,"d":1},3],"b":1}',
    );
  });
});

describe('exactCacheKey', () => {
  const key = (req: Record<string, unknown>, scope = 'scope-a') => exactCacheKey(scope, req);

  it('is stable regardless of key order', () => {
    const reordered = {
      temperature: 0,
      messages: [{ content: 'What is a twin prime?', role: 'user' }],
      model: 'gpt-4o-mini',
    };
    expect(key(reordered)).toBe(key(base));
  });

  it('ignores fields that do not affect output', () => {
    expect(key({ ...base, stream: true, user: 'u1', metadata: { a: 1 }, store: true })).toBe(
      key(base),
    );
  });

  it('ignores unknown fields rather than guessing', () => {
    expect(key({ ...base, some_future_param: 'x' })).toBe(key(base));
  });

  it('treats an explicit null like an omitted parameter', () => {
    expect(key({ ...base, max_tokens: null })).toBe(key(base));
  });

  it('treats a single stop string like a one-element array', () => {
    expect(key({ ...base, stop: 'END' })).toBe(key({ ...base, stop: ['END'] }));
  });

  it.each([
    ['model', { model: 'gpt-4o' }],
    ['temperature', { temperature: 0.7 }],
    ['max_tokens', { max_tokens: 10 }],
    ['seed', { seed: 42 }],
    ['tools', { tools: [{ type: 'function', function: { name: 'f' } }] }],
    ['response_format', { response_format: { type: 'json_object' } }],
    ['message content', { messages: [{ role: 'user', content: 'What is a cousin prime?' }] }],
    ['message role', { messages: [{ role: 'system', content: 'What is a twin prime?' }] }],
  ])('changes when %s changes', (_, change) => {
    expect(key({ ...base, ...change })).not.toBe(key(base));
  });

  it('changes with message order', () => {
    const a = { role: 'user', content: 'a' };
    const b = { role: 'assistant', content: 'b' };
    expect(key({ ...base, messages: [a, b] })).not.toBe(key({ ...base, messages: [b, a] }));
  });

  it('never matches across scopes', () => {
    expect(key(base, 'scope-a')).not.toBe(key(base, 'scope-b'));
  });

  it('has a versioned, namespaced format', () => {
    expect(key(base)).toMatch(/^twynn:v1:exact:scope-a:[0-9a-f]{64}$/);
  });
});
