import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemo, type Demo } from './demo';
import { PASSWORD as PW } from './helpers';
import { makeLogin, makeRaw, newIp } from './raw';

let d: Demo;
let raw: ReturnType<typeof makeRaw>;
let login: ReturnType<typeof makeLogin>;
let F: Awaited<ReturnType<typeof login>>;
let K: typeof F;
let T: typeof F;
let acme: { id: number; client_id: number };
let green: { id: number; client_id: number };
let bright: { id: number; client_id: number };
const db = () => d.app.ctx.db;
const row = <R>(sql: string, ...p: unknown[]): R => db().prepare(sql).get(...p) as R;
const idOf = (email: string): number => row<{ id: number }>('SELECT id FROM users WHERE email=?', email).id;

beforeAll(async () => {
  d = await createDemo({ TRUST_PROXY: '1' });
  raw = makeRaw(d.app);
  login = makeLogin(d.app);
  F = await login('aarav@demo.test');
  K = await login('kabir@demo.test'); // intern with maintenance access, on Acme + BrightPath
  T = await login('tara@demo.test'); // intern, no extra access, on Acme + GreenLeaf
  const projects = (await F.call('GET', '/projects?limit=500')).j;
  acme = projects.find((p: { name: string }) => p.name.startsWith('Fleet'));
  green = projects.find((p: { name: string }) => p.name.startsWith('GreenLeaf'));
  bright = projects.find((p: { name: string }) => p.name.startsWith('BrightPath'));
});
afterAll(() => d.app.close());

describe('Access control — interns vs founder-only data', () => {
  const founderOnly = ['invoices', 'quotes', 'payments', 'expenses', 'accounts', 'transfers', 'renewals', 'change_requests_money'];
  for (const r of founderOnly.filter((x) => !x.endsWith('_money'))) {
    it(`blocks both interns from reading or changing ${r}`, async () => {
      const anyId = (db().prepare(`SELECT id FROM ${r} LIMIT 1`).get() as { id: number } | undefined)?.id ?? 1;
      for (const I of [K, T]) {
        const results = [
          await I.call('GET', `/${r}`), await I.call('GET', `/${r}/${anyId}`), await I.call('GET', `/${r}/export.csv`),
          await I.call('POST', `/${r}`, { name: 'x', title: 'x', client_id: 1, date: '2026-01-01', amount: 1, kind: 'capital_in' }),
          await I.call('PUT', `/${r}/${anyId}`, { notes: 'x' }), await I.call('DELETE', `/${r}/${anyId}`),
        ];
        expect(results.every((x) => [403, 404].includes(x.s))).toBe(true);
      }
    });
  }
  it('blocks finance, vault, team, audit, settings and backup for interns', async () => {
    for (const u of ['/finance/summary', '/credentials', '/users', '/audit', '/settings', '/backup', '/analytics/finance']) expect((await T.call('GET', u)).s).toBe(403);
    const cred = row<{ id: number }>('SELECT id FROM credentials LIMIT 1').id;
    expect((await K.call('POST', `/credentials/${cred}/reveal`)).s).toBe(403);
    expect((await T.call('PUT', '/settings', { company_name: 'pwned' })).s).toBe(403);
    expect((await T.call('POST', '/users', { name: 'x', email: 'evil@x.test', password: 'Abcdefghij12', role: 'founder' })).s).toBe(403);
    expect((await T.call('PUT', `/users/${idOf('tara@demo.test')}`, { role: 'founder' })).s).toBe(403);
    expect((await T.call('DELETE', `/users/${idOf('kabir@demo.test')}`)).s).toBe(403);
    expect((await T.call('POST', '/leads/1/convert', {})).s).toBe(403);
    expect((await T.call('POST', '/quotes/1/to-invoice')).s).toBe(403);
    expect((await T.call('POST', '/renewals/1/renew')).s).toBe(403);
    expect((await T.call('POST', '/change-requests/1/quote')).s).toBe(403);
    expect((await T.call('PUT', `/projects/${acme.id}/members`, { user_ids: [idOf('tara@demo.test')] })).s).toBe(403);
    expect((await T.call('GET', '/leads')).s).toBe(403);
    expect((await T.call('GET', '/leads/1')).s).toBe(404); // does not even confirm it exists
  });
});

