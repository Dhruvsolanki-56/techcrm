import { addDays, today as localToday } from '@crm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { round2 } from '@crm/shared';
import { createDemo, type Demo } from './demo';
import { ago } from './helpers';

let d: Demo;
beforeAll(async () => { d = await createDemo(); });
afterAll(() => d.app.close());
const q = <R = { v: number }>(sql: string, ...p: unknown[]): R => d.app.ctx.db.prepare(sql).get(...p) as R;
const today = localToday();

/** Every number on a dashboard is checked against an independent SQL query over the same database. */
describe('dashboard', () => {
  it('reports cash, receivables, income, expenses and pipeline that match the database', async () => {
    const dash = (await d.F.get('/dashboard')).j;
    const fin = (await d.F.get(`/finance/summary?from=2000-01-01&to=${today}`)).j;
    expect(dash.kpi.cash).toBeCloseTo(fin.cash, 2);
    expect(dash.kpi.receivables).toBeCloseTo(q("SELECT COALESCE(SUM(total-paid_amount),0) v FROM invoices WHERE kind='invoice' AND status IN ('sent','partial','overdue')").v, 2);
    expect(dash.kpi.open_leads.n).toBe(q("SELECT COUNT(*) v FROM leads WHERE stage NOT IN ('won','closed','lost')").v);
    expect(dash.kpi.month_income).toBeCloseTo(q('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE date>=?', `${today.slice(0, 7)}-01`).v, 2);
    expect(dash.kpi.mrr).toBe(6000);
    expect(dash.trend).toHaveLength(6);
    expect(dash.by_client.length).toBeGreaterThan(0);
    expect(dash.work.clients.n).toBe(3);
    expect(dash.work.invoices.n).toBe(q("SELECT COUNT(*) v FROM invoices WHERE kind='invoice' AND status NOT IN ('draft','cancelled')").v);
    const pipelineTotal = Object.values(dash.pipeline as Record<string, { n: number }>).reduce((s, x) => s + x.n, 0);
    expect(pipelineTotal).toBe(q('SELECT COUNT(*) v FROM leads').v);
  });
  it('lists follow-ups and tasks only for what the person may see', async () => {
    expect((await d.F.get('/dashboard')).j.followups.length).toBeGreaterThan(0);
    expect((await d.T.get('/dashboard')).j.followups).toBeUndefined();
    expect((await d.T.get('/dashboard')).j.my_tasks.length).toBeGreaterThan(0);
  });
});

describe('finance analytics', () => {
  it('builds a monthly series whose totals equal the ledgers', async () => {
    const a = (await d.F.get('/analytics/finance?months=12')).j;
    expect(a.series).toHaveLength(12);
    const inc = a.series.reduce((s: number, r: { income: number }) => s + r.income, 0);
    const exp = a.series.reduce((s: number, r: { expense: number }) => s + r.expense, 0);
    expect(inc).toBeCloseTo(q('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE date>=?', `${a.months[0]}-01`).v, 2);
    expect(exp).toBeCloseTo(q("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='paid' AND date>=?", `${a.months[0]}-01`).v, 2);
    expect(a.totals.net).toBeCloseTo(round2(inc - exp), 2);
    for (const row of a.series) expect(row.net).toBeCloseTo(row.income - row.expense, 2);
    const last = a.series[a.series.length - 1];
    expect(last.cumulative).toBeCloseTo(a.series.reduce((s: number, r: { net: number }) => s + r.net, 0) + q('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE date<?', `${a.months[0]}-01`).v - q("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='paid' AND date<?", `${a.months[0]}-01`).v, 2);
  });
  it('ranks clients, projects and grants and forecasts the next 60 days', async () => {
    const a = (await d.F.get('/analytics/finance')).j;
    expect(a.top_clients[0].received).toBeGreaterThanOrEqual(a.top_clients[a.top_clients.length - 1].received);
    expect(a.receivable_clients.every((c: { owed: number }) => c.owed > 0)).toBe(true);
    expect(a.project_profit.every((p: { margin: number; received: number; cost: number }) => Math.abs(p.margin - (p.received - p.cost)) < 0.01)).toBe(true);
    const g = a.grants[0];
    expect(g.remaining).toBeCloseTo(g.received - g.used, 2);
    expect(g.pending).toBeCloseTo(g.requested - g.received, 2);
    expect(a.forecast_60d.expected_in).toBeCloseTo(a.forecast_60d.inflow.reduce((s: number, r: { amount: number }) => s + r.amount, 0), 2);
    expect(a.invoice_status.length).toBeGreaterThan(0);
    expect(a.recurring.mrr).toBe(6000);
  });
  it('computes burn, aging and GST in the finance summary', async () => {
    const s = (await d.F.get(`/finance/summary?from=${ago(400)}&to=${today}`)).j;
    expect(s.burn).toBeGreaterThan(0);
    expect(Object.values(s.aging as Record<string, number>).reduce((a, b) => a + b, 0)).toBeCloseTo(s.receivables, 2);
    expect(s.gst.net).toBeCloseTo(s.gst.output - s.gst.input, 2);
    expect(s.expense_by_category.reduce((a: number, r: { v: number }) => a + r.v, 0)).toBeCloseTo(s.expenses.v, 2);
  });
});

