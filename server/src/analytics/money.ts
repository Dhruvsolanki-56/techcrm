import { addDays, assessmentYear, fyOf, fyRange, lastMonths, round2, TDS_STATUSES, today, validDate } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import { CR_VALUE_SQL, PM_SQL } from '../domain/projectMoney';
import { markOverdue } from '../domain/billing';
import { badRequest } from '../shared/errors';

type Q = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const intOr = (v: unknown): number | null => (/^\d{1,12}$/.test(String(v ?? '')) ? Number(v) : null);

/** Group keys → [label SQL, extra joins]. Only these are ever put in SQL, never user text. */
const SPEND_BY: Record<string, { key: string; label: string; join?: string }> = {
  category: { key: "COALESCE(e.category,'Uncategorised')", label: "COALESCE(e.category,'Uncategorised')" },
  vendor: { key: "COALESCE(e.vendor,'No vendor')", label: "COALESCE(e.vendor,'No vendor')" },
  project: { key: 'COALESCE(e.project_id,0)', label: "COALESCE(p.name,'Not on a project')", join: 'LEFT JOIN projects p ON p.id=e.project_id' },
  client: { key: 'COALESCE(e.client_id,0)', label: "COALESCE(c.company,'Not on a client')", join: 'LEFT JOIN clients c ON c.id=e.client_id' },
  grant: { key: 'COALESCE(e.grant_id,0)', label: "COALESCE(g.name,'Company money (no grant)')", join: 'LEFT JOIN grants g ON g.id=e.grant_id' },
  account: { key: 'COALESCE(e.account_id,0)', label: "COALESCE(a.name,'No account')", join: 'LEFT JOIN accounts a ON a.id=e.account_id' },
  paid_by: { key: 'COALESCE(e.paid_by_id,0)', label: "COALESCE(u.name,'Company')", join: 'LEFT JOIN users u ON u.id=e.paid_by_id' },
  month: { key: "strftime('%Y-%m',e.date)", label: "strftime('%Y-%m',e.date)" },
  recurring: { key: "COALESCE(e.renewal_id,0)", label: "COALESCE(r.name,'One-off')", join: 'LEFT JOIN renewals r ON r.id=e.renewal_id' },
  mode: { key: "COALESCE(e.method,'Not recorded')", label: "COALESCE(e.method,'Not recorded')" },
};
const INCOME_BY: Record<string, { key: string; label: string; join?: string }> = {
  client: { key: 'COALESCE(pm.client_id,0)', label: "COALESCE(c.company,'Not from a client')", join: 'LEFT JOIN clients c ON c.id=pm.client_id' },
  project: { key: 'COALESCE(pm.project_id,0)', label: "COALESCE(p.name,'Not on a project')", join: 'LEFT JOIN projects p ON p.id=pm.project_id' },
  category: { key: "COALESCE(pm.category,'Uncategorised')", label: "COALESCE(pm.category,'Uncategorised')" },
  account: { key: 'COALESCE(pm.account_id,0)', label: "COALESCE(a.name,'No account')", join: 'LEFT JOIN accounts a ON a.id=pm.account_id' },
  mode: { key: "COALESCE(pm.method,'Not recorded')", label: "COALESCE(pm.method,'Not recorded')" },
  grant: { key: 'COALESCE(pm.grant_id,0)', label: "COALESCE(g.name,'Not a grant')", join: 'LEFT JOIN grants g ON g.id=pm.grant_id' },
  month: { key: "strftime('%Y-%m',pm.date)", label: "strftime('%Y-%m',pm.date)" },
};

function range(q: Q): { from: string; to: string } {
  const from = str(q.from);
  const to = str(q.to);
  if (from && !validDate(from)) throw badRequest('"From" is not a real date.');
  if (to && !validDate(to)) throw badRequest('"To" is not a real date.');
  return { from: from || '2000-01-01', to: to || '2100-12-31' };
}

