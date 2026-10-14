import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemo, type Demo } from './demo';

let d: Demo;
beforeAll(async () => { d = await createDemo(); });
afterAll(() => d.app.close());
const today = new Date().toISOString().slice(0, 10);

/** The whole commercial chain, end to end: lead → quotation → client & project → change request → quotation → invoice → payment. */
describe('lead → quotation → client & project', () => {
  let clientId = 0;
  let projectId = 0;
  it('turns the accepted quotation into the project scope and value when the lead converts', async () => {
    const quote = (await d.F.list('/quotes')).j[0];
    expect(quote.total).toBe(383500);
    const conv = await d.F.post(`/leads/${d.leads.l1}/convert`, { create_project: true, quote_id: quote.id, project_name: 'Kumar Textiles online store' });
    expect(conv.s).toBe(200);
    clientId = conv.j.client_id;
    projectId = conv.j.project_id;
    const project = (await d.F.get(`/projects/${projectId}`)).j;
    expect(project.budget).toBe(325000); // the quoted price without GST
    expect(project.client_name).toBe('Kumar Textiles');
    const q = (await d.F.get(`/quotes/${quote.id}`)).j;
    expect(q).toMatchObject({ status: 'accepted', project_id: projectId, client_id: clientId });
    expect((await d.F.get(`/leads/${d.leads.l1}`)).j).toMatchObject({ stage: 'won', client_id: clientId });
    const notes = (await d.F.get(`/notes?entity_type=project&entity_id=${projectId}`)).j as { body: string }[];
    expect(notes.some((n) => /Started from accepted quotation/.test(n.body))).toBe(true);
  });
  it('refuses a quotation that belongs to another lead', async () => {
    const q2 = await d.F.post('/quotes', { lead_id: d.leads.l2, title: 'Other lead quote', items: [{ description: 'Site', qty: 1, rate: 100 }] });
    const conv = await d.F.post(`/leads/${d.leads.l3}/convert`, { create_project: true, quote_id: q2.j.id });
    expect(conv.s).toBe(400);
  });

  describe('change request before delivery', () => {
    let crId = 0;
    it('is raised against the project, with the client, phase and a system ID filled in', async () => {
      await d.F.put(`/projects/${projectId}`, { status: 'active' });
      const cr = await d.F.post('/change_requests', { project_id: projectId, title: 'Add a wishlist page', description: 'Customers want to save products', kind: 'feature', requested_by: 'Rajesh Kumar' });
      expect(cr.s).toBe(201);
      expect(cr.j).toMatchObject({ client_id: clientId, phase: 'before_delivery', status: 'requested', billable: 1 });
      expect(cr.j.ref).toMatch(/^CR-\d{4}$/);
      expect(cr.j.requested_on).toBe(today);
      crId = cr.j.id;
      const timeline = (await d.F.get(`/notes?entity_type=change_request&entity_id=${crId}`)).j as { body: string }[];
      expect(timeline.some((n) => /Change request raised \(before delivery\)/.test(n.body))).toBe(true);
    });
    it('cannot be marked estimated without an estimate, and cannot skip steps', async () => {
      expect((await d.F.put(`/change_requests/${crId}`, { status: 'estimated' })).s).toBe(400);
      expect((await d.F.put(`/change_requests/${crId}`, { status: 'delivered' })).s).toBe(400);
      expect((await d.F.put(`/change_requests/${crId}`, { project_id: d.proj.acme })).s).toBe(400);
    });
    it('is estimated, then quoted with one click: quotation and request point at each other', async () => {
      const est = await d.F.put(`/change_requests/${crId}`, { estimate_hours: 12, estimate_amount: 24000, status: 'estimated' });
      expect(est.j.status).toBe('estimated');
      const q = await d.F.post(`/change-requests/${crId}/quote`);
      expect(q.s).toBe(201);
      const quote = (await d.F.get(`/quotes/${q.j.quote_id}`)).j;
      expect(quote).toMatchObject({ project_id: projectId, client_id: clientId, change_request_id: crId, status: 'draft' });
      expect(quote.items[0]).toMatchObject({ qty: 1, rate: 24000 });
      expect(quote.items[0].description).toMatch(/Add a wishlist page \(about 12 hours\)/);
      expect(quote.tax_type).toBe('cgst_sgst'); // demo company has a GSTIN: GST applies
      expect(quote.total).toBe(28320);
      const cr = (await d.F.get(`/change_requests/${crId}`)).j;
      expect(cr).toMatchObject({ status: 'quoted', quote_id: q.j.quote_id, billing_status: 'quoted', quote_number: quote.number });
      expect((await d.F.post(`/change-requests/${crId}/quote`)).s).toBe(409); // one open quotation at a time
    });
    it('is approved when the client accepts the quotation; the project value follows', async () => {
      const cr = (await d.F.get(`/change_requests/${crId}`)).j;
      await d.F.put(`/quotes/${cr.quote_id}`, { status: 'sent' });
      await d.F.put(`/quotes/${cr.quote_id}`, { status: 'accepted' });
      const after = (await d.F.get(`/change_requests/${crId}`)).j;
      expect(after).toMatchObject({ status: 'approved', approved_on: today });
      const p = (await d.F.get(`/projects/${projectId}`)).j;
      expect(p).toMatchObject({ budget: 325000, cr_value: 24000, revised_value: 349000, cr_open: 1, cr_count: 1 });
    });
    it('is invoiced from its quotation and settles when paid', async () => {
      const cr = (await d.F.get(`/change_requests/${crId}`)).j;
      const inv = await d.F.post(`/quotes/${cr.quote_id}/to-invoice`);
      expect(inv.s).toBe(200);
      const invoice = (await d.F.get(`/invoices/${inv.j.invoice_id}`)).j;
      expect(invoice).toMatchObject({ change_request_id: crId, project_id: projectId, client_id: clientId, total: 28320 });
      expect((await d.F.get(`/change_requests/${crId}`)).j).toMatchObject({ invoice_id: invoice.id, billing_status: 'invoiced' });
      await d.F.put(`/invoices/${invoice.id}`, { status: 'sent' });
      await d.F.post('/payments', { invoice_id: invoice.id, date: today, amount: 28320, account_id: d.bank });
      expect((await d.F.get(`/change_requests/${crId}`)).j.billing_status).toBe('paid');
      expect((await d.F.get(`/projects/${projectId}`)).j.total_received).toBe(28320);
    });
    it('cannot be deleted once invoiced, and links tasks to its own project only', async () => {
      expect((await d.F.del(`/change_requests/${crId}`)).s).toBe(409);
      const t = await d.F.post('/tasks', { title: 'Build the wishlist page', change_request_id: crId });
      expect(t.s).toBe(201);
      expect(t.j.project_id).toBe(projectId);
      expect(t.j.change_request_title).toBe('Add a wishlist page');
      expect((await d.F.post('/tasks', { title: 'wrong project', project_id: d.proj.acme, change_request_id: crId })).s).toBe(400);
      await d.F.put(`/change_requests/${crId}`, { status: 'in_progress' });
      await d.F.put(`/change_requests/${crId}`, { status: 'delivered' });
      const done = (await d.F.get(`/change_requests/${crId}`)).j;
      expect(done).toMatchObject({ status: 'delivered', delivered_on: today, task_count: 1 });
    });
  });

  describe('change request after delivery', () => {
    it('is flagged as post-delivery when the project is completed, and can be non-billable', async () => {
      await d.F.put(`/projects/${projectId}`, { status: 'completed' });
      const cr = await d.F.post('/change_requests', { project_id: projectId, title: 'Fix typo on the home page', kind: 'change', billable: false });
      expect(cr.j.phase).toBe('after_delivery');
      expect(cr.j.billable).toBe(0);
      expect((await d.F.put(`/change_requests/${cr.j.id}`, { status: 'approved' })).j.approved_on).toBe(today);
      expect((await d.F.post(`/change-requests/${cr.j.id}/quote`)).s).toBe(400); // nothing to bill
      const paid = await d.F.post('/change_requests', { project_id: projectId, title: 'New feature: loyalty points', kind: 'feature', estimate_amount: 50000, estimate_hours: 30, status: 'estimated' });
      expect(paid.j.status).toBe('estimated'); // created with an estimate
      expect(paid.j.phase).toBe('after_delivery');
    });
    it('is rejected, reopened, and a rejected quotation sends it back to estimated', async () => {
      const cr = await d.F.post('/change_requests', { project_id: projectId, title: 'Rebuild in another stack', estimate_amount: 90000, status: 'estimated' });
      const q = await d.F.post(`/change-requests/${cr.j.id}/quote`);
      await d.F.put(`/quotes/${q.j.quote_id}`, { status: 'sent' });
      await d.F.put(`/quotes/${q.j.quote_id}`, { status: 'rejected' });
      expect((await d.F.get(`/change_requests/${cr.j.id}`)).j.status).toBe('estimated');
      expect((await d.F.put(`/change_requests/${cr.j.id}`, { status: 'rejected' })).s).toBe(200);
      expect((await d.F.put(`/change_requests/${cr.j.id}`, { status: 'requested' })).s).toBe(200);
      await d.F.del(`/quotes/${q.j.quote_id}`);
      expect((await d.F.del(`/change_requests/${cr.j.id}`)).s).toBe(200);
    });
  });
});

