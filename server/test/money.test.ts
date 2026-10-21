import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { today as localToday } from '@crm/shared';
import { runAutoDebits } from '../src/jobs/autoDebit';
import { createDemo, type Demo } from './demo';
import { ago, inn } from './helpers';

let d: Demo;
const sql = (q: string, ...p: unknown[]) => d.app.ctx.db.prepare(q).all(...p) as Record<string, number | string>[];
beforeAll(async () => { d = await createDemo(); });
afterAll(() => d.app.close());

describe('spending analysis (where the money went)', () => {
  it('groups paid expenses by any dimension and always adds up to the total', async () => {
    const total = (sql("SELECT SUM(amount) v FROM expenses WHERE status='paid'")[0] as { v: number }).v;
    for (const by of ['category', 'vendor', 'project', 'client', 'grant', 'account', 'paid_by', 'month', 'recurring', 'mode']) {
      const r = (await d.F.get(`/analytics/spending?by=${by}`)).j;
      expect(r.total, by).toBeCloseTo(total, 2);
      expect(r.rows.reduce((s: number, x: { amount: number }) => s + x.amount, 0), by).toBeCloseTo(total, 2);
      expect(r.months.reduce((s: number, x: { amount: number }) => s + x.amount, 0), by).toBeCloseTo(total, 2);
    }
  });
  it('filters by date, category, vendor, project, grant and says how much came from the grant', async () => {
    const all = (await d.F.get('/analytics/spending')).j;
    const some = (await d.F.get(`/analytics/spending?from=${ago(30)}&to=${inn(0)}`)).j;
    expect(some.total).toBeLessThanOrEqual(all.total);
    const cat = all.rows[0].label;
    const onlyCat = (await d.F.get(`/analytics/spending?category=${encodeURIComponent(cat)}`)).j;
    expect(onlyCat.total).toBeCloseTo(all.rows[0].amount, 2);
    const granted = (await d.F.get('/analytics/spending?grant=any&by=grant')).j;
    expect(granted.rows.every((r: { key: number }) => r.key !== 0)).toBe(true);
    const grantSql = (sql("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='paid' AND grant_id IS NOT NULL")[0] as { v: number }).v;
    expect(granted.total).toBeCloseTo(grantSql, 2);
    expect((await d.F.get('/analytics/spending?by=; DROP TABLE expenses')).s).toBe(400);
    expect((await d.F.get('/analytics/spending?from=2026-13-45')).s).toBe(400);
  });
  it('is founder-only', async () => {
    for (const u of ['/analytics/spending', '/analytics/income', '/analytics/receivables', '/analytics/grants', '/analytics/subscriptions']) expect((await d.K.get(u)).s, u).toBe(403);
  });
});

describe('income analysis', () => {
  it('adds up to every payment received, by client, project, category, month', async () => {
    const total = (sql('SELECT SUM(amount) v FROM payments')[0] as { v: number }).v;
    for (const by of ['client', 'project', 'category', 'account', 'mode', 'grant', 'month']) {
      const r = (await d.F.get(`/analytics/income?by=${by}`)).j;
      expect(r.total, by).toBeCloseTo(total, 2);
      expect(r.rows.reduce((s: number, x: { amount: number }) => s + x.amount, 0), by).toBeCloseTo(total, 2);
    }
  });
});

describe('received vs pending', () => {
  it('shows for every project what was agreed, invoiced, received (cash only), still pending and not yet billed — TDS is kept out of the invoice', async () => {
    const p = (await d.F.post('/projects', { client_id: d.clients.green, name: 'Receivable Test', status: 'active', budget: 130000 })).j;
    const inv = (await d.F.post('/invoices', { client_id: d.clients.green, project_id: p.id, status: 'sent', due_date: inn(10), items: [{ description: 'Phase 1', qty: 1, rate: 90000 }], tax_type: 'none' })).j;
    // we invoice what we will receive (90,000); the client pays exactly that and deducts 10,000 TDS on top, tracked apart
    await d.F.post('/payments', { invoice_id: inv.id, amount: 90000, tds: 10000, date: ago(1) });
    const r = (await d.F.get('/analytics/receivables')).j;
    const row = r.projects.find((x: { id: number }) => x.id === p.id);
    expect(row).toMatchObject({ value: 130000, invoiced: 90000, cash: 90000, tds: 10000, received: 90000, pending: 0, unbilled: 30000 });
    const client = r.clients.find((c: { client_id: number }) => c.client_id === d.clients.green);
    expect(client.value).toBeGreaterThanOrEqual(130000);
    const sumPending = r.projects.reduce((s: number, x: { pending: number }) => s + x.pending, 0);
    expect(r.totals.pending).toBeCloseTo(sumPending, 2);
    const openInv = (sql("SELECT COALESCE(SUM(total-paid_amount),0) v FROM invoices WHERE kind='invoice' AND status IN ('sent','partial','overdue') AND project_id IS NOT NULL")[0] as { v: number }).v;
    expect(r.totals.pending).toBeCloseTo(openInv, 2);
  });
});