/** Where the company's money went, sliced any way: category, vendor, project, client, grant, account, who paid, month, recurring item. */
export function spending(ctx: AppContext, q: Q): Row {
  const by = SPEND_BY[str(q.by) || 'category'];
  if (!by) throw badRequest('Unknown grouping.');
  const { from, to } = range(q);
  const where = ["e.date BETWEEN ? AND ?", "e.status='paid'"];
  const p: unknown[] = [from, to];
  const add = (cond: string, v: unknown): void => { where.push(cond); p.push(v); };
  if (str(q.category)) add('e.category=?', str(q.category));
  if (str(q.vendor)) add('e.vendor=?', str(q.vendor));
  if (intOr(q.project_id)) add('e.project_id=?', intOr(q.project_id));
  if (intOr(q.client_id)) add('e.client_id=?', intOr(q.client_id));
  if (intOr(q.grant_id)) add('e.grant_id=?', intOr(q.grant_id));
  if (intOr(q.account_id)) add('e.account_id=?', intOr(q.account_id));
  if (intOr(q.paid_by_id)) add('e.paid_by_id=?', intOr(q.paid_by_id));
  if (str(q.grant) === 'any') where.push('e.grant_id IS NOT NULL');
  if (str(q.grant) === 'none') where.push('e.grant_id IS NULL');
  const w = where.join(' AND ');
  const db = ctx.db;
  const total = db.prepare(`SELECT COALESCE(SUM(e.amount),0) v, COUNT(*) n FROM expenses e WHERE ${w}`).get(...p) as { v: number; n: number };
  const groups = db.prepare(`SELECT ${by.key} k, ${by.label} label, SUM(e.amount) amount, COUNT(*) n FROM expenses e ${by.join ?? ''} WHERE ${w} GROUP BY k ORDER BY ${str(q.by) === 'month' ? 'k' : 'amount DESC'}`).all(...p) as Row[];
  const months = db.prepare(`SELECT strftime('%Y-%m',e.date) month, SUM(e.amount) amount FROM expenses e WHERE ${w} GROUP BY month ORDER BY month`).all(...p) as Row[];
  const top = db.prepare(`SELECT e.id, e.date, e.vendor, e.description, e.category, e.amount FROM expenses e WHERE ${w} ORDER BY e.amount DESC LIMIT 10`).all(...p) as Row[];
  const pending = db.prepare("SELECT COALESCE(SUM(amount),0) v, COUNT(*) n FROM expenses WHERE status='pending'").get() as { v: number; n: number };
  return {
    by: str(q.by) || 'category', from, to, total: round2(total.v), count: total.n, average: total.n ? round2(total.v / total.n) : 0,
    rows: groups.map((g) => ({ key: g.k, label: g.label, amount: round2(g.amount), count: g.n, share: total.v ? Math.round((1000 * g.amount) / total.v) / 10 : 0 })),
    months: months.map((m) => ({ month: m.month, amount: round2(m.amount) })), top, pending,
    options: {
      categories: db.prepare('SELECT DISTINCT category v FROM expenses WHERE category IS NOT NULL ORDER BY v').all().map((r) => (r as Row).v),
      vendors: db.prepare('SELECT DISTINCT vendor v FROM expenses WHERE vendor IS NOT NULL ORDER BY v').all().map((r) => (r as Row).v),
    },
  };
}