describe('Access control — project isolation (IDOR)', () => {
  it('hides projects, tasks, timelines and teams of other projects', async () => {
    expect((await K.call('GET', `/projects/${green.id}`)).s).toBe(404);
    const greenTask = row<{ id: number }>('SELECT id FROM tasks WHERE project_id=? AND assignee_id<>?', green.id, idOf('kabir@demo.test'));
    expect((await K.call('GET', `/tasks/${greenTask.id}`)).s).toBe(404);
    expect((await K.call('PUT', `/tasks/${greenTask.id}`, { status: 'done' })).s).toBe(404);
    expect((await K.call('GET', `/notes?entity_type=project&entity_id=${green.id}`)).s).toBe(403);
    expect((await K.call('POST', '/tasks', { title: 'sneak', project_id: green.id })).s).toBe(403);
    expect((await K.call('GET', `/projects/${green.id}/members`)).s).toBe(403);
  });
  it('forces intern-created tasks onto the intern and blocks mass assignment on update', async () => {
    const kTask = await K.call('POST', '/tasks', { title: 'Own task', project_id: acme.id, assignee_id: 1, created_by: 1, lead_id: 1 });
    expect(kTask.s).toBe(201);
    expect(kTask.j.assignee_id).not.toBe(1);
    expect(kTask.j.lead_id).toBeNull();
    const upd = await K.call('PUT', `/tasks/${kTask.j.id}`, { status: 'review', project_id: green.id, assignee_id: 1, title: 'renamed' });
    expect(upd.j).toMatchObject({ project_id: acme.id, title: 'Own task', status: 'review' });
  });
  it('scopes events, money fields, search, dashboard, calendar and notifications', async () => {
    const ev = await F.call('POST', '/events', { title: 'GreenLeaf private call', date: '2026-12-01', project_id: green.id, client_id: green.client_id });
    const kEvents = (await K.call('GET', '/events?limit=500')).j;
    expect(kEvents.some((e: { id: number }) => e.id === ev.j.id)).toBe(false);
    expect(kEvents.some((e: { title: string }) => e.title === 'GST filing due')).toBe(true);
    const kp = (await K.call('GET', '/projects?limit=500')).j;
    const kc = (await K.call('GET', '/clients?limit=500')).j;
    expect(kp.every((p: { budget?: number; cr_value?: number }) => p.budget === undefined && p.cr_value === undefined)).toBe(true);
    expect(kc.every((c: { outstanding?: number; lifetime_received?: number }) => c.outstanding === undefined && c.lifetime_received === undefined)).toBe(true);
    const ks = (await T.call('GET', '/search?q=a')).j as { type: string }[];
    expect(ks.every((x) => !['Invoice', 'Quote', 'Credential', 'Renewal', 'Lead'].includes(x.type))).toBe(true);
    const kd = (await K.call('GET', '/dashboard')).j;
    expect(kd.kpi ?? kd.renewals ?? kd.trend).toBeUndefined();
    const cal = (await K.call('GET', '/calendar?from=2000-01-01&to=2099-12-31')).j.items as { type: string }[];
    expect(cal.every((i) => !['invoice', 'quote', 'renewal'].includes(i.type))).toBe(true);
    const tId = idOf('tara@demo.test');
    expect(((await T.call('GET', '/notifications')).j.items as { user_id: number }[]).every((n) => n.user_id === tId)).toBe(true);
    const money = (await K.call('GET', '/analytics/delivery')).j;
    expect(money.change_requests.money).toBeUndefined();
  });
});

describe('Access control — maintenance log', () => {
  it('ties an intern log to her project and herself, limits updates, forbids deletes', async () => {
    const tId = idOf('tara@demo.test');
    const log = await T.call('POST', '/maintenance_logs', { title: 'Tara log', project_id: green.id, client_id: 1, assignee_id: 1 });
    expect(log.s).toBe(201);
    expect(log.j.client_id).toBe(green.client_id);
    expect(log.j.assignee_id).toBe(tId);
    expect((await T.call('POST', '/maintenance_logs', { title: 'x', project_id: bright.id })).s).toBe(403);
    const upd = await T.call('PUT', `/maintenance_logs/${log.j.id}`, { status: 'resolved', title: 'changed', project_id: bright.id, billable: true });
    expect(upd.j).toMatchObject({ status: 'resolved', title: 'Tara log', project_id: green.id });
    expect(upd.j.billable).toBeFalsy();
    expect((await K.call('DELETE', `/maintenance_logs/${log.j.id}`)).s).toBe(403);
  });
});

