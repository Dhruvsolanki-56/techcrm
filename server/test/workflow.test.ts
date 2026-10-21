import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemo, type Demo } from './demo';
import { ago } from './helpers';

let d: Demo;
beforeAll(async () => { d = await createDemo(); });
afterAll(() => d.app.close());

const newProject = async (budget: number, extra: Record<string, unknown> = {}) =>
  (await d.F.post('/projects', { client_id: d.clients.bright, name: `Workflow ${Math.random().toString(36).slice(2, 7)}`, status: 'active', budget, ...extra })).j.id as number;

describe('payment schedule (milestones)', () => {
  it('splits the agreed value with a ready-made schedule and keeps the total exact', async () => {
    const p = await newProject(100001);
    const r = await d.F.post(`/projects/${p}/schedule`, { template: '40-30-30' });
    expect(r.s).toBe(200);
    expect(r.j).toHaveLength(3);
    expect(r.j.reduce((s: number, m: { amount: number }) => s + m.amount, 0)).toBeCloseTo(100001, 2);
    expect(r.j[0].kind).toBe('advance');
    expect(r.j[2].kind).toBe('final');
    expect((await d.F.post(`/projects/${p}/schedule`, { template: '50-50' })).j).toHaveLength(2); // replaced
    expect((await d.F.post(`/projects/${p}/schedule`, { template: 'nonsense' })).s).toBe(400);
  });
  it('needs an agreed value for a ready-made schedule, but payments can always be added and changed by hand', async () => {
    const empty = await newProject(0);
    expect((await d.F.post(`/projects/${empty}/schedule`, { template: 'full' })).s).toBe(400);
    const p = await newProject(10000);
    const ok = await d.F.post('/milestones', { project_id: p, title: 'Half', percent: 50 });
    expect(ok.s).toBe(201);
    expect(ok.j.amount).toBe(5000);
    expect(ok.j.ref).toMatch(/^MS-\d{4}$/);
    expect((await d.F.post('/milestones', { project_id: p, title: 'Extra work', amount: 9000 })).s).toBe(201); // over the value: allowed, you know your deal
    expect((await d.F.put(`/milestones/${ok.j.id}`, { amount: 6000, title: 'Half (revised)' })).j.amount).toBe(6000);
  });
  it('follows its invoice: planned → ready → invoiced → paid, and stays editable throughout', async () => {
    const p = await newProject(60000);
    const ms = (await d.F.post(`/projects/${p}/schedule`, { template: '50-50' })).j;
    expect((await d.F.get(`/milestones/${ms[0].id}`)).j.state).toBe('planned');
    await d.F.put(`/milestones/${ms[0].id}`, { reached_on: ago(1) });
    expect((await d.F.get(`/milestones/${ms[0].id}`)).j.state).toBe('ready');
    const inv = await d.F.post(`/milestones/${ms[0].id}/invoice`);
    expect(inv.s).toBe(201);
    const invoice = (await d.F.get(`/invoices/${inv.j.invoice_id}`)).j;
    expect(invoice.project_id).toBe(p);
    expect(invoice.client_id).toBe(d.clients.bright);
    expect(invoice.subtotal).toBe(30000);
    expect(invoice.status).toBe('draft');
    expect((await d.F.post(`/milestones/${ms[0].id}/invoice`)).s).toBe(400);
    expect((await d.F.put(`/milestones/${ms[0].id}`, { notes: 'Client asked for it in two parts' })).s).toBe(200);
    // a new schedule keeps what is already invoiced and splits only the rest
    const again = await d.F.post(`/projects/${p}/schedule`, { template: '50-50' });
    expect(again.s).toBe(200);
    const kept = again.j.filter((m: { invoice_id: number | null }) => m.invoice_id);
    expect(kept).toHaveLength(1);
    expect(again.j.reduce((s: number, m: { amount: number }) => s + m.amount, 0)).toBeCloseTo(60000, 2);
    await d.F.put(`/invoices/${invoice.id}`, { status: 'sent' });
    expect((await d.F.get(`/milestones/${ms[0].id}`)).j.state).toBe('invoiced');
    await d.F.post('/payments', { invoice_id: invoice.id, amount: invoice.total, date: ago(0) });
    const paid = (await d.F.get(`/milestones/${ms[0].id}`)).j;
    expect(paid.state).toBe('paid');
    expect(paid.invoice_number).toBe(invoice.number);
  });
  it('is founder-only', async () => {
    expect((await d.K.get('/milestones')).s).toBe(403);
    expect((await d.K.post('/milestones', { project_id: d.proj.acme, title: 'x', amount: 1 })).s).toBe(403);
  });
});

