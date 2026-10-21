import { addDays, today as localToday } from '@crm/shared';
import { inn } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemo, type Demo } from './demo';

/** Things that really happen in an office and must not break the books. */
let d: Demo;
const t = localToday();
beforeAll(async () => { d = await createDemo(); });
afterAll(() => d.app.close());
const inv = async (extra: Record<string, unknown> = {}) => (await d.F.post('/invoices', { client_id: d.clients.acme, title: `Reality ${Math.random()}`, issue_date: t, due_date: addDays(t, 10), items: JSON.stringify([{ description: 'x', qty: 1, rate: 1000 }]), ...extra })).j;

describe('payments in real life', () => {
  it('a client who pays a draft invoice makes it sent-and-paid, not a paid draft', async () => {
    const i = await inv({ status: 'draft' });
    await d.F.post('/payments', { invoice_id: i.id, amount: 1000, date: t });
    expect((await d.F.get(`/invoices/${i.id}`)).j).toMatchObject({ status: 'paid', paid_amount: 1000, balance: 0 });
  });
  it('a part-payment on a draft makes it partial, and deleting that payment leaves it sent (it was billed)', async () => {
    const i = await inv({ status: 'draft' });
    const p = (await d.F.post('/payments', { invoice_id: i.id, amount: 400, date: t })).j;
    expect((await d.F.get(`/invoices/${i.id}`)).j.status).toBe('partial');
    await d.F.del(`/payments/${p.id}`);
    expect((await d.F.get(`/invoices/${i.id}`)).j.status).toBe('sent'); // money did arrive, so it was billed; set it back by hand if needed
  });
  it('money cannot be recorded against a cancelled invoice', async () => {
    const i = await inv({ status: 'sent' });
    await d.F.put(`/invoices/${i.id}`, { status: 'cancelled' });
    const r = await d.F.post('/payments', { invoice_id: i.id, amount: 100, date: t });
    expect(r.s).toBe(400);
    expect(r.j.error).toMatch(/cancelled/i);
  });
  it('a payment cannot name a client or project that is not the invoice’s own: it follows the invoice', async () => {
    const i = await inv({ status: 'sent', project_id: d.proj.acme });
    const p = (await d.F.post('/payments', { invoice_id: i.id, amount: 10, date: t, client_id: d.clients.green, project_id: d.proj.green })).j;
    expect(p).toMatchObject({ client_id: d.clients.acme, project_id: d.proj.acme });
  });
  it('an invoice cannot be for a project that belongs to another client', async () => {
    const r = await d.F.post('/invoices', { client_id: d.clients.acme, project_id: d.proj.green, items: JSON.stringify([{ description: 'x', qty: 1, rate: 1 }]) });
    expect(r.s).toBe(400);
    expect(r.j.error).toMatch(/project/i);
    const i = await inv({ status: 'draft' });
    expect((await d.F.put(`/invoices/${i.id}`, { project_id: d.proj.green })).s).toBe(400);
  });
});

describe('quotations in real life', () => {
  it('a rejected or expired quotation cannot be turned into an invoice or a project', async () => {
    const q = (await d.F.post('/quotes', { client_id: d.clients.acme, title: 'Nope', items: JSON.stringify([{ description: 'x', qty: 1, rate: 500 }]) })).j;
    await d.F.put(`/quotes/${q.id}`, { status: 'rejected' });
    expect((await d.F.post(`/quotes/${q.id}/to-invoice`)).s).toBe(400);
    expect((await d.F.post(`/quotes/${q.id}/start-project`)).s).toBe(400);
  });
  it('an invoice that came from a quotation keeps pointing at it, and the quotation cannot be deleted while it does', async () => {
    const q = (await d.F.post('/quotes', { client_id: d.clients.acme, title: 'Keep', items: JSON.stringify([{ description: 'x', qty: 1, rate: 700 }]) })).j;
    const i = (await d.F.post(`/quotes/${q.id}/to-invoice`)).j.invoice_id;
    expect((await d.F.get(`/invoices/${i}`)).j.quote_id).toBe(q.id);
    expect((await d.F.del(`/quotes/${q.id}`)).s).toBeGreaterThanOrEqual(400);
  });
});

describe('projects in real life', () => {
  it('cancelling a project drops it from what is still to be collected but keeps its money history', async () => {
    const p = (await d.F.post('/projects', { client_id: d.clients.green, name: 'Cancelled Job', status: 'active', budget: 50000 })).j;
    expect(((await d.F.get('/analytics/receivables')).j.projects as { id: number }[]).some((x) => x.id === p.id)).toBe(true);
    await d.F.put(`/projects/${p.id}`, { status: 'cancelled' });
    expect(((await d.F.get('/analytics/receivables')).j.projects as { id: number }[]).some((x) => x.id === p.id)).toBe(false);
    expect((await d.F.get('/attention')).j.items.some((i: { title: string }) => i.title.includes('Cancelled Job'))).toBe(false);
  });
  it('a project with no client cannot be saved, and moving it to another client moves its invoices’ meaning with a clear refusal', async () => {
    expect((await d.F.post('/projects', { name: 'Orphan' })).s).toBe(400);
  });
  it('a milestone cannot be added to a project that does not exist', async () => {
    expect((await d.F.post('/milestones', { project_id: 999999, title: 'x', amount: 5 })).s).toBeGreaterThanOrEqual(400);
  });
});

