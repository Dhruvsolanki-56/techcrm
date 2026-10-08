/* End-to-end checks of permissions and money logic against a throwaway database.  Run: npm test */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
process.env.CRM_DATA_DIR = dir;
execFileSync(process.execPath, [path.join(__dirname, 'seed-demo.js')], { env: process.env, stdio: 'ignore' });

const http = require('http');
const app = require('../server');
const PW = 'Demo-Pass-2026';
let pass = 0, failed = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; } else { failed++; console.log('  ✗ FAIL:', name, extra !== undefined ? JSON.stringify(extra).slice(0, 200) : ''); } };

(async () => {
  const server = http.createServer(app).listen(0); const base = `http://127.0.0.1:${server.address().port}/api`;
  async function login(email, password = PW) {
    const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'crm' }, body: JSON.stringify({ email, password }) });
    const c = (r.headers.get('set-cookie') || '').split(';')[0];
    return { status: r.status, call: async (m, u, b, extra = {}) => { const x = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'crm', cookie: c, ...extra }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await x.json(); } catch { /* */ } return { s: x.status, j }; } };
  }
  const F = await login('aarav@demo.test'); const K = await login('kabir@demo.test'); const T = await login('tara@demo.test');
  ok(F.status === 200 && K.status === 200, 'logins work');
  ok((await login('aarav@demo.test', 'wrong-password-1')).status === 401, 'wrong password rejected');

  // ---- intern isolation ----
  for (const u of ['/finance/summary', '/invoices', '/quotes', '/payments', '/expenses', '/accounts', '/transfers', '/credentials', '/users', '/audit', '/settings', '/backup', '/leads', '/renewals', '/maintenance_logs/export.csv']) {
    const r = await K.call('GET', u);
    ok(r.s === 403, `intern blocked from ${u}`, r.s);
  }
  const kp = (await K.call('GET', '/projects')).j; ok(kp.length === 2 && kp.every((p) => p.budget === undefined), 'intern sees only own projects, no budget', kp.map((p) => p.name));
  const tp = (await T.call('GET', '/projects')).j; ok(tp.length === 2, 'second intern sees only her projects');
  const green = (await F.call('GET', '/projects')).j.find((p) => p.name.includes('GreenLeaf'));
  ok((await K.call('GET', '/projects/' + green.id)).s === 404, 'intern cannot open a project he is not on');
  const kc = (await K.call('GET', '/clients')).j; ok(kc.length === 2 && kc.every((c) => c.outstanding === undefined && c.lifetime_received === undefined), 'intern sees only his clients without money fields', kc);
  const ktasks = (await K.call('GET', '/tasks')).j; ok(ktasks.length > 0 && ktasks.every((t) => t.project_name !== 'GreenLeaf Online Store'), 'intern tasks scoped');
  const others = (await F.call('GET', '/tasks')).j.find((t) => t.assignee_name === 'Rohan Shah');
  ok((await K.call('PUT', '/tasks/' + others.id, { status: 'done' })).s === 403, "intern cannot change someone else's task");
  const mine = ktasks.find((t) => t.assignee_name === 'Kabir Singh' && t.status !== 'done');
  const upd = await K.call('PUT', '/tasks/' + mine.id, { status: 'review', title: 'HACKED', priority: 'urgent' });
  ok(upd.s === 200 && upd.j.status === 'review' && upd.j.title === mine.title && upd.j.priority === mine.priority, 'intern can move own task but not edit its title/priority', upd.j);
  ok((await K.call('DELETE', '/tasks/' + mine.id)).s === 403, 'intern cannot delete tasks');
  ok((await K.call('POST', '/projects', { name: 'x', client_id: 1 })).s === 403, 'intern cannot create projects');
  ok((await K.call('POST', '/notes', { entity_type: 'project', entity_id: green.id, body: 'hi' })).s === 403, 'intern cannot comment on a project he is not on');
  ok((await K.call('GET', '/maintenance_logs')).s === 200, 'intern with maintenance flag can read logs');
  ok((await T.call('GET', '/maintenance_logs')).s === 200, 'project member sees logs scoped by project');
  ok((await T.call('POST', '/maintenance_logs', { title: 'x' })).s === 400, 'intern without maintenance access must pick one of her projects');
  const sumR = (await (await login('aarav@demo.test')).call('GET', '/dashboard')).j; ok(sumR.kpi.mrr === 6000, 'maintenance plan (AMC renewal) counts as monthly recurring income', sumR.kpi.mrr);
  ok((await K.call('POST', '/users', { name: 'x', email: 'x@x.com', password: 'Abcdefghij1', role: 'founder' })).s === 403, 'intern cannot create users');
  const kd = await K.call('GET', '/dashboard'); ok(kd.s === 200 && !kd.j.kpi, 'intern dashboard has no finance KPIs');
  const ks = await K.call('GET', '/search?q=acme'); ok(ks.s === 200 && ks.j.every((x) => !['Invoice', 'Credential', 'Quote'].includes(x.type)), 'intern search excludes finance & vault', ks.j);
  ok((await K.call('GET', '/lookups')).j.accounts.length === 0, 'intern lookups hide accounts');

  // ---- csrf header ----
  const noHdr = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a', password: 'b' }) });
  ok(noHdr.status === 403, 'requests without X-Requested-With are blocked');

  // ---- founder money logic ----
  const invs = (await F.call('GET', '/invoices')).j;
  const byTitle = (t) => invs.find((i) => i.title === t);
  const adv = byTitle('Fleet portal — advance 30%'); ok(adv.total === 159300 && adv.status === 'paid' && adv.paid_amount === 159300, 'advance invoice: 135000 + 18% GST = 159300, paid', adv);
  const m1 = byTitle('Fleet portal — milestone 1'); ok(m1.total === 106200 && m1.status === 'overdue' && m1.paid_amount === 50000 && m1.balance === 56200, 'part-paid invoice past its due date shows overdue', m1);
  const bp = byTitle('Website maintenance — last month'); ok(bp.status === 'paid' && bp.paid_amount === 7080, 'TDS counts towards invoice settlement (6000+18% = 7080 = 6080 cash + 1000 TDS)', bp);
  const fin = byTitle('Online store — final'); ok(fin.status === 'sent', 'unpaid invoice is sent', fin.status);
  ok(/^INV\/\d{4}-\d{2}\/\d{4}$/.test(adv.number), 'invoice number format', adv.number);
  ok(new Set(invs.map((i) => i.number)).size === invs.length, 'invoice numbers unique');
  const pay = await F.call('POST', '/payments', { invoice_id: m1.id, date: '2026-10-01', amount: 56200 }); ok(pay.s === 201, 'record final payment');
  ok((await F.call('GET', '/invoices/' + m1.id)).j.status === 'paid', 'invoice flips to paid after final payment');
  await F.call('DELETE', '/payments/' + pay.j.id); const back = (await F.call('GET', '/invoices/' + m1.id)).j; ok(back.status === 'overdue' && back.paid_amount === 50000, 'deleting payment reopens invoice', back.status);
  ok((await F.call('DELETE', '/invoices/' + adv.id)).s === 409, 'cannot delete invoice that has payments');
  const sum = (await F.call('GET', '/finance/summary?from=2000-01-01&to=2099-12-31')).j; ok(sum.income.cash > 0 && sum.accounts.length === 2 && Array.isArray(sum.trend) && sum.trend.length === 12, 'finance summary shape');
  const acc = sum.accounts.find((a) => a.name.startsWith('HDFC')); const expectBal = 250000 + sum.income.cash + 800000 - 50000 - (24000 + 7800 + 9200 + 30000 + 18000); ok(Math.abs(acc.balance - expectBal) < 1, 'bank balance = opening + receipts + capital − draws − company-paid expenses', { got: acc.balance, expectBal });
  ok(sum.founders.find((f) => f.name.startsWith('Isha')).company_owes === 15000, 'founder owed for personal spend');

  // ---- quote, convert lead, clients, vault ----
  const quotes = (await F.call('GET', '/quotes')).j; ok(quotes.length === 1 && quotes[0].total === 383500, 'quote total (325000 + 18%)', quotes[0]);
  const lead = (await F.call('GET', '/leads')).j.find((l) => l.company === 'Kumar Textiles');
  const conv = await F.call('POST', `/leads/${lead.id}/convert`, { create_project: true }); ok(conv.s === 200 && conv.j.client_id && conv.j.project_id, 'convert lead to client + project', conv);
  ok((await F.call('POST', `/leads/${lead.id}/convert`, {})).s === 400, 'cannot convert twice');
  const q2 = (await F.call('GET', '/quotes')).j[0]; ok(q2.client_id === conv.j.client_id, 'quote followed lead to the new client');
  const toInv = await F.call('POST', `/quotes/${q2.id}/to-invoice`); ok(toInv.s === 200, 'quote converts to invoice');
  ok((await F.call('GET', '/invoices/' + toInv.j.invoice_id)).j.total === 383500, 'invoice carries quote total');
  const acme = (await F.call('GET', '/clients')).j.find((c) => c.company.startsWith('Acme')); ok((await F.call('DELETE', '/clients/' + acme.id)).s === 409, 'client with projects/invoices cannot be deleted');
  const creds = (await F.call('GET', '/credentials')).j; ok(creds.length === 2 && creds.every((c) => c.password === undefined && c.password_enc === undefined), 'vault list never exposes secrets');
  const rev = await F.call('POST', `/credentials/${creds[0].id}/reveal`); ok(rev.j.password && rev.j.password.startsWith('Demo!'), 'founder can reveal a password');
  const raw = require('../lib/db').db.prepare('SELECT password_enc FROM credentials LIMIT 1').get().password_enc; ok(raw.startsWith('v1.') && !raw.includes('Demo'), 'password stored encrypted at rest');
  const aud = (await F.call('GET', '/audit?action=vault_reveal')).j; ok(aud.length >= 1, 'vault reveal is audited');
  // user management guards
  const me = (await F.call('GET', '/me')).j;
  ok((await F.call('PUT', '/users/' + me.id, { active: false })).s === 400, 'founder cannot deactivate self');
  const kabir = (await F.call('GET', '/users')).j.find((u) => u.email === 'kabir@demo.test');
  ok((await F.call('PUT', '/users/' + kabir.id, { active: false })).s === 200, 'founder can deactivate an intern');
  ok((await K.call('GET', '/me')).s === 401, 'deactivated user is signed out immediately');
  ok((await login('kabir@demo.test')).status === 401, 'deactivated user cannot sign in');
  ok((await F.call('POST', '/users', { name: 'W', email: 'weak@x.com', password: 'short', role: 'intern' })).s === 400, 'weak password rejected');
  // CSV export formula injection guard
  await F.call('POST', '/expenses', { date: '2026-10-01', amount: 1, vendor: '=HYPERLINK("http://evil")', category: 'Other' });
  const csv = await fetch(base + '/expenses/export.csv', { headers: { cookie: '' } }); ok(csv.status === 401, 'csv export requires login');

  console.log(`\n${failed ? '✗' : '✓'} ${pass} passed, ${failed} failed`);
  server.close(); try { require('../lib/db').db.close(); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir cleanup is best-effort */ } process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
