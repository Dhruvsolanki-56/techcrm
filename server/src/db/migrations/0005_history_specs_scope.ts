import type { Migration } from '../migrate';

/**
 * Field-level change history for every record, a specification on leads (carried to the project on conversion),
 * and who a recurring cost belongs to (company → debited automatically, person → tracked only) with a one-off amount for the next cycle.
 */
export const historySpecsScope: Migration = {
  id: '0005',
  name: 'change history, lead specification, subscription owner and next-cycle amount',
  up(db) {
    const has = (t: string, c: string): boolean => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((x) => x.name === c);
    db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY,
        entity TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        action TEXT NOT NULL,                 -- create | update | delete
        user_id INTEGER, user_name TEXT,
        changes TEXT,                         -- JSON: [{field, from, to}]
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_history_entity ON history(entity, entity_id, id);
    `);
    if (!has('leads', 'specs')) db.exec('ALTER TABLE leads ADD COLUMN specs TEXT');
    if (!has('renewals', 'scope')) db.exec("ALTER TABLE renewals ADD COLUMN scope TEXT NOT NULL DEFAULT 'company'");
    if (!has('renewals', 'next_amount')) db.exec('ALTER TABLE renewals ADD COLUMN next_amount REAL');
  },
};
