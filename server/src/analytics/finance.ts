import { addDays, CYCLE_MONTHS, lastMonths, round2, today, validDate } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import { markOverdue } from '../domain/billing';
import { unbilled } from '../domain/projectMoney';

/** Monthly recurring revenue = active maintenance plans (renewals of kind 'amc'), spread per month. */
export function mrr(ctx: AppContext): number {
  const rows = ctx.db.prepare("SELECT client_price, cycle FROM renewals WHERE kind='amc' AND status='active'").all() as { client_price: number; cycle: string }[];
  return round2(rows.reduce((s, r) => s + (CYCLE_MONTHS[r.cycle] ? r.client_price / (CYCLE_MONTHS[r.cycle] as number) : 0), 0));
}

/** What the COMPANY pays every month for things that renew (subscriptions, hosting, bills …). What a person pays themselves (e.g. a founder's own tool) is not company money and is left out. */
export function recurringCostPerMonth(ctx: AppContext): number {
  const rows = ctx.db.prepare("SELECT our_cost, cycle FROM renewals WHERE status='active' AND our_cost>0 AND kind<>'amc' AND scope='company'").all() as { our_cost: number; cycle: string }[];
  return round2(rows.reduce((s, r) => s + (CYCLE_MONTHS[r.cycle] ? r.our_cost / (CYCLE_MONTHS[r.cycle] as number) : 0), 0));
}

/** All-time TDS tax credit: deducted by clients, and how much of it is still to be claimed in the ITR. */
export function tdsTotals(ctx: AppContext): { deducted: number; claimed: number; to_claim: number; awaiting_certificate: number } {
  const r = ctx.db.prepare("SELECT COALESCE(SUM(tds),0) d, COALESCE(SUM(CASE WHEN tds_status='claimed' THEN tds END),0) c, COALESCE(SUM(CASE WHEN tds_status='deducted' THEN tds END),0) w FROM payments WHERE tds > 0").get() as { d: number; c: number; w: number };
  return { deducted: round2(r.d), claimed: round2(r.c), to_claim: round2(r.d - r.c), awaiting_certificate: round2(r.w) };
}

