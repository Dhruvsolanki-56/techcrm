import type { AppContext } from '../core/context';

/**
 * The one definition of "how much do we still need to get" for a project, used by every screen so they always agree.
 *
 *   value      = agreed value + approved payable change requests
 *   tds        = what the client deducted as TDS (a tax credit we claim in the ITR — never collected from the client)
 *   invoiced   = invoices sent + money received with no invoice
 *   pending    = invoiced and not paid yet (as on the invoice)
 *   to_invoice = value − tds − invoiced   (not yet invoiced)
 *   to_get     = pending + to_invoice     (the money still to come in; when it arrives the project is settled)
 */
const LIVE = "i.kind='invoice' AND i.status NOT IN ('draft','cancelled')";

export const CR_VALUE_SQL = "SELECT COALESCE(SUM(cr.estimate_amount),0) FROM change_requests cr WHERE cr.project_id=p.id AND cr.billable=1 AND cr.status IN ('approved','in_progress','delivered')";

/** The advance of a project's payment schedule, and whether it has been paid ('none' when there is no advance in the schedule). */
export const ADVANCE_SQL = "(SELECT COALESCE(SUM(m.amount),0) FROM milestones m WHERE m.project_id=p.id AND m.kind='advance')";
export const ADVANCE_STATE_SQL = `(CASE WHEN NOT EXISTS (SELECT 1 FROM milestones m WHERE m.project_id=p.id AND m.kind='advance') THEN 'none'
  WHEN EXISTS (SELECT 1 FROM milestones m JOIN invoices i ON i.id=m.invoice_id WHERE m.project_id=p.id AND m.kind='advance' AND i.status='paid') THEN 'paid' ELSE 'unpaid' END)`;

export const PM_SQL = {
  value: `(COALESCE(p.budget,0) + (${CR_VALUE_SQL}))`,
  tds: '(SELECT COALESCE(SUM(x.tds),0) FROM payments x WHERE x.project_id=p.id)',
  /** TDS to leave out of what we can still collect: what was deducted, or what the TDS rates (per payment, else the project's) say will be deducted, whichever is more. */
  tds_eff: `MAX((SELECT COALESCE(SUM(x.tds),0) FROM payments x WHERE x.project_id=p.id), ROUND(
      COALESCE((SELECT SUM(m.amount * COALESCE(m.tds_percent, p.tds_percent, 0) / 100) FROM milestones m WHERE m.project_id=p.id), 0)
      + MAX(0, COALESCE(p.budget,0) + (${CR_VALUE_SQL}) - COALESCE((SELECT SUM(m.amount) FROM milestones m WHERE m.project_id=p.id), 0)) * COALESCE(p.tds_percent, 0) / 100, 2))`,
  cash: '(SELECT COALESCE(SUM(x.amount),0) FROM payments x WHERE x.project_id=p.id)',
  invoiced: `((SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.project_id=p.id AND ${LIVE}) + (SELECT COALESCE(SUM(x.amount),0) FROM payments x WHERE x.project_id=p.id AND x.invoice_id IS NULL))`,
  pending: `(SELECT COALESCE(SUM(MAX(i.total-i.paid_amount,0)),0) FROM invoices i WHERE i.project_id=p.id AND ${LIVE})`,
  overdue: "(SELECT COALESCE(SUM(MAX(i.total-i.paid_amount,0)),0) FROM invoices i WHERE i.project_id=p.id AND i.kind='invoice' AND i.status='overdue')",
};
PM_SQL satisfies Record<string, string>;

/** Same figures as columns on a `projects p` row. */
export const PM_COLUMNS = `
  ${PM_SQL.tds} AS tds_total,
  MAX(0, ${PM_SQL.value} - ${PM_SQL.tds_eff} - ${PM_SQL.invoiced}) AS to_invoice,
  ${PM_SQL.pending} AS pending_amount,
  MAX(0, ${PM_SQL.value} - ${PM_SQL.tds_eff} - ${PM_SQL.invoiced}) + ${PM_SQL.pending} AS to_get`;

/** Money still to come in, from every live project and loose invoice: what is invoiced and unpaid, and what is not invoiced yet (never TDS: that is claimed in the ITR). */
export function unbilled(ctx: AppContext): { amount: number; projects: number; pending: number; to_get: number; overdue: number; clients: number } {
  const rows = ctx.db.prepare(`SELECT p.id, p.client_id, ${PM_SQL.pending} pending, ${PM_SQL.overdue} overdue, MAX(0, ${PM_SQL.value} - ${PM_SQL.tds_eff} - ${PM_SQL.invoiced}) to_invoice
    FROM projects p WHERE p.status<>'cancelled'`).all() as { client_id: number | null; pending: number; overdue: number; to_invoice: number }[];
  const loose = ctx.db.prepare("SELECT COALESCE(SUM(MAX(total-paid_amount,0)),0) v, COALESCE(SUM(CASE WHEN status='overdue' THEN MAX(total-paid_amount,0) ELSE 0 END),0) o FROM invoices WHERE project_id IS NULL AND kind='invoice' AND status NOT IN ('draft','cancelled')").get() as { v: number; o: number };
  let toInvoice = 0; let pending = loose.v; let overdue = loose.o; let projects = 0;
  const owing = new Set<number | null>();
  for (const r of rows) {
    toInvoice += r.to_invoice; pending += r.pending; overdue += r.overdue;
    if (r.to_invoice > 0.5) projects += 1;
    if (r.to_invoice + r.pending > 0.5) owing.add(r.client_id);
  }
  const rnd = (n: number): number => Math.round(n);
  return { amount: rnd(toInvoice), projects, pending: rnd(pending), overdue: rnd(overdue), to_get: rnd(toInvoice + pending), clients: owing.size };
}
