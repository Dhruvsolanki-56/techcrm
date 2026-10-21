import type { Migration } from '../migrate';

/**
 * Tranche rules: a project can say how much TDS its client deducts (the same ratio then applies to every payment, change requests included)
 * and whether the advance must be paid before work starts. An invoice remembers the TDS it expects so the payment can follow the same ratio.
 */
export const trancheRules: Migration = {
  id: '0008',
  name: 'project TDS ratio, advance-before-work rule, expected TDS on invoices',
  up(db) {
    const has = (t: string, c: string): boolean => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((x) => x.name === c);
    if (!has('projects', 'tds_percent')) db.exec('ALTER TABLE projects ADD COLUMN tds_percent REAL NOT NULL DEFAULT 0');
    if (!has('projects', 'advance_required')) db.exec('ALTER TABLE projects ADD COLUMN advance_required INTEGER NOT NULL DEFAULT 1');
    if (!has('invoices', 'expected_tds')) db.exec('ALTER TABLE invoices ADD COLUMN expected_tds REAL NOT NULL DEFAULT 0');
  },
};
