import { addDays, today as localToday } from '@crm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAutoDebits } from '../src/jobs/autoDebit';
import { createTestApp, PASSWORD, type LoggedIn, type TestApp } from './helpers';

/**
 * One company's whole year on a brand-new database, checked after every step against every screen's numbers:
 * lead → conversation → quotation → client + project → payment schedule → invoices → payments with TDS → change requests (payable or not)
 * → maintenance plan → subscriptions → grant spending → TDS claim. Money is checked three ways: the screen's API, the ledger tables, and what a person would add up.
 */
let app: TestApp;
let F: LoggedIn;
const t = localToday();
const sql = <R = Record<string, number>>(q: string, ...p: unknown[]): R => app.ctx.db.prepare(q).get(...p) as R;
const S: Record<string, number> = {};

beforeAll(async () => {
  app = createTestApp();
  const setup = await app.request.post('/api/auth/setup').set('X-Requested-With', 'crm').send({ company_name: 'Journey Works LLP', name: 'Asha Founder', email: 'asha@journey.test', password: PASSWORD });
  expect(setup.status).toBe(200);
  F = await app.login('asha@journey.test');
  S.bank = (await F.post('/accounts', { name: 'Journey Bank', type: 'bank', opening_balance: 10000 })).j.id;
});
afterAll(() => app.close());

const rec = async () => (await F.get('/analytics/receivables')).j;
const proj = async (id: number) => (await rec()).projects.find((p: { id: number }) => p.id === id);
const fin = async () => (await F.get('/finance/summary?from=2000-01-01&to=2100-01-01')).j;
const tds = async (q = '') => (await F.get(`/analytics/tds${q}`)).j;

describe('1. sales: lead → conversation → quotation', () => {
  it('captures a new lead (a company with a contact), keeps the specification, and logs the conversation', async () => {
    const lead = await F.post('/leads', { company: 'Orbit Foods Pvt Ltd', name: 'Rahul Jain', phone: '+91 98765 43210', department: 'Website', stage: 'new', value: 130000, specs: 'Pages: home, menu, orders.\nPayments: Razorpay.' });
    expect(lead.s).toBe(201);
    S.lead = lead.j.id;
    const contact = await F.post(`/leads/${S.lead}/contact`, { kind: 'call', stage: 'meeting', body: 'Wants a demo next week, budget around 1.3L', followup_round: 'initial', next_followup: addDays(t, 2), next_action: 'Send demo link' });
    expect(contact.s).toBeLessThan(300);
    const after = (await F.get(`/leads/${S.lead}`)).j;
    expect(after).toMatchObject({ stage: 'meeting', next_followup: addDays(t, 2), next_action: 'Send demo link', last_contact: t });
    const log = (await F.get('/contact-log')).j as { body?: string; note?: string }[];
    expect(JSON.stringify(log)).toContain('Wants a demo next week');
    const sales = (await F.get('/analytics/sales')).j;
    expect(sales.total.leads).toBe(1);
  });
  it('moves the lead to Proposal Sent when the quotation is sent, and shows the open quotation', async () => {
    const q = (await F.post('/quotes', { lead_id: S.lead, title: 'Orbit Foods website', items: [{ description: 'Website design & development', qty: 1, rate: 130000 }], tax_type: 'none', tax_rate: 0 })).j;
    S.quote = q.id;
    expect(q.total).toBe(130000);
    await F.put(`/quotes/${q.id}`, { status: 'sent' });
    expect((await F.get(`/leads/${S.lead}`)).j.stage).toBe('proposal');
    expect((await F.get('/analytics/sales')).j.open_quotes).toBeTruthy();
  });
  it('converts to a client and a project worth the quotation, carrying the specification', async () => {
    const r = await F.post(`/leads/${S.lead}/convert`, { create_project: true, quote_id: S.quote, project_name: 'Orbit Foods Website' });
    expect(r.s).toBe(200);
    S.client = r.j.client_id;
    S.project = r.j.project_id;
    const p = (await F.get(`/projects/${S.project}`)).j;
    expect(p).toMatchObject({ budget: 130000, client_id: S.client });
    expect(p.specs).toContain('Razorpay');
    expect((await F.get(`/leads/${S.lead}`)).j.stage).toBe('won');
    expect((await F.get(`/quotes/${S.quote}`)).j.status).toBe('accepted');
    const pr = await proj(S.project as number);
    expect(pr).toMatchObject({ value: 130000, invoiced: 0, received: 0, pending: 0, unbilled: 130000 });
  });
});