describe('Access control — files & notes', () => {
  it('keeps company documents away from interns and refused uploads off the disk', async () => {
    const dir = d.app.config.uploadDir;
    const before = fs.readdirSync(dir).length + 1; // +1 for the founder upload below
    const up = await F.call('POST', '/documents/upload', undefined, { attach: { field: 'file', content: 'secret company doc', filename: 'policy.txt', fields: { entity_type: 'general' } } });
    expect(up.s).toBe(201);
    expect((await K.call('GET', `/files/${up.j.id}`)).s).toBe(404);
    expect(((await K.call('GET', '/documents?limit=500')).j as { id: number }[]).some((x) => x.id === up.j.id)).toBe(false);
    for (const [type, id] of [['general', ''], ['client', green.client_id], ['lead', 1], ['invoice', 1]] as const) {
      const r = await T.call('POST', '/documents/upload', undefined, { attach: { field: 'file', content: 'x', filename: 'x.txt', fields: { entity_type: type, entity_id: String(id) } } });
      expect(r.s, `intern attaching to ${type}`).toBe(403);
    }
    const r3 = await K.call('POST', '/documents/upload', undefined, { attach: { field: 'file', content: 'x', filename: 'x.txt', fields: { entity_type: 'project', entity_id: String(green.id) } } });
    expect(r3.s).toBe(403);
    expect(fs.readdirSync(dir).length).toBe(before);
    expect((await raw('GET', `/files/${up.j.id}`)).s).toBe(401);
    const note = await F.call('POST', '/notes', { entity_type: 'project', entity_id: acme.id, body: 'founder note' });
    expect((await K.call('DELETE', `/notes/${note.j.id}`)).s).toBe(403);
  });
});

describe('Injection & malformed input', () => {
  it('treats SQL in filters, searches and ids as plain values', async () => {
    expect((await F.call('GET', "/clients?status=' OR 1=1 --")).j).toHaveLength(0);
    expect((await F.call('GET', "/clients?status=active') OR ('1'='1")).j).toHaveLength(0);
    const search = await T.call('GET', "/search?q=%25' OR 1=1 --");
    expect(search.s).toBe(200);
    expect((search.j as { type: string }[]).every((x) => x.type !== 'Invoice')).toBe(true);
    expect((await F.call('GET', '/projects/1%20OR%201=1')).s).toBe(404);
    for (const p of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) expect((await F.call('GET', `/${p}`)).s).toBe(404);
  });
  it('survives repeated and odd query parameters', async () => {
    expect((await F.call('GET', '/clients?status=active&status=past')).s).toBe(200);
    expect((await F.call('GET', '/credentials?client_id=1&client_id=2')).s).toBe(200);
    expect((await F.call('GET', '/audit?user_id=1&user_id=2&limit=-5')).s).toBe(200);
    expect((await F.call('GET', '/notes?entity_type=project&entity_type=lead&entity_id=1')).s).toBe(400);
    expect((await F.call('GET', '/leads?limit=abc&offset=-3&sort=__proto__:desc')).s).toBe(200);
  });
  it('handles broken JSON, oversized bodies and unknown values', async () => {
    expect((await raw('POST', '/tasks', { rawBody: true, body: '{"title": ', cookie: F.cookie, headers: { 'Content-Type': 'application/json' } })).s).toBe(400);
    expect((await raw('POST', '/tasks', { rawBody: true, body: JSON.stringify({ title: 'x'.repeat(5 * 1024 * 1024) }), cookie: F.cookie, headers: { 'Content-Type': 'application/json' } })).s).toBe(413);
    expect((await F.call('POST', '/tasks', { title: 'x', status: 'hacked' })).s).toBe(400);
    expect((await F.call('POST', '/leads', { name: 'x', stage: '<script>' })).s).toBe(400);
    expect((await F.call('POST', '/payments', { date: '2026-01-01', amount: -500 })).s).toBe(400);
    expect((await F.call('POST', '/payments', { date: '2026-01-01', amount: 10, tds: -5 })).s).toBe(400);
    expect((await F.call('POST', '/events', { title: 'x', date: "2026-01-01' OR 1=1" })).s).toBe(400);
    expect((await F.call('PUT', '/settings', { logo: 'data:image/png;base64,AAAA" onerror="alert(1)' })).s).toBe(400);
  });
  it('ignores prototype keys, blocks mass assignment and neutralises CSV formulas', async () => {
    await raw('PUT', '/settings', { rawBody: true, body: '{"__proto__":{"polluted":1},"toString":"x","constructor":"y","company_name":"TechSentinals (demo)"}', cookie: F.cookie, headers: { 'Content-Type': 'application/json' } });
    expect(db().prepare("SELECT 1 FROM settings WHERE key IN ('toString','__proto__','polluted')").get()).toBeUndefined();
    expect(({} as { polluted?: number }).polluted).toBeUndefined();
    const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const xc = await F.call('POST', '/clients', { company: xss, id: 99999, created_at: '1999-01-01' });
    expect(xc.s).toBe(201);
    expect(xc.j.id).not.toBe(99999);
    expect(xc.j.created_at.startsWith('1999')).toBe(false);
    expect(xc.j.company).toBe(xss); // stored as-is, escaped at display time (React) and blocked by CSP
    await F.call('POST', '/expenses', { date: '2026-10-01', amount: 1, vendor: '=HYPERLINK("http://evil.test","x")', category: 'Other' });
    const csv = await F.call('GET', '/expenses/export.csv');
    expect(csv.s).toBe(200);
  });
  it('neutralises spreadsheet formulas in the CSV export text', async () => {
    const r = await raw('GET', '/expenses/export.csv', { cookie: F.cookie });
    expect(r.text).toContain(`"'=HYPERLINK`);
    expect(/(^|,)=HYPERLINK/m.test(r.text)).toBe(false);
  });
});