/** Where the money came from. */
export function income(ctx: AppContext, q: Q): Row {
  const by = INCOME_BY[str(q.by) || 'client'];
  if (!by) throw badRequest('Unknown grouping.');
  const { from, to } = range(q);
  const where = ['pm.date BETWEEN ? AND ?'];
  const p: unknown[] = [from, to];
  if (intOr(q.client_id)) { where.push('pm.client_id=?'); p.push(intOr(q.client_id)); }
  if (intOr(q.project_id)) { where.push('pm.project_id=?'); p.push(intOr(q.project_id)); }
  if (str(q.category)) { where.push('pm.category=?'); p.push(str(q.category)); }
  const w = where.join(' AND ');
  const total = ctx.db.prepare(`SELECT COALESCE(SUM(pm.amount),0) v, COALESCE(SUM(pm.tds),0) tds, COUNT(*) n FROM payments pm WHERE ${w}`).get(...p) as { v: number; tds: number; n: number };
  const groups = ctx.db.prepare(`SELECT ${by.key} k, ${by.label} label, SUM(pm.amount) amount, SUM(COALESCE(pm.tds,0)) tds, COUNT(*) n FROM payments pm ${by.join ?? ''} WHERE ${w} GROUP BY k ORDER BY ${str(q.by) === 'month' ? 'k' : 'amount DESC'}`).all(...p) as Row[];
  const months = ctx.db.prepare(`SELECT strftime('%Y-%m',pm.date) month, SUM(pm.amount) amount FROM payments pm WHERE ${w} GROUP BY month ORDER BY month`).all(...p) as Row[];
  return {
    by: str(q.by) || 'client', from, to, total: round2(total.v), tds: round2(total.tds), count: total.n,
    rows: groups.map((g) => ({ key: g.k, label: g.label, amount: round2(g.amount), tds: round2(g.tds), count: g.n, share: total.v ? Math.round((1000 * g.amount) / total.v) / 10 : 0 })),
    months: months.map((m) => ({ month: m.month, amount: round2(m.amount) })),
  };
}

/**
 * For every client and project: what was agreed, what was invoiced, what has come in (cash only), and — the number that matters — what we still need to get.
 * TDS the client deducted is neither received nor collectable: it is taken out of the value and tracked apart for the ITR (see domain/projectMoney.ts).
 */
export function receivables(ctx: AppContext): Row {
  markOverdue(ctx);
  const db = ctx.db;
  const t = today();
  const projects: Row[] = (db.prepare(`SELECT p.id, p.code, p.name, p.status, p.client_id, c.company client_name, p.budget,
      (${CR_VALUE_SQL}) cr_value, ${PM_SQL.value} value, ${PM_SQL.tds} tds, ${PM_SQL.cash} cash, ${PM_SQL.pending} pending, ${PM_SQL.overdue} overdue,
      (SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.project_id=p.id AND i.kind='invoice' AND i.status NOT IN ('draft','cancelled')) invoiced,
      MAX(0, ${PM_SQL.value} - ${PM_SQL.tds_eff} - ${PM_SQL.invoiced}) to_invoice
    FROM projects p LEFT JOIN clients c ON c.id=p.client_id WHERE p.status<>'cancelled' ORDER BY p.id DESC`).all() as Row[]).map((p) => ({
    ...p, value: round2(p.value), received: round2(p.cash), cash: round2(p.cash), tds: round2(p.tds), invoiced: round2(p.invoiced), pending: round2(p.pending), overdue: round2(p.overdue),
    unbilled: round2(p.to_invoice), to_get: round2(p.to_invoice + p.pending),
  }));
  // invoices that are not tied to any project still have to be collected
  for (const r of db.prepare(`SELECT i.client_id, c.company client_name, SUM(i.total) invoiced, SUM(MAX(i.total-i.paid_amount,0)) pending, SUM(CASE WHEN i.status='overdue' THEN MAX(i.total-i.paid_amount,0) ELSE 0 END) overdue, SUM(i.paid_amount) cash
      FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.project_id IS NULL AND i.kind='invoice' AND i.status NOT IN ('draft','cancelled') GROUP BY i.client_id HAVING pending > 0.005`).all() as Row[]) {
    projects.push({ id: 0, code: null, name: 'Invoices not tied to a project', status: 'active', client_id: r.client_id, client_name: r.client_name, budget: 0, cr_value: 0, value: 0, tds: 0, cash: 0, received: 0, invoiced: round2(r.invoiced), pending: round2(r.pending), overdue: round2(r.overdue), unbilled: 0, to_invoice: 0, to_get: round2(r.pending) });
  }
  const clients = new Map<number, Row>();
  const FIELDS = ['value', 'invoiced', 'cash', 'tds', 'received', 'pending', 'overdue', 'unbilled', 'to_get'] as const;
  for (const p of projects) {
    const k = (p.client_id as number | null) ?? 0;
    const c = clients.get(k) ?? { client_id: k, client_name: p.client_name ?? 'No client', projects: 0, value: 0, invoiced: 0, cash: 0, tds: 0, received: 0, pending: 0, overdue: 0, unbilled: 0, to_get: 0 };
    for (const f of FIELDS) c[f] = round2((c[f] as number) + (p[f] as number));
    if (p.id) c.projects = (c.projects as number) + 1;
    clients.set(k, c);
  }
  const sum = (f: string): number => round2(projects.reduce((s, p) => s + (p[f] as number), 0));
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
  for (const r of db.prepare("SELECT MAX(total-paid_amount,0) bal, due_date FROM invoices WHERE kind='invoice' AND status IN ('sent','partial','overdue')").all() as Row[]) {
    const days = r.due_date ? Math.floor((Date.parse(t) - Date.parse(r.due_date)) / 86_400_000) : 0;
    aging[days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'd90p'] += r.bal;
  }
  return {
    totals: { value: sum('value'), invoiced: sum('invoiced'), received: sum('received'), cash: sum('cash'), tds: sum('tds'), pending: sum('pending'), overdue: sum('overdue'), unbilled: sum('unbilled'), to_get: sum('to_get') },
    clients: [...clients.values()].sort((a, b) => (b.to_get as number) - (a.to_get as number) || (b.value as number) - (a.value as number)), projects, aging,
    upcoming: db.prepare("SELECT i.id, i.number, i.due_date, MAX(i.total-i.paid_amount,0) amount, c.company FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.kind='invoice' AND i.status IN ('sent','partial','overdue') ORDER BY COALESCE(i.due_date,'9999') LIMIT 12").all(),
    // other income not tied to an invoice (grants, interest, one-off)
    other_income: db.prepare('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE project_id IS NULL AND invoice_id IS NULL').get(),
  };
}

