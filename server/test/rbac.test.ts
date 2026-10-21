import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemo, type Demo } from './demo';
import type { LoggedIn } from './helpers';

/**
 * Role-based access, checked against EVERY resource the same way:
 *  - what an intern is shown is a subset of what a founder sees (never more),
 *  - every record a founder can see but the intern cannot is refused on read, on its history, notes and files, and on edit/delete,
 *  - no money column reaches an intern, in lists, single records, history, search, exports or analytics.
 */
let d: Demo;
let L: LoggedIn;
beforeAll(async () => {
  d = await createDemo();
  // a person with the sales modules, and records of every kind on every project / client / lead, so there is something to leak
  await d.F.post('/users', { name: 'Lena Sales', email: 'lena@demo.test', role: 'intern', password: 'Demo-Pass-2026', modules: ['leads', 'clients'] });
  d.app.ctx.db.prepare("UPDATE users SET must_change_password=0 WHERE email='lena@demo.test'").run();
  L = await d.app.login('lena@demo.test');
  for (const pid of Object.values(d.proj)) {
    await d.F.post('/change_requests', { project_id: pid, title: `CR on ${pid}`, billable: true, estimate_amount: 9000 });
    await d.F.post('/notes', { entity_type: 'project', entity_id: pid, body: 'internal pricing talk' });
    await d.F.post('/documents/link', { entity_type: 'project', entity_id: pid, url: 'https://drive.example/x', title: 'Contract' });
    await d.F.post('/tasks', { project_id: pid, title: `Task on ${pid}`, status: 'todo' });
  }
  for (const cid of Object.values(d.clients)) await d.F.post('/notes', { entity_type: 'client', entity_id: cid, body: 'client is slow to pay' });
  for (const lid of Object.values(d.leads)) await d.F.post('/notes', { entity_type: 'lead', entity_id: lid, body: 'budget is 5L' });
});
afterAll(() => d.app.close());

