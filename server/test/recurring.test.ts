import { addDays, today as localToday } from '@crm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMonths } from '@crm/shared';
import { runAutoDebits } from '../src/jobs/autoDebit';
import { createDemo, type Demo } from './demo';
import { ago } from './helpers';

let d: Demo;
beforeAll(async () => { d = await createDemo(); });
afterAll(() => d.app.close());
const today = localToday();
const one = <R>(sql: string, ...p: unknown[]): R => d.app.ctx.db.prepare(sql).get(...p) as R;

describe('validation of automatic debit', () => {
  it('can be saved in any state — an incomplete item simply does not debit until it is complete', async () => {
    const base = { name: 'Rule check', kind: 'subscription', renewal_date: today, cycle: 'monthly', auto_debit: true };
    for (const body of [{ ...base, our_cost: 0 }, { ...base, our_cost: 10, cycle: 'one-time' }, { ...base, our_cost: 10, renewal_date: undefined }]) {
      const r = await d.F.post('/renewals', body);
      expect(r.s).toBe(201);
    }
    expect((await d.F.get('/expenses?q=Rule check')).j).toHaveLength(0);
  });
});

describe('a fixed subscription', () => {
  let id = 0;
  it('is debited as soon as it is saved when already due, and its date moves one cycle on', async () => {
    const r = await d.F.post('/renewals', { name: 'CRUD auto tool', kind: 'subscription', vendor: 'Acme', renewal_date: ago(1), cycle: 'monthly', our_cost: 499, auto_debit: true, pay_account_id: d.bank });
    expect(r.s).toBe(201);
    id = r.j.id;
    expect(r.j.renewal_date > ago(1)).toBe(true);
    expect(r.j.last_debited).toBe(today);
    const ex = ((await d.F.list('/expenses')).j as Record<string, any>[]).filter((e) => e.renewal_id === id);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ amount: 499, date: ago(1), account_id: d.bank, status: 'paid', category: 'Software/SaaS', vendor: 'Acme', method: 'Auto-debit', is_estimate: 0 });
  });
  it('never records the same payment twice and catches up missed months', () => {
    const ctx = d.app.ctx;
    expect(runAutoDebits(ctx, today)).toHaveLength(0);
    const far = addDays(localToday(), 95);
    const caught = runAutoDebits(ctx, far);
    expect(caught.length).toBeGreaterThanOrEqual(3);
    expect((ctx.db.prepare('SELECT COUNT(*) n FROM (SELECT renewal_id, date FROM expenses WHERE renewal_id IS NOT NULL GROUP BY renewal_id, date HAVING COUNT(*)>1)').get() as { n: number }).n).toBe(0);
  });
  it('keeps the expenses when the recurring item is deleted', async () => {
    const before = one<{ n: number }>('SELECT COUNT(*) n FROM expenses WHERE renewal_id=?', id).n;
    expect((await d.F.del(`/renewals/${id}`)).s).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM expenses WHERE description LIKE 'CRUD auto tool%'").n).toBe(before);
  });
  it('never debits a maintenance plan that the client pays for', async () => {
    const amc = await d.F.post('/renewals', { name: 'Client AMC', kind: 'amc', renewal_date: ago(40), cycle: 'monthly', client_price: 5000 });
    expect(amc.s).toBe(201);
    runAutoDebits(d.app.ctx, today);
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM expenses WHERE renewal_id=?', amc.j.id).n).toBe(0);
  });
});

describe('a bill whose amount changes every month (postpaid phone)', () => {
  it('adds a pending estimate based on the last real bill, asks the founders for the real amount and confirms it when edited', async () => {
    const bill = await d.F.post('/renewals', { name: 'Airtel postpaid', kind: 'bill', vendor: 'Airtel', renewal_date: addMonths(today, -1), cycle: 'monthly', our_cost: 834, auto_debit: true, amount_varies: true, pay_account_id: d.bank });
    expect(bill.s).toBe(201);
    const first = ((await d.F.list('/expenses')).j as Record<string, any>[]).find((e) => e.renewal_id === bill.j.id) as Record<string, any>;
    expect(first).toMatchObject({ status: 'pending', is_estimate: 1, amount: 834, category: 'Telecom & Utilities' });
    const paidBefore = one<{ v: number }>("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='paid'").v;
    expect(one<{ v: number }>("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='paid' AND is_estimate=1").v).toBe(0); // estimates are not money spent
    expect(paidBefore).toBeGreaterThan(0);
    const note = ((await d.F.get('/notifications')).j.items as { text: string }[]).find((n) => /Bill due: Airtel postpaid/.test(n.text));
    expect(note).toBeTruthy();
    // the real bill arrives
    const fixed = await d.F.put(`/expenses/${first.id}`, { amount: 912.5, status: 'paid' });
    expect(fixed.j).toMatchObject({ amount: 912.5, status: 'paid', is_estimate: 0 });
    // next month's estimate is based on the real bill, not the typical amount
    const nextMonth = addMonths(bill.j.renewal_date, 1);
    runAutoDebits(d.app.ctx, nextMonth);
    const second = (d.app.ctx.db.prepare('SELECT * FROM expenses WHERE renewal_id=? ORDER BY date DESC, id DESC').get(bill.j.id)) as Record<string, any>;
    expect(second).toMatchObject({ amount: 912.5, status: 'pending', is_estimate: 1 });
    expect((await d.F.get('/finance/summary')).j.pending_expenses.n).toBeGreaterThanOrEqual(1);
  });
});

describe('what the founders see', () => {
  it('lists upcoming debits on the dashboard and totals the recurring cost', async () => {
    await d.F.post('/renewals', { name: 'Soon tool', kind: 'subscription', renewal_date: addMonths(today, 0).slice(0, 8) + '28', cycle: 'monthly', our_cost: 1000, auto_debit: true });
    const dash = (await d.F.get('/dashboard')).j;
    expect(dash.kpi.recurring_cost).toBeGreaterThan(0);
    expect(Array.isArray(dash.auto_debits)).toBe(true);
    expect(dash.pending_estimates.n).toBeGreaterThanOrEqual(1);
  });
});
