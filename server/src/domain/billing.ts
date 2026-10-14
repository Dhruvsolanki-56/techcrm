import { computeTotals, round2, today, type LineItem } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import { HttpError } from '../shared/errors';

/** Validates quote / invoice lines (JSON string or array) and returns clean ones. */
export function normalizeItems(items: unknown): LineItem[] {
  let list: unknown = items;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) list = [];
  return (list as Record<string, unknown>[])
    .map((it) => ({ description: String(it.description ?? '').slice(0, 1000), hsn: String(it.hsn ?? '').slice(0, 20), qty: Number(it.qty) || 0, rate: Number(it.rate) || 0 }))
    .filter((it) => it.description || it.qty || it.rate)
    .map((it, i) => {
      if (!(it.qty > 0) || it.qty > 1e7) throw new HttpError(400, `Line ${i + 1}: quantity must be more than 0.`);
      if (!(it.rate >= 0) || it.rate > 1e11) throw new HttpError(400, `Line ${i + 1}: rate cannot be negative.`);
      if (!it.description.trim()) throw new HttpError(400, `Line ${i + 1}: add a description.`);
      return it;
    });
}

/** "2026-27" style financial-year label for a date, using the company's financial-year start month. */
export function fiscalYearLabel(ctx: AppContext, dateStr?: string | null): string {
  const startMonth = Number.parseInt(ctx.settings.get().fy_start_month, 10) || 4;
  const d = new Date(dateStr || today());
  let y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (startMonth === 1) return String(y);
  if (m < startMonth) y -= 1;
  return `${y}-${String(y + 1).slice(2)}`;
}

/** Next document number, e.g. INV/2026-27/0004 — restarts every financial year, never reuses a number. */
export function nextNumber(ctx: AppContext, table: 'invoices' | 'quotes', prefix: string, dateStr?: string | null): string {
  const head = `${prefix}/${fiscalYearLabel(ctx, dateStr)}/`;
  const rows = ctx.db.prepare(`SELECT number FROM ${table} WHERE number LIKE ?`).all(`${head}%`) as { number: string }[];
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.number.slice(head.length), 10);
    if (n > max) max = n;
  }
  return head + String(max + 1).padStart(4, '0');
}

/** Recomputes an invoice's paid amount and status from its payments. */
export function refreshInvoice(ctx: AppContext, id: number | null | undefined): void {
  if (!id) return;
  const inv = ctx.db.prepare('SELECT * FROM invoices WHERE id=?').get(id) as Row | undefined;
  if (!inv) return;
  const paid = (ctx.db.prepare('SELECT COALESCE(SUM(amount + COALESCE(tds,0)),0) s FROM payments WHERE invoice_id=?').get(id) as { s: number }).s;
  let status: string = inv.status;
  if (status !== 'draft' && status !== 'cancelled') {
    if (inv.total > 0 && paid >= inv.total - 0.005) status = 'paid';
    else if (paid > 0) status = 'partial';
    else status = 'sent';
    if (status !== 'paid' && inv.due_date && inv.due_date < today()) status = 'overdue';
  }
  ctx.db.prepare("UPDATE invoices SET paid_amount=?, status=?, updated_at=datetime('now') WHERE id=?").run(round2(paid), status, id);
}

/** Unpaid invoices past their due date become Overdue; sent quotes past their date become Expired. */
export function markOverdue(ctx: AppContext): void {
  const t = today();
  ctx.db.prepare("UPDATE invoices SET status='overdue' WHERE status IN ('sent','partial') AND due_date IS NOT NULL AND due_date < ?").run(t);
  ctx.db.prepare("UPDATE quotes SET status='expired' WHERE status='sent' AND valid_until IS NOT NULL AND valid_until < ?").run(t);
}

/** Before-hook shared by quotes and invoices: defaults, number, line items and totals. */
export function documentBefore(ctx: AppContext, table: 'invoices' | 'quotes', prefixKey: 'invoice_prefix' | 'quote_prefix', termsKey: 'terms_invoice' | 'terms_quote') {
  return (op: 'create' | 'update' | 'delete', d: Row, ex: Row | null, actor: { user: { id: number } }): void => {
    if (op === 'delete') return;
    const s = ctx.settings.get();
    if (op === 'create') {
      d.created_by = actor.user.id;
      d.issue_date ||= today();
      if (d.tax_rate === undefined || d.tax_rate === null) d.tax_rate = Number(s.default_tax_rate) || 0;
      // a company with no GSTIN is not charging GST
      d.tax_type ||= s.gstin ? s.default_tax_type : 'none';
      d.currency ||= s.currency;
      d.terms ||= s[termsKey];
      if (table === 'invoices' && !d.due_date) {
        const x = new Date(d.issue_date);
        x.setDate(x.getDate() + 15);
        d.due_date = x.toISOString().slice(0, 10);
      }
      if (table === 'quotes' && !d.valid_until) {
        const x = new Date(d.issue_date);
        x.setDate(x.getDate() + 30);
        d.valid_until = x.toISOString().slice(0, 10);
      }
    }
    if (!d.number && (op === 'create' || (ex && !ex.number))) {
      const pfx = table === 'invoices' && (d.kind || ex?.kind) === 'proforma' ? 'PI' : s[prefixKey];
      d.number = nextNumber(ctx, table, pfx, d.issue_date || ex?.issue_date);
    }
    if (d.items !== undefined || d.discount !== undefined || d.tax_rate !== undefined || d.tax_type !== undefined || op === 'create') {
      const items = normalizeItems(d.items !== undefined ? JSON.parse(d.items) : ex ? ex.items : []);
      const discount = d.discount !== undefined ? d.discount : ex ? ex.discount : 0;
      const taxRate = d.tax_rate !== undefined ? d.tax_rate : ex ? ex.tax_rate : 0;
      const taxType = d.tax_type !== undefined ? d.tax_type : ex ? ex.tax_type : 'none';
      d.items = JSON.stringify(items);
      Object.assign(d, computeTotals(items, discount, taxRate, taxType));
    }
  };
}