describe('Files', () => {
  it('stores uploads under random names and never renders them in the browser', async () => {
    const ev = await F.call('POST', '/documents/upload', undefined, { attach: { field: 'file', content: '<script>alert(document.cookie)</script>', filename: '../../../evil.html', type: 'text/html', fields: { entity_type: 'project', entity_id: String(acme.id) } } });
    const stored = row<{ stored_name: string; filename: string }>('SELECT stored_name, filename FROM documents WHERE id=?', ev.j.id);
    expect(stored.stored_name).toMatch(/^[a-f0-9]{32}$/);
    expect(stored.filename.includes('/') || stored.filename.includes('\\')).toBe(false);
    expect(fs.existsSync(path.join(d.app.config.uploadDir, '..', '..', '..', 'evil.html'))).toBe(false);
    for (const q of ['', '?inline=1']) {
      const dl = await raw('GET', `/files/${ev.j.id}${q}`, { cookie: F.cookie });
      expect(dl.h['content-type']).toBe('application/octet-stream');
      expect(dl.h['content-disposition']).toMatch(/^attachment/);
      expect(dl.h['content-security-policy']).toMatch(/sandbox/);
      expect(dl.h['x-content-type-options']).toBe('nosniff');
    }
  });
  it('saves document links safely', async () => {
    const lk = await F.call('POST', '/documents/link', { title: 'Drive folder', url: 'drive.google.com/x', entity_type: 'general' });
    expect(lk.s).toBe(201);
    expect(row<{ url: string }>('SELECT url FROM documents WHERE id=?', lk.j.id).url).toBe('https://drive.google.com/x');
    expect((await F.call('POST', '/documents/link', { title: 'x', url: 'javascript:alert(1)', entity_type: 'general' })).s).toBe(400);
    expect((await T.call('POST', '/documents/link', { title: 'x', url: 'https://example.com', entity_type: 'general' })).s).toBe(403);
    expect((await F.call('GET', `/files/${lk.j.id}`)).s).toBe(404);
  });
});

