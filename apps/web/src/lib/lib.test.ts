// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loginSchema, signupSchema } from '@twynn/shared';
import { safeNext } from '../pages/auth/Login';
import { ApiError } from './api';
import { formatRelative, formatUsd } from './format';
import { apiErrors, validate } from './forms';
import { buildSnippets } from './snippets';

describe('buildSnippets', () => {
  const input = {
    gatewayUrl: 'https://gw.example.com/v1',
    apiKey: 'twynn_sk_abc',
    model: 'gpt-4o-mini',
  };

  it('fills in the real gateway URL, key and model in every language', () => {
    for (const code of Object.values(buildSnippets(input))) {
      expect(code).toContain('gw.example.com/v1');
      expect(code).toContain('twynn_sk_abc');
      expect(code).toContain('gpt-4o-mini');
    }
  });

  it('targets the chat completions endpoint from curl', () => {
    expect(buildSnippets(input).curl).toContain('curl https://gw.example.com/v1/chat/completions');
  });

  it('keeps shell quoting intact when values contain quotes', () => {
    const { curl } = buildSnippets({ ...input, model: "it's-a-model" });
    expect(curl).toContain(`'\\''`);
    expect(curl).not.toMatch(/-d '[^']*it's/);
  });
});

describe('safeNext', () => {
  it.each([
    ['/onboarding', '/onboarding'],
    ['/app?x=1', '/app?x=1'],
    [null, '/app'],
    ['https://evil.example', '/app'],
    ['//evil.example', '/app'],
    ['javascript:alert(1)', '/app'],
  ])('%s → %s', (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });
});

describe('validate', () => {
  it('returns parsed data when valid', () => {
    const result = validate(loginSchema, { email: ' A@B.co ', password: 'x' });
    expect(result.data).toEqual({ email: 'a@b.co', password: 'x' });
  });

  it('gives one friendly message per field', () => {
    const { errors } = validate(signupSchema, { email: 'nope', password: 'short' });
    expect(errors).toEqual({
      email: 'Enter a valid email address.',
      password: 'Use at least 10 characters.',
    });
  });
});

describe('apiErrors', () => {
  it('maps an API error to its field, or to the form', () => {
    expect(apiErrors(new ApiError(409, 'Taken', 'email_taken', 'email'))).toEqual({
      email: 'Taken',
    });
    expect(apiErrors(new ApiError(500, 'Boom'))).toEqual({ form: 'Boom' });
    expect(apiErrors(new Error('x'))).toEqual({ form: 'Something went wrong. Please try again.' });
  });
});

describe('format', () => {
  it('keeps sub-cent estimates meaningful', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0000033)).toBe('$0.0000033');
    expect(formatUsd(12.345)).toBe('$12.35');
  });

  it('describes recency in words', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(formatRelative('2026-01-01T11:59:50Z', now)).toBe('just now');
    expect(formatRelative('2026-01-01T11:55:00Z', now)).toBe('5 minutes ago');
    expect(formatRelative('2026-01-01T09:00:00Z', now)).toBe('3 hours ago');
  });
});
