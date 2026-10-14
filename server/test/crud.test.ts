import { today as localToday } from '@crm/shared';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ago, type LoggedIn } from './helpers';
import { createDemo, type Demo } from './demo';

let d: Demo;
let F: LoggedIn;
beforeAll(async () => {
  d = await createDemo();
  F = d.F;
});
afterAll(() => d.app.close());
const today = localToday();

describe('every record type: create, edit, list, delete — each with its own system ID', () => {
  // resource, create body, edit body, field that must change, ID pattern
  const CASES: [string, () => Record<string, unknown>, Record<string, unknown>, string, RegExp][] = [
    ['leads', () => ({ company: 'CRUD Lead Co', name: 'Asha' }), { company: 'CRUD Lead Co Ltd' }, 'company', /^LD-\d{4}$/],
    ['clients', () => ({ company: 'CRUD Client Pvt Ltd' }), { company: 'CRUD Client LLP' }, 'company', /^CL-\d{4}$/],
    ['contacts', () => ({ client_id: d.clients.acme, name: 'Priya Rao' }), { role: 'Owner' }, 'role', /^CT-\d{4}$/],
    ['projects', () => ({ client_id: d.clients.acme, name: 'CRUD Project' }), { name: 'CRUD Project v2', status: 'active' }, 'name', /^P-\d{2}-\d{3}$/],
    ['tasks', () => ({ title: 'CRUD task', project_id: d.proj.acme }), { title: 'CRUD task edited' }, 'title', /^T-\d+$/],
    ['quotes', () => ({ title: 'CRUD quote', client_id: d.clients.acme, items: [{ description: 'Work', qty: 1, rate: 1000 }] }), { title: 'CRUD quote edited' }, 'title', /^QUO\//],
    ['invoices', () => ({ client_id: d.clients.acme, project_id: d.proj.acme, items: [{ description: 'Work', qty: 1, rate: 1000 }] }), { title: 'CRUD invoice edited' }, 'title', /^INV\//],
    ['payments', () => ({ date: today, amount: 500, client_id: d.clients.acme }), { amount: 750 }, 'amount', /^PAY-\d{4}$/],
    ['expenses', () => ({ date: today, amount: 300, category: 'Other', description: 'CRUD expense' }), { amount: 350 }, 'amount', /^EXP-\d{4}$/],
    ['accounts', () => ({ name: 'CRUD cash', type: 'cash' }), { name: 'CRUD cash box' }, 'name', /^ACC-\d{4}$/],
    ['transfers', () => ({ date: today, kind: 'capital_in', amount: 100, account_id: d.bank }), { amount: 120 }, 'amount', /^TRF-\d{4}$/],
    ['grants', () => ({ name: 'CRUD grant', requested: 1000 }), { received: 400 }, 'received', /^GR-\d{4}$/],
    ['assets', () => ({ asset_type: 'Laptop', make_model: 'CRUD Book' }), { make_model: 'CRUD Book Pro' }, 'make_model', /^AST-\d{4}$/],
    ['bank_transactions', () => ({ date: today, description: 'CRUD line', deposit: 100 }), { deposit: 110 }, 'deposit', /^BNK-\d{4}$/],
    ['renewals', () => ({ name: 'CRUD domain', kind: 'domain', renewal_date: today, cycle: 'yearly', our_cost: 900 }), { our_cost: 950 }, 'our_cost', /^REN-\d{4}$/],
    ['maintenance_logs', () => ({ title: 'CRUD fix', project_id: d.proj.bright }), { status: 'resolved' }, 'status', /^MNT-\d{4}$/],
    ['events', () => ({ title: 'CRUD event', date: today }), { title: 'CRUD event edited' }, 'title', /^EV-\d{4}$/],
    ['change_requests', () => ({ project_id: d.proj.acme, title: 'CRUD change', description: 'Move the export button' }), { description: 'Move the export button to the top bar' }, 'description', /^CR-\d{4}$/],
  ];
  const created: [string, number][] = [];
  for (const [res, body, edit, field, ref] of CASES) {
    it(`${res}`, async () => {
      const c = await F.post(`/${res}`, body());
      expect(c.s, JSON.stringify(c.j)).toBe(201);
      expect(String(c.j.ref)).toMatch(ref);
      const u = await F.put(`/${res}/${c.j.id}`, edit);
      expect(u.s).toBe(200);
      expect(u.j[field]).toBe(edit[field]);
      const back = await F.get(`/${res}/${c.j.id}`);
      expect(back.j[field]).toBe(edit[field]);
      expect(back.j.ref).toBe(c.j.ref); // the ID never changes
      const list = await F.list(`/${res}`);
      expect(list.j.some((r: { id: number; ref: string }) => r.id === c.j.id && r.ref === c.j.ref)).toBe(true);
      created.push([res, c.j.id]);
    });
  }
  it('numbers records one after another and removes them again', async () => {
    const l1 = await F.post('/leads', { company: 'ID check one' });
    const l2 = await F.post('/leads', { company: 'ID check two' });
    expect(l2.j.id).toBe(l1.j.id + 1);
    expect(l2.j.ref).not.toBe(l1.j.ref);
    created.push(['leads', l1.j.id], ['leads', l2.j.id]);
    // delete in a safe order: things that point at others first
    const order = ['change_requests', 'maintenance_logs', 'events', 'renewals', 'bank_transactions', 'payments', 'expenses', 'transfers', 'invoices', 'quotes', 'tasks', 'contacts', 'grants', 'assets', 'accounts', 'leads', 'projects', 'clients'];
    for (const res of order) {
      for (const [r, id] of created.filter(([x]) => x === res)) {
        expect((await F.del(`/${r}/${id}`)).s, `delete ${r} ${id}`).toBe(200);
        expect((await F.get(`/${r}/${id}`)).s).toBe(404);
      }
    }
  });
  it('protects a client with history from deletion, with a readable reason', async () => {
    const protectedClient = ((await F.list('/clients')).j as { id: number; project_count: number }[]).find((c) => c.project_count > 0) as { id: number };
    const refused = await F.del(`/clients/${protectedClient.id}`);
    expect(refused.s).toBe(409);
    expect(refused.j.error).toMatch(/Archived|history/i);
  });
});

describe('pagination, search, sorting and filters are done by the server', () => {
  it('pages a list and reports the total in a header', async () => {
    for (let i = 0; i < 12; i++) await F.post('/leads', { company: `Paging Company ${String(i).padStart(2, '0')}`, city: 'Pune' });
    const p1 = await F.get('/leads?limit=5&offset=0&q=Paging%20Company&sort=company:asc');
    expect(p1.s).toBe(200);
    expect(p1.j).toHaveLength(5);
    expect(p1.h['x-total-count']).toBe('12');
    expect(p1.j[0].company).toBe('Paging Company 00');
    const p3 = await F.get('/leads?limit=5&offset=10&q=Paging%20Company&sort=company:asc');
    expect(p3.j).toHaveLength(2);
    const desc = await F.get('/leads?limit=3&q=Paging%20Company&sort=company:desc');
    expect(desc.j[0].company).toBe('Paging Company 11');
  });
  it('caps the page size and ignores nonsense', async () => {
    expect(((await F.get('/leads?limit=100000')).j as unknown[]).length).toBeLessThanOrEqual(500);
    expect((await F.get('/leads?limit=-4&offset=abc')).s).toBe(200);
    expect(((await F.get('/leads')).j as unknown[]).length).toBeLessThanOrEqual(50);
  });
  it('searches by text, system ID, contact details, and filters by field', async () => {
    const one = (await F.get('/leads?q=Kumar%20Textiles')).j[0];
    expect(one.company).toBe('Kumar Textiles');
    expect(((await F.get(`/leads?q=${one.ref}`)).j as { id: number }[]).some((r) => r.id === one.id)).toBe(true);
    expect(((await F.get('/leads?stage=lost')).j as { stage: string }[]).every((r) => r.stage === 'lost')).toBe(true);
    expect(((await F.get('/leads?followup_status=Overdue')).j as { followup_status: string }[]).every((r) => r.followup_status === 'Overdue')).toBe(true);
    expect(((await F.get('/clients?q=Neha')).j as { company: string }[]).map((c) => c.company)).toContain('Acme Logistics Pvt Ltd'); // finds the client by a contact's name
    expect((await F.get('/clients?q=%25')).j).toHaveLength(0); // wildcard characters are literal
  });
  it('filters payments and expenses by a date range', async () => {
    const all = (await F.list('/payments')).j as { date: string }[];
    const recent = (await F.get(`/payments?from=${ago(20)}&to=${today}&limit=500`)).j as { date: string }[];
    expect(recent.length).toBeLessThan(all.length);
    expect(recent.every((p) => p.date >= ago(20))).toBe(true);
  });
  it('exports everything (not just one page) as Excel and as PDF — and never as CSV', async () => {
    const cookie = await cookieOf(d);
    const get = (url: string) => d.app.request.get(url).set('X-Requested-With', 'crm').set('Cookie', cookie).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const x = await get('/api/leads/export.xlsx');
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as never);
    const ws = wb.worksheets[0] as ExcelJS.Worksheet;
    expect(ws.rowCount).toBeGreaterThan(18); // header + every lead (more than one page of 5 above)
    expect(String(ws.getRow(1).getCell(1).value)).toBe('Ref');
    const px = await get('/api/payments/export.xlsx');
    const pwb = new ExcelJS.Workbook();
    await pwb.xlsx.load(px.body as never);
    const heads = ((pwb.worksheets[0] as ExcelJS.Worksheet).getRow(1).values as unknown[]).slice(1).map(String);
    expect(heads).toContain('TDS'); // acronyms read properly
    expect(heads).not.toContain('Import key'); // nothing internal leaks into a spreadsheet people share
    expect(heads.filter((h) => /(^|\s)id$/i.test(h))).toEqual([]);
    const filtered = await get('/api/leads/export.xlsx?stage=won');
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(filtered.body as never);
    expect((wb2.worksheets[0] as ExcelJS.Worksheet).rowCount).toBeLessThan(ws.rowCount);
    const pdf = await get('/api/leads/export.pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await get('/api/leads/export.csv')).status).toBe(404);
  });
});

async function cookieOf(demo: Demo): Promise<string> {
  const r = await demo.app.request.post('/api/auth/login').set('X-Requested-With', 'crm').send({ email: 'aarav@demo.test', password: 'Demo-Pass-2026' });
  return String((r.headers['set-cookie'] as unknown as string[])[0]).split(';')[0] as string;
}