describe('grant utilisation', () => {
  it('explains where each grant rupee went: category, vendor, project, month, remaining and missing receipts', async () => {
    const r = (await d.F.get('/analytics/grants')).j;
    expect(r.grants.length).toBeGreaterThan(0);
    const g = r.grants[0];
    expect(g.remaining).toBeCloseTo(g.received - g.used, 2);
    expect(g.by_category.reduce((s: number, x: { amount: number }) => s + x.amount, 0)).toBeCloseTo(g.used, 2);
    expect(g.by_month.reduce((s: number, x: { amount: number }) => s + x.amount, 0)).toBeCloseTo(g.used, 2);
    expect(typeof g.missing_receipts).toBe('number');
    const one = (await d.F.get(`/analytics/grants/${g.id}`)).j;
    expect(one.id).toBe(g.id);
    expect((await d.F.get('/analytics/grants/99999')).s).toBe(404);
  });
});

describe('subscriptions: company or person, and a price that changes for one cycle', () => {
  it('only debits the company ones; a personal subscription is tracked, not deducted', async () => {
    const mk = async (name: string, scope: string) => (await d.F.post('/renewals', { name, kind: 'subscription', cycle: 'monthly', renewal_date: ago(0), our_cost: 500, auto_debit: true, scope })).j.id as number;
    const company = await mk('Company Tool', 'company');
    const personal = await mk('Personal Tool', 'personal');
    runAutoDebits(d.app.ctx);
    expect(sql('SELECT id FROM expenses WHERE renewal_id=?', company)).toHaveLength(1);
    expect(sql('SELECT id FROM expenses WHERE renewal_id=?', personal)).toHaveLength(0);
    const s = (await d.F.get('/analytics/subscriptions')).j;
    expect(s.personal_monthly).toBeGreaterThanOrEqual(500);
    expect(s.company_monthly + s.personal_monthly).toBeCloseTo(s.monthly_total, 2);
  });
});

describe('lead specification becomes the project specification', () => {
  it('carries the specification, requirement and files from the lead into the new project', async () => {
    const lead = (await d.F.post('/leads', { company: 'Specs Co', name: 'Spec Person', stage: 'proposal', requirement: 'Booking website', specs: 'Pages: home, services, booking.\nPayments via Razorpay.', value: 80000 })).j;
    await d.F.post('/documents/link', { entity_type: 'lead', entity_id: lead.id, url: 'https://drive.example/brief', title: 'Client brief' });
    const r = await d.F.post(`/leads/${lead.id}/convert`, { create_project: true, project_name: 'Specs Co Website' });
    expect(r.s).toBe(200);
    const project = (await d.F.get(`/projects/${r.j.project_id}`)).j;
    expect(project.specs).toContain('Razorpay');
    expect(project.description).toBe('Booking website');
    const docs = (await d.F.get(`/documents?entity_type=project&entity_id=${project.id}`)).j;
    expect(docs.map((x: { title: string }) => x.title)).toContain('Client brief');
    expect((await d.F.get(`/documents?entity_type=lead&entity_id=${lead.id}`)).j).toHaveLength(0);
  });
});

describe('edge cases in the money rules', () => {
  it('keeps amounts to whole paise, explains a missing linked record, and treats an overpaid invoice as credit — never as negative pending', async () => {
    const client = (await d.F.get('/clients')).j[0];
    const odd = await d.F.post('/expenses', { date: inn(0), amount: 10.005, category: 'Other', description: 'rounding' });
    expect(odd.s).toBe(201);
    expect(odd.j.amount).toBe(10.01);
    const ghost = await d.F.post('/payments', { date: inn(0), amount: 10, client_id: 999999 });
    expect(ghost.s).toBe(409);
    expect(ghost.j.error).toMatch(/no longer exists/);
    const inv = (await d.F.post('/invoices', { client_id: client.id, title: 'Overpay', issue_date: inn(0), due_date: inn(10), status: 'sent', items: JSON.stringify([{ description: 'Work', qty: 1, rate: 1000 }]), tax_type: 'none', tax_rate: 0 })).j;
    await d.F.post('/payments', { date: inn(0), amount: 1250, client_id: client.id, invoice_id: inv.id });
    const got = (await d.F.get(`/invoices/${inv.id}`)).j;
    expect(got.status).toBe('paid');
    expect(got.balance).toBe(0);
    expect(got.credit).toBe(250);
    const att = (await d.F.get('/attention')).j.items as { key: string }[];
    expect(att.some((x) => x.key === `inv-over-${inv.id}`)).toBe(true);
    const rec = (await d.F.get('/analytics/receivables')).j;
    expect(rec.totals.pending).toBeGreaterThanOrEqual(0);
    expect(rec.clients.every((c: { pending: number }) => c.pending >= 0)).toBe(true);
  });
});