describe('quotation → project', () => {
  it('starts a project for an existing client from a quotation and links everything', async () => {
    const q = (await d.F.post('/quotes', { client_id: d.clients.green, title: 'Loyalty app', items: [{ description: 'App', qty: 1, rate: 200000 }], discount: 20000 })).j;
    const r = await d.F.post(`/quotes/${q.id}/start-project`, { project_name: 'GreenLeaf Loyalty App' });
    expect(r.s).toBe(201);
    const project = (await d.F.get(`/projects/${r.j.project_id}`)).j;
    expect(project.budget).toBe(180000);
    expect(project.client_id).toBe(d.clients.green);
    expect(project.code).toMatch(/^P-\d{2}-\d{3}$/);
    const after = (await d.F.get(`/quotes/${q.id}`)).j;
    expect(after.status).toBe('accepted');
    expect(after.project_id).toBe(project.id);
    expect((await d.F.post(`/quotes/${q.id}/start-project`)).s).toBe(400); // only once
  });
  it('accepting a quotation of a lead makes the client, the project and moves the lead — and the first payment converts it', async () => {
    const lead = (await d.F.post('/leads', { company: 'Flow Co', name: 'Farah Khan', phone: '+91 98111 22233', stage: 'proposal', specs: 'Pages: home, about.' })).j;
    const q = (await d.F.post('/quotes', { lead_id: lead.id, title: 'Flow site', items: [{ description: 'Site', qty: 1, rate: 80000 }] })).j;
    // a second quotation for the same lead stays untouched
    const other = (await d.F.post('/quotes', { lead_id: lead.id, title: 'Flow app', items: [{ description: 'App', qty: 1, rate: 50000 }] })).j;
    const r = await d.F.put(`/quotes/${q.id}`, { status: 'accepted' });
    expect(r.s).toBe(200);
    expect(r.j.project_id).toBeTruthy();
    const l = (await d.F.get(`/leads/${lead.id}`)).j;
    expect(l).toMatchObject({ stage: 'accepted', client_id: r.j.client_id });
    const client = (await d.F.get(`/clients/${l.client_id}`)).j;
    expect(client).toMatchObject({ company: 'Flow Co', status: 'prospect' });
    expect(((await d.F.get(`/contacts?client_id=${client.id}`)).j as { name: string }[])[0]?.name).toBe('Farah Khan');
    const proj = (await d.F.get(`/projects/${r.j.project_id}`)).j;
    expect(proj).toMatchObject({ budget: 80000, status: 'planning', client_id: client.id });
    expect(proj.specs).toContain('Pages: home');
    expect((await d.F.get(`/quotes/${other.id}`)).j).toMatchObject({ status: 'draft', client_id: client.id, project_id: null });
    // accepting again, or by another route, changes nothing
    expect((await d.F.put(`/quotes/${q.id}`, { status: 'accepted', notes: 'again' })).j.project_id).toBe(r.j.project_id);
    expect(((await d.F.get('/projects?limit=500')).j as { name: string }[]).filter((p) => p.name === 'Flow site')).toHaveLength(1);
    // the first payment: prospect → client, lead → converted
    const inv = (await d.F.post('/invoices', { client_id: client.id, project_id: proj.id, status: 'sent', items: [{ description: 'Advance', qty: 1, rate: 30000 }] })).j;
    await d.F.post('/payments', { invoice_id: inv.id, amount: 30000, date: ago(0) });
    expect((await d.F.get(`/clients/${client.id}`)).j.status).toBe('active');
    expect((await d.F.get(`/leads/${lead.id}`)).j.stage).toBe('won');
    // a second quotation of the same lead can be accepted later and becomes its own project for the same client
    const r2 = await d.F.put(`/quotes/${other.id}`, { status: 'accepted' });
    expect(r2.j.project_id).not.toBe(r.j.project_id);
    expect((await d.F.get(`/projects/${r2.j.project_id}`)).j.client_id).toBe(client.id);
    expect((await d.F.get(`/leads/${lead.id}`)).j.stage).toBe('won'); // an already converted lead stays converted
  });
  it('invoicing a lead quotation makes the client without a project; a rejected one can do neither', async () => {
    const lead = (await d.F.post('/leads', { company: 'Invoice Only Co', name: 'Ira Roy', stage: 'proposal' })).j;
    const q = (await d.F.post('/quotes', { lead_id: lead.id, title: 'One-off', items: [{ description: 'Logo', qty: 1, rate: 5000 }] })).j;
    const inv = await d.F.post(`/quotes/${q.id}/to-invoice`);
    expect(inv.s).toBe(200);
    expect((await d.F.get(`/leads/${lead.id}`)).j.stage).toBe('accepted');
    expect((await d.F.get(`/quotes/${q.id}`)).j.project_id).toBeNull();
    const lead2 = (await d.F.post('/leads', { company: 'Nope Co', name: 'Nitin Das', stage: 'proposal' })).j;
    const q2 = (await d.F.post('/quotes', { lead_id: lead2.id, title: 'No', items: [{ description: 'x', qty: 1, rate: 100 }] })).j;
    await d.F.put(`/quotes/${q2.id}`, { status: 'rejected' });
    expect((await d.F.post(`/quotes/${q2.id}/start-project`)).s).toBe(400);
    expect((await d.F.get(`/leads/${lead2.id}`)).j.stage).toBe('proposal');
  });
  it('moves the lead to "Proposal Sent" when its quotation is sent', async () => {
    const lead = (await d.F.post('/leads', { company: 'Proposal Test Co', stage: 'contacted' })).j;
    const q = (await d.F.post('/quotes', { lead_id: lead.id, title: 'Website', items: [{ description: 'x', qty: 1, rate: 50000 }] })).j;
    expect((await d.F.get(`/leads/${lead.id}`)).j.stage).toBe('contacted');
    await d.F.put(`/quotes/${q.id}`, { status: 'sent' });
    const after = (await d.F.get(`/leads/${lead.id}`)).j;
    expect(after.stage).toBe('proposal');
    expect(after.proposal_date).toBeTruthy();
  });
});

