import { describe, expect, it } from 'vitest';
import { providerUrlProblem } from './url-safety';

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
