import type { Migration } from '../migrate';

/**
 * This company never charges GST: every invoice and quotation is for exactly its lines less the discount, and the GSTIN / tax settings are gone.
 * TDS can differ per payment, so a payment of the schedule may carry its own TDS % (empty = the project's).
 */
export const noGst: Migration = {
  id: '0009',
  name: 'remove GST; per-payment TDS %',
  up(db) {
    const has = (t: string, c: string): boolean => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((x) => x.name === c);
    if (!has('milestones', 'tds_percent')) db.exec('ALTER TABLE milestones ADD COLUMN tds_percent REAL');
    for (const t of ['invoices', 'quotes']) {
      db.exec(`UPDATE ${t} SET tax_type='none', tax_rate=0, tax_amount=0, total=ROUND(subtotal-discount,2)`);
    }
    db.exec("UPDATE expenses SET tax_amount=0");
    db.exec("DELETE FROM settings WHERE key IN ('gstin','default_tax_type','default_tax_rate')");
    db.exec("UPDATE clients SET gstin=NULL");
    // an invoice that was "paid" against a GST-inclusive total is re-checked against the smaller total
    db.exec(`UPDATE invoices SET status='paid' WHERE status IN ('sent','partial','overdue') AND total>0 AND paid_amount >= total - 0.005`);
  },
};
