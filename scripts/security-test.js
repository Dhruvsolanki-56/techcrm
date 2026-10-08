/* Security test suite — attacks the API the way an external tester would, against a throwaway copy of the demo data.
   Run: npm run test:security      (npm test runs this and the functional smoke test)
   Every request carries its own X-Forwarded-For address so the login rate limiter can be tested per "attacker". */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-sec-'));
process.env.CRM_DATA_DIR = dir;
process.env.TRUST_PROXY = '1';
execFileSync(process.execPath, [path.join(__dirname, 'seed-demo.js')], { env: process.env, stdio: 'ignore' });

const http = require('http');
const app = require('../server');
const { db, UPLOAD_DIR } = require('../lib/db');
const sec = require('../lib/security');
const PW = 'Demo-Pass-2026';

let pass = 0; const fails = []; let section = '';
const ok = (cond, name, extra) => { if (cond) pass++; else { fails.push(`[${section}] ${name}`); console.log(`  ✗ ${section}: ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 240) : ''); } };
const group = (n) => { section = n; console.log(`· ${n}`); };
let ipSeq = 10;
const newIp = () => `203.0.113.${ipSeq++}`;

(async () => {
  const server = http.createServer(app).listen(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = origin + '/api';
  async function raw(method, url, { body, cookie = '', headers = {}, ip = '198.51.100.1', json = true } = {}) {
    const h = { 'X-Requested-With': 'crm', 'X-Forwarded-For': ip, cookie, ...headers };
    if (body !== undefined && json) h['Content-Type'] = 'application/json';
    const r = await fetch(url.startsWith('http') ? url : base + url, { method, headers: h, body: body === undefined ? undefined : json ? JSON.stringify(body) : body, redirect: 'manual' });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { s: r.status, j, text, h: r.headers };
  }
  async function login(email, password = PW, { ip = newIp(), code } = {}) {
    const r = await raw('POST', '/auth/login', { body: { email, password, ...(code ? { code } : {}) }, ip });
    const cookie = (r.h.get('set-cookie') || '').split(';')[0];
    const call = (m, u, b, extra = {}) => raw(m, u, { body: b, cookie, ip, ...extra });
    return { ...r, cookie, call, ip };
  }
  const F = await login('aarav@demo.test');
  const K = await login('kabir@demo.test');     // intern with maintenance access, on Acme + BrightPath
  const T = await login('tara@demo.test');      // intern, no extra access, on Acme + GreenLeaf
  const projects = (await F.call('GET', '/projects')).j;
  const acme = projects.find((p) => p.name.startsWith('Fleet')); const green = projects.find((p) => p.name.startsWith('GreenLeaf')); const bright = projects.find((p) => p.name.startsWith('BrightPath'));

  /* ------------------------------------------------------------------ */
  group('Authentication');
  const wrong = await login('aarav@demo.test', 'not-the-password-1');
  const unknown = await login('nobody@demo.test', 'not-the-password-1');
  ok(wrong.s === 401 && unknown.s === 401 && wrong.j.error === unknown.j.error, 'unknown email and wrong password give the same answer (no account enumeration)', [wrong.j, unknown.j]);
  ok(!wrong.cookie.startsWith('crm_session=') || wrong.cookie === 'crm_session=', 'failed login sets no session cookie', wrong.cookie);
  const time = async (email) => { const t = []; for (let i = 0; i < 4; i++) { const s = process.hrtime.bigint(); await login(email, 'not-the-password-1'); t.push(Number(process.hrtime.bigint() - s) / 1e6); } return t.sort((a, b) => a - b)[1]; };
  const tKnown = await time('aarav@demo.test'); const tUnknown = await time('ghost@demo.test');
  ok(tUnknown > tKnown * 0.4, 'unknown email takes about as long as a wrong password (timing does not reveal accounts)', { tKnown, tUnknown });
  ok(F.s === 200 && /HttpOnly/.test(F.h.get('set-cookie')) && /SameSite=Lax/.test(F.h.get('set-cookie')) && /Path=\//.test(F.h.get('set-cookie')), 'session cookie is HttpOnly + SameSite=Lax', F.h.get('set-cookie'));
  ok(!/Secure/.test(F.h.get('set-cookie')), 'no Secure flag on plain http (would break local use)');
  const https = await raw('POST', '/auth/login', { body: { email: 'meera@demo.test', password: PW }, ip: newIp(), headers: { 'X-Forwarded-Proto': 'https' } });
  ok(/; Secure/.test(https.h.get('set-cookie') || '') && /max-age/i.test(https.h.get('strict-transport-security') || ''), 'behind HTTPS proxy: cookie is Secure and HSTS is sent', https.h.get('set-cookie'));
  ok(/^[a-f0-9]{64}$/.test(F.cookie.split('=')[1]), 'session token is 256-bit random hex');
  ok(!db.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(F.cookie.split('=')[1]), 'database stores only a hash of the session token');
  ok((await raw('GET', '/me', { cookie: 'crm_session=' + 'a'.repeat(64) })).s === 401, 'forged session token rejected');
  ok((await raw('GET', '/me', { cookie: 'crm_session=%E0%A4%A' })).s === 401, 'malformed cookie handled (401, not a crash)');
  ok((await raw('GET', '/me')).s === 401, 'no cookie → 401');
  ok((await raw('POST', '/auth/setup', { body: { name: 'x', email: 'x@x.test', password: 'Abcdefghij12' } })).s === 400, 'setup endpoint is closed once a founder exists');
  const L1 = await login('rohan@demo.test'); await L1.call('POST', '/auth/logout');
  ok((await L1.call('GET', '/me')).s === 401, 'logout invalidates the session on the server (old cookie is dead)');
  const exp = await login('isha@demo.test'); db.prepare('UPDATE sessions SET expires_at=1 WHERE user_id=(SELECT id FROM users WHERE email=?)').run('isha@demo.test');
  ok((await exp.call('GET', '/me')).s === 401, 'expired session rejected');
  const hash = db.prepare("SELECT password_hash FROM users WHERE email='aarav@demo.test'").get().password_hash;
  ok(hash.startsWith('scrypt$') && !hash.includes(PW), 'passwords stored as salted scrypt hashes');
  const dbBytes = fs.readFileSync(path.join(dir, 'crm.db'));
  ok(!dbBytes.includes(Buffer.from(PW)) && !dbBytes.includes(Buffer.from('Demo!cPanel#2026')), 'no plaintext password or vault secret anywhere in the database file');

  group('Brute-force protection');
  const bfIp = newIp();
  for (let i = 0; i < 8; i++) await login('meera@demo.test', 'guess-number-' + i, { ip: bfIp });
  ok((await login('meera@demo.test', PW, { ip: bfIp })).s === 429, '9th try on one account is blocked for 15 min — even with the right password');
  ok((await login('meera@demo.test', PW)).s === 200, 'the real user from another network is not locked out');
  const sprayIp = newIp(); let sprayBlocked = false;
  for (let i = 0; i < 32; i++) { const r = await login(`spray${i}@demo.test`, 'Password123', { ip: sprayIp }); if (r.s === 429) { sprayBlocked = true; break; } }
  ok(sprayBlocked, 'password spraying across many emails from one IP gets blocked');

  group('Password rules & sessions');
  const P1 = await login('rohan@demo.test'); const P2 = await login('rohan@demo.test');
  ok((await P1.call('POST', '/password', { current: PW, next: 'short1' })).s === 400, 'weak new password rejected');
  ok((await P1.call('POST', '/password', { current: PW, next: PW })).s === 400, 'cannot "change" to the same password');
  ok((await P1.call('POST', '/password', { current: 'wrong', next: 'Brand-new-pass-77' })).s === 400, 'password change needs the current password');
  ok((await P1.call('POST', '/password', { current: PW, next: 'Brand-new-pass-77' })).s === 200, 'password change works');
  ok((await P2.call('GET', '/me')).s === 401 && (await P1.call('GET', '/me')).s === 200, 'changing password signs out every other device, keeps this one');
  const newIntern = await F.call('POST', '/users', { name: 'Temp Intern', email: 'temp@demo.test', password: 'Temp-pass-123', role: 'intern' });
  const TI = await login('temp@demo.test', 'Temp-pass-123');
  const blockedTemp = await TI.call('GET', '/tasks');
  ok(blockedTemp.s === 403 && blockedTemp.j.code === 'password_change_required', 'temporary password: API refuses everything until it is changed (server-side, not just UI)', blockedTemp);
  ok((await TI.call('GET', '/me')).s === 200, 'temporary password: can still load own profile');
  await TI.call('POST', '/password', { current: 'Temp-pass-123', next: 'My-own-pass-456' });
  ok((await TI.call('GET', '/tasks')).s === 200, 'after choosing own password the account works');
  ok((await F.call('PUT', '/users/' + newIntern.j.id, { modules: 'leads' })).s === 200, 'malformed modules value does not crash user update');

  group('Two-step login (TOTP)');
  const M = await login('meera@demo.test');
  ok((await M.call('POST', '/2fa/setup', { password: 'wrong' })).s === 400, 'setup needs the account password (a stolen session cannot lock the owner out)');
  const setup = await M.call('POST', '/2fa/setup', { password: PW });
  ok(setup.s === 200 && /^[A-Z2-7]{32}$/.test(setup.j.secret) && setup.j.uri.startsWith('otpauth://totp/'), 'setup returns a 160-bit base32 secret + otpauth link', setup.j);
  ok(!db.prepare("SELECT totp_secret FROM users WHERE email='meera@demo.test'").get().totp_secret.includes(setup.j.secret), 'authenticator secret is encrypted at rest');
  ok((await M.call('POST', '/2fa/enable', { code: '000000' })).s === 400, 'enabling needs a valid code');
  const codeNow = () => sec.hotp(sec.unbase32(setup.j.secret), Math.floor(Date.now() / 30000));
  const M2 = await login('meera@demo.test');      // her laptop, still signed in
  ok((await M.call('POST', '/2fa/enable', { code: codeNow() })).s === 200, 'enable with a correct code');
  ok((await M2.call('GET', '/me')).s === 401 && (await M.call('GET', '/me')).s === 200, 'turning it on signs out her other devices, keeps this one');
  const noCode = await login('meera@demo.test');
  ok(noCode.s === 401 && noCode.j.need_code && !noCode.cookie.includes('crm_session=') , 'password alone is no longer enough — no session issued', noCode.j);
  ok((await login('meera@demo.test', PW, { code: '123456' })).s === 401, 'wrong code rejected');
  ok((await login('meera@demo.test', 'bad-password-9', { code: codeNow() })).s === 401, 'right code + wrong password rejected');
  ok((await login('meera@demo.test', PW, { code: codeNow() })).s === 401, 'the code used to switch it on cannot be reused to sign in (no replay)');
  db.prepare("UPDATE users SET totp_last=0 WHERE email='meera@demo.test'").run();
  const oneCode = codeNow();
  ok((await login('meera@demo.test', PW, { code: oneCode })).s === 200, 'password + current code signs in');
  ok((await login('meera@demo.test', PW, { code: oneCode })).s === 401, 'the same code cannot be used twice');
  const meeraId = db.prepare("SELECT id FROM users WHERE email='meera@demo.test'").get().id;
  ok((await K.call('PUT', '/users/' + meeraId, { reset_2fa: true })).s === 403, 'interns cannot reset anyone\'s two-step login');
  ok((await F.call('PUT', '/users/' + meeraId, { reset_2fa: true })).s === 200 && (await login('meera@demo.test')).s === 200, 'a founder can reset it for a lost phone');
  ok(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action IN ('2fa_on','2fa_reset')").get().n === 2, 'two-step changes are in the activity log');

  /* ------------------------------------------------------------------ */
  group('CSRF');
  const noHdr = await fetch(base + '/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: F.cookie }, body: JSON.stringify({ title: 'csrf' }) });
  ok(noHdr.status === 403, 'state-changing request without X-Requested-With is refused');
  const formPost = await fetch(base + '/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: F.cookie }, body: 'label=x&client_id=1' });
  ok(formPost.status === 403, 'cross-site HTML form post is refused');
  ok((await raw('DELETE', '/tasks/1', { cookie: F.cookie, headers: { 'X-Requested-With': 'XMLHttpRequest' } })).s === 403, 'wrong header value is refused');
  ok(!db.prepare("SELECT 1 FROM tasks WHERE title='csrf'").get(), 'nothing was written by the refused requests');

  /* ------------------------------------------------------------------ */
  group('Access control — interns vs founder-only data');
  const founderOnly = ['invoices', 'quotes', 'payments', 'expenses', 'accounts', 'transfers', 'renewals'];
  for (const r of founderOnly) {
    const anyId = (db.prepare(`SELECT id FROM ${r} LIMIT 1`).get() || { id: 1 }).id;
    for (const I of [K, T]) {
      const results = [await I.call('GET', `/${r}`), await I.call('GET', `/${r}/${anyId}`), await I.call('GET', `/${r}/export.csv`), await I.call('POST', `/${r}`, { name: 'x', title: 'x', client_id: 1, date: '2026-01-01', amount: 1, kind: 'capital_in' }), await I.call('PUT', `/${r}/${anyId}`, { notes: 'x' }), await I.call('DELETE', `/${r}/${anyId}`)];
      ok(results.every((x) => [403, 404].includes(x.s)), `intern cannot read or change ${r}`, results.map((x) => x.s));
    }
  }
  for (const u of ['/finance/summary', '/credentials', '/users', '/audit', '/settings', '/backup']) ok((await T.call('GET', u)).s === 403, `intern blocked from ${u}`);
  const cred = db.prepare('SELECT id FROM credentials LIMIT 1').get().id;
  ok((await K.call('POST', `/credentials/${cred}/reveal`)).s === 403, 'intern cannot reveal vault passwords');
  ok((await T.call('PUT', '/settings', { company_name: 'pwned' })).s === 403, 'intern cannot change settings');
  ok((await T.call('POST', '/users', { name: 'x', email: 'evil@x.test', password: 'Abcdefghij12', role: 'founder' })).s === 403, 'intern cannot create a founder account');
  const tId = db.prepare("SELECT id FROM users WHERE email='tara@demo.test'").get().id;
  ok((await T.call('PUT', '/users/' + tId, { role: 'founder' })).s === 403, 'intern cannot promote herself');
  ok((await T.call('POST', `/leads/1/convert`, {})).s === 403 && (await T.call('POST', `/quotes/1/to-invoice`)).s === 403 && (await T.call('POST', `/renewals/1/renew`)).s === 403, 'intern cannot run founder actions (convert lead, quote→invoice, renew)');
  ok((await T.call('PUT', `/projects/${acme.id}/members`, { user_ids: [tId] })).s === 403, 'intern cannot change project teams');
  ok((await T.call('GET', '/leads')).s === 403 && (await T.call('GET', '/leads/1')).s === 404, 'intern without lead access cannot see leads (single lead → 404, does not even confirm it exists)');

  group('Access control — project isolation (IDOR)');
  ok((await K.call('GET', '/projects/' + green.id)).s === 404, 'intern cannot open a project by id he is not on');
  const greenTask = db.prepare('SELECT id FROM tasks WHERE project_id=? AND assignee_id<>?').get(green.id, db.prepare("SELECT id FROM users WHERE email='kabir@demo.test'").get().id);
  ok((await K.call('GET', '/tasks/' + greenTask.id)).s === 404 && (await K.call('PUT', '/tasks/' + greenTask.id, { status: 'done' })).s === 404, 'intern cannot read or change a task in another project');
  ok((await K.call('GET', `/notes?entity_type=project&entity_id=${green.id}`)).s === 403, 'intern cannot read another project\'s timeline');
  ok((await K.call('POST', '/tasks', { title: 'sneak', project_id: green.id })).s === 403, 'intern cannot create tasks inside another project');
  ok((await K.call('GET', `/projects/${green.id}/members`)).s === 403, 'intern cannot list another project\'s team');
  const kTask = await K.call('POST', '/tasks', { title: 'Own task', project_id: acme.id, assignee_id: 1, created_by: 1, lead_id: 1 });
  ok(kTask.s === 201 && kTask.j.assignee_id !== 1 && kTask.j.lead_id === null, 'intern-created task is forced to self, cannot link a lead', kTask.j);
  const kUpd = await K.call('PUT', '/tasks/' + kTask.j.id, { status: 'review', project_id: green.id, assignee_id: 1, title: 'renamed' });
  ok(kUpd.j.project_id === acme.id && kUpd.j.title === 'Own task' && kUpd.j.status === 'review', 'intern task update ignores project / assignee / title (mass assignment blocked)', kUpd.j);
  const greenEvent = await F.call('POST', '/events', { title: 'GreenLeaf private call', date: '2026-12-01', project_id: green.id, client_id: green.client_id });
  const kEvents = (await K.call('GET', '/events')).j;
  ok(!kEvents.some((e) => e.id === greenEvent.j.id) && kEvents.some((e) => e.title === 'GST filing due'), 'intern sees company reminders but not reminders for other projects');
  const kp = (await K.call('GET', '/projects')).j; const kc = (await K.call('GET', '/clients')).j;
  ok(kp.every((p) => p.budget === undefined) && kc.every((c) => c.outstanding === undefined && c.lifetime_received === undefined), 'money fields are stripped from what interns receive');
  const ks = (await T.call('GET', '/search?q=a')).j;
  ok(ks.every((x) => !['Invoice', 'Quote', 'Credential', 'Renewal', 'Lead'].includes(x.type)), 'intern search never returns finance, vault, renewal or lead records', [...new Set(ks.map((x) => x.type))]);
  const kd = (await K.call('GET', '/dashboard')).j; ok(!kd.kpi && !kd.renewals && !kd.trend, 'intern dashboard has no finance data');
  const kCal = (await K.call('GET', '/calendar?from=2000-01-01&to=2099-12-31')).j.items;
  ok(kCal.every((i) => !['invoice', 'quote', 'renewal'].includes(i.type)), 'intern calendar has no invoices, quotes or renewals');
  ok((await T.call('GET', '/notifications')).j.items.every((n) => n.user_id === tId), 'notifications are per user');

  group('Access control — maintenance log');
  const tLog = await T.call('POST', '/maintenance_logs', { title: 'Tara log', project_id: green.id, client_id: 1, assignee_id: 1 });
  ok(tLog.s === 201 && tLog.j.client_id === green.client_id && tLog.j.assignee_id === tId, 'intern log is tied to her project\'s client and to herself', tLog.j);
  ok((await T.call('POST', '/maintenance_logs', { title: 'x', project_id: bright.id })).s === 403, 'intern cannot log work on a project she is not on');
  const tLogUpd = await T.call('PUT', '/maintenance_logs/' + tLog.j.id, { status: 'resolved', title: 'changed', project_id: bright.id, billable: true });
  ok(tLogUpd.j.status === 'resolved' && tLogUpd.j.title === 'Tara log' && tLogUpd.j.project_id === green.id && !tLogUpd.j.billable, 'intern log update limited to progress fields', tLogUpd.j);
  ok((await K.call('DELETE', '/maintenance_logs/' + tLog.j.id)).s === 403, 'interns cannot delete log entries');

  group('Access control — files & notes');
  const uploadsBefore = fs.readdirSync(UPLOAD_DIR).length + 1;     // +1 for the founder upload right below
  const fd = new FormData(); fd.append('file', new Blob(['secret company doc']), 'policy.txt'); fd.append('entity_type', 'general');
  const up = await raw('POST', '/documents/upload', { body: fd, cookie: F.cookie, json: false });
  ok(up.s === 201, 'founder uploads a company-wide document');
  ok((await K.call('GET', '/files/' + up.j.id)).s === 404 && !(await K.call('GET', '/documents')).j.some((d) => d.id === up.j.id), 'interns cannot list or download company-wide documents');
  for (const [type, id] of [['general', ''], ['client', green.client_id], ['lead', 1], ['invoice', 1]]) {
    const f2 = new FormData(); f2.append('file', new Blob(['x']), 'x.txt'); f2.append('entity_type', type); f2.append('entity_id', String(id));
    ok((await raw('POST', '/documents/upload', { body: f2, cookie: T.cookie, json: false, ip: T.ip })).s === 403, `intern cannot attach files to ${type}`);
  }
  const f3 = new FormData(); f3.append('file', new Blob(['x']), 'x.txt'); f3.append('entity_type', 'project'); f3.append('entity_id', String(green.id));
  ok((await raw('POST', '/documents/upload', { body: f3, cookie: K.cookie, json: false, ip: K.ip })).s === 403, 'intern cannot attach files to someone else\'s project');
  ok(fs.readdirSync(UPLOAD_DIR).length === uploadsBefore, 'refused uploads leave no file behind on disk');
  const fNote = await F.call('POST', '/notes', { entity_type: 'project', entity_id: acme.id, body: 'founder note' });
  ok((await K.call('DELETE', '/notes/' + fNote.j.id)).s === 403, 'intern cannot delete a founder\'s note');
  ok((await raw('GET', '/files/' + up.j.id)).s === 401, 'file download needs a signed-in user');

  { group('Task teamwork — several people, checklist, mentions, watchers');
  const kId = db.prepare("SELECT id FROM users WHERE email='kabir@demo.test'").get().id;
  const meeraId = db.prepare("SELECT id FROM users WHERE email='meera@demo.test'").get().id;
  const notes = async (I) => (await I.call('GET', '/notifications')).j.items;
  const seeded = (await F.call('GET', '/tasks')).j.find((x) => x.title.startsWith('Get Fleet portal ready'));
  ok(seeded && seeded.assignees.length === 3 && seeded.check_total === 6 && seeded.check_done === 2 && seeded.comment_count === 4, 'demo has a shared task with 3 people, a checklist and a discussion', seeded);
  // Tara is not on BrightPath, but being put on a task there lets her open it
  const team = await F.call('POST', '/tasks', { title: 'Team task', project_id: bright.id, assignee_ids: [kId, tId], priority: 'high' });
  ok(team.s === 201 && team.j.assignees.map((a) => a.id).join() === `${kId},${tId}` && team.j.assignee_id === kId, 'founder assigns one task to two interns (first one stays the main assignee)', team.j);
  const tid = team.j.id; const link = `#/tasks?open=${tid}`;
  ok((await notes(K)).some((n) => n.link === link && /assigned you T-/.test(n.text)) && (await notes(T)).some((n) => n.link === link), 'both interns are notified, and the notification opens that task');
  ok((await T.call('GET', '/tasks/' + tid)).s === 200 && (await T.call('GET', `/tasks/${tid}/collab`)).j.can_edit === true, 'an assignee who is not on the project can still open and work on the task');
  ok((await T.call('GET', `/tasks?assignee_id=${tId}`)).j.some((x) => x.id === tid) && (await T.call('GET', '/dashboard')).j.my_tasks.some((x) => x.id === tid), '"Assigned to me" and the dashboard include tasks where she is the second person');
  ok((await F.call('GET', '/dashboard')).j.team_load.find((x) => x.id === tId).open_tasks >= 1, 'team workload counts every person on a task');
  ok((await T.call('PUT', '/tasks/' + tid, { status: 'in_progress' })).s === 200, 'the second assignee can move the task');
  ok((await notes(K)).some((n) => n.link === link && /moved T-\d+ .* to In progress/.test(n.text)) && (await notes(F)).some((n) => n.link === link && /moved/.test(n.text)), 'watchers (other assignee, creator) hear about the status change');
  const hist = (await F.call('GET', `/notes?entity_type=task&entity_id=${tid}`)).j.filter((n) => n.kind === 'history');
  ok(hist.some((n) => n.body === 'changed status from To do to In progress' && n.user_id === tId) && hist.some((n) => n.body === 'created this task'), 'history records who changed what', hist.map((n) => n.body));
  ok((await T.call('DELETE', '/notes/' + hist[0].id)).s === 403 && (await F.call('DELETE', '/notes/' + hist[0].id)).s === 403, 'history cannot be deleted, not even by a founder');
  await T.call('PUT', '/tasks/' + tid, { assignee_ids: [tId], title: 'mine now' });
  ok((await F.call('GET', '/tasks/' + tid)).j.assignees.length === 2, 'an intern cannot change who is on a task');
  ok((await F.call('POST', '/tasks', { title: 'ghost', assignee_ids: [999999] })).s === 400, 'cannot assign someone who does not exist');
  // checklist
  const c1 = await K.call('POST', `/tasks/${tid}/checklist`, { text: 'Backend part', assignee_id: tId });
  ok(c1.s === 201 && c1.j[0].assignee_id === tId && (await notes(T)).some((n) => /gave you a checklist item/.test(n.text)), 'an assignee adds a checklist item for a teammate, who is notified');
  ok((await K.call('POST', `/tasks/${tid}/checklist`, { text: 'x', assignee_id: meeraId })).s === 400, 'checklist items can only go to people on the task');
  ok((await K.call('POST', `/tasks/${tid}/checklist`, { text: '   ' })).s === 400, 'empty checklist item refused');
  const tick = await T.call('PUT', `/tasks/${tid}/checklist/${c1.j[0].id}`, { done: true });
  ok(tick.j[0].done === 1 && tick.j[0].done_by === tId && (await F.call('GET', '/tasks/' + tid)).j.check_done === 1, 'ticking records who did it and updates the task progress');
  // a project teammate who is not on the task: may read and discuss, not change
  const acmeTask = await F.call('POST', '/tasks', { title: 'Kabir only', project_id: acme.id, assignee_ids: [kId] });
  const tc = await T.call('GET', `/tasks/${acmeTask.j.id}/collab`);
  ok(tc.s === 200 && tc.j.can_edit === false && (await T.call('POST', `/tasks/${acmeTask.j.id}/checklist`, { text: 'x' })).s === 403 && (await T.call('PUT', '/tasks/' + acmeTask.j.id, { status: 'done' })).s === 403, 'a project teammate not on the task can read it but not change status or checklist');
  ok((await T.call('POST', '/notes', { entity_type: 'task', entity_id: acmeTask.j.id, body: 'Can I help?' })).s === 201, '…and can still join the discussion');
  // someone with no access at all
  const greenOnly = await F.call('POST', '/tasks', { title: 'Tara only', project_id: green.id, assignee_ids: [tId] });
  const kOut = [await K.call('GET', `/tasks/${greenOnly.j.id}/collab`), await K.call('POST', `/tasks/${greenOnly.j.id}/checklist`, { text: 'x' }), await K.call('POST', `/tasks/${greenOnly.j.id}/watch`, {}), await K.call('POST', '/notes', { entity_type: 'task', entity_id: greenOnly.j.id, body: 'x' })];
  ok(kOut.every((x) => [403, 404].includes(x.s)), 'an outsider cannot read, tick, watch or comment on the task', kOut.map((x) => x.s));
  // comments, mentions, editing
  const fBefore = (await notes(F)).length;
  const cm = await K.call('POST', '/notes', { entity_type: 'task', entity_id: tid, body: '@Tara Nair please check', mentions: [tId, 'junk', kId] });
  const tN = (await notes(T)).filter((n) => n.link === link);
  ok(cm.s === 201 && JSON.parse(cm.j.mentions).map((m) => m.id).join() === String(tId), 'mentions are stored (junk ids and self-mentions dropped)', cm.j.mentions);
  ok(tN.some((n) => /mentioned you on T-/.test(n.text)) && !tN.some((n) => /Kabir Singh commented/.test(n.text)), 'the mentioned person gets one "mentioned you" notification, not two');
  ok((await notes(F)).length === fBefore + 1, 'the creator (watching) gets a "commented" notification');
  ok((await T.call('PUT', '/notes/' + cm.j.id, { body: 'hacked' })).s === 403 && (await K.call('PUT', '/notes/' + hist[0].id, { body: 'x' })).s === 403, 'nobody can edit someone else\'s comment or the history');
  const ed = await K.call('PUT', '/notes/' + cm.j.id, { body: '@Tara Nair please check the API' });
  ok(ed.s === 200 && ed.j.edited_at && ed.j.body.endsWith('the API'), 'you can fix your own comment and it shows as edited');
  // watchers
  await K.call('POST', `/tasks/${tid}/watch`, { on: false });
  const kBefore = (await notes(K)).length;
  await F.call('POST', '/notes', { entity_type: 'task', entity_id: tid, body: 'update from founder' });
  ok((await notes(K)).length === kBefore, 'unwatching stops comment notifications');
  ok((await K.call('POST', `/tasks/${tid}/watch`, {})).j.watching === true, 'and watching again turns them back on');
  // taking someone off the task takes away access, and mentioning them no longer pings them
  await F.call('PUT', '/tasks/' + tid, { assignee_ids: [kId] });
  ok((await T.call('GET', '/tasks/' + tid)).s === 404, 'removing an intern from the task removes her access');
  ok((await F.call('GET', `/notes?entity_type=task&entity_id=${tid}`)).j.some((n) => n.kind === 'history' && n.body === 'removed Tara Nair'), 'history shows who was removed');
  const tCount = (await notes(T)).length;
  const late = await K.call('POST', '/notes', { entity_type: 'task', entity_id: tid, body: '@Tara Nair?', mentions: [tId] });
  ok(late.j.mentions === null && (await notes(T)).length === tCount, 'people who cannot see the task are not mentioned or notified');
  ok(!(await F.call('GET', `/tasks/${tid}/collab`)).j.people.some((p) => p.id === tId), 'the @mention list only offers people who can open the task');
  await F.call('DELETE', '/tasks/' + tid);
  ok(['task_assignees', 'task_watchers', 'task_checklist'].every((tb) => db.prepare(`SELECT COUNT(*) n FROM ${tb} WHERE task_id=?`).get(tid).n === 0), 'deleting a task cleans up its people, watchers and checklist'); }

  /* ------------------------------------------------------------------ */
  group('Injection & malformed input');
  ok((await F.call('GET', "/clients?status=' OR 1=1 --")).j.length === 0, 'SQL injection in a list filter returns nothing (parameterised)');
  ok((await F.call('GET', "/clients?status=active') OR ('1'='1")).j.length === 0, 'second SQL injection variant also inert');
  const sqliSearch = await T.call('GET', "/search?q=%25' OR 1=1 --");
  ok(sqliSearch.s === 200 && sqliSearch.j.every((x) => x.type !== 'Invoice'), 'SQL injection in search is inert and scope still applies');
  ok((await F.call('GET', '/projects/1%20OR%201=1')).s === 404, 'SQL in an id is treated as a plain value');
  for (const p of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) ok((await F.call('GET', '/' + p)).s === 404, `prototype name /${p} → 404, not a crash`);
  ok((await F.call('GET', '/clients?status=active&status=past')).s === 200, 'repeated query parameter does not crash');
  ok((await F.call('GET', '/credentials?client_id=1&client_id=2')).s === 200, 'repeated parameter on vault does not crash');
  ok((await F.call('GET', '/audit?user_id=1&user_id=2&limit=-5')).s === 200, 'repeated parameter + negative limit on audit handled');
  ok((await F.call('GET', '/notes?entity_type=project&entity_type=lead&entity_id=1')).s === 400, 'array entity type rejected');
  ok((await raw('POST', '/tasks', { body: '{"title": ', cookie: F.cookie, json: false, headers: { 'Content-Type': 'application/json' } })).s === 400, 'broken JSON → 400');
  ok((await raw('POST', '/tasks', { body: JSON.stringify({ title: 'x'.repeat(5 * 1024 * 1024) }), cookie: F.cookie, json: false, headers: { 'Content-Type': 'application/json' } })).s === 413, 'oversized body (>4 MB) refused');
  ok((await F.call('POST', '/tasks', { title: 'x', status: 'hacked' })).s === 400 && (await F.call('POST', '/leads', { name: 'x', stage: '<script>' })).s === 400, 'unknown status values rejected');
  ok((await F.call('POST', '/payments', { date: '2026-01-01', amount: -500 })).s === 400 && (await F.call('POST', '/payments', { date: '2026-01-01', amount: 10, tds: -5 })).s === 400, 'negative money rejected');
  ok((await F.call('POST', '/events', { title: 'x', date: "2026-01-01' OR 1=1" })).s === 400, 'malformed date rejected');
  ok((await F.call('PUT', '/settings', { logo: 'data:image/png;base64,AAAA" onerror="alert(1)' })).s === 400, 'logo with HTML attribute injection rejected');
  await raw('PUT', '/settings', { body: '{"__proto__":{"polluted":1},"toString":"x","constructor":"y","company_name":"TechSentinals (demo)"}', cookie: F.cookie, json: false, headers: { 'Content-Type': 'application/json' } });
  ok(!db.prepare("SELECT 1 FROM settings WHERE key IN ('toString','__proto__','polluted')").get() && ({}).polluted === undefined, 'settings ignore unknown / prototype keys');
  const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const xc = await F.call('POST', '/clients', { company: xss, id: 99999, created_at: '1999-01-01' });
  ok(xc.s === 201 && xc.j.id !== 99999 && !xc.j.created_at.startsWith('1999'), 'id / created_at cannot be forced on create (mass assignment)', xc.j);
  ok(xc.j.company === xss, 'text is stored as-is (escaped at display time; see CSP check)');
  await F.call('POST', '/expenses', { date: '2026-10-01', amount: 1, vendor: '=HYPERLINK("http://evil.test","x")', category: 'Other' });
  const csv = await F.call('GET', '/expenses/export.csv');
  ok(csv.text.includes(`"'=HYPERLINK`) && !/(^|,)=HYPERLINK/m.test(csv.text), 'CSV export neutralises spreadsheet formulas');

  group('Files');
  const evil = new FormData(); evil.append('file', new Blob(['<script>alert(document.cookie)</script>'], { type: 'text/html' }), '../../../evil.html'); evil.append('entity_type', 'project'); evil.append('entity_id', String(acme.id));
  const ev = await raw('POST', '/documents/upload', { body: evil, cookie: F.cookie, json: false });
  const stored = db.prepare('SELECT stored_name, filename FROM documents WHERE id=?').get(ev.j.id);
  ok(/^[a-f0-9]{32}$/.test(stored.stored_name) && !stored.filename.includes('/') && !stored.filename.includes('\\'), 'uploaded file gets a random name on disk; path in the name is stripped', stored);
  ok(!fs.existsSync(path.join(UPLOAD_DIR, '..', '..', '..', 'evil.html')) && !fs.existsSync(path.join(dir, 'evil.html')), 'path traversal in the filename writes nothing outside the uploads folder');
  for (const q of ['', '?inline=1']) {
    const dl = await raw('GET', `/files/${ev.j.id}${q}`, { cookie: F.cookie });
    ok(dl.h.get('content-type') === 'application/octet-stream' && /^attachment/.test(dl.h.get('content-disposition')) && /sandbox/.test(dl.h.get('content-security-policy')) && dl.h.get('x-content-type-options') === 'nosniff', `uploaded HTML is never rendered in the browser${q ? ' (even with inline=1)' : ''}`, [dl.h.get('content-type'), dl.h.get('content-disposition')]);
  }

  /* ------------------------------------------------------------------ */
  group('Input validation (same rules as the browser)');
  const rej = async (u, body, why, m = 'POST') => { const r = await F.call(m, u, body); ok(r.s === 400, `rejected: ${why}`, [r.s, r.j]); return r; };
  const okc = async (u, body, why) => { const r = await F.call('POST', u, body); ok(r.s === 201, `accepted: ${why}`, [r.s, r.j]); return r.j; };
  await rej('/leads', { name: 'Ravi 123', stage: 'new' }, 'digits in a person name');
  await rej('/leads', { name: 'Ravi<script>', stage: 'new' }, 'symbols in a person name');
  await rej('/leads', { name: '   ', stage: 'new' }, 'name made only of spaces');
  await rej('/leads', { name: 'Ravi', phone: 'call me later', stage: 'new' }, 'letters in a phone number');
  await rej('/leads', { name: 'Ravi', phone: '12345', stage: 'new' }, 'phone with too few digits');
  await rej('/leads', { name: 'Ravi', email: 'ravi@', stage: 'new' }, 'broken email');
  await rej('/leads', { name: 'Ravi', city: 'Pune 411001', stage: 'new' }, 'digits in a city');
  await rej('/leads', { name: 'Ravi', value: -5000, stage: 'new' }, 'negative deal value');
  await rej('/leads', { name: 'Ravi', website: 'not a site', stage: 'new' }, 'invalid website');
  await rej('/leads', { name: 'Ravi', next_followup: '2026-02-30', stage: 'new' }, 'impossible date (30 Feb)');
  await rej('/leads', { name: 'x'.repeat(81), stage: 'new' }, 'name longer than 80 characters');
  const okLead = await okc('/leads', { name: "Anne-Marie D'Souza", phone: '+91 98765-43210', email: 'anne@site.co.in', city: 'Navi Mumbai', website: 'site.co.in', value: 125000.5, stage: 'new' }, 'real-world name with hyphen and apostrophe, Indian phone format');
  await okc('/leads', { name: 'राहुल शर्मा', stage: 'new' }, 'names in Hindi (non-English letters)');
  await rej('/clients', { company: 'GST Co', gstin: '27ABCDE1234F1Z' }, 'GSTIN with 14 characters');
  await rej('/clients', { company: 'PAN Co', pan: '1234567890' }, 'PAN in the wrong format');
  const gc = await okc('/clients', { company: 'Proper GST Co', gstin: '27abcde1234f1z5', pan: 'abcde1234f', industry: 'Retail / D2C', state: 'Maharashtra' }, 'valid GSTIN/PAN typed in lower case; industry may contain digits');
  ok(gc.gstin === '27ABCDE1234F1Z5' && gc.pan === 'ABCDE1234F', 'GSTIN and PAN are stored in capitals', gc);
  await rej('/contacts', { client_id: gc.id, name: 'Priya 2' }, 'digits in a contact name');
  await rej('/projects', { name: 'Dates', client_id: gc.id, start_date: '2026-05-10', deadline: '2026-05-01' }, 'deadline before start date');
  const pj = await okc('/projects', { name: 'Dates OK', client_id: gc.id, start_date: '2026-05-01', deadline: '2026-05-10' }, 'deadline after start date');
  await rej(`/projects/${pj.id}`, { deadline: '2026-04-01' }, 'moving a deadline before the existing start date (update)', 'PUT');
  await rej('/payments', { amount: -100, date: '2026-10-01' }, 'negative payment');
  await rej('/payments', { amount: 'abc', date: '2026-10-01' }, 'payment amount that is not a number');
  await rej('/expenses', { amount: 100, date: '2026-10-01', category: 'Software', tax_amount: -1 }, 'negative GST on an expense');
  await rej('/maintenance_logs', { title: 'Too many hours', hours: 5000, status: 'open' }, 'more than 1000 hours on one item');
  await rej('/invoices', { client_id: gc.id, issue_date: '2026-10-10', due_date: '2026-10-01', items: [{ description: 'Work', qty: 1, rate: 100 }] }, 'invoice due before it was issued');
  await rej('/invoices', { client_id: gc.id, items: [{ description: 'Work', qty: 0, rate: 100 }] }, 'invoice line with quantity 0');
  await rej('/invoices', { client_id: gc.id, items: [{ description: 'Work', qty: 1, rate: -100 }] }, 'invoice line with a negative rate');
  await rej('/invoices', { client_id: gc.id, items: [{ description: '', qty: 1, rate: 100 }] }, 'invoice line without a description');
  await rej('/invoices', { client_id: gc.id, tax_rate: 150, items: [{ description: 'Work', qty: 1, rate: 100 }] }, 'tax rate above 100%');
  await rej('/users', { name: 'Intern 007', email: 'i7@demo.test', password: 'Strong-pass-2026', role: 'intern' }, 'digits in a team member name');
  await rej('/users', { name: 'New Intern', email: 'bad-email', password: 'Strong-pass-2026', role: 'intern' }, 'team member with a broken email');
  await rej('/settings', { bank_ifsc: 'HDFC123' }, 'IFSC in the wrong format', 'PUT');
  await rej('/settings', { upi_id: 'not-a-upi' }, 'UPI ID without @bank', 'PUT');
  ok((await F.call('PUT', '/settings', { bank_ifsc: 'hdfc0001234', gstin: '27AAACT1234A1Z5' })).j.bank_ifsc === 'HDFC0001234', 'valid IFSC accepted and stored in capitals');
  const impW = await F.call('POST', '/import/leads', { records: [{ name: 'Warn Row', phone: 'call later', email: 'not an email' }] });
  ok(impW.j.added === 1 && impW.j.warnings.length === 2 && db.prepare("SELECT phone, email FROM leads WHERE name='Warn Row'").get().phone === null, 'import keeps the row but empties invalid cells and reports them', impW.j);
  void okLead;

  /* ------------------------------------------------------------------ */
  group('Excel import');
  ok((await K.call('POST', '/import/leads', { records: [{ name: 'Sneaky' }] })).s === 403 && (await T.call('POST', '/import/clients', { records: [{ company: 'Sneaky' }] })).s === 403, 'interns cannot import');
  ok((await F.call('POST', '/import/users', { records: [{ name: 'x' }] })).s === 400 && (await F.call('POST', '/import/__proto__', { records: [{ name: 'x' }] })).s === 400, 'only leads and clients can be imported');
  ok((await F.call('POST', '/import/leads', { records: Array.from({ length: 5001 }, (_, i) => ({ name: 'x' + i })) })).s === 400, 'more than 5,000 rows is refused');
  ok((await F.call('POST', '/import/leads', { records: 'nope' })).s === 400, 'records must be a list');
  const imp = await F.call('POST', '/import/leads', { records: [
    { name: 'Imported One', email: 'imp1@example.com', phone: '+91 98765 11111', stage: 'Meeting done', value: '₹1,20,000', next_followup: '05/11/2026', owner_id: 999, id: 1 },
    { name: 'Imported One again', email: 'IMP1@example.com' }, { name: 'Phone twin', phone: '9876511111' }, { company: '' }, { name: '<img src=x onerror=alert(1)>' }] });
  const row = db.prepare("SELECT * FROM leads WHERE email='imp1@example.com'").get();
  ok(imp.s === 200 && imp.j.added === 2 && imp.j.duplicates.length === 2 && imp.j.skipped.length === 1, 'import adds new rows, skips duplicates (email / phone) and empty rows', imp.j);
  ok(row && row.stage === 'meeting' && row.value === 120000 && row.next_followup === '2026-11-05' && row.id !== 1, 'stage, amount and dd/mm/yyyy date are understood; id cannot be forced', row);
  const again = await F.call('POST', '/import/leads', { records: [{ name: 'Imported One', email: 'imp1@example.com' }] });
  ok(again.j.added === 0 && again.j.duplicates.length === 1, 'running the same import twice adds nothing');
  const ci = await F.call('POST', '/import/clients', { records: [{ company: 'ACME LOGISTICS PVT LTD', contact_name: 'X' }, { company: 'Fresh Co', contact_name: 'Priya', contact_email: 'priya@fresh.co', gstin: '27ABCDE1234F1Z5' }, { company: 'fresh co' }] });
  const fc = db.prepare("SELECT * FROM clients WHERE company='Fresh Co'").get();
  ok(ci.j.added === 1 && ci.j.duplicates.length === 2 && fc && db.prepare('SELECT COUNT(*) n FROM contacts WHERE client_id=? AND name=?').get(fc.id, 'Priya').n === 1, 'client import skips existing companies (any case) and creates the main contact', ci.j);
  ok(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='import'").get().n === 4, 'every import is written to the activity log');

  /* ------------------------------------------------------------------ */
  group('Security headers');
  const home = await fetch(origin + '/');
  const csp = home.headers.get('content-security-policy') || '';
  ok(/script-src 'self'/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp) && /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp), 'strict CSP: no inline scripts, no framing, no plugins', csp);
  ok(home.headers.get('x-frame-options') === 'DENY' && home.headers.get('x-content-type-options') === 'nosniff' && home.headers.get('referrer-policy') === 'same-origin', 'clickjacking / sniffing / referrer headers set');
  ok(!!home.headers.get('permissions-policy') && home.headers.get('cross-origin-opener-policy') === 'same-origin', 'permissions + cross-origin isolation headers set');
  ok(!home.headers.get('x-powered-by'), 'no X-Powered-By (framework not advertised)');
  ok((await F.call('GET', '/me')).h.get('cache-control') === 'no-store', 'API responses are never cached');
  const unk = await raw('GET', '/does-not-exist', { cookie: F.cookie });
  ok(unk.s === 404 && !/at .*\.js/.test(unk.text), 'unknown API path → clean 404 without stack trace');
  const bad = await raw('POST', '/tasks', { body: '{bad', cookie: F.cookie, json: false, headers: { 'Content-Type': 'application/json' } });
  ok(!/node_modules|at Object|\.js:\d+/.test(bad.text), 'error responses do not leak stack traces', bad.text);

  group('Vault encryption');
  const c1 = db.prepare('SELECT password_enc FROM credentials WHERE id=?').get(cred).password_enc;
  ok(c1.startsWith('v1.') && sec.encrypt('same') !== sec.encrypt('same'), 'AES-256-GCM with a fresh IV each time (same password → different ciphertext)');
  const tampered = 'v1.' + Buffer.from(Buffer.from(c1.slice(3), 'base64').map((b, i) => (i === 30 ? b ^ 1 : b))).toString('base64');
  let threw = false; try { sec.decrypt(tampered); } catch { threw = true; }
  ok(threw, 'tampered ciphertext is detected (GCM authentication)');
  ok((await F.call('GET', '/credentials')).j.every((c) => !('password' in c) && !('password_enc' in c) && !('secret_enc' in c)), 'vault list never contains secrets');
  await F.call('POST', `/credentials/${cred}/reveal`);
  const rev = db.prepare("SELECT * FROM audit_log WHERE action='vault_reveal' ORDER BY id DESC LIMIT 1").get();
  ok(rev && rev.user_name === 'Aarav Mehta' && rev.ip, 'every reveal is logged with who and from which IP', rev);
  ok(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='login_failed'").get().n > 5, 'failed logins are logged');

  console.log(`\n${fails.length ? '✗' : '✓'} security: ${pass} passed, ${fails.length} failed`);
  server.close(); try { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