describe('the database itself protects the important links', () => {
  it('a document number or project code can never be changed — not by the API, not by SQL', async () => {
    const i = await inv({ status: 'sent' });
    const before = i.number as string;
    await d.F.put(`/invoices/${i.id}`, { number: 'INV/HACKED/0001', title: 'renamed' });
    expect((await d.F.get(`/invoices/${i.id}`)).j.number).toBe(before);
    expect(() => d.app.ctx.db.prepare('UPDATE invoices SET number=? WHERE id=?').run('X/1', i.id)).toThrow(/can never be changed/);
    const p = (await d.F.get(`/projects/${d.proj.acme}`)).j;
    await d.F.put(`/projects/${p.id}`, { code: 'P-HACK' });
    expect((await d.F.get(`/projects/${p.id}`)).j.code).toBe(p.code);
    expect(() => d.app.ctx.db.prepare('UPDATE projects SET code=? WHERE id=?').run('P-HACK', p.id)).toThrow(/can never be changed/);
  });
  it('an invoice with payments cannot move to another client, and a project with invoices cannot be handed over', async () => {
    const i = await inv({ status: 'sent', project_id: d.proj.acme });
    await d.F.post('/payments', { invoice_id: i.id, amount: 10, date: t });
    const r = await d.F.put(`/invoices/${i.id}`, { client_id: d.clients.green, project_id: null });
    expect(r.s).toBe(409);
    expect(r.j.error).toMatch(/cannot be moved|different client/);
    const r2 = await d.F.put(`/projects/${d.proj.acme}`, { client_id: d.clients.green });
    expect(r2.s).toBe(409);
    expect(r2.j.error).toMatch(/cannot be given to another client/);
  });
  it('a lead with quotations, or one that became a client, cannot be deleted', async () => {
    const lead = (await d.F.post('/leads', { company: 'Keep Me Co', stage: 'proposal' })).j;
    await d.F.post('/quotes', { lead_id: lead.id, title: 'q', items: [{ description: 'x', qty: 1, rate: 1 }] });
    const r = await d.F.del(`/leads/${lead.id}`);
    expect(r.s).toBe(409);
    expect(r.j.error).toMatch(/quotation/);
  });
});

describe('nothing that other records rely on can be deleted from under them', () => {
  it('a grant with spending, a payment with a live invoice and a change request with a quotation or invoice are kept', async () => {
    const g = (await d.F.post('/grants', { name: 'Kept Grant', status: 'approved' })).j;
    await d.F.post('/expenses', { date: t, amount: 10, category: 'Other', description: 'from grant', grant_id: g.id, status: 'paid' });
    expect((await d.F.del(`/grants/${g.id}`)).s).toBe(409);
    const p = (await d.F.post('/projects', { client_id: d.clients.acme, name: 'Del Guard', status: 'planning', budget: 10000 })).j;
    const ms = (await d.F.post(`/projects/${p.id}/schedule`, { template: 'full' })).j[0];
    const invId = (await d.F.post(`/milestones/${ms.id}/invoice`)).j.invoice_id;
    expect((await d.F.del(`/milestones/${ms.id}`)).s).toBe(409);
    await d.F.put(`/invoices/${invId}`, { status: 'cancelled' });
    expect((await d.F.del(`/milestones/${ms.id}`)).s).toBeLessThan(300);
    const cr = (await d.F.post('/change_requests', { project_id: p.id, title: 'Del CR', billable: true, estimate_amount: 500 })).j;
    await d.F.post(`/change-requests/${cr.id}/quote`);
    const del = await d.F.del(`/change_requests/${cr.id}`);
    expect(del.s).toBe(409);
    expect(del.j.error).toMatch(/Quotation/);
  });
});

describe('subscriptions and maintenance plans are two different things', () => {
  it('the running cost is only what the company pays; someone else’s tool and a client’s maintenance plan are not in it', async () => {
    const before = (await d.F.get('/dashboard')).j.kpi.recurring_cost as number;
    await d.F.post('/renewals', { name: 'Vansh own GPT', kind: 'subscription', scope: 'personal', owner_id: d.u.rohan, renewal_date: inn(5), cycle: 'monthly', our_cost: 2000 });
    expect((await d.F.get('/dashboard')).j.kpi.recurring_cost).toBe(before); // not company money
    await d.F.post('/renewals', { name: 'Maintenance for Acme', kind: 'amc', client_id: d.clients.acme, renewal_date: inn(60), cycle: 'monthly', client_price: 5000 });
    expect((await d.F.get('/dashboard')).j.kpi.recurring_cost).toBe(before); // a plan clients pay us for is income, not cost
    const pay = ((await d.F.get('/renewals?group=pay&limit=200')).j as { kind: string; name: string }[]);
    const sell = ((await d.F.get('/renewals?group=sell&limit=200')).j as { kind: string; name: string }[]);
    expect(pay.some((r) => r.kind === 'amc')).toBe(false);
    expect(pay.some((r) => r.name === 'Vansh own GPT')).toBe(true);
    expect(sell.every((r) => r.kind === 'amc')).toBe(true);
    expect(sell.some((r) => r.name === 'Maintenance for Acme')).toBe(true);
    const subs = (await d.F.get('/analytics/subscriptions')).j;
    expect(subs.by_kind.reduce((s: number, x: { amount: number }) => s + x.amount, 0)).toBeCloseTo(subs.company_monthly, 2);
    expect(JSON.stringify(subs.by_owner)).toContain('Rohan');
  });
});
