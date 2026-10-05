import { pino, type Logger } from 'pino';
import { PRODUCT_SLUG } from '@twynn/shared';
import type { Config } from '../config';

export function createLogger(config: Pick<Config, 'NODE_ENV' | 'TWYNN_LOG_LEVEL'>): Logger {
  return pino({
    name: PRODUCT_SLUG,
    level: config.NODE_ENV === 'test' ? 'silent' : config.TWYNN_LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.apiKey',
        '*.password',
        '*.token',
        '*.secret',
      ],
      censor: '[redacted]',
    },
    ...(config.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } },
    }),
  });
}
