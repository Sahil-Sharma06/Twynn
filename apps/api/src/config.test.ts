import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = {
  TWYNN_DB_URL: 'postgres://u:p@localhost:5432/twynn',
  TWYNN_REDIS_URL: 'redis://localhost:6379',
  TWYNN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('loadConfig', () => {
  it('applies defaults and coerces numbers', () => {
    const config = loadConfig({ ...base, TWYNN_API_PORT: '4000' });
    expect(config.TWYNN_API_PORT).toBe(4000);
    expect(config.TWYNN_LOG_LEVEL).toBe('info');
    expect(config.TWYNN_WEB_ORIGIN).toBe('http://localhost:5173');
  });

  it('reduces the web origin to scheme, host and port', () => {
    expect(
      loadConfig({ ...base, TWYNN_WEB_ORIGIN: 'https://app.twynn.dev/' }).TWYNN_WEB_ORIGIN,
    ).toBe('https://app.twynn.dev');
  });

  it('rejects a missing database URL with a readable message', () => {
    expect(() => loadConfig({ ...base, TWYNN_DB_URL: undefined })).toThrow(/TWYNN_DB_URL/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ ...base, TWYNN_API_PORT: '70000' })).toThrow(/TWYNN_API_PORT/);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() =>
      loadConfig({ ...base, TWYNN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/TWYNN_ENCRYPTION_KEY/);
  });
});
