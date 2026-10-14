import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from '../src/config';
import { runAutoDebits } from '../src/jobs/autoDebit';
import { runSeed, type SeedReport } from '../src/seed/load';
import { createTestApp, type LoggedIn, type TestApp } from './helpers';

const xlsDir = path.join(ROOT, 'current_xls');
const have = fs.existsSync(path.join(xlsDir, 'TechSentinals OS.xlsx')) && fs.existsSync(path.join(xlsDir, 'TechSentinals CRM.xlsx'));
const t = new Date().toISOString().slice(0, 10);
const PW = 'Seed-Test-2026';

/** The real workbooks → the real API. Every number is compared with what the sheets show themselves. */
describe.skipIf(!have)('TechSentinals seed', () => {
  let app: TestApp;
  let F: LoggedIn;
  let report: SeedReport;
  beforeAll(async () => {
    app = createTestApp();
    report = runSeed(app.ctx, { xlsDir, password: PW });
    app.ctx.db.prepare('UPDATE users SET must_change_password=0').run();
    F = await app.login('techsentinalsprojects@gmail.com', PW);
  });
  afterAll(() => app?.close());
  const get = async (u: string) => { const r = await F.get(u); expect(r.s, u).toBe(200); return r.j; };

  it('reconciles every total with the sheets (and says which corrections were agreed)', () => {
    const bad = report.checks.filter((c) => !c.ok);
    expect(bad, JSON.stringify(bad)).toEqual([]);
    expect(report.checks.length).toBeGreaterThanOrEqual(50);
    expect(report.counts).toMatchObject({ leads: 121, clients: 4, projects: 5, invoices: 5, payments: 15, expenses: 50, grants: 1, renewals: 5, users: 4 });
  });
  describe('money', () => {
    it('matches the sheet dashboard: revenue, expenses, balance, grants', async () => {
      const f = await get(`/finance/summary?from=2024-01-01&to=${t}`);
      expect(f.income.cash).toBe(509400);
      expect(f.expenses.v).toBeCloseTo(166713.34, 2);
      expect(f.profit).toBeCloseTo(342686.66, 2);
      expect(f.cash).toBeCloseTo(342686.66, 2);
      expect(f.grants).toMatchObject({ requested: 250000, received: 100000 });
    });
    it('files expenses by what they were for (the sheet’s “Grant” became a funded-by link)', async () => {
      const f = await get(`/finance/summary?from=2024-01-01&to=${t}`);
      const cat = Object.fromEntries(f.expense_by_category.map((x: { k: string; v: number }) => [x.k, x.v]));
      expect(cat.Payroll).toBe(5600);
      expect(cat.Marketing).toBe(18042);
      expect(cat.Travel).toBe(10000);
      expect(cat.Hardware).toBe(36400);
      expect(cat['Hosting/Cloud']).toBeCloseTo(35669.04 + 6370.82 + 3182.46, 2);
      expect(cat['Legal & Admin']).toBe(550 + 18520 + 1000 + 1500);
      expect(cat['Software/SaaS']).toBe(2350 * 6 + 2399 + 2484);
      expect(cat['Office/Rent']).toBe(8000);
      expect(cat['Telecom & Utilities']).toBe(1668);
      expect(cat['Bank Charges']).toBeCloseTo(348.02, 2);
      expect(cat.Other).toBe(880);
      expect(cat.Grant).toBeUndefined();
      expect(Object.values(cat as Record<string, number>).reduce((a, b) => a + b, 0)).toBeCloseTo(166713.34, 2);
    });
    it('attributes income to the right clients and projects (own-company money is not client income)', async () => {
      const f = await get(`/finance/summary?from=2024-01-01&to=${t}`);
      const cl = Object.fromEntries(f.income_by_client.map((x: { k: string; v: number }) => [x.k, x.v]));
      expect(cl).toMatchObject({ 'RotoTech Systems': 175000, 'Vishalwin Foundation': 102900, 'Inventa Systems': 45000, 'Strikar Lifescience LLP': 39000, Unassigned: 147500 });
      const pr = Object.fromEntries(f.projects.map((x: { name: string; received: number }) => [x.name, x.received]));
      expect(pr).toMatchObject({
        'Inventa Website': 45000, 'RotoTech Custom Software Development': 150000, 'RotoTech Maintenance & Support (Phase 2)': 25000,
        'Strikar Lifescience Website': 39000, 'Vishalwin Foundation NGO Dashboard': 102900,
      });
    });
    it('puts dates back in order (nothing in the future) and the grant receipt on the first grant spend', async () => {
      const pays = await get('/payments?limit=500');
      expect(pays.every((p: { date: string }) => p.date <= t)).toBe(true);
      expect((await get('/expenses?limit=500')).every((e: { date: string }) => e.date <= t)).toBe(true);
      expect(pays.find((p: { grant_id: number }) => p.grant_id).date).toBe('2026-07-13');
      const jul = await get('/finance/summary?from=2026-07-01&to=2026-07-31');
      expect(jul.expenses.v).toBeCloseTo(2350 + 5000 + 35669.04 + 6370.82 + 500 + 1770 + 550 + 12.98 + 2 + 9.73, 2);
    });
    it('tracks the SSIP grant: requested, received, used and which expenses it paid for', async () => {
      const g = (await get('/grants'))[0];
      expect(g).toMatchObject({ name: 'SSIP', funder: 'LEAF GLS', status: 'disbursed', ref: 'GR-0001' });
      expect(g.used).toBeCloseTo(92175.32, 2);
      const spent = (await get('/expenses?limit=500')).filter((e: { grant_id: number }) => e.grant_id === g.id).reduce((s: number, e: { amount: number }) => s + e.amount, 0);
      expect(spent).toBeCloseTo(92175.32, 2);
    });
    it('writes every expense and payment with a proper description and a system ID', async () => {
      const exps = await get('/expenses?limit=500');
      expect(exps.filter((e: { description: string }) => !e.description || /^[a-z]/.test(e.description))).toEqual([]);
      expect(exps.every((e: { ref: string }) => /^EXP-\d{4}$/.test(e.ref))).toBe(true);
      expect((await get('/payments?limit=500')).every((p: { ref: string }) => /^PAY-\d{4}$/.test(p.ref))).toBe(true);
    });
  });

  describe('clients, projects, invoices and maintenance', () => {
    it('has four properly spelt clients, each with its projects and money', async () => {
      const clients = await get('/clients?limit=500');
      expect(clients.map((c: { company: string }) => c.company).sort()).toEqual(['Inventa Systems', 'RotoTech Systems', 'Strikar Lifescience LLP', 'Vishalwin Foundation']);
      const rt = clients.find((c: { company: string }) => c.company === 'RotoTech Systems');
      expect(rt).toMatchObject({ project_count: 2, lifetime_received: 175000, outstanding: 0, ref: 'CL-0002' });
    });
    it('knows what each project is (Strikar site, Vishalwin NGO dashboard, RotoTech maintenance)', async () => {
      const projects = Object.fromEntries((await get('/projects?limit=500')).map((p: { name: string }) => [p.name, p]));
      expect(projects['Strikar Lifescience Website']).toMatchObject({ type: 'Website', status: 'active', client_name: 'Strikar Lifescience LLP' });
      expect(projects['Vishalwin Foundation NGO Dashboard']).toMatchObject({ type: 'Dashboard', status: 'active' });
      expect(projects['Vishalwin Foundation NGO Dashboard'].description).toMatch(/Renu program and the Road Safety Guardian Angel program/);
      expect(projects['RotoTech Maintenance & Support (Phase 2)']).toMatchObject({ type: 'Maintenance', status: 'maintenance', deadline: '2026-12-31', budget: 25000, client_name: 'RotoTech Systems' });
      expect(projects['Inventa Website']).toMatchObject({ status: 'completed', completed_on: '2026-07-02', budget: 45000 });
      expect(Object.values(projects).every((p) => (p as { client_id: number }).client_id && /^P-\d{2}-\d{3}$/.test((p as { ref: string }).ref))).toBe(true);
    });
    it('has one paid, numbered invoice per project with its payments attached', async () => {
      const inv = await get('/invoices?limit=500');
      expect(inv).toHaveLength(5);
      expect(inv.every((i: { status: string; balance: number }) => i.status === 'paid' && i.balance === 0)).toBe(true);
      expect(inv.map((i: { number: string }) => i.number).sort()).toEqual(['INV/2025-26/0001', 'INV/2026-27/0001', 'INV/2026-27/0002', 'INV/2026-27/0003', 'INV/2026-27/0004']);
      expect(inv.reduce((s: number, i: { total: number }) => s + i.total, 0)).toBe(45000 + 150000 + 25000 + 39000 + 102900);
      const pays = await get('/payments?limit=500');
      expect(pays.filter((p: { client_id: number }) => p.client_id).every((p: { invoice_id: number }) => p.invoice_id)).toBe(true);
    });
    it('plans RotoTech maintenance until December and gives Inventa none', async () => {
      const ren = await get('/renewals?limit=500');
      const amc = ren.find((r: { kind: string }) => r.kind === 'amc');
      expect(amc).toMatchObject({ client_name: 'RotoTech Systems', renewal_date: '2026-12-31', client_price: 25000, project_name: 'RotoTech Maintenance & Support (Phase 2)' });
      expect(ren.filter((r: { kind: string; client_name: string }) => r.kind === 'amc' && r.client_name === 'Inventa Systems')).toHaveLength(0);
    });
  });

  describe('recurring costs', () => {
    it('has two Claude subscriptions, ChatGPT and the variable Airtel bill — all debiting themselves', async () => {
      const ren = (await get('/renewals?limit=500')).filter((r: { kind: string }) => r.kind !== 'amc');
      expect(ren.map((r: { name: string }) => r.name).sort()).toEqual(['Airtel postpaid phone bill', 'ChatGPT Plus', 'Claude subscription (billed on the 12th)', 'Claude subscription (billed on the 17th)']);
      expect(ren.every((r: { auto_debit: number; pay_account_id: number }) => r.auto_debit === 1 && r.pay_account_id)).toBe(true);
      expect(ren.find((r: { name: string }) => /Airtel/.test(r.name))).toMatchObject({ amount_varies: 1, kind: 'bill', vendor: 'Airtel' });
      expect(ren.filter((r: { name: string }) => /^Claude/.test(r.name))).toHaveLength(2);
    });
    it('debits Claude on the 17th once, and records an estimate for Airtel', async () => {
      const ctx = app.ctx;
      const claude = ctx.db.prepare("SELECT * FROM renewals WHERE name LIKE 'Claude%17th%'").get() as { id: number; renewal_date: string; pay_account_id: number };
      const due = runAutoDebits(ctx, claude.renewal_date);
      expect(due.filter((x) => /17th/.test(x.renewal))).toHaveLength(1);
      expect(runAutoDebits(ctx, claude.renewal_date)).toHaveLength(0);
      const ex = ctx.db.prepare('SELECT * FROM expenses WHERE renewal_id=?').get(claude.id) as Record<string, unknown>;
      expect(ex).toMatchObject({ amount: 2399, category: 'Software/SaaS', status: 'paid', vendor: 'Anthropic', account_id: claude.pay_account_id });
      const airtelLater = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
      const est = runAutoDebits(ctx, airtelLater).filter((x) => /Airtel/.test(x.renewal));
      expect(est.length).toBeGreaterThanOrEqual(1);
      expect(est[0]).toMatchObject({ estimate: true, amount: 834 });
    });
  });

  describe('leads and sales analytics', () => {
    it('has 121 leads with system IDs, owners and no sheet IDs', async () => {
      const leads = await get('/leads?limit=500');
      expect(leads).toHaveLength(121);
      expect(Math.max(...leads.map((l: { id: number }) => l.id))).toBe(121);
      expect(leads.every((l: { ref: string }) => /^LD-\d{4}$/.test(l.ref))).toBe(true);
      const owned = (n: string) => leads.filter((l: { owner_name: string }) => l.owner_name === n).length;
      expect(owned('Aastha Sangtani')).toBe(110);
      expect(owned('Vansh Balyan')).toBe(4);
      const won = leads.filter((l: { stage: string }) => l.stage === 'won');
      expect(won).toHaveLength(5);
      expect(won.filter((l: { client_id: number }) => l.client_id)).toHaveLength(4);
    });
    it('is spelt properly: no ALL-CAPS names, typos fixed, countries right, one phone layout', async () => {
      const leads = await get('/leads?limit=500');
      const caps = leads.filter((l: { company: string }) => /[A-Z]{5,}/.test(l.company.replace(/\b(LLP|HVACR|CIMS|MPRS|SLA|SCOPE)\b/g, '')));
      expect(caps).toEqual([]);
      expect(leads.some((l: { company: string; city: string }) => /Heailth|Banglore/i.test(l.company + (l.city ?? '')))).toBe(false);
      expect(leads.find((l: { company: string }) => /Ministry of Health/.test(l.company))).toBeTruthy();
      expect(leads.find((l: { company: string }) => /SCOPE Kenya/.test(l.company)).market).toBe('Foreign');
      expect(leads.some((l: { market: string; country: string }) => l.market === 'Foreign' && l.country === 'South Africa')).toBe(false);
      expect(leads.filter((l: { phone: string }) => /^\+91 \d{5} \d{5}$/.test(l.phone ?? '')).length).toBeGreaterThanOrEqual(95);
      expect(leads.every((l: { email: string }) => !l.email || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email) && l.email === l.email.toLowerCase()))).toBe(true);
    });
    it('matches the sheet’s dashboard, departments, sources and months (India/Foreign differ by the SCOPE Kenya fix)', async () => {
      const a = await get('/analytics/sales?year=2026');
      expect(a.total).toMatchObject({ leads: 121, open: 112, converted: 5, india: 111, foreign: 9, conversion: 4.1, pipeline: 0, no_date: 112 });
      const dep = Object.fromEntries(a.by_department.map((x: { name: string }) => [x.name, x]));
      expect(dep.Healthcare).toMatchObject({ leads: 35, converted: 2, hot: 7, lost: 1 });
      expect(dep.Manufacturing).toMatchObject({ leads: 26, hot: 2 });
      expect(dep['NGO & Foundation']).toMatchObject({ leads: 22, hot: 3 });
      expect(dep['Other Services']).toMatchObject({ leads: 28, hot: 3, lost: 1 });
      expect(dep.Optical).toMatchObject({ leads: 2, hot: 1 });
      expect(dep['Other Products']).toMatchObject({ leads: 7, hot: 3 });
      const src = Object.fromEntries(a.by_source.map((x: { name: string }) => [x.name, x]));
      expect(src['Event/Expo']).toMatchObject({ leads: 82, india: 82 });
      expect(src['Cold Outreach']).toMatchObject({ leads: 29, foreign: 9 });
      expect(src.Referral).toMatchObject({ leads: 4, hot_all: 4 });
      const m = Object.fromEntries(a.monthly.map((x: { month: string }) => [x.month, x]));
      expect([m['2026-08'].added, m['2026-09'].added, m['2026-10'].added]).toEqual([48, 68, 5]);
      expect(a.monthly.reduce((n: number, x: { converted: number }) => n + x.converted, 0)).toBe(5);
    });
  });

  describe('people', () => {
    it('has the four founders and no intern', async () => {
      const users = await get('/users');
      expect(users.map((u: { name: string; role: string }) => `${u.name}:${u.role}`).sort()).toEqual(['Aastha Sangtani:founder', 'Ashwin Solanki:founder', 'Dhruv Solanki:founder', 'Vansh Balyan:founder']);
      expect((await app.login('vansh@techsentinals.local', PW)).status).toBe(200);
    });
    it('finds records by system ID and by name', async () => {
      expect(((await get('/search?q=LD-0001')) as { type: string }[]).some((x) => x.type === 'Lead')).toBe(true);
      expect(((await get('/search?q=CL-0002')) as { type: string }[]).some((x) => x.type === 'Client')).toBe(true);
      expect(((await get('/search?q=Strikar')) as { type: string }[]).map((x) => x.type)).toEqual(expect.arrayContaining(['Client', 'Project']));
    });
  });
});

describe.skipIf(!have)('seed re-runs', () => {
  it('is safe to run again and can be reset without touching anything typed by hand', async () => {
    const app = createTestApp();
    const first = runSeed(app.ctx, { xlsDir, password: PW });
    app.ctx.db.prepare('UPDATE users SET must_change_password=0').run();
    const F = await app.login('techsentinalsprojects@gmail.com', PW);
    const again = runSeed(app.ctx, { xlsDir, password: PW });
    expect(again.created).toHaveLength(0);
    expect(again.counts).toEqual(first.counts);
    await F.post('/leads', { company: 'Typed by hand' });
    const reset = runSeed(app.ctx, { xlsDir, password: PW, reset: true });
    expect(reset.removed?.leads).toBe(121);
    expect(reset.counts.leads).toBe(122); // the hand-typed lead survived
    expect(reset.counts.invoices).toBe(5);
    expect(reset.checks.filter((c) => !['Leads: total', 'Leads: open', 'Leads added in 2026-10'].includes(c.what) && !c.ok)).toEqual([]);
    app.close();
  });
});
