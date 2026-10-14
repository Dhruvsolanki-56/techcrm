import type { Logger } from 'pino';
import type { Db } from './connection';
import { MIGRATIONS } from './migrations';

export interface Migration {
  /** Strictly increasing, e.g. "0003". Never change or reuse one that has shipped. */
  id: string;
  name: string;
  up: (db: Db) => void;
}

/**
 * Applies every migration that has not run yet, each in its own transaction, in order.
 * Safe on a database created by the earlier version of the app: the baseline only creates what is missing.
 */
export function migrate(db: Db, log?: Pick<Logger, 'info' | 'warn'>): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const done = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    // table rebuilds in a migration need foreign keys off; the flag cannot change inside a transaction
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        m.up(db);
        db.prepare('INSERT INTO schema_migrations(id,name) VALUES(?,?)').run(m.id, m.name);
      })();
      const bad = db.pragma('foreign_key_check') as unknown[];
      if (bad.length) log?.warn({ migration: m.id, broken: bad.length }, 'database has records pointing at things that no longer exist');
    } finally {
      db.pragma('foreign_keys = ON');
    }
    applied.push(m.id);
    log?.info({ migration: m.id, name: m.name }, 'migration applied');
  }
  return applied;
}