/** Money in, money out, what is owed to us and what is left — for a date range (default: this month). */
export function financeSummary(ctx: AppContext, query: { from?: string; to?: string }): Row {
  const { db } = ctx;
  const one = (sql: string, ...p: unknown[]): Row => db.prepare(sql).get(...p) as Row;
  const all = (sql: string, ...p: unknown[]): Row[] => db.prepare(sql).all(...p) as Row[];
  markOverdue(ctx);
  const t = today();
  const from = query.from && validDate(query.from) ? query.from : `${t.slice(0, 7)}-01`;
  const to = query.to && validDate(query.to) ? query.to : t;
  const inc = one('SELECT COALESCE(SUM(amount),0) cash, COALESCE(SUM(tds),0) tds, COUNT(*) n FROM payments WHERE date BETWEEN ? AND ?', from, to);
  const exp = one("SELECT COALESCE(SUM(amount),0) v, COUNT(*) n FROM expenses WHERE status='paid' AND date BETWEEN ? AND ?", from, to);
  const inv = one("SELECT COALESCE(SUM(total),0) total, COUNT(*) n FROM invoices WHERE kind='invoice' AND status NOT IN ('draft','cancelled') AND issue_date BETWEEN ? AND ?", from, to);
  const open = all("SELECT MAX(total-paid_amount,0) bal, due_date FROM invoices WHERE kind='invoice' AND status IN ('sent','partial','overdue')");
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
  for (const r of open) {
    const days = r.due_date ? Math.floor((new Date(t).getTime() - new Date(r.due_date).getTime()) / 86_400_000) : 0;
    const k = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'd90p';
    aging[k] += r.bal;
  }
  // 12-month trend ending in `to`
  const end = new Date(`${to < t ? to : t}T00:00:00`);
  const months = lastMonths(12, end);
  const firstDay = `${months[0]}-01`;
  const monthly = (sql: string): Record<string, number> => Object.fromEntries(all(sql, firstDay).map((r) => [r.m, r.v]));
  const mi = monthly("SELECT strftime('%Y-%m',date) m, SUM(amount) v FROM payments WHERE date>=? GROUP BY m");
  const me = monthly("SELECT strftime('%Y-%m',date) m, SUM(amount) v FROM expenses WHERE status='paid' AND date>=? GROUP BY m");
  const founders = all("SELECT id,name FROM users WHERE role='founder' AND active=1").map((f) => {
    const sum = (sql: string): number => (one(sql, f.id).v as number);
    const capital = sum("SELECT COALESCE(SUM(amount),0) v FROM transfers WHERE user_id=? AND kind='capital_in'");
    const draw = sum("SELECT COALESCE(SUM(amount),0) v FROM transfers WHERE user_id=? AND kind='withdrawal'");
    const paid = sum('SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE paid_by_id=?');
    const reimb = sum("SELECT COALESCE(SUM(amount),0) v FROM transfers WHERE user_id=? AND kind='reimbursement'");
    return { ...f, capital, withdrawals: draw, paid_personally: paid, reimbursed: reimb, company_owes: round2(paid - reimb) };
  });
  const accounts = all(`SELECT a.*, a.opening_balance
      + COALESCE((SELECT SUM(amount) FROM payments WHERE account_id=a.id),0)
      - COALESCE((SELECT SUM(amount) FROM expenses WHERE account_id=a.id AND paid_by_id IS NULL AND status='paid'),0)
      + COALESCE((SELECT SUM(amount) FROM transfers WHERE (account_id=a.id AND kind IN ('capital_in','loan_in')) OR (to_account_id=a.id AND kind='transfer')),0)
      - COALESCE((SELECT SUM(amount) FROM transfers WHERE account_id=a.id AND kind IN ('withdrawal','loan_repay','tax_paid','transfer','reimbursement')),0) AS balance
    FROM accounts a WHERE a.active=1 ORDER BY a.name`);
  const sixAgo = new Date(`${t}T00:00:00`);
  sixAgo.setMonth(sixAgo.getMonth() - 6);
  const burn = round2((one("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='paid' AND date>? AND date<=?", sixAgo.toISOString().slice(0, 10), t).v as number) / 6);
  return {
    from, to,
    income: inc, expenses: exp, invoiced: inv,
    profit: round2(inc.cash - exp.v),
    receivables: round2(open.reduce((s, r) => s + r.bal, 0)), aging,
    tds: tdsTotals(ctx),
    still_to_get: unbilled(ctx),
    trend: months.map((m) => ({ month: m, income: mi[m] || 0, expense: me[m] || 0 })),
    expense_by_category: all("SELECT COALESCE(category,'Uncategorised') k, SUM(amount) v FROM expenses WHERE status='paid' AND date BETWEEN ? AND ? GROUP BY k ORDER BY v DESC", from, to),
    income_by_client: all("SELECT COALESCE(c.company,'Unassigned') k, c.id id, SUM(pm.amount) v FROM payments pm LEFT JOIN clients c ON c.id=pm.client_id WHERE pm.date BETWEEN ? AND ? GROUP BY k ORDER BY v DESC LIMIT 8", from, to),
    projects: all(`SELECT p.id, p.name, p.client_id, c.company client_name, p.status, p.budget,
      (SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.project_id=p.id AND i.kind='invoice' AND i.status NOT IN ('draft','cancelled')) invoiced,
      (SELECT COALESCE(SUM(amount),0) FROM payments pm WHERE pm.project_id=p.id) received,
      (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.project_id=p.id AND e.status='paid') cost
      FROM projects p LEFT JOIN clients c ON c.id=p.client_id ORDER BY received DESC, p.id DESC LIMIT 60`),
    accounts, cash: round2(accounts.reduce((s, a) => s + a.balance, 0)), founders,
    pending_expenses: one("SELECT COALESCE(SUM(amount),0) v, COUNT(*) n FROM expenses WHERE status='pending'"),
    mrr: mrr(ctx),
    all_time: { revenue: one('SELECT COALESCE(SUM(amount),0) v FROM payments').v, expenses: one("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='paid'").v },
    burn,
    grants: one('SELECT COALESCE(SUM(requested),0) requested, COALESCE(SUM(received),0) received, COUNT(*) n FROM grants'),
    renewals_60d: one("SELECT COALESCE(SUM(our_cost),0) cost, COALESCE(SUM(client_price),0) price, COUNT(*) n FROM renewals WHERE status='active' AND renewal_date BETWEEN ? AND ?", t, addDays(t, 60)),
  };
}

