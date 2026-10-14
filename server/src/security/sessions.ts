import crypto from 'node:crypto';
import type { Db } from '../db/connection';
import type { User } from './permissions';

const sha = (t: string): string => crypto.createHash('sha256').update(t).digest('hex');

export interface SessionStore {
  create(userId: number, ip: string | undefined, userAgent: string | undefined): string;
  destroy(token: string | undefined): void;
  destroyForUser(userId: number, exceptToken?: string): void;
  userFor(token: string | undefined): User | null;
  purgeExpired(): void;
}

/** Tokens are 256-bit random values; only their SHA-256 hash is stored, so a leaked database cannot be used to sign in. */
export function createSessionStore(db: Db, sessionMs: number): SessionStore {
  return {
    create(userId, ip, userAgent) {
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,ip,ua) VALUES(?,?,?,?,?)')
        .run(sha(token), userId, Date.now() + sessionMs, ip ?? null, String(userAgent ?? '').slice(0, 200));
      return token;
    },
    destroy(token) {
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));
    },
    destroyForUser(userId, exceptToken) {
      if (exceptToken) db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(userId, sha(exceptToken));
      else db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    },
    userFor(token) {
      if (!token) return null;
      const row = db.prepare('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(sha(token)) as (User & { expires_at: number }) | undefined;
      if (!row || row.expires_at < Date.now() || !row.active) return null;
      return row;
    },
    purgeExpired() {
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    },
  };
}
