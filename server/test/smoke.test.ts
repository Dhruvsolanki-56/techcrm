import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemo, type Demo } from './demo';
import { createTestApp, PASSWORD } from './helpers';

let d: Demo;
beforeAll(async () => { d = await createDemo(); });
afterAll(() => d.app.close());

describe('sign in', () => {
  it('works for every demo user and rejects a wrong password', async () => {
    expect(d.F.status).toBe(200);
    expect(d.K.status).toBe(200);
    expect((await d.app.login('aarav@demo.test', 'wrong-password-1')).status).toBe(401);
  });
  it('blocks state-changing requests without the CSRF header', async () => {
    const r = await d.app.request.post('/api/auth/login').send({ email: 'a', password: 'b' });
    expect(r.status).toBe(403);
  });
});

describe('health check', () => {
  it('answers without signing in and reveals nothing but "ok"', async () => {
    const r = await d.app.request.get('/api/health');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(Object.keys(r.body).sort()).toEqual(['ok', 'uptime']);
    expect(r.body.ok).toBe(true);
  });
});

describe('interns only see their own work', () => {
  it.each(['/finance/summary', '/invoices', '/quotes', '/payments', '/expenses', '/accounts', '/transfers', '/credentials', '/users', '/audit', '/settings', '/backup', '/leads', '/renewals', '/maintenance_logs/export.xlsx', '/analytics/finance'])(
    'blocks an intern from %s', async (url) => { expect((await d.K.get(url)).s).toBe(403); },
  );
  it('limits projects, hides budgets, clients and tasks to the intern', async () => {
    const kp = (await d.K.list('/projects')).j;
    expect(kp).toHaveLength(2);
    expect(kp.every((p: { budget?: number }) => p.budget === undefined)).toBe(true);
    expect((await d.T.list('/projects')).j).toHaveLength(2);
    const green = (await d.F.list('/projects')).j.find((p: { name: string }) => p.name.includes('GreenLeaf'));
    expect((await d.K.get(`/projects/${green.id}`)).s).toBe(404);
    const kc = (await d.K.list('/clients')).j;
    expect(kc).toHaveLength(2);
    expect(kc.every((c: Record<string, unknown>) => c.outstanding === undefined && c.lifetime_received === undefined)).toBe(true);
    const kt = (await d.K.list('/tasks')).j;
    expect(kt.length).toBeGreaterThan(0);
    expect(kt.every((t: { project_name: string }) => t.project_name !== 'GreenLeaf Online Store')).toBe(true);
  });
  it('lets an intern move their own task along but not edit it, and never touch others', async () => {
    const others = (await d.F.list('/tasks')).j.find((t: { assignee_name: string }) => t.assignee_name === 'Rohan Shah');
    expect((await d.K.put(`/tasks/${others.id}`, { status: 'done' })).s).toBe(403);
    const mine = (await d.K.list('/tasks')).j.find((t: { assignee_name: string; status: string }) => t.assignee_name === 'Kabir Singh' && t.status !== 'done');
    const upd = await d.K.put(`/tasks/${mine.id}`, { status: 'review', title: 'HACKED', priority: 'urgent' });
    expect(upd.s).toBe(200);
    expect(upd.j).toMatchObject({ status: 'review', title: mine.title, priority: mine.priority });
    expect((await d.K.del(`/tasks/${mine.id}`)).s).toBe(403);
  });
  it('blocks creating projects, users, comments on foreign projects and finance search', async () => {
    const green = (await d.F.list('/projects')).j.find((p: { name: string }) => p.name.includes('GreenLeaf'));
    expect((await d.K.post('/projects', { name: 'x', client_id: 1 })).s).toBe(403);
    expect((await d.K.post('/notes', { entity_type: 'project', entity_id: green.id, body: 'hi' })).s).toBe(403);
    expect((await d.K.post('/users', { name: 'x', email: 'x@x.com', password: 'Abcdefghij1', role: 'founder' })).s).toBe(403);
    expect((await d.K.get('/dashboard')).j.kpi).toBeUndefined();
    const search = (await d.K.get('/search?q=acme')).j as { type: string }[];
    expect(search.every((x) => !['Invoice', 'Credential', 'Quote'].includes(x.type))).toBe(true);
    expect((await d.K.get('/lookups')).j.accounts).toHaveLength(0);
  });
  it('shows maintenance logs by access flag or project membership', async () => {
    expect((await d.K.get('/maintenance_logs')).s).toBe(200);
    expect((await d.T.get('/maintenance_logs')).s).toBe(200);
    expect((await d.T.post('/maintenance_logs', { title: 'x' })).s).toBe(400);
  });
});