/** How each grant has been used: by category, vendor, project, month — and what is left. */
export function grants(ctx: AppContext, id?: number): Row {
  const db = ctx.db;
  const list = db.prepare(`SELECT g.*, COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.grant_id=g.id AND e.status='paid'),0) used,
      COALESCE((SELECT COUNT(*) FROM expenses e WHERE e.grant_id=g.id),0) expense_count FROM grants g ${id ? 'WHERE g.id=?' : ''} ORDER BY COALESCE(g.applied_on,g.created_at) DESC`).all(...(id ? [id] : [])) as Row[];
  const out: Row[] = list.map((g) => {
    const w = "e.grant_id=? AND e.status='paid'";
    const grp = (sql: string): Row[] => (db.prepare(sql).all(g.id) as Row[]).map((r) => ({ ...r, amount: round2(r.amount), share: g.used ? Math.round((1000 * r.amount) / g.used) / 10 : 0 }));
    return {
      ...g, used: round2(g.used), remaining: round2(g.received - g.used), to_come: round2(Math.max(0, g.requested - g.received)),
      utilisation: g.received ? Math.round((1000 * g.used) / g.received) / 10 : 0,
      overspent: g.used > g.received + 0.5,
      by_category: grp(`SELECT COALESCE(e.category,'Uncategorised') label, SUM(e.amount) amount, COUNT(*) n FROM expenses e WHERE ${w} GROUP BY label ORDER BY amount DESC`),
      by_vendor: grp(`SELECT COALESCE(e.vendor,'No vendor') label, SUM(e.amount) amount, COUNT(*) n FROM expenses e WHERE ${w} GROUP BY label ORDER BY amount DESC LIMIT 15`),
      by_project: grp(`SELECT COALESCE(p.name,'Not on a project') label, SUM(e.amount) amount, COUNT(*) n FROM expenses e LEFT JOIN projects p ON p.id=e.project_id WHERE ${w} GROUP BY label ORDER BY amount DESC`),
      by_month: (db.prepare(`SELECT strftime('%Y-%m',e.date) month, SUM(e.amount) amount FROM expenses e WHERE ${w} GROUP BY month ORDER BY month`).all(g.id) as Row[]).map((r) => ({ month: r.month, amount: round2(r.amount) })),
      receipts: db.prepare("SELECT date, amount, reference, notes FROM payments WHERE grant_id=? ORDER BY date").all(g.id),
      missing_receipts: (db.prepare("SELECT COUNT(*) n FROM expenses e WHERE e.grant_id=? AND e.status='paid' AND (e.receipt_url IS NULL OR e.receipt_url='') AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.entity_type='expense' AND d.entity_id=e.id)").get(g.id) as { n: number }).n,
    };
  });
  return { grants: out, totals: { requested: round2(out.reduce((s, g) => s + g.requested, 0)), received: round2(out.reduce((s, g) => s + g.received, 0)), used: round2(out.reduce((s, g) => s + g.used, 0)) } };
}