describe('TDS: a tax credit claimed in the ITR, tracked apart from cash', () => {
  it('reports deducted / certificate / claimed by financial year and client, keeps it out of cash, and flags an ended year that is not claimed', async () => {
    const client = (await d.F.get('/clients')).j[0];
    const a = (await d.F.post('/payments', { date: '2025-03-31', amount: 9000, tds: 1000, client_id: client.id, tds_section: '194J' })).j; // FY 2024-25
    const b = (await d.F.post('/payments', { date: '2025-04-01', amount: 18000, tds: 2000, client_id: client.id })).j; // FY 2025-26
    expect(a.tds_status).toBe('deducted');
    const all = (await d.F.get('/analytics/tds')).j;
    const y = Object.fromEntries(all.years.map((r: { key: string; deducted: number }) => [r.key, r.deducted]));
    expect(y['2024-25']).toBeGreaterThanOrEqual(1000);
    expect(y['2025-26']).toBeGreaterThanOrEqual(2000);
    expect(all.years.find((r: { key: string }) => r.key === '2025-26').ay).toBe('2026-27');
    const entry = all.entries.find((e: { id: number }) => e.id === b.id);
    expect(entry.gross).toBe(20000);
    expect(entry.rate).toBe(10);
    const sqlTds = (sql("SELECT COALESCE(SUM(tds),0) v FROM payments")[0] as { v: number }).v;
    expect(all.totals.deducted).toBeCloseTo(sqlTds, 2);
    expect(all.totals.to_claim).toBeCloseTo(sqlTds, 2);
    const att = (await d.F.get('/attention')).j.items as { key: string }[];
    expect(att.some((x) => x.key === 'tds-claim-2024-25')).toBe(true);
    // mark one claimed: the claim date is filled in and the totals move
    const claimed = await d.F.call('PUT', `/payments/${a.id}`, { tds_status: 'claimed' });
    expect(claimed.s).toBe(200);
    expect(claimed.j.tds_claimed_on).toBe(localToday());
    const after = (await d.F.get('/analytics/tds?fy=2024-25')).j;
    expect(after.totals.claimed).toBeGreaterThanOrEqual(1000);
    expect(after.entries.every((e: { fy: string }) => e.fy === '2024-25')).toBe(true);
    expect((await d.F.get('/analytics/tds?status=claimed')).j.entries.every((e: { tds_status: string }) => e.tds_status === 'claimed')).toBe(true);
    // moving it back clears the claim date
    const back = await d.F.call('PUT', `/payments/${a.id}`, { tds_status: 'certificate' });
    expect(back.j.tds_claimed_on).toBeNull();
  });
  it('is founder-only, validates input, exports to Excel and PDF, and shows in the finance summary and dashboard', async () => {
    expect((await d.K.get('/analytics/tds')).s).toBe(403);
    expect((await d.F.get('/analytics/tds?fy=banana')).s).toBe(400);
    expect((await d.F.get('/analytics/tds?status=nope')).s).toBe(400);
    expect((await d.F.get('/analytics/tds?fy=2025-26; DROP TABLE payments')).s).toBe(400);
    const fin = (await d.F.get('/finance/summary')).j;
    expect(fin.tds.deducted).toBeGreaterThan(0);
    expect((await d.F.get('/dashboard')).j.kpi.tds.to_claim).toBeGreaterThan(0);
    const login = await d.app.request.post('/api/auth/login').set('X-Requested-With', 'crm').send({ email: 'aarav@demo.test', password: 'Demo-Pass-2026' });
    const cookie = String((login.headers['set-cookie'] as unknown as string[])[0]).split(';')[0] as string;
    const x = await d.app.request.get('/api/analytics/tds/export.xlsx').set('X-Requested-With', 'crm').set('Cookie', cookie);
    expect(x.status).toBe(200);
    const p = await d.app.request.get('/api/analytics/tds/export.pdf').set('X-Requested-With', 'crm').set('Cookie', cookie);
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toBe('application/pdf');
  });
});
