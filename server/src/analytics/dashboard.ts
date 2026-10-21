import { addDays, lastMonths, today } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import type { Engine } from '../crud/engine';
import { markOverdue } from '../domain/billing';
import { hasFlag, isFounder, type User } from '../security/permissions';
import { unbilled } from '../domain/projectMoney';
import { mrr, recurringCostPerMonth, tdsTotals } from './finance';

/** The Home screen: what needs attention today, the money, the pipeline, and the day-to-day work. */
export function dashboard(ctx: AppContext, engine: Engine, u: User): Row {
  const { db } = ctx;
  const one = (sql: string, ...p: unknown[]): Row => db.prepare(sql).get(...p) as Row;
  const all = (sql: string, ...p: unknown[]): Row[] => db.prepare(sql).all(...p) as Row[];
  markOverdue(ctx);
  const t = today();
  const founder = isFounder(u);
  const out: Row = { today: t, role: u.role };
  const mine = 't.id IN (SELECT task_id FROM task_assignees WHERE user_id=?)';
  out.my_tasks = engine.query('tasks', u, `${mine} AND t.status<>'done'`, [u.id], 12);
  out.deadlines = engine.query('projects', u, "p.status NOT IN ('completed','cancelled','maintenance','on_hold') AND p.deadline IS NOT NULL AND p.deadline<=?", [addDays(t, 21)], 10, 'p.deadline');
  out.my_projects = engine.query('projects', u, "p.status IN ('planning','active','review','maintenance')", [], 8);
  out.tasks_overdue = one(`SELECT COUNT(*) n FROM tasks t WHERE t.status<>'done' AND t.due_date < ? ${founder ? '' : `AND ${mine}`}`, t, ...(founder ? [] : [u.id])).n;
  if (hasFlag(u, 'leads')) {
    out.followups = engine.query('leads', u, "l.stage NOT IN ('won','closed','lost') AND l.next_followup IS NOT NULL AND l.next_followup<=?", [addDays(t, 3)], 8, 'l.next_followup');
  }
  if (!founder) return out;

  out.renewals = engine.query('renewals', u, "r.status='active' AND r.renewal_date IS NOT NULL AND r.renewal_date<=?", [addDays(t, 30)], 10);
  const monthStart = `${t.slice(0, 7)}-01`;
  const months = lastMonths(6);
  out.kpi = {
    open_leads: one("SELECT COUNT(*) n, COALESCE(SUM(value),0) v FROM leads WHERE stage NOT IN ('won','closed','lost')"),
    active_projects: one("SELECT COUNT(*) n FROM projects WHERE status IN ('planning','active','review')").n,
    receivables: one("SELECT COALESCE(SUM(MAX(total-paid_amount,0)),0) v FROM invoices WHERE kind='invoice' AND status NOT IN ('draft','cancelled','paid')").v,
    overdue: one("SELECT COALESCE(SUM(MAX(total-paid_amount,0)),0) v, COUNT(*) n FROM invoices WHERE kind='invoice' AND status='overdue'"),
    month_income: one('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE date>=?', monthStart).v,
    month_expense: one("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='paid' AND date>=?", monthStart).v,
    mrr: mrr(ctx),
    recurring_cost: recurringCostPerMonth(ctx),
    quotes_pending: one("SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM quotes WHERE status='sent'"),
    open_change_requests: one("SELECT COUNT(*) n, COALESCE(SUM(estimate_amount),0) v FROM change_requests WHERE status IN ('requested','estimated','quoted','approved','in_progress') AND billable=1"),
    unbilled: unbilled(ctx),
    tds: tdsTotals(ctx),
    cash: all(`SELECT a.opening_balance
      + COALESCE((SELECT SUM(amount) FROM payments WHERE account_id=a.id),0)
      - COALESCE((SELECT SUM(amount) FROM expenses WHERE account_id=a.id AND paid_by_id IS NULL AND status='paid'),0)
      + COALESCE((SELECT SUM(amount) FROM transfers WHERE (account_id=a.id AND kind IN ('capital_in','loan_in')) OR (to_account_id=a.id AND kind='transfer')),0)
      - COALESCE((SELECT SUM(amount) FROM transfers WHERE account_id=a.id AND kind IN ('withdrawal','loan_repay','tax_paid','transfer','reimbursement')),0) AS balance
      FROM accounts a WHERE a.active=1`).reduce((s, a) => s + a.balance, 0),
  };
  out.overdue_invoices = engine.query('invoices', u, "i.status='overdue'", [], 6);
  out.activity = all("SELECT * FROM audit_log WHERE action IN ('create','update','delete','convert','upload','renew') AND entity NOT IN ('settings','users') ORDER BY id DESC LIMIT 14");
  out.overdue_tasks = engine.query('tasks', u, "t.status<>'done' AND t.due_date < ?", [t], 8);
  out.pipeline = Object.fromEntries(all('SELECT stage, COUNT(*) n, COALESCE(SUM(value),0) v FROM leads GROUP BY stage').map((r) => [r.stage, { n: r.n, v: r.v }]));
  const first = `${months[0]}-01`;
  const inc = Object.fromEntries(all("SELECT strftime('%Y-%m',date) m, SUM(amount) v FROM payments WHERE date>=? GROUP BY m", first).map((r) => [r.m, r.v]));
  const exp = Object.fromEntries(all("SELECT strftime('%Y-%m',date) m, SUM(amount) v FROM expenses WHERE status='paid' AND date>=? GROUP BY m", first).map((r) => [r.m, r.v]));
  out.trend = months.map((m) => ({ month: m, income: inc[m] || 0, expense: exp[m] || 0 }));
  out.team_load = all(`SELECT u.id, u.name, u.role,
    (SELECT COUNT(*) FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id WHERE ta.user_id=u.id AND t.status<>'done') AS open_tasks,
    (SELECT COUNT(*) FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id WHERE ta.user_id=u.id AND t.status<>'done' AND t.due_date<?) AS overdue_tasks,
    (SELECT COUNT(*) FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id WHERE ta.user_id=u.id AND t.status='done' AND t.completed_at>=datetime('now','-7 days')) AS done_week
    FROM users u WHERE u.active=1 ORDER BY open_tasks DESC`, t);
  // who pays us, where the money goes, what debits itself soon, how the work is spread
  out.by_client = all("SELECT COALESCE(c.company,'Not from a client') k, c.id id, SUM(pm.amount) v FROM payments pm LEFT JOIN clients c ON c.id=pm.client_id GROUP BY k ORDER BY v DESC LIMIT 6");
  out.spend_by_category = all("SELECT COALESCE(category,'Uncategorised') k, SUM(amount) v FROM expenses WHERE status='paid' AND date>=? GROUP BY k ORDER BY v DESC LIMIT 7", first);
  out.auto_debits = engine.query('renewals', u, "r.status='active' AND r.auto_debit=1 AND r.our_cost>0 AND r.renewal_date IS NOT NULL AND r.renewal_date<=?", [addDays(t, 45)], 8);
  out.pending_estimates = one("SELECT COUNT(*) n, COALESCE(SUM(amount),0) v FROM expenses WHERE status='pending' AND is_estimate=1");
  out.work = {
    clients: one("SELECT COUNT(*) n, SUM(status='active') active FROM clients"),
    projects: all('SELECT status k, COUNT(*) n FROM projects GROUP BY status ORDER BY n DESC'),
    invoices: one("SELECT COUNT(*) n, COALESCE(SUM(total),0) total, COALESCE(SUM(MAX(total-paid_amount,0)),0) open FROM invoices WHERE kind='invoice' AND status NOT IN ('draft','cancelled')"),
  };
  out.change_requests = engine.query('change_requests', u, "cr.status IN ('requested','estimated','quoted','approved','in_progress')", [], 6);
  return out;
}
