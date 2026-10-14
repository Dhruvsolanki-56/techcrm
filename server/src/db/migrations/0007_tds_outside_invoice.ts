import { today } from '@crm/shared';
import type { Migration } from '../migrate';

/** An invoice is for what the client really pays: TDS they deduct is tracked apart, so it no longer counts as "paid" on the invoice. */
export const tdsOutsideInvoice: Migration = {
  id: '0007',
  name: 'TDS no longer counts towards invoice payment',
  up(db) {
    const t = today();
    const invoices = db.prepare("SELECT id, status, total, due_date FROM invoices WHERE status NOT IN ('draft','cancelled')").all() as { id: number; status: string; total: number; due_date: string | null }[];
    const paidOf = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id=?');
    const set = db.prepare('UPDATE invoices SET paid_amount=?, status=? WHERE id=?');
    for (const i of invoices) {
      const paid = Math.round(((paidOf.get(i.id) as { s: number }).s + Number.EPSILON) * 100) / 100;
      let status = i.total > 0 && paid >= i.total - 0.005 ? 'paid' : paid > 0 ? 'partial' : 'sent';
      if (status !== 'paid' && i.due_date && i.due_date < t) status = 'overdue';
      set.run(paid, status, i.id);
    }
    db.prepare("UPDATE invoices SET paid_amount=(SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id=invoices.id) WHERE status IN ('draft','cancelled')").run();
  },
};
