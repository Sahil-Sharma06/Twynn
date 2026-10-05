import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = {
  TWYNN_DB_URL: 'postgres://u:p@localhost:5432/twynn',
  TWYNN_REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfig', () => {
  it('applies defaults and coerces numbers', () => {
    const config = loadConfig({ ...base, TWYNN_API_PORT: '4000' });
    expect(config.TWYNN_API_PORT).toBe(4000);
    expect(config.TWYNN_LOG_LEVEL).toBe('info');
  });

  it('rejects a missing database URL with a readable message', () => {
    expect(() => loadConfig({ TWYNN_REDIS_URL: base.TWYNN_REDIS_URL })).toThrow(/TWYNN_DB_URL/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ ...base, TWYNN_API_PORT: '70000' })).toThrow(/TWYNN_API_PORT/);
  });
});
