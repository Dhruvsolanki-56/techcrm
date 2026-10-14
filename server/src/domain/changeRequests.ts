import { today } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';

/** The change request, if any, a quote was written for. */
export function changeRequestOfQuote(ctx: AppContext, quote: Row): Row | undefined {
  if (!quote.change_request_id) return undefined;
  return ctx.db.prepare('SELECT * FROM change_requests WHERE id=?').get(quote.change_request_id) as Row | undefined;
}

function note(ctx: AppContext, cr: Row, userId: number | null, text: string): void {
  ctx.db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES('change_request',?,?,'system',?)").run(cr.id, userId, text);
  ctx.db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES('project',?,?,'system',?)").run(cr.project_id, userId, `CR-${String(cr.id).padStart(4, '0')} — ${text}`);
}

/**
 * A quote written for a change request moves the request along:
 * accepted → the request is approved; rejected or expired → it goes back to "estimated" so it can be quoted again.
 */
export function syncChangeRequestWithQuote(ctx: AppContext, quote: Row, previousStatus: string | null, userId: number | null): void {
  const cr = changeRequestOfQuote(ctx, quote);
  if (!cr || previousStatus === quote.status) return;
  if (quote.status === 'accepted' && ['requested', 'estimated', 'quoted'].includes(cr.status)) {
    ctx.db.prepare("UPDATE change_requests SET status='approved', approved_on=COALESCE(approved_on, ?), estimate_amount=CASE WHEN estimate_amount>0 THEN estimate_amount ELSE ? END, updated_at=datetime('now') WHERE id=?")
      .run(today(), quote.subtotal - quote.discount, cr.id);
    note(ctx, cr, userId, `Quote ${quote.number} accepted — change request approved`);
  } else if (['rejected', 'expired'].includes(quote.status) && cr.status === 'quoted') {
    ctx.db.prepare("UPDATE change_requests SET status='estimated', updated_at=datetime('now') WHERE id=?").run(cr.id);
    note(ctx, cr, userId, `Quote ${quote.number} ${quote.status} — back to estimated`);
  }
}

/** When an invoice is raised for a change request (directly or from its quote), link it and record the step. */
export function linkInvoiceToChangeRequest(ctx: AppContext, invoice: Row, userId: number | null): void {
  if (!invoice.change_request_id) return;
  const cr = ctx.db.prepare('SELECT * FROM change_requests WHERE id=?').get(invoice.change_request_id) as Row | undefined;
  if (!cr || cr.invoice_id === invoice.id) return;
  ctx.db.prepare("UPDATE change_requests SET invoice_id=?, updated_at=datetime('now') WHERE id=?").run(invoice.id, cr.id);
  note(ctx, cr, userId, `Invoice ${invoice.number} raised`);
}