/** What recurring costs run the company, who they belong to, and how their price moved over time. */
export function subscriptions(ctx: AppContext): Row {
  const db = ctx.db;
  const t = today();
  const items = db.prepare(`SELECT r.*, COALESCE(u.name, r.assigned_name) owner_name,
      ROUND(r.our_cost / CASE r.cycle WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'half-yearly' THEN 6 WHEN 'yearly' THEN 12 WHEN 'biennial' THEN 24 WHEN 'triennial' THEN 36 ELSE NULL END, 2) monthly
    FROM renewals r LEFT JOIN users u ON u.id=r.owner_id WHERE r.status='active' AND r.kind<>'amc' ORDER BY r.our_cost DESC`).all() as Row[];
  const sumBy = (key: (r: Row) => string, only: 'company' | 'personal' = 'company'): Row[] => {
    const m = new Map<string, number>();
    for (const r of items.filter((x) => x.scope === only)) m.set(key(r), round2((m.get(key(r)) ?? 0) + (r.monthly ?? 0)));
    return [...m].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  };
  const months = lastMonths(12);
  const history = items.map((r) => {
    const rows = db.prepare("SELECT strftime('%Y-%m',date) month, amount, status, is_estimate FROM expenses WHERE renewal_id=? AND date>=? ORDER BY date").all(r.id, `${months[0]}-01`) as Row[];
    const amounts = rows.filter((x) => x.status === 'paid').map((x) => x.amount as number);
    return { id: r.id, name: r.name, scope: r.scope, cost: r.our_cost, varies: !!r.amount_varies, next_amount: r.next_amount, min: amounts.length ? Math.min(...amounts) : null, max: amounts.length ? Math.max(...amounts) : null, months: rows.map((x) => ({ month: x.month, amount: x.amount, estimate: !!x.is_estimate, pending: x.status === 'pending' })) };
  });
  return {
    items, monthly_total: round2(items.reduce((s, r) => s + (r.monthly ?? 0), 0)),
    company_monthly: round2(items.filter((r) => r.scope === 'company').reduce((s, r) => s + (r.monthly ?? 0), 0)),
    personal_monthly: round2(items.filter((r) => r.scope === 'personal').reduce((s, r) => s + (r.monthly ?? 0), 0)),
    by_kind: sumBy((r) => String(r.kind)), by_owner: sumBy((r) => String(r.owner_name ?? 'Someone else'), 'personal'), by_vendor: sumBy((r) => String(r.vendor ?? r.name)),
    next_30: items.filter((r) => r.renewal_date && r.renewal_date <= addDays(t, 30)).map((r) => ({ id: r.id, name: r.name, date: r.renewal_date, amount: r.next_amount ?? r.our_cost, scope: r.scope, auto: !!r.auto_debit })),
    history,
  };
}