describe('invoices and payments', () => {
  it('computes GST, settles with TDS and numbers invoices per financial year', async () => {
    const invs = (await d.F.list('/invoices')).j as Record<string, any>[];
    const by = (t: string) => invs.find((i) => i.title === t) as Record<string, any>;
    expect(by('Fleet portal — advance 30%')).toMatchObject({ total: 159300, status: 'paid', paid_amount: 159300 });
    expect(by('Fleet portal — milestone 1')).toMatchObject({ total: 106200, status: 'overdue', paid_amount: 50000, balance: 56200 });
    expect(by('Website maintenance — last month')).toMatchObject({ status: 'paid', paid_amount: 7080 });
    expect(by('Online store — final').status).toBe('sent');
    expect(invs.every((i) => /^INV\/\d{4}-\d{2}\/\d{4}$/.test(i.number))).toBe(true);
    expect(new Set(invs.map((i) => i.number)).size).toBe(invs.length);
  });
  it('flips an invoice to paid on the final payment and reopens it when that payment is deleted', async () => {
    const m1 = ((await d.F.list('/invoices')).j as Record<string, any>[]).find((i) => i.title === 'Fleet portal — milestone 1') as Record<string, any>;
    const pay = await d.F.post('/payments', { invoice_id: m1.id, date: '2026-10-01', amount: 56200 });
    expect(pay.s).toBe(201);
    expect((await d.F.get(`/invoices/${m1.id}`)).j.status).toBe('paid');
    await d.F.del(`/payments/${pay.j.id}`);
    expect((await d.F.get(`/invoices/${m1.id}`)).j).toMatchObject({ status: 'overdue', paid_amount: 50000 });
  });
  it('refuses to delete an invoice that has payments', async () => {
    const adv = ((await d.F.list('/invoices')).j as Record<string, any>[]).find((i) => i.title === 'Fleet portal — advance 30%') as Record<string, any>;
    expect((await d.F.del(`/invoices/${adv.id}`)).s).toBe(409);
  });
  it('summarises finance with trend, accounts and founders owed', async () => {
    const sum = (await d.F.get('/finance/summary?from=2000-01-01&to=2099-12-31')).j;
    expect(sum.income.cash).toBeGreaterThan(0);
    expect(sum.accounts).toHaveLength(2);
    expect(sum.trend).toHaveLength(12);
    const acc = sum.accounts.find((a: { name: string }) => a.name.startsWith('HDFC'));
    const expected = 250000 + sum.income.cash + 800000 - 50000 - (24000 + 7800 + 9200 + 30000 + 18000 + 18000);
    expect(Math.abs(acc.balance - expected)).toBeLessThan(1);
    expect(sum.founders.find((f: { name: string }) => f.name.startsWith('Isha')).company_owes).toBe(15000);
  });
});