/** Deeper finance analytics: margins, grant use, who pays, project profitability, and what the next 60 days look like. */
export function financeAnalytics(ctx: AppContext, months = 12): Row {
  const { db } = ctx;
  const all = (sql: string, ...p: unknown[]): Row[] => db.prepare(sql).all(...p) as Row[];
  const one = (sql: string, ...p: unknown[]): Row => db.prepare(sql).get(...p) as Row;
  markOverdue(ctx);
  const t = today();
  const keys = lastMonths(Math.min(Math.max(months, 3), 36));
  const first = `${keys[0]}-01`;
  const m = (sql: string): Record<string, number> => Object.fromEntries(all(sql, first).map((r) => [r.m, r.v]));
  const income = m("SELECT strftime('%Y-%m',date) m, SUM(amount) v FROM payments WHERE date>=? GROUP BY m");
  const spend = m("SELECT strftime('%Y-%m',date) m, SUM(amount) v FROM expenses WHERE status='paid' AND date>=? GROUP BY m");
  const invoiced = m("SELECT strftime('%Y-%m',issue_date) m, SUM(total) v FROM invoices WHERE kind='invoice' AND status NOT IN ('draft','cancelled') AND issue_date>=? GROUP BY m");
  let cumulative = (one('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE date<?', first).v as number) - (one("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='paid' AND date<?", first).v as number);
  const series = keys.map((k) => {
    const i = income[k] || 0;
    const e = spend[k] || 0;
    cumulative += i - e;
    return { month: k, income: round2(i), expense: round2(e), net: round2(i - e), invoiced: round2(invoiced[k] || 0), margin: i ? Math.round((1000 * (i - e)) / i) / 10 : null, cumulative: round2(cumulative) };
  });
  const totalIn = series.reduce((s, r) => s + r.income, 0);
  const totalOut = series.reduce((s, r) => s + r.expense, 0);
  // what the next 60 days look like: invoices falling due in, renewals and bills going out
  const inflow = all("SELECT i.id, i.number, c.company, i.due_date, MAX(i.total-i.paid_amount,0) AS amount FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.kind='invoice' AND i.status IN ('sent','partial','overdue') AND i.total>i.paid_amount ORDER BY COALESCE(i.due_date,'9999') LIMIT 20");
  const outflow = all("SELECT id, name, renewal_date, our_cost AS amount, auto_debit, amount_varies FROM renewals WHERE status='active' AND our_cost>0 AND renewal_date IS NOT NULL AND renewal_date<=? ORDER BY renewal_date LIMIT 30", addDays(t, 60));
  return {
    months: keys, series,
    totals: { income: round2(totalIn), expense: round2(totalOut), net: round2(totalIn - totalOut), margin: totalIn ? Math.round((1000 * (totalIn - totalOut)) / totalIn) / 10 : null },
    top_clients: all(`SELECT c.id, c.company AS name, SUM(pm.amount) AS received, COUNT(DISTINCT pm.project_id) AS projects FROM payments pm JOIN clients c ON c.id=pm.client_id GROUP BY c.id ORDER BY received DESC LIMIT 8`),
    expense_by_category: all("SELECT COALESCE(category,'Uncategorised') k, SUM(amount) v FROM expenses WHERE status='paid' AND date>=? GROUP BY k ORDER BY v DESC", first),
    invoice_status: all("SELECT status k, COUNT(*) n, COALESCE(SUM(total),0) total, COALESCE(SUM(MAX(total-paid_amount,0)),0) open FROM invoices WHERE kind='invoice' GROUP BY status ORDER BY n DESC"),
    receivable_clients: all("SELECT c.id, c.company AS name, SUM(MAX(i.total-i.paid_amount,0)) AS owed, MIN(i.due_date) AS oldest_due FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.kind='invoice' AND i.status IN ('sent','partial','overdue') GROUP BY c.id HAVING owed>0 ORDER BY owed DESC LIMIT 8"),
    project_profit: all(`SELECT p.id, p.name, p.status, p.client_id, c.company AS client_name,
        p.budget + (SELECT COALESCE(SUM(cr.estimate_amount),0) FROM change_requests cr WHERE cr.project_id=p.id AND cr.billable=1 AND cr.status IN ('approved','in_progress','delivered')) AS value,
        (SELECT COALESCE(SUM(amount),0) FROM payments WHERE project_id=p.id) AS received,
        (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE project_id=p.id AND status='paid') AS cost
      FROM projects p LEFT JOIN clients c ON c.id=p.client_id ORDER BY received DESC LIMIT 10`).map((p) => ({ ...p, margin: round2(p.received - p.cost) })),
    grants: all(`SELECT g.id, g.name, g.funder, g.status, g.requested, g.received,
        (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE grant_id=g.id AND status='paid') AS used FROM grants g ORDER BY g.id DESC`).map((g) => ({ ...g, remaining: round2(g.received - g.used), pending: round2(g.requested - g.received) })),
    recurring: { monthly_cost: recurringCostPerMonth(ctx), mrr: mrr(ctx), items: all("SELECT id, name, vendor, cycle, our_cost, auto_debit, amount_varies, renewal_date FROM renewals WHERE status='active' AND our_cost>0 AND kind<>'amc' ORDER BY our_cost DESC") },
    forecast_60d: { inflow, outflow, expected_in: round2(inflow.reduce((s, r) => s + r.amount, 0)), expected_out: round2(outflow.reduce((s, r) => s + r.amount, 0)) },
    pending_estimates: all("SELECT id, description, amount, date FROM expenses WHERE status='pending' AND is_estimate=1 ORDER BY date"),
  };
}