/** TDS the clients deducted: a tax credit claimed when the ITR is filed, so it is tracked apart from cash. */
export function tdsReport(ctx: AppContext, q: Q): Row {
  const { db } = ctx;
  const fy = str(q.fy);
  if (fy && !/^\d{4}-\d{2}$/.test(fy)) throw badRequest('Financial year looks like 2026-27.');
  const status = str(q.status);
  if (status && !TDS_STATUSES.some(([k]) => k === status)) throw badRequest('Unknown TDS status.');
  const where = ['pm.tds > 0'];
  const p: unknown[] = [];
  if (fy) { const r = fyRange(fy); where.push('pm.date BETWEEN ? AND ?'); p.push(r.from, r.to); }
  if (status) { where.push('pm.tds_status=?'); p.push(status); }
  if (intOr(q.client_id)) { where.push('pm.client_id=?'); p.push(intOr(q.client_id)); }
  const entries = db.prepare(`SELECT pm.id, pm.date, pm.amount, pm.tds, pm.tds_status, pm.tds_section, pm.tds_claimed_on, pm.client_id, c.company client_name, pm.project_id, p.name project_name, i.id invoice_id, i.number invoice_number
    FROM payments pm LEFT JOIN clients c ON c.id=pm.client_id LEFT JOIN projects p ON p.id=pm.project_id LEFT JOIN invoices i ON i.id=pm.invoice_id
    WHERE ${where.join(' AND ')} ORDER BY pm.date DESC, pm.id DESC LIMIT 2000`).all(...p) as Row[];
  type TdsRow = Row & { fy: string; gross: number; rate: number };
  const rows: TdsRow[] = entries.map((e) => ({ ...e, fy: fyOf(e.date as string), gross: round2((e.amount as number) + (e.tds as number)), rate: (e.amount as number) + (e.tds as number) ? Math.round((1000 * (e.tds as number)) / ((e.amount as number) + (e.tds as number))) / 10 : 0 }));
  const sum = (list: TdsRow[], f?: (r: TdsRow) => boolean): number => round2(list.filter(f ?? (() => true)).reduce((s, r) => s + (r.tds as number), 0));
  const group = (key: (r: TdsRow) => string, label: (r: TdsRow) => string): Row[] => {
    const m = new Map<string, { key: string; label: string; deducted: number; claimed: number; certificate: number; count: number; gross: number }>();
    for (const r of rows) {
      const k = key(r);
      const g = m.get(k) ?? { key: k, label: label(r), deducted: 0, claimed: 0, certificate: 0, count: 0, gross: 0 };
      g.deducted = round2(g.deducted + (r.tds as number));
      if (r.tds_status === 'claimed') g.claimed = round2(g.claimed + (r.tds as number));
      if (r.tds_status === 'certificate') g.certificate = round2(g.certificate + (r.tds as number));
      g.gross = round2(g.gross + r.gross);
      g.count++;
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, to_claim: round2(g.deducted - g.claimed) }));
  };
  const years = group((r) => r.fy, (r) => r.fy).sort((a, b) => String(b.key).localeCompare(String(a.key))).map((g) => ({ ...g, ay: assessmentYear(String(g.key)), ended: today() > fyRange(String(g.key)).to }));
  return {
    fy: fy || null, status: status || null,
    totals: {
      deducted: sum(rows), claimed: sum(rows, (r) => r.tds_status === 'claimed'), certificate: sum(rows, (r) => r.tds_status === 'certificate'), awaiting_certificate: sum(rows, (r) => r.tds_status === 'deducted'),
      to_claim: sum(rows, (r) => r.tds_status !== 'claimed'), count: rows.length,
    },
    years,
    clients: group((r) => String(r.client_id ?? 0), (r) => String(r.client_name ?? 'No client')).sort((a, b) => (b.deducted as number) - (a.deducted as number)),
    entries: rows,
    statuses: TDS_STATUSES.map(([k, l]) => ({ key: k, label: l })),
    options: { years: [...new Set((db.prepare('SELECT date FROM payments WHERE tds > 0').all() as Row[]).map((r) => fyOf(r.date as string)))].sort().reverse() },
  };
}