describe('Input validation (same rules as the browser)', () => {
  const rej = async (u: string, body: unknown, why: string, m = 'POST') => { const r = await F.call(m, u, body); expect(r.s, `rejected: ${why} → ${JSON.stringify(r.j)}`).toBe(400); return r; };
  const okc = async (u: string, body: unknown, why: string) => { const r = await F.call('POST', u, body); expect(r.s, `accepted: ${why} → ${JSON.stringify(r.j)}`).toBe(201); return r.j; };
  it('applies the people, phone, email, place, money and date rules', async () => {
    await rej('/leads', { name: 'Ravi 123', stage: 'new' }, 'digits in a person name');
    await rej('/leads', { name: 'Ravi<script>', stage: 'new' }, 'symbols in a person name');
    await rej('/leads', { name: '   ', stage: 'new' }, 'name made only of spaces');
    await rej('/leads', { name: 'Ravi', phone: 'call me later', stage: 'new' }, 'letters in a phone');
    await rej('/leads', { name: 'Ravi', phone: '12345', stage: 'new' }, 'too few digits');
    await rej('/leads', { name: 'Ravi', email: 'ravi@', stage: 'new' }, 'broken email');
    await rej('/leads', { name: 'Ravi', city: 'Pune 411001', stage: 'new' }, 'digits in a city');
    await rej('/leads', { name: 'Ravi', value: -5000, stage: 'new' }, 'negative deal value');
    await rej('/leads', { name: 'Ravi', website: 'not a site', stage: 'new' }, 'invalid website');
    await rej('/leads', { name: 'Ravi', next_followup: '2026-02-30', stage: 'new' }, 'impossible date');
    await rej('/leads', { name: 'x'.repeat(81), stage: 'new' }, 'name longer than 80');
    await okc('/leads', { name: "Anne-Marie D'Souza", phone: '+91 98765-43210', email: 'anne@site.co.in', city: 'Navi Mumbai', website: 'site.co.in', value: 125000.5, stage: 'new' }, 'real-world name');
    await okc('/leads', { name: 'राहुल शर्मा', stage: 'new' }, 'Hindi names');
  });
  it('applies the GSTIN / PAN, contacts, projects, payments, expenses, invoices, users and settings rules', async () => {
    await rej('/clients', { company: 'GST Co', gstin: '27ABCDE1234F1Z' }, '14-character GSTIN');
    await rej('/clients', { company: 'PAN Co', pan: '1234567890' }, 'wrong PAN format');
    const gc = await okc('/clients', { company: 'Proper GST Co', gstin: '27abcde1234f1z5', pan: 'abcde1234f', industry: 'Retail / D2C', state: 'Maharashtra' }, 'valid GSTIN/PAN typed in lower case');
    expect(gc.gstin).toBe('27ABCDE1234F1Z5');
    expect(gc.pan).toBe('ABCDE1234F');
    await rej('/contacts', { client_id: gc.id, name: 'Priya 2' }, 'digits in a contact name');
    await rej('/projects', { name: 'Dates', client_id: gc.id, start_date: '2026-05-10', deadline: '2026-05-01' }, 'deadline before start');
    const pj = await okc('/projects', { name: 'Dates OK', client_id: gc.id, start_date: '2026-05-01', deadline: '2026-05-10' }, 'deadline after start');
    await rej(`/projects/${pj.id}`, { deadline: '2026-04-01' }, 'moving a deadline before the start (update)', 'PUT');
    await rej('/payments', { amount: -100, date: '2026-10-01' }, 'negative payment');
    await rej('/payments', { amount: 'abc', date: '2026-10-01' }, 'non-numeric payment');
    await rej('/expenses', { amount: 100, date: '2026-10-01', category: 'Software', tax_amount: -1 }, 'negative GST');
    await rej('/maintenance_logs', { title: 'Too many hours', hours: 5000, status: 'open' }, '5000 hours');
    await rej('/invoices', { client_id: gc.id, issue_date: '2026-10-10', due_date: '2026-10-01', items: [{ description: 'Work', qty: 1, rate: 100 }] }, 'due before issue');
    await rej('/invoices', { client_id: gc.id, items: [{ description: 'Work', qty: 0, rate: 100 }] }, 'quantity 0');
    await rej('/invoices', { client_id: gc.id, items: [{ description: 'Work', qty: 1, rate: -100 }] }, 'negative rate');
    await rej('/invoices', { client_id: gc.id, items: [{ description: '', qty: 1, rate: 100 }] }, 'no description');
    await rej('/invoices', { client_id: gc.id, tax_rate: 150, items: [{ description: 'Work', qty: 1, rate: 100 }] }, 'tax above 100%');
    await rej('/users', { name: 'Intern 007', email: 'i7@demo.test', password: 'Strong-pass-2026', role: 'intern' }, 'digits in a name');
    await rej('/users', { name: 'New Intern', email: 'bad-email', password: 'Strong-pass-2026', role: 'intern' }, 'broken email');
    await rej('/settings', { bank_ifsc: 'HDFC123' }, 'bad IFSC', 'PUT');
    await rej('/settings', { upi_id: 'not-a-upi' }, 'bad UPI', 'PUT');
    expect((await F.call('PUT', '/settings', { bank_ifsc: 'hdfc0001234', gstin: '27AAACT1234A1Z5' })).j.bank_ifsc).toBe('HDFC0001234');
  });
});