describe('quotes, lead conversion, clients and the vault', () => {
  it('prices a quote with GST and carries it through lead conversion into an invoice', async () => {
    const quotes = (await d.F.list('/quotes')).j;
    expect(quotes).toHaveLength(1);
    expect(quotes[0].total).toBe(383500);
    const lead = ((await d.F.list('/leads')).j as { id: number; company: string }[]).find((l) => l.company === 'Kumar Textiles');
    const conv = await d.F.post(`/leads/${lead?.id}/convert`, { create_project: true });
    expect(conv.s).toBe(200);
    expect(conv.j.client_id && conv.j.project_id).toBeTruthy();
    expect((await d.F.post(`/leads/${lead?.id}/convert`, {})).s).toBe(400);
    const q2 = (await d.F.list('/quotes')).j[0];
    expect(q2.client_id).toBe(conv.j.client_id);
    const toInv = await d.F.post(`/quotes/${q2.id}/to-invoice`);
    expect(toInv.s).toBe(200);
    expect((await d.F.get(`/invoices/${toInv.j.invoice_id}`)).j.total).toBe(383500);
  });
  it('protects clients with history from deletion', async () => {
    const acme = ((await d.F.list('/clients')).j as { id: number; company: string }[]).find((c) => c.company.startsWith('Acme'));
    expect((await d.F.del(`/clients/${acme?.id}`)).s).toBe(409);
  });
  it('never exposes vault secrets, encrypts them at rest and audits every reveal', async () => {
    const creds = (await d.F.get('/credentials')).j;
    expect(creds).toHaveLength(2);
    expect(creds.every((c: Record<string, unknown>) => c.password === undefined && c.password_enc === undefined)).toBe(true);
    const rev = await d.F.post(`/credentials/${creds[0].id}/reveal`);
    expect(rev.j.password).toMatch(/^Demo!/);
    const raw = d.app.ctx.db.prepare('SELECT password_enc FROM credentials LIMIT 1').get() as { password_enc: string };
    expect(raw.password_enc.startsWith('v1.')).toBe(true);
    expect(raw.password_enc).not.toContain('Demo');
    expect((await d.F.get('/audit?action=vault_reveal')).j.length).toBeGreaterThanOrEqual(1);
  });
});

describe('team management guards', () => {
  it('stops a founder deactivating themself and signs deactivated users out at once', async () => {
    const me = (await d.F.get('/me')).j;
    expect((await d.F.put(`/users/${me.id}`, { active: false })).s).toBe(400);
    const users = (await d.F.get('/users')).j as { id: number; email: string }[];
    const tara = users.find((u) => u.email === 'tara@demo.test') as { id: number };
    expect((await d.F.put(`/users/${tara.id}`, { active: false })).s).toBe(200);
    expect((await d.T.get('/me')).s).toBe(401);
    expect((await d.app.login('tara@demo.test')).status).toBe(401);
    expect((await d.F.put(`/users/${tara.id}`, { active: true })).s).toBe(200);
  });
  it('rejects weak passwords and lets a founder remove a person completely (not themself)', async () => {
    expect((await d.F.post('/users', { name: 'W', email: 'weak@x.com', password: 'short', role: 'intern' })).s).toBe(400);
    const made = await d.F.post('/users', { name: 'Temp Person', email: 'temp@x.com', password: 'Temp-pass-2026x', role: 'intern' });
    expect(made.s).toBe(201);
    expect((await d.F.del(`/users/${made.j.id}`)).s).toBe(200);
    expect((await d.app.login('temp@x.com', 'Temp-pass-2026x')).status).toBe(401);
    const me = (await d.F.get('/me')).j;
    expect((await d.F.del(`/users/${me.id}`)).s).toBe(400);
    expect((await d.K.del('/users/1')).s).toBe(403);
  });
  it('can create a person whose temporary password does not have to be changed', async () => {
    const made = await d.F.post('/users', { name: 'Keep Same', email: 'same@x.com', password: PASSWORD, role: 'founder', keep_password: true });
    expect(made.j.must_change_password).toBe(false);
    const s = await d.app.login('same@x.com');
    expect((await s.get('/finance/summary')).s).toBe(200);
  });
});

describe('first-time setup', () => {
  it('is only possible once and creates a founder', async () => {
    const t = createTestApp();
    const a = await t.request.post('/api/auth/setup').set('X-Requested-With', 'crm').send({ name: 'Ashwin Solanki', email: 'a@x.test', password: PASSWORD });
    expect(a.status).toBe(200);
    const b = await t.request.post('/api/auth/setup').set('X-Requested-With', 'crm').send({ name: 'Other', email: 'o@x.test', password: PASSWORD });
    expect(b.status).toBe(400);
    t.close();
  });
});