describe('2. billing: payment schedule → invoice → payment with TDS (never part of the invoice)', () => {
  it('splits the value in two, flags the first part ready when finished, and drafts its invoice', async () => {
    const ms = (await F.post(`/projects/${S.project}/schedule`, { template: '50-50' })).j;
    expect(ms.map((m: { amount: number }) => m.amount)).toEqual([65000, 65000]);
    S.m1 = ms[0].id; S.m2 = ms[1].id;
    await F.put(`/milestones/${S.m1}`, { reached_on: t });
    const att = (await F.get('/attention')).j.items.map((i: { title: string }) => i.title);
    expect(att.some((x: string) => x.startsWith('Ready to invoice'))).toBe(true);
    const inv = await F.post(`/milestones/${S.m1}/invoice`);
    expect(inv.s).toBe(201);
    S.inv1 = inv.j.invoice_id;
    expect((await F.get(`/invoices/${S.inv1}`)).j).toMatchObject({ total: 65000, status: 'draft', client_id: S.client, project_id: S.project });
  });
  it('invoices only what we will receive: the client deducts 10% TDS, so the invoice is edited to ₹58,500', async () => {
    const edited = await F.put(`/invoices/${S.inv1}`, { items: JSON.stringify([{ description: 'Orbit Foods Website — advance (net of 10% TDS)', qty: 1, rate: 58500 }]), status: 'sent', due_date: addDays(t, 7), tax_type: 'none', tax_rate: 0 });
    expect(edited.j.total).toBe(58500);
    const pay = await F.post('/payments', { invoice_id: S.inv1, amount: 58500, tds: 6500, date: t, account_id: S.bank, method: 'Bank Transfer', category: 'Client payment' });
    expect(pay.s).toBe(201);
    S.pay1 = pay.j.id;
    const inv = (await F.get(`/invoices/${S.inv1}`)).j;
    expect(inv).toMatchObject({ status: 'paid', paid_amount: 58500, balance: 0, credit: 0 });
    expect((await F.get(`/milestones/${S.m1}`)).j.state).toBe('paid');
  });
  it('shows received = cash only, TDS apart, and not-yet-billed = value − TDS − invoiced', async () => {
    expect(await proj(S.project as number)).toMatchObject({ value: 130000, invoiced: 58500, cash: 58500, tds: 6500, received: 58500, pending: 0, overdue: 0, unbilled: 65000, to_get: 65000 });
    const f = await fin();
    expect(f.income.cash).toBe(58500);
    expect(f.profit).toBe(58500); // TDS is a tax credit, not income in hand
    expect(f.cash).toBe(10000 + 58500);
    expect(f.tds).toMatchObject({ deducted: 6500, claimed: 0, to_claim: 6500 });
    const d = (await F.get('/dashboard')).j;
    expect(d.kpi.tds.to_claim).toBe(6500);
    const income = (await F.get('/analytics/income?by=client')).j;
    expect(income.total).toBe(58500);
    expect(income.tds).toBe(6500);
  });
  it('second part: unpaid past its due date is overdue and pending; part-payment leaves the balance pending', async () => {
    const inv = await F.post(`/milestones/${S.m2}/invoice`);
    S.inv2 = inv.j.invoice_id;
    await F.put(`/invoices/${S.inv2}`, { items: JSON.stringify([{ description: 'Orbit Foods Website — final (net of 10% TDS)', qty: 1, rate: 58500 }]), status: 'sent', issue_date: addDays(t, -40), due_date: addDays(t, -10), tax_type: 'none', tax_rate: 0 });
    expect((await F.get(`/invoices/${S.inv2}`)).j.status).toBe('overdue');
    expect(await proj(S.project as number)).toMatchObject({ invoiced: 117000, received: 58500, pending: 58500, overdue: 58500, unbilled: 6500, to_get: 65000 });
    expect((await F.get('/attention')).j.items.some((i: { title: string }) => /owes/.test(i.title))).toBe(true);
    await F.post('/payments', { invoice_id: S.inv2, amount: 30000, date: t, account_id: S.bank });
    expect((await F.get(`/invoices/${S.inv2}`)).j).toMatchObject({ status: 'overdue', paid_amount: 30000, balance: 28500 });
    expect(await proj(S.project as number)).toMatchObject({ pending: 28500, overdue: 28500 });
    const aging = (await rec()).aging;
    expect(Object.values(aging as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(28500);
  });
  it('settles the rest with the second TDS: both invoices paid, nothing pending, all TDS tracked', async () => {
    await F.post('/payments', { invoice_id: S.inv2, amount: 28500, tds: 6500, date: t, account_id: S.bank });
    expect((await F.get(`/invoices/${S.inv2}`)).j).toMatchObject({ status: 'paid', balance: 0 });
    expect(await proj(S.project as number)).toMatchObject({ value: 130000, invoiced: 117000, cash: 117000, tds: 13000, received: 117000, pending: 0, overdue: 0, unbilled: 0, to_get: 0 });
    expect(await tds()).toMatchObject({ totals: { deducted: 13000, to_claim: 13000, claimed: 0, awaiting_certificate: 13000 } });
  });
  it('an overpaid invoice is credit, not negative pending', async () => {
    const q = await F.post('/payments', { invoice_id: S.inv1, amount: 250, date: t });
    expect((await F.get(`/invoices/${S.inv1}`)).j).toMatchObject({ balance: 0, credit: 250 });
    expect((await rec()).totals.pending).toBeGreaterThanOrEqual(0);
    await F.del(`/payments/${q.j.id}`);
    expect((await F.get(`/invoices/${S.inv1}`)).j.credit).toBe(0);
  });
});

describe('3. change requests: payable and not payable', () => {
  it('a payable request is estimated, quoted, accepted (value rises), invoiced and paid', async () => {
    const cr = (await F.post('/change_requests', { project_id: S.project, title: 'Add table booking', kind: 'feature', billable: true, estimate_amount: 20000, estimate_hours: 10 })).j;
    S.cr = cr.id;
    await F.put(`/change_requests/${cr.id}`, { status: 'estimated' });
    const q = await F.post(`/change-requests/${cr.id}/quote`);
    expect(q.s).toBeLessThan(300);
    const quote = (await F.get(`/change_requests/${cr.id}`)).j.quote_id;
    await F.put(`/quotes/${quote}`, { status: 'sent' });
    await F.put(`/quotes/${quote}`, { status: 'accepted' });
    expect((await F.get(`/change_requests/${cr.id}`)).j.status).toBe('approved');
    expect(await proj(S.project as number)).toMatchObject({ value: 150000, unbilled: 20000, to_get: 20000 });
    const inv = await F.post(`/quotes/${quote}/to-invoice`);
    const invId = inv.j.invoice_id ?? inv.j.id;
    await F.put(`/invoices/${invId}`, { status: 'sent', due_date: addDays(t, 5) });
    await F.post('/payments', { invoice_id: invId, amount: 20000, date: t, account_id: S.bank });
    expect((await F.get(`/change_requests/${cr.id}`)).j.billing_status).toBe('paid');
    expect(await proj(S.project as number)).toMatchObject({ value: 150000, invoiced: 137000, received: 137000, unbilled: 0, pending: 0 });
  });
  it('a request that is not payable stays out of the project value and the receivables', async () => {
    const before = await proj(S.project as number);
    const made = await F.post('/change_requests', { project_id: S.project, title: 'Fix our own typo', kind: 'change', billable: false, estimate_amount: 5000 });
    expect(made.s, JSON.stringify(made.j)).toBe(201);
    const cr = made.j;
    await F.put(`/change_requests/${cr.id}`, { status: 'approved' });
    await F.put(`/change_requests/${cr.id}`, { status: 'delivered' });
    expect(await proj(S.project as number)).toMatchObject({ value: before.value, unbilled: before.unbilled });
    expect((await F.get(`/change_requests/${cr.id}`)).j.billing_status).toBe('not_billable');
  });
});

describe('4. maintenance plan and subscriptions', () => {
  it('a maintenance plan (AMC) is monthly recurring revenue, and work in the plan is not billed', async () => {
    const amc = await F.post('/renewals', { kind: 'amc', name: 'Orbit Foods — yearly maintenance', client_id: S.client, project_id: S.project, renewal_date: addDays(t, 300), cycle: 'yearly', our_cost: 0, client_price: 12000, status: 'active' });
    expect(amc.s).toBe(201);
    expect((await fin()).mrr).toBe(1000);
    const log = await F.post('/maintenance_logs', { title: 'Menu page slow', project_id: S.project, type: 'bug', status: 'resolved', billable: false, hours: 2, reported_on: t });
    expect(log.s).toBe(201);
  });
  it('a company subscription debits itself once; a personal one is only tracked; a one-off price is used once', async () => {
    const co = (await F.post('/renewals', { kind: 'subscription', name: 'Claude', scope: 'company', renewal_date: t, cycle: 'monthly', our_cost: 2399, auto_debit: true, pay_account_id: S.bank })).j;
    const me = (await F.post('/renewals', { kind: 'subscription', name: 'Founder phone plan', scope: 'person', renewal_date: t, cycle: 'monthly', our_cost: 700, auto_debit: true })).j;
    const spent = (id: number) => (sql<{ n: number }>('SELECT COUNT(*) n FROM expenses WHERE renewal_id=?', id)).n;
    expect(spent(co.id)).toBe(1);
    expect(spent(me.id)).toBe(0);
    expect(runAutoDebits(app.ctx, t)).toHaveLength(0); // never twice
    await F.put(`/renewals/${co.id}`, { next_amount: 3000 });
    runAutoDebits(app.ctx, addDays(t, 40));
    const amounts = (app.ctx.db.prepare('SELECT amount FROM expenses WHERE renewal_id=? ORDER BY date').all(co.id) as { amount: number }[]).map((r) => r.amount);
    expect(amounts).toEqual([2399, 3000]);
    runAutoDebits(app.ctx, addDays(t, 75));
    expect((app.ctx.db.prepare('SELECT amount FROM expenses WHERE renewal_id=? ORDER BY date').all(co.id) as { amount: number }[]).map((r) => r.amount)).toEqual([2399, 3000, 2399]); // back to the normal price
    const subs = (await F.get('/analytics/subscriptions')).j;
    expect(JSON.stringify(subs)).toContain('Claude');
  });
});

describe('5. grant money, spending and the ledgers add up', () => {
  it('tracks a grant: received, spent from it, and what is left', async () => {
    const g = (await F.post('/grants', { name: 'Startup Grant', funder: 'State Govt', requested: 100000, received: 100000, status: 'disbursed', applied_on: addDays(t, -60) })).j;
    await F.post('/payments', { amount: 100000, date: addDays(t, -30), category: 'Grant', grant_id: g.id, account_id: S.bank });
    await F.post('/expenses', { date: t, amount: 40000, category: 'Hardware', vendor: 'Laptop Store', description: 'Laptop', grant_id: g.id, account_id: S.bank, status: 'paid' });
    const u = (await F.get(`/analytics/grants/${g.id}`)).j;
    expect(u).toMatchObject({ received: 100000 });
    expect(JSON.stringify(u)).toContain('40000');
    const spend = (await F.get('/analytics/spending?grant=any&by=grant')).j;
    expect(spend.total).toBe(40000);
  });
  it('every analytic equals the ledger and the cash balance adds up', async () => {
    const paid = sql<{ v: number }>("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='paid'").v;
    const got = sql<{ v: number }>('SELECT COALESCE(SUM(amount),0) v FROM payments').v;
    const f = await fin();
    expect(f.income.cash).toBeCloseTo(got, 2);
    expect(f.expenses.v).toBeCloseTo(paid, 2);
    expect(f.profit).toBeCloseTo(got - paid, 2);
    expect(f.cash).toBeCloseTo(10000 + got - paid, 2); // everything went through the one account
    for (const by of ['category', 'vendor', 'project', 'client', 'grant', 'account', 'paid_by', 'recurring', 'mode', 'month']) {
      expect((await F.get(`/analytics/spending?by=${by}`)).j.total, `spend by ${by}`).toBeCloseTo(paid, 2);
    }
    for (const by of ['client', 'project', 'category', 'account', 'mode', 'grant', 'month']) {
      const r = (await F.get(`/analytics/income?by=${by}`)).j;
      expect(r.total, `income by ${by}`).toBeCloseTo(got, 2);
      expect(r.rows.reduce((s: number, x: { amount: number }) => s + x.amount, 0), `income rows by ${by}`).toBeCloseTo(got, 2);
    }
    const r = await rec();
    expect(r.totals.received + r.other_income.v).toBeCloseTo(got, 2); // client money + other income (the grant)
    expect(r.totals.invoiced - r.totals.received).toBeCloseTo(r.totals.pending, 2);
  });
});

describe('6. TDS: claimed at year end', () => {
  it('shows where to redeem it from, by year and client, and moves to claimed with a date', async () => {
    const r = await tds();
    expect(r.totals.deducted).toBe(13000);
    expect(r.clients).toHaveLength(1);
    expect(r.clients[0]).toMatchObject({ label: 'Orbit Foods Pvt Ltd', deducted: 13000, to_claim: 13000 });
    expect(r.years[0].key).toBe(r.entries[0].fy);
    for (const e of r.entries as { id: number }[]) expect((await F.put(`/payments/${e.id}`, { tds_status: 'certificate' })).s).toBe(200);
    expect((await tds()).totals).toMatchObject({ certificate: 13000, awaiting_certificate: 0, to_claim: 13000 });
    for (const e of r.entries as { id: number }[]) await F.put(`/payments/${e.id}`, { tds_status: 'claimed' });
    expect((await tds()).totals).toMatchObject({ claimed: 13000, to_claim: 0 });
    expect((await fin()).tds).toMatchObject({ claimed: 13000, to_claim: 0 });
    expect((await F.get('/attention')).j.items.some((i: { key: string }) => i.key.startsWith('tds-claim'))).toBe(false);
  });
  it('keeps the whole story in history and exports to Excel and PDF', async () => {
    const h = (await F.get(`/history?entity=payments&entity_id=${S.pay1}`)).j as { changes: { field: string }[] }[];
    expect(h.length).toBeGreaterThanOrEqual(3);
    const login = await app.request.post('/api/auth/login').set('X-Requested-With', 'crm').send({ email: 'asha@journey.test', password: PASSWORD });
    const cookie = String((login.headers['set-cookie'] as unknown as string[])[0]).split(';')[0] as string;
    for (const u of ['/api/analytics/tds/export.xlsx', '/api/analytics/tds/export.pdf', '/api/payments/export.xlsx', '/api/invoices/export.pdf', '/api/analytics/spending']) {
      expect((await app.request.get(u).set('X-Requested-With', 'crm').set('Cookie', cookie)).status, u).toBe(200);
    }
  });
});

describe('6b. "still to get" is one number, the same on every screen', () => {
  it('equals pending + not invoiced for the project, the client, the totals, the dashboard, the project page and the clients list', async () => {
    const p2 = (await F.post('/projects', { client_id: S.client, name: 'Orbit Foods App', status: 'active', budget: 40000 })).j.id;
    await F.post('/payments', { project_id: p2, client_id: S.client, amount: 9000, tds: 1000, date: t, account_id: S.bank }); // paid with no invoice at all
    const inv3 = (await F.post('/invoices', { client_id: S.client, project_id: p2, title: 'App part', status: 'sent', issue_date: t, due_date: addDays(t, 10), items: JSON.stringify([{ description: 'App part', qty: 1, rate: 10000 }]), tax_type: 'cgst_sgst', tax_rate: 18 })).j;
    expect(inv3.total).toBe(11800); // GST is on top, and is never counted as "agreed value"
    const row = await proj(p2);
    // value 40,000 − TDS 1,000 − (invoiced 10,000 before GST + 9,000 received without invoice) = 20,000 not invoiced; 11,800 invoiced and unpaid
    expect(row).toMatchObject({ value: 40000, tds: 1000, pending: 11800, unbilled: 20000, to_get: 31800 });
    const r = await rec();
    const c = r.clients.find((x: { client_id: number }) => x.client_id === S.client);
    expect(c.to_get).toBeCloseTo(r.projects.filter((x: { client_id: number }) => x.client_id === S.client).reduce((a: number, x: { to_get: number }) => a + x.to_get, 0), 2);
    expect(r.totals.to_get).toBeCloseTo(r.totals.pending + r.totals.unbilled, 2);
    const dash = (await F.get('/dashboard')).j.kpi.unbilled;
    expect(dash.to_get).toBe(Math.round(r.totals.to_get));
    expect(dash.pending).toBe(Math.round(r.totals.pending));
    const page = (await F.get(`/projects/${p2}`)).j;
    expect(page).toMatchObject({ to_get: 31800, to_invoice: 20000, pending_amount: 11800, tds_total: 1000 });
    const list = (await F.get('/clients?limit=50')).j.find((x: { id: number }) => x.id === S.client);
    expect(list.to_get).toBeCloseTo(c.to_get, 2);
    // the remaining money arrives: nothing left to get
    await F.put(`/invoices/${inv3.id}`, { status: 'sent' });
    await F.post('/payments', { invoice_id: inv3.id, amount: 11800, date: t });
    await F.post('/payments', { project_id: p2, client_id: S.client, amount: 20000, date: t });
    expect(await proj(p2)).toMatchObject({ pending: 0, unbilled: 0, to_get: 0 });
  });
  it('shows what is still to get as an Action center item for a finished project, and not for a settled one', async () => {
    const p3 = (await F.post('/projects', { client_id: S.client, name: 'Orbit Foods Logo', status: 'completed', budget: 13000 })).j.id;
    await F.post('/payments', { project_id: p3, client_id: S.client, amount: 0.01, date: t });
    const titles = (await F.get('/attention')).j.items.map((i: { title: string; detail: string }) => `${i.title} | ${i.detail}`);
    expect(titles.some((x: string) => /Orbit Foods Pvt Ltd: ₹13,000 still to get \| Orbit Foods Logo/.test(x))).toBe(true);
    expect(titles.some((x: string) => /Orbit Foods Website/.test(x) && /still to get/.test(x))).toBe(false);
  });
});

describe('7. everything stays editable and reversible, and the figures follow', () => {
  let inv = 0;
  let pay = 0;
  it('changing an invoice after payment re-works its status: smaller total = credit, bigger = partial again', async () => {
    const made = (await F.post('/invoices', { client_id: S.client, project_id: S.project, title: 'Editable', status: 'sent', issue_date: t, due_date: addDays(t, 30), items: JSON.stringify([{ description: 'x', qty: 1, rate: 10000 }]), tax_type: 'none', tax_rate: 0 })).j;
    inv = made.id;
    pay = (await F.post('/payments', { invoice_id: inv, amount: 10000, date: t })).j.id;
    expect((await F.get(`/invoices/${inv}`)).j.status).toBe('paid');
    await F.put(`/invoices/${inv}`, { items: JSON.stringify([{ description: 'x', qty: 1, rate: 12000 }]) });
    expect((await F.get(`/invoices/${inv}`)).j).toMatchObject({ status: 'partial', balance: 2000, credit: 0 });
    await F.put(`/invoices/${inv}`, { items: JSON.stringify([{ description: 'x', qty: 1, rate: 9000 }]) });
    expect((await F.get(`/invoices/${inv}`)).j).toMatchObject({ status: 'paid', balance: 0, credit: 1000 });
  });
  it('moving a payment to another invoice refreshes both, and deleting it reopens the first', async () => {
    const other = (await F.post('/invoices', { client_id: S.client, project_id: S.project, title: 'Other', status: 'sent', issue_date: t, due_date: addDays(t, 30), items: JSON.stringify([{ description: 'y', qty: 1, rate: 10000 }]), tax_type: 'none', tax_rate: 0 })).j.id;
    await F.put(`/payments/${pay}`, { invoice_id: other });
    expect((await F.get(`/invoices/${other}`)).j).toMatchObject({ status: 'paid', paid_amount: 10000 });
    expect((await F.get(`/invoices/${inv}`)).j).toMatchObject({ status: 'sent', paid_amount: 0, balance: 9000 });
    await F.del(`/payments/${pay}`);
    expect((await F.get(`/invoices/${other}`)).j).toMatchObject({ status: 'sent', paid_amount: 0 });
  });
  it('editing the due date moves an invoice in and out of overdue', async () => {
    await F.put(`/invoices/${inv}`, { issue_date: addDays(t, -20), due_date: addDays(t, -3) });
    expect((await F.get(`/invoices/${inv}`)).j.status).toBe('overdue');
    await F.put(`/invoices/${inv}`, { due_date: addDays(t, 10) });
    expect((await F.get(`/invoices/${inv}`)).j.status).toBe('sent');
  });
  it('a cancelled invoice drops out of what is invoiced and pending', async () => {
    const before = await proj(S.project as number);
    await F.put(`/invoices/${inv}`, { status: 'cancelled' });
    const after = await proj(S.project as number);
    expect(before.invoiced - after.invoiced).toBe(9000);
    expect(before.pending - after.pending).toBe(9000);
  });
  it('a project value can be changed after a schedule exists; the figures follow the new value', async () => {
    const before = await proj(S.project as number);
    await F.put(`/projects/${S.project}`, { budget: 140000 });
    const after = await proj(S.project as number);
    expect(after.value).toBe(before.value + 10000);
    expect(after.unbilled).toBe(Math.max(0, after.value - after.tds - after.invoiced));
    await F.put(`/projects/${S.project}`, { budget: 130000 });
  });
  it('a lead can be reopened and re-closed, and a converted lead cannot create a second client', async () => {
    const l = (await F.post('/leads', { company: 'Flip Co', stage: 'new' })).j.id;
    await F.put(`/leads/${l}`, { stage: 'lost', lost_reason: 'Too expensive' });
    expect((await F.get(`/leads/${l}`)).j).toMatchObject({ stage: 'lost', lost_reason: 'Too expensive' });
    await F.put(`/leads/${l}`, { stage: 'contacted' });
    expect((await F.get(`/leads/${l}`)).j.stage).toBe('contacted');
    const first = await F.post(`/leads/${l}/convert`, { create_project: false });
    expect(first.s).toBe(200);
    const clients = (await F.get('/clients?limit=100')).j.length;
    const again = await F.post(`/leads/${l}/convert`, { create_project: false });
    expect((await F.get('/clients?limit=100')).j.length, JSON.stringify(again.j)).toBe(clients);
  });
  it('a milestone can be changed by hand even after its invoice is paid, and the project keeps its history', async () => {
    expect((await F.put(`/milestones/${S.m1}`, { notes: 'Paid with 10% TDS' })).s).toBe(200);
    const h = (await F.get(`/history?entity=projects&entity_id=${S.project}`)).j as unknown[];
    expect(h.length).toBeGreaterThan(0);
  });
  it('the ledgers still add up after all the edits', async () => {
    const got = sql<{ v: number }>('SELECT COALESCE(SUM(amount),0) v FROM payments').v;
    const f = await fin();
    expect(f.income.cash).toBeCloseTo(got, 2);
    const stale = sql<{ n: number }>("SELECT COUNT(*) n FROM invoices i WHERE ABS(i.paid_amount - COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id=i.id),0)) > 0.005").n;
    expect(stale).toBe(0);
  });
});