describe('action center', () => {
  it('lists what needs doing, worst first, with a link for each', async () => {
    const p = await newProject(80000);
    const ms = (await d.F.post(`/projects/${p}/schedule`, { template: 'full' })).j[0];
    await d.F.put(`/milestones/${ms.id}`, { reached_on: ago(2) });
    const r = await d.F.get('/attention');
    expect(r.s).toBe(200);
    const titles = r.j.items.map((i: { title: string }) => i.title);
    expect(titles.some((t: string) => /^Ready to invoice: Full payment/.test(t))).toBe(true);
    expect(titles.some((t: string) => /owes/.test(t))).toBe(true); // the demo has an overdue invoice
    expect(r.j.items.every((i: { link: string }) => i.link.startsWith('/'))).toBe(true);
    const order = ['critical', 'high', 'normal'];
    const ranks = r.j.items.map((i: { severity: string }) => order.indexOf(i.severity));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(r.j.total).toBe(r.j.items.length);
    expect(r.j.counts.critical + r.j.counts.high + r.j.counts.normal).toBe(r.j.total);
  });
  it('flags unbilled work on a finished project and a delivered change request nobody invoiced', async () => {
    const p = await newProject(90000, { status: 'completed' });
    const cr = (await d.F.post('/change_requests', { project_id: p, title: 'Extra reports', estimate_amount: 12000, estimate_hours: 6 })).j;
    await d.F.put(`/change_requests/${cr.id}`, { status: 'approved' });
    await d.F.put(`/change_requests/${cr.id}`, { status: 'delivered' });
    const titles = (await d.F.get('/attention')).j.items.map((i: { title: string }) => i.title);
    expect(titles.some((t: string) => /₹1,02,000 still to get/.test(t))).toBe(true);
    expect(titles).toContain('Delivered but not invoiced: Extra reports');
  });
  it('shows an intern only their own work, never money', async () => {
    const r = await d.K.get('/attention');
    expect(r.s).toBe(200);
    expect(r.j.items.every((i: { area: string }) => ['Delivery', 'Support', 'Sales'].includes(i.area))).toBe(true);
    expect(r.j.items.some((i: { area: string }) => i.area === 'Money')).toBe(false);
    expect((await d.T.get('/attention')).j.items.some((i: { area: string }) => i.area === 'Money')).toBe(false);
  });
});

