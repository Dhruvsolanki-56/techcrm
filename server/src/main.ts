import { createApp } from './app';
import { loadConfig } from './config';
import { createContext } from './core/context';
import { startJobs } from './jobs/scheduler';
import { createLogger } from './logger';

function main(): void {
  const config = loadConfig();
  const log = createLogger(config);
  const ctx = createContext(config, log);
  const { app } = createApp(ctx);
  const stopJobs = config.jobs ? startJobs(ctx) : () => undefined;

  const server = app.listen(config.port, config.host, () => {
    log.info({ port: config.port, env: config.env, data: config.dataDir }, 'TechSentinals CRM is running');
  });

  // graceful shutdown: stop taking requests, finish the ones in flight, close the database cleanly
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    log.info({ signal }, 'shutting down');
    stopJobs();
    server.close(() => {
      ctx.db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));
}

main();