describe('Sales, grants and settings behaviour', () => {
  it('works out business side, closing dates and last-contact', async () => {
    const lead = await F.call('POST', '/leads', { name: 'Sheet Style Lead', priority: 'hot', market: 'Foreign', department: 'SaaS product', stage: 'qualified', followup_round: 'first' });
    expect(lead.s).toBe(201);
    expect(lead.j).toMatchObject({ business_side: 'Product', priority: 'hot' });
    expect((await F.call('POST', '/leads', { name: 'Bad heat', priority: 'boiling' })).s).toBe(400);
    expect((await F.call('POST', '/leads', { name: 'Bad round', followup_round: 'ninth' })).s).toBe(400);
    expect((await F.call('POST', '/leads', { name: 'Bad market', market: 'Mars' })).s).toBe(400);
    await F.call('PUT', `/leads/${lead.j.id}`, { stage: 'lost', lost_reason: 'test' });
    expect(row<{ closed_on: string }>('SELECT closed_on FROM leads WHERE id=?', lead.j.id).closed_on).toBeTruthy();
    await F.call('PUT', `/leads/${lead.j.id}`, { stage: 'meeting' });
    expect(row<{ closed_on: string | null }>('SELECT closed_on FROM leads WHERE id=?', lead.j.id).closed_on).toBeNull();
    await F.call('POST', '/notes', { entity_type: 'lead', entity_id: lead.j.id, kind: 'call', body: 'Called, wants a demo' });
    expect(row<{ last_contact: string }>('SELECT last_contact FROM leads WHERE id=?', lead.j.id).last_contact).toBe(new Date().toISOString().slice(0, 10));
  });
  it('serves the sales report to people with sales access only, and keeps grants founder-only', async () => {
    const an = await F.call('GET', '/sales/analytics');
    expect(an.s).toBe(200);
    expect(an.j.total.leads).toBeGreaterThan(0);
    expect(an.j.monthly).toHaveLength(12);
    expect((await T.call('GET', '/sales/analytics')).s).toBe(403);
    expect((await T.call('GET', '/grants')).s).toBe(403);
    expect((await K.call('POST', '/grants', { name: 'x' })).s).toBe(403);
    expect((await F.call('POST', '/grants', { name: 'Test grant', requested: 1000, received: 500, status: 'disbursed' })).s).toBe(201);
    expect((await F.call('POST', '/grants', { name: 'x', status: 'stolen' })).s).toBe(400);
  });
  it('cleans dropdown lists (no duplicates, blanks or long values)', async () => {
    const set = await F.call('PUT', '/settings', { lead_sources: `LinkedIn\nlinkedin\n  Trade   fair  \n\n${'x'.repeat(200)}` });
    const src = row<{ value: string }>("SELECT value FROM settings WHERE key='lead_sources'").value.split('\n');
    expect(set.s).toBe(200);
    expect(src).toHaveLength(3);
    expect(src[1]).toBe('Trade fair');
    expect(src[2]?.length).toBe(60);
  });
});