const RESOURCES = ['leads', 'clients', 'contacts', 'projects', 'tasks', 'change_requests', 'documents', 'payments', 'expenses', 'accounts', 'transfers', 'renewals', 'maintenance_logs', 'events', 'grants', 'assets', 'bank_transactions', 'quotes', 'invoices', 'milestones'];
const MONEY = /(^|_)(budget|total_billed|total_received|total_expenses|revised_value|cr_value|lifetime_received|outstanding|to_get|to_invoice|pending_amount|tds|tds_total|estimate_amount|invoice_total|invoice_paid|quote_total|our_cost|client_price|opening_balance|advance_amount|expected_tds|subtotal|paid_amount|tax_amount)$/;
const leaks = (v: unknown, path = ''): string[] => {
  if (Array.isArray(v)) return v.slice(0, 50).flatMap((x, i) => leaks(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => (MONEY.test(k) && x !== null && x !== undefined && x !== 0 && x !== '' ? [`${path}.${k}`] : leaks(x, `${path}.${k}`)));
  return [];
};
const ids = async (who: LoggedIn, res: string): Promise<number[]> => {
  const r = await who.get(`/${res}?limit=500`);
  return r.s === 200 && Array.isArray(r.j) ? (r.j as { id: number }[]).map((x) => x.id) : [];
};

for (const [name, get] of [['an intern with no modules', () => d.T], ['an intern with the maintenance module', () => d.K], ['an intern with the leads and clients modules', () => L]] as [string, () => LoggedIn][]) {
  describe(name, () => {
    it('only ever sees a subset of what a founder sees, and no money', async () => {
      const bad: string[] = [];
      for (const res of RESOURCES) {
        const f = await ids(d.F, res);
        const mine = await ids(get(), res);
        const extra = mine.filter((id) => !f.includes(id));
        if (extra.length) bad.push(`${res}: sees rows a founder does not (${extra.join(',')})`);
        const l = await get().get(`/${res}?limit=500`);
        const lk = leaks(l.j);
        if (lk.length) bad.push(`${res} list leaks money: ${lk.slice(0, 3).join(' ')}`);
        for (const id of mine.slice(0, 5)) {
          const one = await get().get(`/${res}/${id}`);
          const ok = leaks(one.j);
          if (ok.length) bad.push(`${res}/${id} leaks money: ${ok.slice(0, 3).join(' ')}`);
          const h = await get().get(`/history?entity=${res}&entity_id=${id}`);
          if (h.s === 200 && JSON.stringify(h.j).match(/"field":"(budget|amount|total|estimate_amount|our_cost|client_price|tds|subtotal)"/)) bad.push(`${res}/${id} history shows a money field`);
        }
      }
      expect(bad).toEqual([]);
    });

    it('is refused on every record it cannot see: read, history, edit and delete', async () => {
      const bad: string[] = [];
      for (const res of RESOURCES) {
        const f = await ids(d.F, res);
        const mine = new Set(await ids(get(), res));
        for (const id of f.filter((x) => !mine.has(x)).slice(0, 6)) {
          const g = await get().get(`/${res}/${id}`);
          if (g.s === 200) bad.push(`READ ${res}/${id}`);
          const h = await get().get(`/history?entity=${res}&entity_id=${id}`);
          if (h.s === 200) bad.push(`HISTORY ${res}/${id}`);
          const p = await get().call('PUT', `/${res}/${id}`, { notes: 'hacked', title: 'hacked', status: 'done' });
          if (p.s === 200) bad.push(`EDIT ${res}/${id}`);
          const del = await get().call('DELETE', `/${res}/${id}`);
          if (del.s === 200 || del.s === 204) bad.push(`DELETE ${res}/${id}`);
        }
      }
      expect(bad).toEqual([]);
    });

    it('cannot read or write notes and files of records it cannot see', async () => {
      const bad: string[] = [];
      const types: [string, string][] = [['lead', 'leads'], ['client', 'clients'], ['project', 'projects'], ['task', 'tasks'], ['change_request', 'change_requests'], ['invoice', 'invoices'], ['quote', 'quotes'], ['grant', 'grants'], ['asset', 'assets'], ['renewal', 'renewals']];
      for (const [type, res] of types) {
        const f = await ids(d.F, res);
        const mine = new Set(await ids(get(), res));
        for (const id of f.filter((x) => !mine.has(x)).slice(0, 4)) {
          const n = await get().get(`/notes?entity_type=${type}&entity_id=${id}`);
          if (n.s === 200 && (n.j as unknown[]).length) bad.push(`NOTES ${type}/${id}`);
          const w = await get().post('/notes', { entity_type: type, entity_id: id, body: 'sneaky' });
          if (w.s < 300) bad.push(`WRITE NOTE ${type}/${id}`);
          const docs = await get().get(`/documents?entity_type=${type}&entity_id=${id}`);
          if (docs.s === 200 && (docs.j as unknown[]).length) bad.push(`FILES ${type}/${id}`);
        }
      }
      expect(bad).toEqual([]);
    });

    it('is refused every founder-only screen, export and action', async () => {
      const founderOnly = ['/finance/summary', '/analytics/finance', '/analytics/spending', '/analytics/income', '/analytics/receivables', '/analytics/grants', '/analytics/subscriptions', '/analytics/tds', '/analytics/tds/export.xlsx', '/audit', '/audit/export.xlsx', '/audit/export.pdf', '/backup', '/users', '/credentials', '/settings', '/payments/export.xlsx', '/expenses/export.pdf', '/invoices/export.xlsx', '/quotes/export.pdf', '/accounts/export.xlsx', '/grants/export.xlsx', '/renewals/export.xlsx', '/assets/export.xlsx', '/transfers/export.xlsx', '/milestones/export.xlsx', '/bank_transactions/export.xlsx'];
      const bad: string[] = [];
      for (const u of founderOnly) { const r = await get().get(u); if (r.s === 200) bad.push(`GET ${u}`); }
      const actions: [string, string, object][] = [['POST', '/projects/1/schedule', { template: 'full' }], ['POST', '/milestones/1/invoice', {}], ['POST', '/quotes/1/to-invoice', {}], ['POST', '/quotes/1/start-project', {}], ['POST', '/change-requests/1/quote', {}], ['POST', '/bank-match', {}], ['POST', '/renewals/1/renew', {}], ['PUT', '/settings', { company_name: 'x' }], ['POST', '/users', { name: 'x y', email: 'x@y.zz', role: 'founder', password: 'Abcdefgh1234!' }], ['PUT', '/users/1', { role: 'intern' }], ['POST', '/credentials', {}]];
      for (const [m, u, b] of actions) {
        const r = await get().call(m, u, b);
        if (r.s < 400) bad.push(`${m} ${u}`);
      }
      expect(bad).toEqual([]);
    });

    it('sees no money or other people’s items on the dashboard, attention list, search, calendar or notifications', async () => {
      expect(leaks((await get().get('/dashboard')).j)).toEqual([]);
      expect(JSON.stringify((await get().get('/attention')).j)).not.toContain('₹');
      const s = ((await get().get('/search?q=an')).j ?? []) as { type: string }[];
      expect(Array.isArray(s)).toBe(true);
      expect(s.filter((x) => ['Invoice', 'Quote', 'Payment', 'Expense', 'Grant', 'Asset', 'Credential'].includes(x.type))).toEqual([]);
      const cal = (await get().get('/calendar?from=2000-01-01&to=2100-01-01')).j.items as { type: string }[];
      expect(cal.filter((x) => ['invoice', 'renewal', 'grant', 'quote'].includes(x.type))).toEqual([]);
      expect(JSON.stringify((await get().get('/notifications')).j)).not.toMatch(/Invoice overdue|Renewal/);
    });
  });
}

describe('accounts and sessions', () => {
  it('nobody can promote themselves or widen their own access', async () => {
    for (const who of [d.T, d.K, L]) {
      const me = (await who.get('/me')).j as { id: number };
      for (const body of [{ role: 'founder' }, { modules: ['leads', 'clients', 'maintenance', 'all_projects'] }, { active: true }, { password: 'Newpassword-12345' }]) {
        const r = await who.call('PUT', `/users/${me.id}`, body);
        expect(r.s, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
      }
      expect(((await who.get('/me')).j as { role: string }).role).toBe('intern');
    }
  });
  it('a deactivated person is signed out at once, and the last active founder cannot be removed or demoted', async () => {
    const made = (await d.F.post('/users', { name: 'Temp Person', email: 'temp@demo.test', role: 'intern', password: 'Demo-Pass-2026', modules: [] })).j;
    d.app.ctx.db.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(made.id);
    const tmp = await d.app.login('temp@demo.test');
    expect((await tmp.get('/me')).s).toBe(200);
    expect((await d.F.call('PUT', `/users/${made.id}`, { active: false })).s).toBe(200);
    expect((await tmp.get('/me')).s).toBe(401);
    expect((await d.app.login('temp@demo.test')).status).toBe(401);
    // founders: demote or remove everyone but one, then the last one is protected
    const founders = ((await d.F.get('/users')).j as { id: number; role: string; active: boolean }[]).filter((u) => u.role === 'founder' && u.active);
    const self = ((await d.F.get('/me')).j as { id: number }).id;
    for (const f of founders.filter((x) => x.id !== self)) await d.F.call('PUT', `/users/${f.id}`, { active: false });
    expect((await d.F.call('PUT', `/users/${self}`, { role: 'intern' })).s).toBeGreaterThanOrEqual(400);
    expect((await d.F.call('PUT', `/users/${self}`, { active: false })).s).toBeGreaterThanOrEqual(400);
    expect((await d.F.call('DELETE', `/users/${self}`)).s).toBeGreaterThanOrEqual(400);
  });
  it('a person’s password hash, two-step secret and vault key never appear in any answer', async () => {
    const blob = JSON.stringify([(await d.F.get('/users')).j, (await d.F.get('/me')).j, (await d.F.get('/settings')).j, (await d.F.get('/audit?limit=500')).j]);
    expect(blob).not.toMatch(/password_hash|scrypt\$|totp_secret|vault_key|"stored_name"/);
  });
});
