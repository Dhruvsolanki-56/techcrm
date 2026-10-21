import path from 'node:path';
import fs from 'node:fs';
import express, { type Request, type Response } from 'express';
import { addDays, round2, TDS_STATUSES, today, validDate } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import type { Engine } from '../crud/engine';
import { toPdf, toXlsx } from './exporters';
import { attention } from '../analytics/attention';
import { grants as grantUsage, income, receivables, spending, subscriptions, tdsReport } from '../analytics/money';
import { dashboard } from '../analytics/dashboard';
import { deliveryAnalytics } from '../analytics/delivery';
import { financeAnalytics, financeSummary } from '../analytics/finance';
import { salesAnalytics } from '../analytics/sales';
import { markOverdue } from '../domain/billing';
import { forbidden } from '../shared/errors';
import { founderOnly } from '../http/middleware';
import { intOrNull } from '../http/validate';
import { notFound } from '../shared/errors';
import { hasFlag, isFounder, type User } from '../security/permissions';

const taskLink = (id: number): string => `/tasks?open=${id}`;

/** Read-only views: dashboard, analytics, calendar, search, activity log, backup download. */
export function insightRoutes(ctx: AppContext, engine: Engine): express.Router {
  const router = express.Router();
  const { db } = ctx;
  const user = (req: Request): User => req.user as User;

  router.get('/dashboard', (req: Request, res: Response) => {
    res.json(dashboard(ctx, engine, user(req)));
  });

  router.get('/attention', (req: Request, res: Response) => {
    res.json(attention(ctx, user(req)));
  });

  router.get('/finance/summary', founderOnly, (req: Request, res: Response) => {
    res.json(financeSummary(ctx, { from: req.query.from as string | undefined, to: req.query.to as string | undefined }));
  });
  router.get('/analytics/finance', founderOnly, (req: Request, res: Response) => {
    res.json(financeAnalytics(ctx, intOrNull(req.query.months) ?? 12));
  });
  router.get('/analytics/spending', founderOnly, (req: Request, res: Response) => { res.json(spending(ctx, req.query as Record<string, unknown>)); });
  router.get('/analytics/income', founderOnly, (req: Request, res: Response) => { res.json(income(ctx, req.query as Record<string, unknown>)); });
  router.get('/analytics/receivables', founderOnly, (_req: Request, res: Response) => { res.json(receivables(ctx)); });
  router.get('/analytics/grants', founderOnly, (_req: Request, res: Response) => { res.json(grantUsage(ctx)); });
  router.get('/analytics/grants/:id', founderOnly, (req: Request, res: Response) => {
    const id = intOrNull(req.params.id);
    const r = id ? grantUsage(ctx, id) : null;
    if (!r || !(r.grants as unknown[]).length) throw notFound();
    res.json((r.grants as unknown[])[0]);
  });
  router.get('/analytics/tds', founderOnly, (req: Request, res: Response) => { res.json(tdsReport(ctx, req.query as Record<string, unknown>)); });
  for (const fmt of ['xlsx', 'pdf'] as const) {
    router.get(`/analytics/tds/export.${fmt}`, founderOnly, async (req: Request, res: Response) => {
      const r = tdsReport(ctx, req.query as Record<string, unknown>);
      const label = (s: unknown): string => TDS_STATUSES.find(([k]) => k === s)?.[1] ?? String(s);
      const rows = (r.entries as Row[]).map((e) => ({
        date: e.date, financial_year: e.fy, client: e.client_name ?? '', invoice: e.invoice_number ?? '', project: e.project_name ?? '', received_in_bank: e.amount, tds_deducted: e.tds, gross_billed: e.gross,
        deduction_rate: e.rate, section: e.tds_section ?? '', status: label(e.tds_status), claimed_on: e.tds_claimed_on ?? '',
      }));
      const note = `TDS report${r.fy ? ` · FY ${String(r.fy)}` : ''} · deducted ₹${(r.totals as { deducted: number }).deducted} · claimed ₹${(r.totals as { claimed: number }).claimed}`;
      const out = fmt === 'xlsx' ? await toXlsx('TDS report', rows as Row[], note, 'tds', user(req).name) : await toPdf('TDS report', 'tds', rows as Row[], note, user(req).name);
      res.setHeader('Content-Type', fmt === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="tds-${today()}.${fmt}"`);
      res.send(out);
    });
  }
  router.get('/analytics/subscriptions', founderOnly, (_req: Request, res: Response) => { res.json(subscriptions(ctx)); });
  router.get('/analytics/delivery', (req: Request, res: Response) => {
    res.json(deliveryAnalytics(ctx, user(req)));
  });
  const sales = (req: Request, res: Response): void => {
    if (!hasFlag(user(req), 'leads')) throw forbidden();
    res.json(salesAnalytics(ctx, engine, user(req), { year: typeof req.query.year === 'string' ? req.query.year : undefined }));
  };
  router.get('/sales/analytics', sales);
  router.get('/analytics/sales', sales);

  /* ---------- calendar: everything with a date, in one list ---------- */
  router.get('/calendar', (req: Request, res: Response) => {
    markOverdue(ctx);
    const u = user(req);
    const from = typeof req.query.from === 'string' && validDate(req.query.from) ? req.query.from : `${today().slice(0, 7)}-01`;
    const to = typeof req.query.to === 'string' && validDate(req.query.to) ? req.query.to : addDays(from, 41);
    const items: { date: string; type: string; title: string; sub?: string | null; link: string | null; event_id?: number }[] = [];
    const push = (rows: Row[], f: (r: Row) => (typeof items)[number]): void => rows.forEach((r) => items.push(f(r)));
    const between = (col: string): [string, unknown[]] => [`${col} BETWEEN ? AND ?`, [from, to]];
    let [w, p] = between('p.deadline');
    push(engine.query('projects', u, `p.status NOT IN ('completed','cancelled','maintenance','on_hold') AND ${w}`, p, 500), (r) => ({ date: r.deadline, type: 'project', title: `Deadline: ${r.name}`, sub: r.client_name, link: `/projects/${r.id}` }));
    [w, p] = between('t.due_date');
    push(engine.query('tasks', u, `t.status<>'done' AND ${w}${isFounder(u) ? '' : ' AND t.id IN (SELECT task_id FROM task_assignees WHERE user_id=?)'}`, isFounder(u) ? p : [...p, u.id], 500),
      (r) => ({ date: r.due_date, type: 'task', title: `Task: ${r.title}`, sub: r.assignee_name || r.project_name, link: taskLink(r.id) }));
    [w, p] = between('ev.date');
    push(engine.query('events', u, w, p, 500), (r) => ({ date: r.date, type: 'event', title: r.title, sub: [r.kind, r.client_name].filter(Boolean).join(' · '), link: null, event_id: r.id }));
    if (isFounder(u)) {
      [w, p] = between('i.due_date');
      push(engine.query('invoices', u, `i.status IN ('sent','partial','overdue') AND ${w}`, p, 500), (r) => ({ date: r.due_date, type: 'invoice', title: `Invoice due: ${r.number}`, sub: `${r.client_name} · ₹${round2(r.total - r.paid_amount).toLocaleString('en-IN')}`, link: `/invoices/${r.id}` }));
      [w, p] = between('ms.due_date');
      push(engine.query('milestones', u, `ms.invoice_id IS NULL AND ${w}`, p, 300), (r) => ({ date: r.due_date, type: 'milestone', title: `Raise invoice: ${r.title}`, sub: `${r.project_name} · ₹${round2(r.amount).toLocaleString('en-IN')}`, link: `/projects/${r.project_id}?tab=finance` }));
      [w, p] = between('q.valid_until');
      push(engine.query('quotes', u, `q.status='sent' AND ${w}`, p, 200), (r) => ({ date: r.valid_until, type: 'quote', title: `Quote expires: ${r.number}`, sub: r.client_name || r.lead_name, link: `/quotes/${r.id}` }));
      [w, p] = between('g.next_report_date');
      push(engine.query('grants', u, `g.status NOT IN ('closed','rejected') AND ${w}`, p, 100), (r) => ({ date: r.next_report_date, type: 'grant', title: `Grant report due: ${r.name}`, sub: r.funder || '', link: '/grants' }));
      [w, p] = between('d.expiry_date');
      push(engine.query('documents', u, w, p, 200), (r) => ({ date: r.expiry_date, type: 'document', title: `Expires: ${r.title}`, sub: r.entity_name || r.category || '', link: '/documents' }));
      [w, p] = between('r.renewal_date');
      push(engine.query('renewals', u, `r.status='active' AND ${w}`, p, 500), (r) => ({
        date: r.renewal_date, type: 'renewal', title: `${r.auto_debit ? 'Auto-debit' : 'Renewal'}: ${r.name}`,
        sub: [r.kind === 'amc' ? 'Maintenance plan' : r.kind, r.client_name].filter(Boolean).join(' · '), link: '/renewals',
      }));
    }
    if (hasFlag(u, 'leads')) {
      [w, p] = between('l.next_followup');
      push(engine.query('leads', u, `l.stage NOT IN ('won','closed','lost') AND ${w}`, p, 500), (r) => ({ date: r.next_followup, type: 'followup', title: `Follow up: ${r.name}`, sub: r.company, link: `/leads/${r.id}` }));
    }
    items.sort((a, b) => a.date.localeCompare(b.date));
    res.json({ from, to, items });
  });

  /* ---------- global search across everything the person may open ---------- */
  router.get('/search', (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const u = user(req);
    const out: { type: string; title: string; sub: string; link: string }[] = [];
    const run = (name: string, type: string, title: (r: Row) => string, sub: (r: Row) => string, link: (r: Row) => string): void => {
      const { rows } = engine.list(name, u, { q, limit: 6 });
      for (const r of rows) out.push({ type, title: title(r), sub: sub(r), link: link(r) });
    };
    const safe = (name: string, fn: () => void): void => {
      const def = engine.resources[name];
      if (def && def.scope(u).where !== '1=0') fn();
    };
    safe('clients', () => run('clients', 'Client', (r) => r.company, (r) => r.industry || r.city || '', (r) => `/clients/${r.id}`));
    safe('contacts', () => run('contacts', 'Contact', (r) => r.name, (r) => `${r.client_name}${r.email ? ` · ${r.email}` : ''}`, (r) => `/clients/${r.client_id}`));
    safe('leads', () => run('leads', 'Lead', (r) => r.name, (r) => `${r.company || ''} · ${r.stage}`, (r) => `/leads/${r.id}`));
    safe('projects', () => run('projects', 'Project', (r) => r.name, (r) => r.client_name || '', (r) => `/projects/${r.id}`));
    safe('change_requests', () => run('change_requests', 'Change request', (r) => `${r.ref} · ${r.title}`, (r) => `${r.project_name} · ${r.status}`, (r) => `/projects/${r.project_id}?tab=changes`));
    safe('tasks', () => run('tasks', 'Task', (r) => `T-${r.id} · ${r.title}`, (r) => r.assignee_name || '', (r) => taskLink(r.id)));
    safe('invoices', () => run('invoices', 'Invoice', (r) => r.number, (r) => `${r.client_name} · ${r.status}`, (r) => `/invoices/${r.id}`));
    safe('quotes', () => run('quotes', 'Quote', (r) => r.number, (r) => `${r.client_name || r.lead_name || ''} · ${r.status}`, (r) => `/quotes/${r.id}`));
    safe('documents', () => run('documents', 'Document', (r) => r.title, (r) => r.entity_name || r.category, () => '/documents'));
    safe('renewals', () => run('renewals', 'Renewal', (r) => r.name, (r) => r.client_name || '', () => '/renewals'));
    if (isFounder(u)) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      for (const r of db.prepare(`SELECT cr.*, c.company AS client_name, p.name AS project_name FROM credentials cr LEFT JOIN clients c ON c.id=cr.client_id LEFT JOIN projects p ON p.id=cr.project_id
        WHERE cr.label LIKE ? ESCAPE '\\' OR cr.url LIKE ? ESCAPE '\\' OR cr.username LIKE ? ESCAPE '\\' LIMIT 6`).all(like, like, like) as Row[]) {
        out.push({ type: 'Credential', title: r.label, sub: r.client_name || r.project_name || '', link: '/vault' });
      }
    }
    res.json(out);
  });

  /* ---------- admin: activity log (paged) and a downloadable database backup ---------- */
  for (const fmt of ['xlsx', 'pdf'] as const) {
    router.get(`/audit/export.${fmt}`, founderOnly, async (req: Request, res: Response) => {
      let where = '1=1';
      const p: unknown[] = [];
      if (req.query.user_id) { where += ' AND user_id=?'; p.push(String(req.query.user_id)); }
      if (req.query.action) { where += ' AND action=?'; p.push(String(req.query.action)); }
      if (req.query.entity) { where += ' AND entity=?'; p.push(String(req.query.entity)); }
      const rows = db.prepare(`SELECT at, user_name, action, entity, entity_id, detail, ip FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT 20000`).all(...p) as Row[];
      const out = fmt === 'xlsx' ? await toXlsx('Activity log', rows, undefined, 'audit', user(req).name) : await toPdf('Activity log', 'audit', rows, undefined, user(req).name);
      res.setHeader('Content-Type', fmt === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="activity-log-${today()}.${fmt}"`);
      res.send(out);
    });
  }
  router.get('/audit', founderOnly, (req: Request, res: Response) => {
    const limit = Math.min(Math.max(intOrNull(req.query.limit) ?? 100, 1), 1000);
    const offset = Math.max(intOrNull(req.query.offset) ?? 0, 0);
    let where = '1=1';
    const p: unknown[] = [];
    if (req.query.user_id) { where += ' AND user_id=?'; p.push(String(req.query.user_id)); }
    if (req.query.action) { where += ' AND action=?'; p.push(String(req.query.action)); }
    if (req.query.entity) { where += ' AND entity=?'; p.push(String(req.query.entity)); }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q) { where += " AND (detail LIKE ? ESCAPE '\\' OR user_name LIKE ? ESCAPE '\\')"; const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`; p.push(like, like); }
    res.setHeader('X-Total-Count', String((db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE ${where}`).get(...p) as { n: number }).n));
    res.json(db.prepare(`SELECT * FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, limit, offset));
  });

  router.get('/backup', founderOnly, async (req: Request, res: Response) => {
    const file = path.join(ctx.config.backupDir, `manual-${Date.now()}.db`);
    await db.backup(file);
    ctx.audit(user(req), 'backup', 'system', null, 'Database downloaded', req.ip);
    res.download(file, `techsentinals-crm-backup-${today()}.db`, () => fs.unlink(file, () => undefined));
  });

  return router;
}