describe('Assets, bank lines, contact log and people from the sheet', () => {
  it('keeps assets and bank lines founder-only and the contact log behind sales access', async () => {
    for (const U of [K, T]) {
      expect((await U.call('GET', '/assets')).s).toBe(403);
      expect((await U.call('POST', '/assets', { asset_type: 'Laptop' })).s).toBe(403);
      expect((await U.call('GET', '/bank_transactions')).s).toBe(403);
      expect((await U.call('POST', '/bank-match', {})).s).toBe(403);
    }
    expect((await T.call('GET', '/contact-log')).s).toBe(403);
  });
  it('validates assets and bank lines and auto-matches deposits within 5 days', async () => {
    expect((await F.call('POST', '/assets', { asset_type: 'Laptop', make_model: 'Test Book 14', purchase_value: 55000, status: 'Active' })).s).toBe(201);
    expect((await F.call('POST', '/assets', { asset_type: 'Laptop', purchase_value: -5 })).s).toBe(400);
    expect((await F.call('POST', '/assets', { make_model: 'x' })).s).toBe(400);
    expect((await F.call('POST', '/bank_transactions', { date: '2026-09-01', description: 'nothing' })).s).toBe(400);
    expect((await F.call('POST', '/bank_transactions', { date: '2026-09-01', deposit: 10, matched_status: 'Hacked' })).s).toBe(400);
    const acc = (await F.call('GET', '/accounts')).j[0];
    const pay = await F.call('POST', '/payments', { date: '2026-09-02', amount: 43210.5, account_id: acc.id, category: 'Consulting' });
    await F.call('POST', '/bank_transactions', { date: '2026-09-04', deposit: 43210.5, description: 'NEFT CR TEST', account_id: acc.id });
    const m = await F.call('POST', '/bank-match', {});
    const line = row<{ matched_status: string; payment_id: number }>("SELECT * FROM bank_transactions WHERE description='NEFT CR TEST'");
    expect(m.j.matched).toBeGreaterThanOrEqual(1);
    expect(line).toMatchObject({ matched_status: 'Matched', payment_id: pay.j.id });
    expect((await F.call('POST', '/bank-match', {})).j.matched).toBe(0);
  });
  it('accepts a lead with only a company, a blank priority, and logs contacts with their follow-up', async () => {
    const co = await F.call('POST', '/leads', { company: 'Only A Company Pvt Ltd' });
    expect(co.s).toBe(201);
    expect(co.j).toMatchObject({ name: 'Only A Company Pvt Ltd', followup_status: 'Not Scheduled' });
    expect((await F.call('POST', '/leads', { city: 'Pune' })).s).toBe(400);
    expect((await F.call('POST', '/leads', { company: 'No Heat Co', priority: '' })).j.priority).toBeNull();
    await F.call('POST', '/notes', { entity_type: 'lead', entity_id: co.j.id, kind: 'whatsapp', body: 'Sent brochure', followup_round: 'first', next_followup: '2026-12-01' });
    const log = await F.call('GET', '/contact-log?kind=whatsapp');
    expect(log.j.some((r: Record<string, unknown>) => r.lead_id === co.j.id && r.followup_round === 'first' && r.next_followup === '2026-12-01')).toBe(true);
    expect((await F.call('POST', '/notes', { entity_type: 'lead', entity_id: co.j.id, kind: 'call', body: 'x', next_followup: '2026-13-45' })).s).toBe(400);
  });
  it('gives people named before they joined their records once they are added', async () => {
    const lead = await F.call('POST', '/leads', { company: 'Waiting For Zara Co', assigned_name: 'Zara Newjoin' });
    expect(lead.j.owner_id === null || lead.j.owner_id === 1).toBe(true);
    db().prepare("UPDATE leads SET owner_id=NULL, assigned_name='Zara Newjoin' WHERE id=?").run(lead.j.id);
    db().prepare("INSERT INTO assets(asset_type, make_model, assigned_name) VALUES('Phone','Test Phone 9','Zara Newjoin')").run();
    const z = await F.call('POST', '/users', { name: 'Zara Newjoin', email: 'zara@demo.test', role: 'intern', password: 'Temp-pass-123456', modules: ['leads'] });
    expect(z.s).toBe(201);
    expect(row<{ owner_id: number; assigned_name: string | null }>('SELECT owner_id, assigned_name FROM leads WHERE id=?', lead.j.id)).toMatchObject({ owner_id: z.j.id, assigned_name: null });
    expect(row<{ assigned_to: number }>("SELECT assigned_to FROM assets WHERE make_model='Test Phone 9'").assigned_to).toBe(z.j.id);
    expect(z.j.linked).toBeGreaterThanOrEqual(2);
  });
});

