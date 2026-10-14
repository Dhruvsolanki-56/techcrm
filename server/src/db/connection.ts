import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Config } from '../config';

export type Db = Database.Database;
/** A database row. Column sets differ per query, so rows are loosely typed at this boundary. */
export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Opens (creating folders as needed) the single SQLite file with the production pragmas. */
export function openDatabase(config: Pick<Config, 'dataDir' | 'uploadDir' | 'backupDir'>): Db {
  for (const dir of [config.dataDir, config.uploadDir, config.backupDir]) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(config.dataDir, 'crm.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL'); // safe with WAL, much faster writes
  db.pragma('cache_size = -16000'); // ~16 MB page cache
  db.pragma('busy_timeout = 5000'); // a second process (seed, CLI) waits instead of failing
  db.pragma('foreign_keys = ON');
  return db;
}

/** Small typed query helpers so call sites stay short and every query stays parameterised. */
export function queries(db: Db) {
  return {
    one: <T = Row>(sql: string, ...params: unknown[]): T | undefined => db.prepare(sql).get(...params) as T | undefined,
    all: <T = Row>(sql: string, ...params: unknown[]): T[] => db.prepare(sql).all(...params) as T[],
    run: (sql: string, ...params: unknown[]) => db.prepare(sql).run(...params),
    /** Runs `fn` in one transaction: everything is saved, or nothing is. */
    tx: <T>(fn: () => T): T => db.transaction(fn)(),
  };
}
export type Queries = ReturnType<typeof queries>;
