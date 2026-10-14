import pino, { type Logger } from 'pino';
import type { Config } from './config';

/** Structured JSON logs in production (one line per event, easy to ship anywhere); readable output while developing. */
export function createLogger(config: Pick<Config, 'env' | 'logLevel'>): Logger {
  const redact = {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', 'password', '*.password', 'secret', '*.secret', 'current', 'next', 'code'],
    censor: '[hidden]',
  };
  if (config.env === 'development') {
    return pino({ level: config.logLevel, redact, transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } });
  }
  return pino({ level: config.logLevel, redact });
}

export type { Logger };
