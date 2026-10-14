import type { Migration } from '../migrate';

/** TDS the client deducted is a tax credit, not cash: track it from "deducted" to "certificate received" to "claimed in the ITR". */
export const tds: Migration = {
  id: '0006',
  name: 'TDS tracking on payments',
  up(db) {
    const has = (c: string): boolean => (db.prepare('PRAGMA table_info(payments)').all() as { name: string }[]).some((x) => x.name === c);
    if (!has('tds_status')) db.exec("ALTER TABLE payments ADD COLUMN tds_status TEXT NOT NULL DEFAULT 'deducted'");
    if (!has('tds_section')) db.exec('ALTER TABLE payments ADD COLUMN tds_section TEXT');
    if (!has('tds_claimed_on')) db.exec('ALTER TABLE payments ADD COLUMN tds_claimed_on TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_payments_tds ON payments(tds_status) WHERE tds > 0');
  },
};