describe('change history', () => {
  it('records who changed which field from what to what, for any record', async () => {
    const lead = (await d.F.post('/leads', { company: 'History Co', stage: 'new' })).j;
    await d.F.put(`/leads/${lead.id}`, { stage: 'contacted', value: 5000 });
    await d.F.put(`/leads/${lead.id}`, { stage: 'contacted' }); // nothing changed → nothing logged
    const h = (await d.F.get(`/history?entity=leads&entity_id=${lead.id}`)).j as { action: string; user_name: string; changes: { field: string; from?: unknown; to?: unknown }[] }[];
    expect(h.map((x) => x.action)).toEqual(['update', 'create']);
    expect(h[0]?.user_name).toBe('Aarav Mehta');
    expect(h[0]?.changes).toEqual(expect.arrayContaining([{ field: 'stage', from: 'new', to: 'contacted' }, { field: 'value', from: 0, to: 5000 }]));
    expect((await d.K.get(`/history?entity=leads&entity_id=${lead.id}`)).s).toBe(404); // outside an intern's view
    expect((await d.F.get('/history?entity=nope&entity_id=1')).s).toBe(404);
  });
});

describe('files for any record', () => {
  it('attaches a file to an expense, a grant and a change request, and removes it with the record', async () => {
    const e = (await d.F.post('/expenses', { date: ago(0), amount: 100, category: 'Other', vendor: 'Receipt Shop' })).j;
    const up = await d.F.post('/documents/link', { entity_type: 'expense', entity_id: e.id, url: 'https://drive.example/receipt', title: 'Receipt' });
    expect(up.s).toBe(201);
    const docs = (await d.F.get(`/documents?entity_type=expense&entity_id=${e.id}`)).j;
    expect(docs).toHaveLength(1);
    expect(docs[0].entity_name).toBe('Receipt Shop');
    await d.F.del(`/expenses/${e.id}`);
    expect((await d.F.get(`/documents?entity_type=expense&entity_id=${e.id}`)).j).toHaveLength(0);
  });
});

describe('leads: existing client, new company, or just a person', () => {
  it('accepts an individual with no company, and refuses a lead with no identity at all', async () => {
    const solo = await d.F.post('/leads', { name: 'Solo Freelancer', stage: 'new' });
    expect(solo.s).toBe(201);
    expect(solo.j.company ?? null).toBeNull();
    expect((await d.F.post('/leads', { stage: 'new' })).s).toBe(400);
    expect((await d.F.post('/leads', { company: 'Only A Company' })).s).toBe(201);
  });
  it('fills a lead for an existing client from the client and its main contact', async () => {
    const r = await d.F.post('/leads', { client_id: d.clients.green, requirement: 'New loyalty app' });
    expect(r.s).toBe(201);
    expect(r.j).toMatchObject({ company: 'GreenLeaf Organics', name: 'Vikram Rao', client_id: d.clients.green, client_name: 'GreenLeaf Organics' });
    expect(r.j.email).toBe('vikram@greenleaf.example');
    expect((await d.F.post('/leads', { client_id: 99999 })).s).toBe(400);
    expect((await d.F.get(`/leads?client_id=${d.clients.green}`)).j.some((l: { id: number }) => l.id === r.j.id)).toBe(true);
  });
  it('converting such a lead starts the work under the same client and creates no second client', async () => {
    const lead = (await d.F.post('/leads', { client_id: d.clients.bright, requirement: 'Parent portal', specs: 'Login, fee payments', stage: 'proposal' })).j;
    await d.F.post('/documents/link', { entity_type: 'lead', entity_id: lead.id, url: 'https://drive.example/spec', title: 'Spec doc' });
    const before = (await d.F.get('/clients?limit=500')).j.length;
    const r = await d.F.post(`/leads/${lead.id}/convert`, { create_project: true, project_name: 'Parent Portal' });
    expect(r.s).toBe(200);
    expect(r.j.client_id).toBe(d.clients.bright);
    expect((await d.F.get('/clients?limit=500')).j.length).toBe(before);
    const project = (await d.F.get(`/projects/${r.j.project_id}`)).j;
    expect(project.client_id).toBe(d.clients.bright);
    expect(project.specs).toContain('fee payments');
    expect((await d.F.get(`/leads/${lead.id}`)).j.stage).toBe('won');
    expect((await d.F.get(`/documents?entity_type=project&entity_id=${project.id}`)).j.map((x: { title: string }) => x.title)).toContain('Spec doc');
    expect((await d.F.post(`/leads/${lead.id}/convert`, {})).s).toBe(400); // only once
  });
});
