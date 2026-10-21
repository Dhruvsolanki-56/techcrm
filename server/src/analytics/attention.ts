import { addDays, assessmentYear, dmy, fyOf, fyRange, today } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import { markOverdue } from '../domain/billing';
import { ADVANCE_SQL, ADVANCE_STATE_SQL, PM_SQL } from '../domain/projectMoney';
import { hasFlag, isFounder, type User } from '../security/permissions';

export type Severity = 'critical' | 'high' | 'normal';
export interface AttentionItem {
  key: string;
  severity: Severity;
  /** Money, Sales, Delivery, Support, Admin */
  area: string;
  title: string;
  detail: string;
  link: string;
  date?: string | null;
  amount?: number;
  /** For rolled-up items ("38 leads have no follow-up date"). */
  count?: number;
  /** The individual records behind a rolled-up item, shown when it is opened. */
  children?: { title: string; detail?: string; link: string }[];
  /** Already shown in the "Money still to get" table of the Action center, so its list leaves it out. */
  panel?: boolean;
}
export interface AttentionResult { items: AttentionItem[]; counts: Record<Severity, number>; total: number }

const RANK: Record<Severity, number> = { critical: 0, high: 1, normal: 2 };

function finish(list: AttentionItem[]): AttentionResult {
  list.sort((a, b) => RANK[a.severity] - RANK[b.severity] || String(a.date ?? '9999').localeCompare(String(b.date ?? '9999')));
  const counts = { critical: 0, high: 0, normal: 0 };
  for (const i of list) counts[i.severity] += 1;
  return { items: list, counts, total: list.length };
}

/**
 * Everything a person should act on today, worst first. Each rule is something a running IT services company
 * loses money or goodwill over when it is forgotten: unpaid invoices, quotes nobody answered, work done but not billed,
 * leads nobody called, projects slipping, renewals about to lapse.
 */