describe('who may do what with change requests', () => {
  it('lets a project member (intern) record and progress requests, but not price, approve or reject them', async () => {
    const cr = await d.K.post('/change_requests', { project_id: d.proj.acme, title: 'Client wants CSV export', estimate_amount: 99999, billable: false });
    expect(cr.s).toBe(201);
    expect(cr.j.estimate_amount).toBeUndefined(); // money is hidden from interns
    const stored = d.app.ctx.db.prepare('SELECT estimate_amount, billable FROM change_requests WHERE id=?').get(cr.j.id) as { estimate_amount: number; billable: number };
    expect(stored).toEqual({ estimate_amount: 0, billable: 1 }); // the intern could not set them
    expect((await d.K.put(`/change_requests/${cr.j.id}`, { status: 'approved' })).s).toBe(403);
    expect((await d.K.put(`/change_requests/${cr.j.id}`, { title: 'hacked', status: 'estimated' })).s).toBe(403);
    expect((await d.F.put(`/change_requests/${cr.j.id}`, { status: 'approved' })).s).toBe(200);
    expect((await d.K.put(`/change_requests/${cr.j.id}`, { status: 'in_progress', title: 'ignored', estimate_hours: 3 })).s).toBe(200);
    expect((await d.K.get(`/change_requests/${cr.j.id}`)).j.title).toBe('Client wants CSV export');
    expect((await d.K.del(`/change_requests/${cr.j.id}`)).s).toBe(403);
    expect((await d.K.post(`/change-requests/${cr.j.id}/quote`)).s).toBe(403);
  });
  it('keeps requests on other projects invisible and unwritable for the intern', async () => {
    const other = await d.F.post('/change_requests', { project_id: d.proj.green, title: 'Green private request' });
    expect((await d.K.get(`/change_requests/${other.j.id}`)).s).toBe(404);
    expect(((await d.K.list('/change_requests')).j as { id: number }[]).some((c) => c.id === other.j.id)).toBe(false);
    expect((await d.K.post('/change_requests', { project_id: d.proj.green, title: 'sneak' })).s).toBe(403);
    expect((await d.K.get('/notes?entity_type=change_request&entity_id=' + other.j.id)).s).toBe(403);
  });
});

describe('delivery analytics', () => {
  it('summarises projects, change requests (with money for founders), tasks, maintenance and the team', async () => {
    const a = (await d.F.get('/analytics/delivery')).j;
    expect(a.projects.total).toBeGreaterThanOrEqual(3);
    expect(a.change_requests.open).toBeGreaterThanOrEqual(1);
    expect(a.change_requests.by_phase.length).toBeGreaterThanOrEqual(1);
    expect(a.change_requests.money.approved).toBeGreaterThanOrEqual(24000);
    expect(a.change_requests.money.collected).toBeGreaterThanOrEqual(28320);
    expect(a.change_requests.monthly).toHaveLength(6);
    expect(a.tasks.weekly).toHaveLength(8);
    expect(a.team.length).toBeGreaterThanOrEqual(6);
    expect(a.maintenance.open).toBeGreaterThanOrEqual(1);
  });
  it('removes search results and money when an intern asks', async () => {
    const found = (await d.F.get('/search?q=wishlist')).j as { type: string }[];
    expect(found.some((x) => x.type === 'Change request')).toBe(true);
    const a = (await d.K.get('/analytics/delivery')).j;
    expect(a.change_requests.money).toBeUndefined();
  });
});
