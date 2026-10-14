import { loadConfig } from '../config';
import { openDatabase } from '../db/connection';
import { migrate } from '../db/migrate';
import { createLogger } from '../logger';

/** Applies pending database migrations without starting the server (also run automatically at start). */
const config = loadConfig();
const log = createLogger({ ...config, logLevel: 'info', env: 'production' });
const db = openDatabase(config);
const applied = migrate(db, log);
log.info({ applied }, applied.length ? 'migrations applied' : 'database is up to date');
db.close();