describe('sales analytics', () => {
  it('counts the funnel, markets, owners and follow-ups consistently', async () => {
    const a = (await d.F.get('/analytics/sales')).j;
    const leads = q('SELECT COUNT(*) v FROM leads').v;
    expect(a.total.leads).toBe(leads);
    expect(a.total.open + a.total.converted + a.total.lost).toBe(leads);
    expect(a.by_stage.reduce((s: number, r: { leads: number }) => s + r.leads, 0)).toBe(leads);
    expect(a.by_market.reduce((s: number, r: { leads: number }) => s + r.leads, 0)).toBe(leads);
    expect(a.by_source.reduce((s: number, r: { leads: number }) => s + r.leads, 0)).toBe(leads);
    expect(a.funnel.map((f: { stage: string }) => f.stage)[0]).toBe('new');
    expect(a.total.pipeline).toBeCloseTo(q("SELECT COALESCE(SUM(value),0) v FROM leads WHERE stage NOT IN ('won','closed','lost')").v, 2);
    expect(a.total.weighted).toBeLessThanOrEqual(a.total.pipeline);
    expect(a.follow_up_queue.length).toBeGreaterThan(0);
    expect(a.follow_up_queue[0].next_followup <= a.follow_up_queue[a.follow_up_queue.length - 1].next_followup).toBe(true);
  });
  it('turns an overdue follow-up into the follow-up queue, dashboard, calendar and lead status — and removes it when closed', async () => {
    const lead = d.leads.l5 as number;
    await d.F.put(`/leads/${lead}`, { next_followup: ago(1), next_action: 'Send the demo video' });
    expect((await d.F.get(`/leads/${lead}`)).j.followup_status).toBe('Overdue');
    expect((await d.F.get('/analytics/sales')).j.total.overdue).toBeGreaterThanOrEqual(1);
    expect(((await d.F.get('/dashboard')).j.followups as { id: number }[]).some((l) => l.id === lead)).toBe(true);
    expect(((await d.F.get(`/calendar?from=${ago(2)}&to=${today}`)).j.items as { type: string; link: string }[]).some((i) => i.type === 'followup' && i.link === `/leads/${lead}`)).toBe(true);
    const before = (await d.F.get('/analytics/sales')).j.total.overdue;
    await d.F.put(`/leads/${lead}`, { stage: 'lost', lost_reason: 'test' });
    expect((await d.F.get('/analytics/sales')).j.total.overdue).toBe(before - 1);
  });
  it('logs a contact atomically: note, stage, round, next date and last contact together', async () => {
    const lead = d.leads.l2 as number;
    const r = await d.F.post(`/leads/${lead}/contact`, { kind: 'call', body: 'Spoke to Priya, wants two samples', stage: 'qualified', followup_round: 'second', next_followup: '2099-01-10', next_action: 'Send samples' });
    expect(r.s).toBe(200);
    expect(r.j).toMatchObject({ stage: 'qualified', followup_round: 'second', next_followup: '2099-01-10', next_action: 'Send samples', last_contact: today });
    const log = (await d.F.get(`/contact-log?lead_id=${lead}`)).j as { body: string; followup_round: string }[];
    expect(log[0]).toMatchObject({ body: 'Spoke to Priya, wants two samples', followup_round: 'second' });
    const closed = await d.F.post(`/leads/${lead}/contact`, { kind: 'call', body: 'Not interested', stage: 'lost' });
    expect(closed.j).toMatchObject({ stage: 'lost', followup_round: 'complete', next_followup: null });
    expect((await d.F.post(`/leads/${lead}/contact`, { kind: 'call', body: '' })).s).toBe(400);
    expect((await d.T.post(`/leads/${lead}/contact`, { body: 'x' })).s).toBe(403);
  });
});

describe('calendar and search', () => {
  it('puts every dated thing on one calendar', async () => {
    const items = (await d.F.get(`/calendar?from=${ago(60)}&to=${addDays(localToday(), 60)}`)).j.items as { type: string }[];
    const types = new Set(items.map((i) => i.type));
    for (const t of ['project', 'task', 'event', 'invoice', 'renewal', 'grant', 'document']) expect(types.has(t), t).toBe(true);
  });
  it('finds records of every kind by name or system ID', async () => {
    const hits = async (term: string) => ((await d.F.get(`/search?q=${encodeURIComponent(term)}`)).j as { type: string }[]).map((x) => x.type);
    expect(await hits('Acme')).toEqual(expect.arrayContaining(['Client', 'Project']));
    expect(await hits('LD-0001')).toContain('Lead');
    expect(await hits('INV/')).toContain('Invoice');
    expect(await hits('cPanel')).toContain('Credential');
    expect(await hits('x')).toEqual([]); // too short
  });
});