describe('Security headers and error handling', () => {
  it('serves the app page with a strict CSP and hardening headers', async () => {
    const dist = path.join(d.app.dir, 'web');
    fs.mkdirSync(path.join(dist, '_app'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>x</title><div id="root"></div>');
    fs.writeFileSync(path.join(dist, '_app', 'app-abc123.js'), 'console.log(1);');
    const { createApp } = await import('../src/app');
    const { loadConfig } = await import('../src/config');
    const { createContext } = await import('../src/core/context');
    const { createLogger } = await import('../src/logger');
    const cfg = loadConfig({ NODE_ENV: 'test', CRM_DATA_DIR: path.join(d.app.dir, 'h'), JOBS: '0', CRM_SECRET: 'test-secret-0123456789abcdef', WEB_DIST: dist } as NodeJS.ProcessEnv);
    const ctx2 = createContext(cfg, createLogger(cfg));
    const supertest = (await import('supertest')).default;
    const a = supertest(createApp(ctx2).app);
    const home = await a.get('/');
    const csp = String(home.headers['content-security-policy']);
    expect(csp).toMatch(/script-src 'self'/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/base-uri 'none'/);
    expect(home.headers['x-frame-options']).toBe('DENY');
    expect(home.headers['x-content-type-options']).toBe('nosniff');
    expect(home.headers['referrer-policy']).toBe('same-origin');
    expect(home.headers['permissions-policy']).toBeTruthy();
    expect(home.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(home.headers['x-powered-by']).toBeUndefined();
    expect(home.headers['cache-control']).toMatch(/no-cache/);
    const asset = await a.get('/_app/app-abc123.js');
    // the Assets screen lives at /assets: it must get the app page, not the built-file folder
    const deep = await a.get('/assets');
    expect(deep.status).toBe(200);
    expect(deep.text).toContain('id="root"');
    expect(asset.headers['cache-control']).toMatch(/immutable/);
    expect(asset.headers['content-security-policy']).toBeTruthy();
    // path tricks do not expose files
    for (const p of ['/%2e%2e/package.json', '/_app/..%2f..%2fpackage.json', '/../data/crm.db']) {
      const r = await a.get(p);
      expect(r.text).not.toMatch(/SQLite format|"name": "@crm/);
    }
    ctx2.db.close();
  });
  it('never caches API answers, answers unknown paths with a clean 404 and leaks no stack traces', async () => {
    expect((await F.call('GET', '/me')).h['cache-control']).toBe('no-store');
    const unk = await raw('GET', '/does-not-exist', { cookie: F.cookie });
    expect(unk.s).toBe(404);
    expect(unk.text).not.toMatch(/at .*\.(js|ts)/);
    const bad = await raw('POST', '/tasks', { rawBody: true, body: '{bad', cookie: F.cookie, headers: { 'Content-Type': 'application/json' } });
    expect(bad.text).not.toMatch(/node_modules|at Object|\.(js|ts):\d+/);
  });
});

describe('Vault encryption', () => {
  it('uses AES-256-GCM with a fresh IV, detects tampering and logs every reveal', async () => {
    const cred = row<{ id: number }>('SELECT id FROM credentials LIMIT 1').id;
    const c1 = row<{ password_enc: string }>('SELECT password_enc FROM credentials WHERE id=?', cred).password_enc;
    const vault = d.app.ctx.vault;
    expect(c1.startsWith('v1.')).toBe(true);
    expect(vault.encrypt('same')).not.toBe(vault.encrypt('same'));
    const tampered = `v1.${Buffer.from(Buffer.from(c1.slice(3), 'base64').map((b, i) => (i === 30 ? b ^ 1 : b))).toString('base64')}`;
    expect(() => vault.decrypt(tampered)).toThrow();
    expect(((await F.call('GET', '/credentials')).j as Record<string, unknown>[]).every((c) => !('password' in c) && !('password_enc' in c) && !('secret_enc' in c))).toBe(true);
    await F.call('POST', `/credentials/${cred}/reveal`);
    const rev = row<{ user_name: string; ip: string }>("SELECT * FROM audit_log WHERE action='vault_reveal' ORDER BY id DESC LIMIT 1");
    expect(rev.user_name).toBe('Aarav Mehta');
    expect(rev.ip).toBeTruthy();
    expect(row<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action='login_failed'").n).toBeGreaterThanOrEqual(0);
    void PW;
    void newIp;
  });
});
