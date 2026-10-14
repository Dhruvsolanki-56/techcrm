import type { Config } from '../config';
import type { Logger } from '../logger';
import { openDatabase, queries, type Db, type Queries } from '../db/connection';
import { migrate } from '../db/migrate';
import { createSettings, type SettingsService } from './settings';
import { createVault, type Vault } from '../security/vault';
import { createSessionStore, type SessionStore } from '../security/sessions';
import { createLoginLimiter, type LoginLimiter } from '../security/loginLimiter';
import type { User } from '../security/permissions';

/** Everything a route or job may need, created once at start and passed in (no hidden globals — easy to test). */
export interface AppContext {
  config: Config;
  log: Logger;
  db: Db;
  q: Queries;
  settings: SettingsService;
  vault: Vault;
  sessions: SessionStore;
  limiter: LoginLimiter;
  /** Writes one line to the activity log. `user` may be null for system actions. */
  audit(user: Pick<User, 'id' | 'name'> | null, action: string, entity?: string | null, entityId?: number | null, detail?: string | null, ip?: string | null): void;
  /** Adds an in-app notification for one person. */
  notify(userId: number | null | undefined, text: string, link?: string | null): void;
}

export function createContext(config: Config, log: Logger): AppContext {
  const db = openDatabase(config);
  migrate(db, log);
  const q = queries(db);
  const insertAudit = db.prepare('INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,detail,ip) VALUES(?,?,?,?,?,?,?)');
  const insertNote = db.prepare('INSERT INTO notifications(user_id,text,link) VALUES(?,?,?)');
  return {
    config, log, db, q,
    settings: createSettings(db),
    vault: createVault(config),
    sessions: createSessionStore(db, config.sessionMs),
    limiter: createLoginLimiter(),
    audit: (user, action, entity, entityId, detail, ip) => {
      insertAudit.run(user?.id ?? null, user?.name ?? null, action, entity ?? null, entityId ?? null, detail ?? null, ip ?? null);
    },
    notify: (userId, text, link) => {
      if (userId) insertNote.run(userId, text, link ?? null);
    },
  };
}