export function attention(ctx: AppContext, u: User): AttentionResult {
  const { db } = ctx;
  const all = (sql: string, ...p: unknown[]): Row[] => db.prepare(sql).all(...p) as Row[];
  const one = (sql: string, ...p: unknown[]): Row => db.prepare(sql).get(...p) as Row;
  markOverdue(ctx);
  const t = today();
  const items: AttentionItem[] = [];
  const add = (i: AttentionItem): void => { items.push(i); };
  const inr = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
  const founder = isFounder(u);

  /* ---------- my work (everyone) ---------- */
  const mine = founder ? '1=1' : 't.id IN (SELECT task_id FROM task_assignees WHERE user_id=?)';
  const mp = founder ? [] : [u.id];
  for (const r of all(`SELECT t.id, t.title, t.due_date, p.name project FROM tasks t LEFT JOIN projects p ON p.id=t.project_id WHERE t.status<>'done' AND t.due_date<? AND ${mine} ORDER BY t.due_date LIMIT 8`, t, ...mp)) {
    add({ key: `task-late-${r.id}`, severity: 'high', area: 'Delivery', title: `Overdue task: ${r.title}`, detail: r.project ?? 'No project', link: `/tasks?open=${r.id}`, date: r.due_date });
  }
  if (founder) {
    const n = one("SELECT COUNT(*) n FROM tasks t WHERE t.status<>'done' AND NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id=t.id)").n as number;
    if (n) add({ key: 'tasks-unassigned', severity: 'normal', area: 'Delivery', title: `${plural(n, 'task')} with nobody on ${n === 1 ? 'it' : 'them'}`, detail: 'Give each task an owner so it does not slip', link: '/tasks?scope=all&assignee=null', count: n });
  }

  /* ---------- sales: follow-ups (people with the leads module) ---------- */
  if (hasFlag(u, 'leads')) {
    const scope = founder ? '' : ' AND l.owner_id=?';
    const sp = founder ? [] : [u.id];
    const open = "l.stage NOT IN ('won','closed','lost')";
    const due = one(`SELECT COUNT(*) n FROM leads l WHERE ${open} AND l.next_followup IS NOT NULL AND l.next_followup<=?${scope}`, t, ...sp).n as number;
    const overdue = one(`SELECT COUNT(*) n FROM leads l WHERE ${open} AND l.next_followup<?${scope}`, t, ...sp).n as number;
    if (due) add({ key: 'leads-due', severity: overdue ? 'high' : 'normal', area: 'Sales', title: `${plural(due, 'follow-up')} due${overdue ? ` (${overdue} overdue)` : ' today'}`, detail: 'People waiting for your call or message', link: '/followups?show=due', count: due });
    const hot = all(`SELECT l.id, l.name, l.company, l.last_contact FROM leads l WHERE ${open} AND l.priority='hot' AND COALESCE(l.last_contact, date(l.created_at)) < ?${scope} ORDER BY COALESCE(l.last_contact, date(l.created_at)) LIMIT 12`, addDays(t, -7), ...sp);
    if (hot.length) add({ key: 'leads-hot-quiet', severity: 'high', area: 'Sales', title: `${plural(hot.length, 'hot lead')} not contacted for over a week`, detail: 'Hot leads go cold fast — call or message them', link: '/leads?priority=hot', count: hot.length, children: hot.map((r) => ({ title: String(r.company || r.name), detail: r.last_contact ? `Last contact ${dmy(r.last_contact)}` : 'Never contacted', link: `/leads/${r.id}` })) });
    const uncontacted = one(`SELECT COUNT(*) n FROM leads l WHERE l.stage='new' AND l.last_contact IS NULL AND date(l.created_at)<?${scope}`, addDays(t, -2), ...sp).n as number;
    if (uncontacted) add({ key: 'leads-uncontacted', severity: uncontacted > 20 ? 'high' : 'normal', area: 'Sales', title: `${plural(uncontacted, 'new lead')} never contacted`, detail: 'Reach out, or close the ones that are not real', link: '/leads?view=list&stage=new', count: uncontacted });
    const nodate = one(`SELECT COUNT(*) n FROM leads l WHERE ${open} AND l.next_followup IS NULL AND l.stage<>'nurture'${scope}`, ...sp).n as number;
    if (nodate) add({ key: 'leads-nodate', severity: 'normal', area: 'Sales', title: `${plural(nodate, 'open lead')} with no next follow-up date`, detail: 'A lead without a date is a lead nobody will call', link: '/followups?show=nodate', count: nodate });
    const noquote = all(`SELECT l.id, l.name, l.company FROM leads l WHERE l.stage IN ('proposal','negotiation') AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.lead_id=l.id AND q.status<>'rejected')${scope} LIMIT 12`, ...sp);
    if (noquote.length) add({ key: 'leads-noquote', severity: 'normal', area: 'Sales', title: `${plural(noquote.length, 'lead')} at Proposal stage with no quotation`, detail: 'Write the quotation so the deal can close', link: '/leads', count: noquote.length, children: noquote.map((r) => ({ title: String(r.company || r.name), detail: 'Write the quotation', link: `/quotes/new?lead=${r.id}` })) });
  }

  /* ---------- support: maintenance tickets ---------- */
  if (founder || hasFlag(u, 'maintenance')) {
    const sc = founder ? '' : ' AND ml.assignee_id=?';
    const sp = founder ? [] : [u.id];
    for (const r of all(`SELECT ml.id, ml.title, ml.priority, ml.reported_on, p.name project FROM maintenance_logs ml LEFT JOIN projects p ON p.id=ml.project_id WHERE ml.status<>'resolved' AND (ml.priority IN ('high','urgent') OR ml.reported_on<?)${sc} ORDER BY ml.reported_on LIMIT 6`, addDays(t, -3), ...sp)) {
      add({ key: `maint-${r.id}`, severity: ['urgent', 'high'].includes(r.priority) ? 'critical' : 'high', area: 'Support', title: `Support item open: ${r.title}`, detail: `${r.project ?? 'No project'} · reported ${r.reported_on ? dmy(r.reported_on) : 'earlier'}`, link: '/maintenance', date: r.reported_on });
    }
  }

  if (!founder) return finish(items);

  /* ---------- money ---------- */
  for (const r of all("SELECT i.id, i.number, i.due_date, MAX(i.total-i.paid_amount,0) bal, c.company FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.kind='invoice' AND i.status='overdue' ORDER BY i.due_date LIMIT 10")) {
    const days = Math.round((Date.parse(t) - Date.parse(r.due_date)) / 86_400_000);
    add({ key: `inv-overdue-${r.id}`, severity: days > 30 ? 'critical' : 'high', area: 'Money', title: `${r.company ?? 'Client'} owes ${inr(r.bal)}`, detail: `${r.number} · ${plural(days, 'day')} overdue — send a reminder`, link: `/invoices/${r.id}`, date: r.due_date, amount: r.bal });
  }
  for (const r of all("SELECT i.id, i.number, i.due_date, MAX(i.total-i.paid_amount,0) bal, c.company FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.kind='invoice' AND i.status IN ('sent','partial') AND i.due_date BETWEEN ? AND ? ORDER BY i.due_date LIMIT 5", t, addDays(t, 3))) {
    add({ key: `inv-soon-${r.id}`, severity: 'normal', area: 'Money', title: `Invoice due soon: ${r.company ?? ''} ${inr(r.bal)}`, detail: r.number, link: `/invoices/${r.id}`, date: r.due_date, amount: r.bal });
  }
  for (const r of all("SELECT i.id, i.number, i.total, c.company FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.status='draft' AND i.kind='invoice' AND date(i.created_at)<? LIMIT 5", addDays(t, -3))) {
    add({ key: `inv-draft-${r.id}`, severity: 'normal', area: 'Money', title: `Invoice still a draft: ${r.number}`, detail: `${r.company ?? ''} · ${inr(r.total)} — send it or delete it`, link: `/invoices/${r.id}`, amount: r.total });
  }
  for (const r of all("SELECT i.id, i.number, i.paid_amount-i.total extra, c.company FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.kind='invoice' AND i.status<>'cancelled' AND i.paid_amount > i.total + 0.005 LIMIT 5")) {
    add({ key: `inv-over-${r.id}`, severity: 'normal', area: 'Money', title: `Invoice overpaid: ${r.number}`, detail: `${r.company ?? ''} paid ${inr(r.extra)} more than the invoice — refund it, adjust it, or check the payment`, link: `/invoices/${r.id}`, amount: r.extra });
  }
  // TDS is a tax credit: chase the certificate, then claim it in the ITR
  const tdsRows = all("SELECT pm.date, pm.tds, pm.tds_status, COALESCE(c.company,'a client') company FROM payments pm LEFT JOIN clients c ON c.id=pm.client_id WHERE pm.tds > 0 AND pm.tds_status<>'claimed'");
  const byFy = new Map<string, number>();
  const awaiting = new Map<string, number>();
  for (const r of tdsRows) {
    byFy.set(fyOf(r.date), (byFy.get(fyOf(r.date)) ?? 0) + r.tds);
    if (r.tds_status === 'deducted' && r.date <= addDays(t, -90)) awaiting.set(r.company, (awaiting.get(r.company) ?? 0) + r.tds);
  }
  for (const [fy, amt] of byFy) {
    if (t > fyRange(fy).to) add({ key: `tds-claim-${fy}`, severity: 'high', area: 'Money', title: `${inr(amt)} TDS of FY ${fy} is not claimed yet`, detail: `Claim it when you file the ITR for AY ${assessmentYear(fy)}, then mark it claimed`, link: `/analytics?tab=tds&fy=${fy}`, amount: amt });
  }
  for (const [company, amt] of awaiting) add({ key: `tds-cert-${company}`, severity: 'normal', area: 'Money', title: `Ask ${company} for the TDS certificate (${inr(amt)})`, detail: 'Deducted more than 90 days ago and the Form 16A is not recorded — check it in 26AS', link: '/analytics?tab=tds&status=deducted', amount: amt });
  // payments that are ready to be billed
  for (const r of all('SELECT ms.id, ms.title, ms.amount, ms.reached_on, ms.due_date, p.id pid, p.name project FROM milestones ms JOIN projects p ON p.id=ms.project_id WHERE ms.invoice_id IS NULL AND (ms.reached_on IS NOT NULL OR ms.due_date<=?) ORDER BY COALESCE(ms.reached_on, ms.due_date) LIMIT 8', t)) {
    add({ key: `ms-${r.id}`, severity: r.reached_on ? 'high' : 'normal', area: 'Money', title: `Ready to invoice: ${r.title} — ${inr(r.amount)}`, detail: `${r.project} · ${r.reached_on ? 'work finished' : 'scheduled date reached'}`, link: `/projects/${r.pid}?tab=finance`, date: r.reached_on ?? r.due_date, amount: r.amount });
  }
  // accepted quotes nobody acted on
  for (const r of all("SELECT q.id, q.number, q.total, c.company FROM quotes q LEFT JOIN clients c ON c.id=q.client_id WHERE q.status='accepted' AND q.client_id IS NOT NULL AND q.project_id IS NULL AND q.change_request_id IS NULL AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.quote_id=q.id) LIMIT 5")) {
    add({ key: `quote-accepted-${r.id}`, severity: 'high', area: 'Money', title: `Accepted quotation not acted on: ${r.number}`, detail: `${r.company ?? ''} · ${inr(r.total)} — start the project or raise the invoice`, link: `/quotes/${r.id}`, amount: r.total });
  }
  for (const r of all("SELECT q.id, q.number, q.total, q.issue_date, COALESCE(c.company, l.company, l.name) who FROM quotes q LEFT JOIN clients c ON c.id=q.client_id LEFT JOIN leads l ON l.id=q.lead_id WHERE q.status='sent' AND q.issue_date<=? ORDER BY q.issue_date LIMIT 5", addDays(t, -7))) {
    add({ key: `quote-wait-${r.id}`, severity: 'normal', area: 'Sales', title: `Quotation unanswered for a week: ${r.who ?? r.number}`, detail: `${r.number} · ${inr(r.total)} — follow up`, link: `/quotes/${r.id}`, date: r.issue_date, amount: r.total });
  }
  // work done for a client that has not been billed
  for (const r of all("SELECT cr.id, cr.title, cr.estimate_amount a, p.name project, p.id pid FROM change_requests cr JOIN projects p ON p.id=cr.project_id WHERE cr.billable=1 AND cr.status='delivered' AND cr.invoice_id IS NULL AND cr.estimate_amount>0 LIMIT 5")) {
    add({ key: `cr-unbilled-${r.id}`, severity: 'high', area: 'Money', title: `Delivered but not invoiced: ${r.title}`, detail: `${r.project} · ${inr(r.a)}`, link: `/projects/${r.pid}?tab=changes`, amount: r.a });
  }
  for (const r of all("SELECT cr.id, cr.title, cr.status, cr.requested_on, p.name project, p.id pid FROM change_requests cr JOIN projects p ON p.id=cr.project_id WHERE cr.status IN ('requested','estimated') ORDER BY cr.requested_on LIMIT 6")) {
    const late = r.requested_on && r.requested_on < addDays(t, -3);
    add({ key: `cr-wait-${r.id}`, severity: late ? 'high' : 'normal', area: 'Delivery', title: `Change request waiting for ${r.status === 'requested' ? 'an estimate' : 'a quotation'}: ${r.title}`, detail: `${r.project}${r.requested_on ? ` · asked ${dmy(r.requested_on)}` : ''}`, link: `/projects/${r.pid}?tab=changes`, date: r.requested_on });
  }
  // money still to get: what is agreed and not invoiced yet (TDS excluded — that is claimed in the ITR). Projects with a payment ready to invoice are already listed above.
  const readyProjects = new Set(items.filter((i) => i.key.startsWith('ms-')).map((i) => Number(i.link.match(/projects\/(\d+)/)?.[1])));
  for (const r of all(`SELECT p.id, p.name, p.status, c.company, MAX(0, ${PM_SQL.value} - ${PM_SQL.tds_eff} - ${PM_SQL.invoiced}) to_invoice
    FROM projects p LEFT JOIN clients c ON c.id=p.client_id WHERE p.status NOT IN ('cancelled','planning') ORDER BY p.id`)) {
    if (r.to_invoice < 1 || readyProjects.has(r.id)) continue;
    const finished = ['completed', 'maintenance'].includes(r.status);
    add({ key: `proj-toinvoice-${r.id}`, severity: finished ? 'high' : 'normal', area: 'Money', title: `${r.company ?? r.name}: ${inr(r.to_invoice)} still to get`, detail: `${r.name} · ${finished ? 'the project is finished — raise the invoice for the rest' : 'not invoiced yet'}`, link: `/projects/${r.id}?tab=finance`, amount: r.to_invoice, panel: true });
  }
  for (const r of all("SELECT p.id, p.name, c.company FROM projects p LEFT JOIN clients c ON c.id=p.client_id WHERE p.status IN ('active','review','completed','maintenance') AND (p.budget IS NULL OR p.budget=0) LIMIT 5")) {
    add({ key: `proj-novalue-${r.id}`, severity: 'normal', area: 'Money', title: `No agreed value on ${r.name}`, detail: `${r.company ?? ''} — set it so billing and profit can be tracked`, link: `/projects/${r.id}` });
  }

  // an accepted quotation needs its payment plan, then its first payment
  for (const r of all("SELECT p.id, p.name, p.budget, c.company FROM projects p LEFT JOIN clients c ON c.id=p.client_id WHERE p.status IN ('planning','active','review') AND p.budget>0 AND NOT EXISTS (SELECT 1 FROM milestones m WHERE m.project_id=p.id) LIMIT 8")) {
    add({ key: `plan-${r.id}`, severity: 'high', area: 'Money', title: `Plan the payments for ${r.name}`, detail: `${r.company ?? ''} · ${inr(r.budget)} — advance, milestones and TDS, so invoices follow the plan`, link: `/projects/${r.id}?tab=finance&plan=1`, amount: r.budget, panel: false });
  }
  for (const r of all("SELECT l.id, COALESCE(NULLIF(l.company,''), l.name) who, l.updated_at FROM leads l WHERE l.stage='accepted' ORDER BY l.updated_at LIMIT 8")) {
    add({ key: `lead-await-${r.id}`, severity: 'high', area: 'Sales', title: `Accepted, waiting for the first payment: ${r.who}`, detail: 'Collect the advance — the lead becomes a client when it arrives', link: `/leads/${r.id}` });
  }
  // work must not start before the advance is paid
  for (const r of all(`SELECT p.id, p.name, c.company, ${ADVANCE_SQL} adv, p.tds_percent FROM projects p LEFT JOIN clients c ON c.id=p.client_id
    WHERE p.status IN ('active','review') AND p.advance_required=1 AND ${ADVANCE_STATE_SQL}='unpaid'`)) {
    add({ key: `adv-unpaid-${r.id}`, severity: 'high', area: 'Money', title: `Work has started but the advance is not paid: ${r.name}`, detail: `${r.company ?? ''} · advance ${inr(r.adv - (r.adv * (r.tds_percent || 0)) / 100)} to receive — collect it before more work is done`, link: `/projects/${r.id}?tab=finance`, amount: r.adv - (r.adv * (r.tds_percent || 0)) / 100 });
  }

  /* ---------- delivery ---------- */
  for (const r of all("SELECT p.id, p.name, p.deadline, c.company FROM projects p LEFT JOIN clients c ON c.id=p.client_id WHERE p.status IN ('planning','active','review','at_risk') AND p.deadline IS NOT NULL AND p.deadline<=? ORDER BY p.deadline LIMIT 6", addDays(t, 7))) {
    const late = r.deadline < t;
    add({ key: `proj-deadline-${r.id}`, severity: late ? 'critical' : 'high', area: 'Delivery', title: late ? `Project past its deadline: ${r.name}` : `Deadline this week: ${r.name}`, detail: r.company ?? '', link: `/projects/${r.id}`, date: r.deadline });
  }
  for (const r of all("SELECT p.id, p.name FROM projects p WHERE p.status='at_risk' LIMIT 5")) add({ key: `proj-risk-${r.id}`, severity: 'high', area: 'Delivery', title: `Project marked at risk: ${r.name}`, detail: 'Decide what unblocks it', link: `/projects/${r.id}` });
  for (const r of all("SELECT p.id, p.name FROM projects p WHERE p.status IN ('active','review') AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.project_id=p.id) LIMIT 5")) {
    add({ key: `proj-notasks-${r.id}`, severity: 'normal', area: 'Delivery', title: `Active project with no tasks: ${r.name}`, detail: 'Break the work into tasks and give them owners', link: `/projects/${r.id}?tab=tasks` });
  }
  for (const r of all("SELECT p.id, p.name, c.company FROM projects p LEFT JOIN clients c ON c.id=p.client_id WHERE p.status='completed' AND p.completed_on>=? AND NOT EXISTS (SELECT 1 FROM renewals r WHERE r.project_id=p.id AND r.kind='amc' AND r.status='active') LIMIT 4", addDays(t, -45))) {
    add({ key: `proj-amc-${r.id}`, severity: 'normal', area: 'Sales', title: `Offer maintenance to ${r.company ?? r.name}`, detail: `${r.name} was delivered — no maintenance plan yet`, link: '/renewals' });
  }

  /* ---------- recurring and admin ---------- */
  for (const r of all("SELECT id, name, kind, renewal_date FROM renewals WHERE status='active' AND renewal_date IS NOT NULL AND renewal_date<=? AND (auto_debit=0 OR kind='amc') ORDER BY renewal_date LIMIT 8", addDays(t, 30))) {
    const late = r.renewal_date < t;
    add({ key: `ren-${r.id}`, severity: late ? 'critical' : 'normal', area: r.kind === 'amc' ? 'Sales' : 'Admin', title: r.kind === 'amc' ? `${late ? 'Maintenance plan ended' : 'Maintenance plan ends'}: ${r.name}` : `${late ? 'Renewal overdue' : 'Renewal due'}: ${r.name}`, detail: r.kind === 'amc' ? 'Renew the plan or the client loses support' : 'Pay it or cancel it', link: '/renewals', date: r.renewal_date });
  }
  const est = one("SELECT COUNT(*) n, COALESCE(SUM(amount),0) v FROM expenses WHERE status='pending' AND is_estimate=1");
  if (est.n) add({ key: 'bills-estimate', severity: 'normal', area: 'Admin', title: `${plural(est.n as number, 'bill')} recorded as an estimate`, detail: `${inr(est.v as number)} — enter the real amount when it arrives`, link: '/finance?tab=expenses', count: est.n as number, amount: est.v as number });
  for (const r of all('SELECT id, title, expiry_date FROM documents WHERE expiry_date IS NOT NULL AND expiry_date<=? ORDER BY expiry_date LIMIT 4', addDays(t, 30))) {
    add({ key: `doc-${r.id}`, severity: r.expiry_date < t ? 'high' : 'normal', area: 'Admin', title: `${r.expiry_date < t ? 'Expired' : 'Expires soon'}: ${r.title}`, detail: 'Renew the document', link: '/documents', date: r.expiry_date });
  }
  for (const r of all("SELECT id, name, next_report_date FROM grants WHERE status NOT IN ('closed','rejected') AND next_report_date IS NOT NULL AND next_report_date<=? LIMIT 3", addDays(t, 14))) {
    add({ key: `grant-${r.id}`, severity: r.next_report_date < t ? 'high' : 'normal', area: 'Admin', title: `Grant report due: ${r.name}`, detail: 'Utilisation report for the funder', link: '/grants', date: r.next_report_date });
  }
  return finish(items);
}
