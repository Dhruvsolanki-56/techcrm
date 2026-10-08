const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const RULES = require('../public/js/rules');     // same field rules the browser uses
const { db, UPLOAD_DIR, getSettings, setSettings, audit, notify, today } = require('./db');
const sec = require('./security');
const { R, HttpError, getScoped, visibleProjectIds, refreshInvoice, markOverdue, normalizeItems, nextNumber, purgeEntity, inList, round2, deny } = require('./resources');

const { isFounder, hasFlag } = sec;
const bad = (msg) => { throw new HttpError(400, msg); };
const need = (cond, msg) => { if (!cond) bad(msg); };
const founderOnly = (req, res, next) => (isFounder(req.user) ? next() : deny());
const str = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);
const intOrNull = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) ? n : null; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

/* =====================================================  AUTH (public)  ===================================================== */
const auth = express.Router();
const COOKIE = 'crm_session';
function setCookie(req, res, token) {
  const secure = req.secure;      // behind a proxy, set TRUST_PROXY=1 so Express trusts X-Forwarded-Proto
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sec.SESSION_MS / 1000}${secure ? '; Secure' : ''}`);
}
const clearCookie = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);

auth.get('/state', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const user = sec.userForToken(sec.parseCookies(req)[COOKIE]);
  const s = getSettings();
  res.json({ setup_needed: count === 0, user: user ? sec.publicUser(user) : null, company_name: s.company_name, logo: s.logo, demo: process.env.DEMO_MODE === '1' });
});

auth.post('/setup', (req, res) => {
  need(db.prepare('SELECT COUNT(*) n FROM users').get().n === 0, 'Setup already completed.');
  const { name, email, password } = req.body || {};
  need(name && email && password, 'Name, email and password are required.');
  ruleCheck('users', req.body, { name: 'Name', email: 'Email' });
  const p = sec.passwordProblem(password); if (p) bad(p);
  const id = db.prepare("INSERT INTO users(name,email,password_hash,role,title) VALUES(?,?,?, 'founder','Founder')")
    .run(String(name).trim(), String(email).trim().toLowerCase(), sec.hashPassword(password)).lastInsertRowid;
  if (req.body.company_name) setSettings({ company_name: String(req.body.company_name).trim() });
  audit({ id, name }, 'setup', 'users', id, 'First founder account created', req.ip);
  setCookie(req, res, sec.createSession(id, req));
  res.json({ ok: true });
});

auth.post('/login', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const password = String(b.password || '').slice(0, 200);
  if (sec.tooManyAttempts(req.ip, email)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  // always run one scrypt so unknown emails take as long as wrong passwords
  const pwOk = sec.verifyPassword(password, u ? u.password_hash : sec.DUMMY_HASH) && !!u && !!u.active;
  if (!pwOk) {
    sec.recordAttempt(req.ip, email, false);
    audit(u ? { id: u.id, name: u.name } : null, 'login_failed', 'users', u && u.id, email, req.ip);
    throw new HttpError(401, 'Invalid email or password.');
  }
  if (u.totp_enabled) {
    if (!b.code) return res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app.', need_code: true });
    const step = sec.checkTotp(sec.decrypt(u.totp_secret), b.code, u.totp_last);
    if (!step) {
      sec.recordAttempt(req.ip, email, false);
      audit(u, 'login_failed', 'users', u.id, 'wrong two-step code', req.ip);
      return res.status(401).json({ error: 'That code is not valid. Check the time on your phone and try again.', need_code: true });
    }
    db.prepare('UPDATE users SET totp_last=? WHERE id=?').run(step, u.id);
  }
  sec.recordAttempt(req.ip, email, true);
  db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").run(u.id);
  audit(u, 'login', 'users', u.id, null, req.ip);
  setCookie(req, res, sec.createSession(u.id, req));
  res.json({ ok: true, user: sec.publicUser(u) });
});

auth.post('/logout', (req, res) => {
  sec.destroySession(sec.parseCookies(req)[COOKIE]);
  clearCookie(res);
  res.json({ ok: true });
});

function requireUser(req, res, next) {
  const token = sec.parseCookies(req)[COOKIE];
  const u = sec.userForToken(token);
  if (!u) return res.status(401).json({ error: 'Please sign in.' });
  req.user = u; req.sessionToken = token;
  next();
}

/* =====================================================  API (signed-in)  ===================================================== */
const api = express.Router();

// someone signed in with a temporary password can do nothing else until they choose their own
const OPEN_WITH_TEMP_PASSWORD = new Set(['/me', '/password', '/lookups']);
api.use((req, res, next) => {
  if (req.user.must_change_password && !OPEN_WITH_TEMP_PASSWORD.has(req.path)) return res.status(403).json({ error: 'Choose your own password first.', code: 'password_change_required' });
  next();
});

api.get('/me', (req, res) => res.json(sec.publicUser(req.user)));

api.post('/password', (req, res) => {
  const { current, next } = req.body || {};
  need(sec.verifyPassword(String(current || ''), req.user.password_hash), 'Current password is incorrect.');
  const p = sec.passwordProblem(next); if (p) bad(p);
  need(next !== current, 'The new password must be different from the current one.');
  db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(sec.hashPassword(next), req.user.id);
  sec.destroyUserSessions(req.user.id, req.sessionToken);      // sign out every other device
  audit(req.user, 'password_change', 'users', req.user.id, null, req.ip);
  res.json({ ok: true });
});

/* ---------- two-step login (authenticator app) ---------- */
api.post('/2fa/setup', (req, res) => {
  need(!req.user.totp_enabled, 'Two-step login is already on. Turn it off first to set up a new phone.');
  need(sec.verifyPassword(String((req.body || {}).password || ''), req.user.password_hash), 'Password is incorrect.');
  const secret = sec.newTotpSecret();
  db.prepare('UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=?').run(sec.encrypt(secret), req.user.id);
  const label = encodeURIComponent(`${getSettings().company_name || 'CRM'}:${req.user.email}`);
  res.json({ secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(getSettings().company_name || 'CRM')}&digits=6&period=30` });
});
api.post('/2fa/enable', (req, res) => {
  need(req.user.totp_secret && !req.user.totp_enabled, 'Start the setup first.');
  const step = sec.checkTotp(sec.decrypt(req.user.totp_secret), (req.body || {}).code, 0);
  need(step, 'That code is not valid. Type the 6 digits currently shown in the app.');
  db.prepare('UPDATE users SET totp_enabled=1, totp_last=? WHERE id=?').run(step, req.user.id);
  sec.destroyUserSessions(req.user.id, req.sessionToken);
  audit(req.user, '2fa_on', 'users', req.user.id, null, req.ip);
  res.json({ ok: true });
});
api.post('/2fa/disable', (req, res) => {
  need(sec.verifyPassword(String((req.body || {}).password || ''), req.user.password_hash), 'Password is incorrect.');
  db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last=0 WHERE id=?').run(req.user.id);
  audit(req.user, '2fa_off', 'users', req.user.id, null, req.ip);
  res.json({ ok: true });
});

/* ---------- team ---------- */
api.get('/users', founderOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY active DESC, role, name').all().map(sec.publicUser));
});
// throws a 400 with a readable message when a field breaks its rule
function ruleCheck(res, b, labels) {
  for (const [k, label] of Object.entries(labels)) {
    if (b[k] === undefined || b[k] === null) continue;
    const kind = RULES.kindFor(res, k); if (!kind) continue;
    b[k] = RULES.normalize(kind, typeof b[k] === 'string' ? b[k].trim() : b[k]);
    const e = RULES.check(kind, b[k]); if (e) bad(`${label} ${e}.`);
  }
}
api.post('/users', founderOnly, (req, res) => {
  const b = req.body || {};
  ruleCheck('users', b, { name: 'Name', email: 'Email', phone: 'Phone' });
  need(b.name && b.email && b.password, 'Name, email and a temporary password are required.');
  const p = sec.passwordProblem(b.password); if (p) bad(p);
  need(['founder', 'intern'].includes(b.role), 'Role must be founder or intern.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(String(b.email).trim().toLowerCase())) throw new HttpError(409, 'A user with this email already exists.');
  const mods = (Array.isArray(b.modules) ? b.modules : []).filter((m) => sec.INTERN_FLAGS.includes(m));
  const id = db.prepare('INSERT INTO users(name,email,password_hash,role,modules,title,phone,must_change_password) VALUES(?,?,?,?,?,?,?,1)')
    .run(String(b.name).trim(), String(b.email).trim().toLowerCase(), sec.hashPassword(b.password), b.role, JSON.stringify(mods), str(b.title), str(b.phone)).lastInsertRowid;
  audit(req.user, 'create', 'users', id, `${b.name} (${b.role})`, req.ip);
  res.status(201).json(sec.publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)));
});
api.put('/users/:id', founderOnly, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) throw new HttpError(404, 'User not found');
  const b = req.body || {};
  ruleCheck('users', b, { name: 'Name', email: 'Email', phone: 'Phone' });
  const role = b.role || u.role;
  need(['founder', 'intern'].includes(role), 'Invalid role.');
  const active = b.active === undefined ? u.active : (b.active ? 1 : 0);
  const otherFounders = db.prepare("SELECT COUNT(*) n FROM users WHERE role='founder' AND active=1 AND id<>?").get(id).n;
  if ((role !== 'founder' || !active) && u.role === 'founder' && otherFounders === 0) bad('You need at least one active founder account.');
  if (id === req.user.id && !active) bad('You cannot deactivate your own account.');
  const mods = Array.isArray(b.modules) ? b.modules.filter((m) => sec.INTERN_FLAGS.includes(m)) : sec.flags(u);
  db.prepare('UPDATE users SET name=?, email=?, role=?, modules=?, title=?, phone=?, active=? WHERE id=?')
    .run(str(b.name) || u.name, (str(b.email) || u.email).toLowerCase(), role, JSON.stringify(mods), b.title === undefined ? u.title : str(b.title), b.phone === undefined ? u.phone : str(b.phone), active, id);
  if (b.password) {
    const p = sec.passwordProblem(b.password); if (p) bad(p);
    db.prepare('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?').run(sec.hashPassword(b.password), id);
    sec.destroyUserSessions(id);
    audit(req.user, 'password_reset', 'users', id, u.name, req.ip);
  }
  if (!active) sec.destroyUserSessions(id);
  if (b.reset_2fa && u.totp_enabled) {      // lost phone: a founder switches two-step login off for them
    db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last=0 WHERE id=?').run(id);
    sec.destroyUserSessions(id);
    audit(req.user, '2fa_reset', 'users', id, u.name, req.ip);
  }
  audit(req.user, 'update', 'users', id, `${u.name} → role ${role}, access: ${mods.join(',') || 'standard'}`, req.ip);
  res.json(sec.publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)));
});

/* ---------- lookups used by dropdowns ---------- */
api.get('/lookups', (req, res) => {
  const u = req.user;
  const sc = (name) => R[name].scope(u);
  const pick = (name, cols) => { const s = sc(name); const d = R[name]; return db.prepare(`SELECT ${cols} FROM ${d.table} ${d.alias} WHERE (${s.where}) ORDER BY ${d.order}`).all(...s.params); };
  const s = getSettings();
  res.json({
    users: db.prepare('SELECT id,name,role,title FROM users WHERE active=1 ORDER BY name').all(),
    clients: pick('clients', `${R.clients.alias}.id, ${R.clients.alias}.company, ${R.clients.alias}.status`),
    projects: pick('projects', 'p.id, p.name, p.client_id, p.status, p.code'),
    accounts: isFounder(u) ? db.prepare('SELECT id,name,type FROM accounts WHERE active=1 ORDER BY name').all() : [],
    leads: hasFlag(u, 'leads') ? pick('leads', 'l.id, l.name, l.company, l.stage') : [],
    settings: { company_name: s.company_name, currency: s.currency, default_tax_rate: s.default_tax_rate, default_tax_type: s.default_tax_type, logo: s.logo, fy_start_month: s.fy_start_month },
  });
});

/* ---------- settings ---------- */
api.get('/settings', founderOnly, (req, res) => res.json(getSettings()));
api.put('/settings', founderOnly, (req, res) => {
  const b = req.body || {};
  ruleCheck('settings', b, { company_email: 'Company email', company_phone: 'Company phone', company_website: 'Website', gstin: 'GSTIN', pan: 'PAN', state: 'State', bank_account_name: 'Account holder', bank_ifsc: 'IFSC', upi_id: 'UPI ID', bank_account_no: 'Account number', default_tax_rate: 'Default tax rate' });
  if (b.logo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.logo) || b.logo.length > 900000)) bad('Logo must be a PNG/JPG/WebP under ~600 KB.');
  if (b.fy_start_month !== undefined) need(['1', '4', '7', '10'].includes(String(b.fy_start_month)), 'Invalid financial year start.');
  if (b.default_tax_type !== undefined) need(['cgst_sgst', 'igst', 'none'].includes(b.default_tax_type), 'Invalid tax type.');
  setSettings(b);
  audit(req.user, 'update', 'settings', null, 'Company settings updated', req.ip);
  res.json(getSettings());
});

/* ---------- notes / timeline ---------- */
const NOTE_ENTITIES = { lead: 'leads', client: 'clients', project: 'projects', task: 'tasks', invoice: 'invoices', quote: 'quotes', maintenance: 'maintenance_logs' };
function noteAccess(req, type, id) {
  need(typeof type === 'string', 'Unknown entity.');
  const resName = Object.hasOwn(NOTE_ENTITIES, type) && NOTE_ENTITIES[type];
  need(resName && id, 'Unknown entity.');
  if (!getScoped(resName, id, req.user)) deny();
}
api.get('/notes', (req, res) => {
  const id = intOrNull(req.query.entity_id);
  noteAccess(req, req.query.entity_type, id);
  res.json(db.prepare(`SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id=n.user_id WHERE entity_type=? AND entity_id=? ORDER BY n.created_at DESC, n.id DESC`).all(req.query.entity_type, id));
});
api.post('/notes', (req, res) => {
  const { entity_type, body, kind, entity_id } = req.body || {};
  const id = intOrNull(entity_id);
  noteAccess(req, entity_type, id);
  need(body && String(body).trim(), 'Write something first.');
  const k = ['note', 'call', 'meeting', 'email', 'whatsapp'].includes(kind) ? kind : 'note';
  const nid = db.prepare('INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES(?,?,?,?,?)').run(entity_type, id, req.user.id, k, String(body).trim().slice(0, 10000)).lastInsertRowid;
  if (entity_type === 'task') {
    const t = db.prepare('SELECT assignee_id, created_by, title FROM tasks WHERE id=?').get(id);
    for (const uid of new Set([t.assignee_id, t.created_by])) if (uid && uid !== req.user.id) notify(uid, `${req.user.name} commented on "${t.title}"`, '#/tasks');
  }
  res.status(201).json(db.prepare('SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id=n.user_id WHERE n.id=?').get(nid));
});
api.delete('/notes/:id', (req, res) => {
  const n = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
  if (!n) throw new HttpError(404, 'Not found');
  if (!(isFounder(req.user) || (n.user_id === req.user.id && n.kind !== 'system'))) deny();
  db.prepare('DELETE FROM notes WHERE id=?').run(n.id);
  res.json({ ok: true });
});

/* ---------- notifications ---------- */
api.get('/notifications', (req, res) => {
  res.json({
    unread: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0').get(req.user.id).n,
    items: db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id),
  });
});
api.post('/notifications/read', (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

/* ---------- project team ---------- */
api.put('/projects/:id/members', founderOnly, (req, res) => {
  const pid = Number(req.params.id);
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(pid);
  if (!p) throw new HttpError(404, 'Project not found');
  const ids = [...new Set((req.body.user_ids || []).map(Number).filter(Number.isInteger))];
  const existing = db.prepare('SELECT user_id FROM project_members WHERE project_id=?').all(pid).map((r) => r.user_id);
  db.transaction(() => {
    db.prepare('DELETE FROM project_members WHERE project_id=?').run(pid);
    for (const uid of ids) db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(pid, uid);
  })();
  for (const uid of ids) if (!existing.includes(uid) && uid !== req.user.id) notify(uid, `You were added to project: ${p.name}`, `#/projects/${pid}`);
  audit(req.user, 'update', 'projects', pid, `Team updated (${ids.length} members)`, req.ip);
  res.json({ ok: true });
});
api.get('/projects/:id/members', (req, res) => {
  if (!getScoped('projects', req.params.id, req.user)) deny();
  res.json(db.prepare('SELECT u.id, u.name, u.title, u.role FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=? ORDER BY u.name').all(req.params.id));
});

/* ---------- lead -> client conversion ---------- */
api.post('/leads/:id/convert', founderOnly, (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id);
  if (!lead) throw new HttpError(404, 'Lead not found');
  if (lead.client_id) bad('This lead was already converted.');
  const b = req.body || {};
  const out = db.transaction(() => {
    const clientId = db.prepare('INSERT INTO clients(company,website,city,status,account_manager_id,notes) VALUES(?,?,?,?,?,?)')
      .run(lead.company || lead.name, lead.website, lead.city, 'active', lead.owner_id, lead.notes).lastInsertRowid;
    db.prepare('INSERT INTO contacts(client_id,name,email,phone,is_primary) VALUES(?,?,?,?,1)').run(clientId, lead.name, lead.email, lead.phone);
    db.prepare("UPDATE leads SET client_id=?, stage='won', updated_at=datetime('now') WHERE id=?").run(clientId, lead.id);
    db.prepare("UPDATE documents SET entity_type='client', entity_id=? WHERE entity_type='lead' AND entity_id=?").run(clientId, lead.id);
    db.prepare('UPDATE quotes SET client_id=? WHERE lead_id=?').run(clientId, lead.id);
    db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES('client',?,?,'system',?)").run(clientId, req.user.id, `Converted from lead "${lead.name}" (source: ${lead.source || 'n/a'}, expected value ${lead.value || 0})`);
    db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES('lead',?,?,'system','Converted to client — lead marked Won')").run(lead.id, req.user.id);
    for (const n of db.prepare("SELECT * FROM notes WHERE entity_type='lead' AND entity_id=? AND kind<>'system'").all(lead.id)) {
      db.prepare('INSERT INTO notes(entity_type,entity_id,user_id,kind,body,created_at) VALUES(?,?,?,?,?,?)').run('client', clientId, n.user_id, n.kind, n.body, n.created_at);
    }
    let projectId = null;
    if (b.create_project) {
      projectId = db.prepare("INSERT INTO projects(client_id,name,type,status,budget,manager_id,description) VALUES(?,?,?,'planning',?,?,?)")
        .run(clientId, str(b.project_name) || `${lead.company || lead.name} — ${lead.service || 'Project'}`, lead.service, lead.value || 0, lead.owner_id, lead.notes).lastInsertRowid;
      db.prepare('UPDATE projects SET code=? WHERE id=?').run(`P-${String(new Date().getFullYear()).slice(2)}-${String(projectId).padStart(3, '0')}`, projectId);
      if (lead.owner_id) db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(projectId, lead.owner_id);
    }
    return { client_id: clientId, project_id: projectId };
  })();
  audit(req.user, 'convert', 'leads', lead.id, `${lead.name} → client #${out.client_id}`, req.ip);
  res.json(out);
});

/* ---------- quote -> invoice ---------- */
api.post('/quotes/:id/to-invoice', founderOnly, (req, res) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!q) throw new HttpError(404, 'Quote not found');
  need(q.client_id, 'Link this quotation to a client first (convert the lead to a client).');
  const s = getSettings();
  const issue = today();
  const due = new Date(); due.setDate(due.getDate() + 15);
  const id = db.prepare(`INSERT INTO invoices(number,client_id,project_id,quote_id,title,issue_date,due_date,status,items,subtotal,discount,tax_type,tax_rate,tax_amount,total,currency,terms,notes,created_by)
    VALUES(?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?)`)
    .run(nextNumber('invoices', s.invoice_prefix, issue), q.client_id, q.project_id, q.id, q.title, issue, due.toISOString().slice(0, 10), q.items, q.subtotal, q.discount,
      q.tax_type, q.tax_rate, q.tax_amount, q.total, q.currency, s.terms_invoice, q.notes, req.user.id).lastInsertRowid;
  db.prepare("UPDATE quotes SET status='accepted', updated_at=datetime('now') WHERE id=?").run(q.id);
  audit(req.user, 'convert', 'quotes', q.id, `${q.number} → invoice`, req.ip);
  res.json({ invoice_id: id });
});

/* ---------- renewals: roll the date forward ---------- */
api.post('/renewals/:id/renew', founderOnly, (req, res) => {
  const r = db.prepare('SELECT * FROM renewals WHERE id=?').get(req.params.id);
  if (!r) throw new HttpError(404, 'Not found');
  const d = new Date((r.renewal_date || today()) + 'T00:00:00');
  const step = { monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12, biennial: 24, triennial: 36 }[r.cycle];
  need(step, 'This item has a one-time cycle and cannot be renewed automatically.');
  d.setMonth(d.getMonth() + step);
  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  db.prepare("UPDATE renewals SET renewal_date=?, status='active' WHERE id=?").run(next, r.id);
  audit(req.user, 'renew', 'renewals', r.id, `${r.name} → ${next}`, req.ip);
  res.json({ renewal_date: next });
});

/* =====================================================  VAULT (founders only)  ===================================================== */
const vault = express.Router();
vault.use(founderOnly);
const vaultRow = (r) => ({ id: r.id, client_id: r.client_id, project_id: r.project_id, label: r.label, kind: r.kind, url: r.url, username: r.username, notes: r.notes,
  has_password: !!r.password_enc, has_secret: !!r.secret_enc, client_name: r.client_name, project_name: r.project_name, updated_at: r.updated_at });
const VSEL = `SELECT cr.*, c.company AS client_name, p.name AS project_name FROM credentials cr LEFT JOIN clients c ON c.id=cr.client_id LEFT JOIN projects p ON p.id=cr.project_id`;
vault.get('/', (req, res) => {
  let sql = `${VSEL} WHERE 1=1`; const params = [];
  if (req.query.client_id) { sql += ' AND cr.client_id=?'; params.push(String(req.query.client_id)); }
  if (req.query.project_id) { sql += ' AND cr.project_id=?'; params.push(String(req.query.project_id)); }
  res.json(db.prepare(sql + ' ORDER BY c.company COLLATE NOCASE, cr.label').all(...params).map(vaultRow));
});
function saveCred(req, res, existing) {
  const b = req.body || {};
  need(str(b.label), 'Label is required.');
  need(intOrNull(b.client_id) || intOrNull(b.project_id), 'Link this to a client or a project.');
  let clientId = intOrNull(b.client_id);
  const projectId = intOrNull(b.project_id);
  if (!clientId && projectId) clientId = (db.prepare('SELECT client_id FROM projects WHERE id=?').get(projectId) || {}).client_id || null;
  const pw = b.password === undefined ? (existing && existing.password_enc) : sec.encrypt(b.password);
  const secret = b.secret === undefined ? (existing && existing.secret_enc) : sec.encrypt(b.secret);
  if (existing) {
    db.prepare("UPDATE credentials SET client_id=?,project_id=?,label=?,kind=?,url=?,username=?,password_enc=?,secret_enc=?,notes=?,updated_at=datetime('now') WHERE id=?")
      .run(clientId, projectId, str(b.label), str(b.kind), str(b.url, 1000), str(b.username), pw || null, secret || null, str(b.notes, 5000), existing.id);
    audit(req.user, 'update', 'credentials', existing.id, str(b.label), req.ip);
    return res.json(vaultRow(db.prepare(`${VSEL} WHERE cr.id=?`).get(existing.id)));
  }
  const id = db.prepare('INSERT INTO credentials(client_id,project_id,label,kind,url,username,password_enc,secret_enc,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(clientId, projectId, str(b.label), str(b.kind), str(b.url, 1000), str(b.username), pw || null, secret || null, str(b.notes, 5000), req.user.id).lastInsertRowid;
  audit(req.user, 'create', 'credentials', id, str(b.label), req.ip);
  res.status(201).json(vaultRow(db.prepare(`${VSEL} WHERE cr.id=?`).get(id)));
}
vault.post('/', (req, res) => saveCred(req, res, null));
vault.put('/:id', (req, res) => {
  const ex = db.prepare('SELECT * FROM credentials WHERE id=?').get(req.params.id);
  if (!ex) throw new HttpError(404, 'Not found');
  saveCred(req, res, ex);
});
vault.post('/:id/reveal', (req, res) => {
  const r = db.prepare('SELECT * FROM credentials WHERE id=?').get(req.params.id);
  if (!r) throw new HttpError(404, 'Not found');
  audit(req.user, 'vault_reveal', 'credentials', r.id, r.label, req.ip);
  res.json({ password: sec.decrypt(r.password_enc), secret: sec.decrypt(r.secret_enc) });
});
vault.delete('/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM credentials WHERE id=?').get(req.params.id);
  if (!r) throw new HttpError(404, 'Not found');
  db.prepare('DELETE FROM credentials WHERE id=?').run(r.id);
  audit(req.user, 'delete', 'credentials', r.id, r.label, req.ip);
  res.json({ ok: true });
});
api.use('/credentials', vault);

/* =====================================================  FILES  ===================================================== */
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
});
const DOC_ENTITIES = { client: 'clients', lead: 'leads', project: 'projects', task: 'tasks', invoice: 'invoices', quote: 'quotes' };
api.post('/documents/upload', upload.single('file'), (req, res) => {
  const f = req.file;
  const cleanup = () => { if (f) try { fs.unlinkSync(f.path); } catch { /* ok */ } };
  try {
    need(f, 'Choose a file to upload.');
    const type = req.body.entity_type || 'general';
    const eid = intOrNull(req.body.entity_id);
    if (type === 'general' || type === 'expense') { if (!isFounder(req.user)) deny(); }
    else {
      need(Object.hasOwn(DOC_ENTITIES, type) && eid, 'Unknown attachment target.');
      if (!getScoped(DOC_ENTITIES[type], eid, req.user)) deny();
      if (!isFounder(req.user) && !['project', 'task'].includes(type)) deny();
    }
    const original = Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
    const title = str(req.body.title) || original;
    const id = db.prepare('INSERT INTO documents(title,category,entity_type,entity_id,filename,stored_name,mime,size,notes,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(title, str(req.body.category, 60) || 'Other', type, eid, original, f.filename, f.mimetype, f.size, str(req.body.notes, 2000), req.user.id).lastInsertRowid;
    audit(req.user, 'upload', 'documents', id, `${title} → ${type}${eid ? ' #' + eid : ''}`, req.ip);
    res.status(201).json({ id });
  } catch (e) { cleanup(); throw e; }
});
const INLINE_OK = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
api.get('/files/:id', (req, res) => {
  const hit = getScoped('documents', req.params.id, req.user);
  if (!hit) throw new HttpError(404, 'File not found (or you do not have access).');
  const d = hit.row;
  const file = path.join(UPLOAD_DIR, d.stored_name);
  if (!fs.existsSync(file)) throw new HttpError(410, 'The file is missing from disk.');
  const inline = req.query.inline === '1' && INLINE_OK.has(d.mime);
  res.setHeader('Content-Type', inline ? d.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.filename)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  audit(req.user, 'download', 'documents', d.id, d.title, req.ip);
  fs.createReadStream(file).pipe(res);
});

/* =====================================================  DASHBOARD  ===================================================== */
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
// monthly recurring revenue = active maintenance plans (renewals of kind 'amc'), spread per month
const mrr = () => one(`SELECT COALESCE(SUM(client_price * 1.0 / CASE cycle WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'half-yearly' THEN 6
  WHEN 'yearly' THEN 12 WHEN 'biennial' THEN 24 WHEN 'triennial' THEN 36 END),0) v FROM renewals WHERE kind='amc' AND status='active'`).v;

function scopedAll(name, user, extra = '1=1', params = [], limit = 10) {
  const d = R[name]; const s = d.scope(user);
  if (s.where === '1=0') return [];
  const rows = db.prepare(`${d.select} WHERE (${s.where}) AND (${extra}) ORDER BY ${d.order} LIMIT ${limit}`).all(...s.params, ...params);
  if (!isFounder(user)) for (const r of rows) for (const k of d.founderCols || []) delete r[k];
  return rows;
}

api.get('/dashboard', (req, res) => {
  markOverdue();
  const u = req.user; const t = today();
  const out = { today: t, role: u.role };
  out.my_tasks = scopedAll('tasks', u, "t.assignee_id=? AND t.status<>'done'", [u.id], 12);
  out.deadlines = scopedAll('projects', u, "p.status NOT IN ('completed','cancelled','maintenance','on_hold') AND p.deadline IS NOT NULL AND p.deadline<=?", [addDays(t, 21)], 10)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  out.my_projects = scopedAll('projects', u, "p.status IN ('planning','active','review','maintenance')", [], 8);
  out.tasks_overdue = one(`SELECT COUNT(*) n FROM tasks t WHERE t.status<>'done' AND t.due_date < ? ${isFounder(u) ? '' : 'AND t.assignee_id=?'}`, t, ...(isFounder(u) ? [] : [u.id])).n;
  if (hasFlag(u, 'leads')) {
    out.followups = scopedAll('leads', u, "l.stage NOT IN ('won','lost') AND l.next_followup IS NOT NULL AND l.next_followup<=?", [addDays(t, 3)], 8);
  }
  if (isFounder(u)) {
    out.renewals = scopedAll('renewals', u, "r.status='active' AND r.renewal_date IS NOT NULL AND r.renewal_date<=?", [addDays(t, 30)], 10);
    const ms = t.slice(0, 7) + '-01';
    out.kpi = {
      open_leads: one("SELECT COUNT(*) n, COALESCE(SUM(value),0) v FROM leads WHERE stage NOT IN ('won','lost')"),
      active_projects: one("SELECT COUNT(*) n FROM projects WHERE status IN ('planning','active','review')").n,
      receivables: one("SELECT COALESCE(SUM(total-paid_amount),0) v FROM invoices WHERE kind='invoice' AND status NOT IN ('draft','cancelled','paid')").v,
      overdue: one("SELECT COALESCE(SUM(total-paid_amount),0) v, COUNT(*) n FROM invoices WHERE kind='invoice' AND status='overdue'"),
      month_income: one('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE date>=?', ms).v,
      month_expense: one("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='paid' AND date>=?", ms).v,
      mrr: mrr(),
      quotes_pending: one("SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM quotes WHERE status='sent'"),
      cash: all(R.accounts.select + ' WHERE a.active=1').reduce((s, a) => s + a.balance, 0),
    };
    out.overdue_invoices = scopedAll('invoices', u, "i.status='overdue'", [], 6);
    out.activity = all("SELECT * FROM audit_log WHERE action IN ('create','update','delete','convert','upload','renew') AND entity NOT IN ('settings','users') ORDER BY id DESC LIMIT 14");
    out.overdue_tasks = scopedAll('tasks', u, "t.status<>'done' AND t.due_date < ?", [t], 8);
    out.pipeline = Object.fromEntries(all('SELECT stage, COUNT(*) n, COALESCE(SUM(value),0) v FROM leads GROUP BY stage').map((r) => [r.stage, { n: r.n, v: r.v }]));
    const months = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    const inc = Object.fromEntries(all("SELECT strftime('%Y-%m',date) m, SUM(amount) v FROM payments WHERE date>=? GROUP BY m", months[0] + '-01').map((r) => [r.m, r.v]));
    const exp = Object.fromEntries(all("SELECT strftime('%Y-%m',date) m, SUM(amount) v FROM expenses WHERE status='paid' AND date>=? GROUP BY m", months[0] + '-01').map((r) => [r.m, r.v]));
    out.trend = months.map((m) => ({ month: m, income: inc[m] || 0, expense: exp[m] || 0 }));
    out.team_load = all(`SELECT u.id, u.name, u.role,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status<>'done') AS open_tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status<>'done' AND t.due_date<?) AS overdue_tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status='done' AND t.completed_at>=datetime('now','-7 days')) AS done_week
      FROM users u WHERE u.active=1 ORDER BY open_tasks DESC`, t);
  }
  res.json(out);
});

/* =====================================================  CALENDAR  ===================================================== */
api.get('/calendar', (req, res) => {
  markOverdue();
  const u = req.user;
  const from = isDate(req.query.from) ? req.query.from : today().slice(0, 7) + '-01';
  const to = isDate(req.query.to) ? req.query.to : addDays(from, 41);
  const items = [];
  const push = (rows, f) => rows.forEach((r) => items.push(f(r)));
  const rng = (col) => [`${col} BETWEEN ? AND ?`, [from, to]];
  let [w, p] = rng('p.deadline');
  push(scopedAll('projects', u, `p.status NOT IN ('completed','cancelled','maintenance','on_hold') AND ${w}`, p, 500), (r) => ({ date: r.deadline, type: 'project', title: `Deadline: ${r.name}`, sub: r.client_name, link: `#/projects/${r.id}` }));
  [w, p] = rng('t.due_date');
  push(scopedAll('tasks', u, `t.status<>'done' AND ${w}${isFounder(u) ? '' : ' AND t.assignee_id=?'}`, isFounder(u) ? p : [...p, u.id], 500), (r) => ({ date: r.due_date, type: 'task', title: `Task: ${r.title}`, sub: r.assignee_name || r.project_name, link: '#/tasks' }));
  [w, p] = rng('ev.date');
  push(scopedAll('events', u, w, p, 500), (r) => ({ date: r.date, type: 'event', title: r.title, sub: [r.kind, r.client_name].filter(Boolean).join(' · '), link: null, event_id: r.id }));
  if (isFounder(u)) {
    [w, p] = rng('i.due_date');
    push(scopedAll('invoices', u, `i.status IN ('sent','partial','overdue') AND ${w}`, p, 500), (r) => ({ date: r.due_date, type: 'invoice', title: `Invoice due: ${r.number}`, sub: `${r.client_name} · ₹${round2(r.total - r.paid_amount).toLocaleString('en-IN')}`, link: `#/invoices/${r.id}` }));
    [w, p] = rng('q.valid_until');
    push(scopedAll('quotes', u, `q.status='sent' AND ${w}`, p, 200), (r) => ({ date: r.valid_until, type: 'quote', title: `Quote expires: ${r.number}`, sub: r.client_name || r.lead_name, link: `#/quotes/${r.id}` }));
    [w, p] = rng('r.renewal_date');
    push(scopedAll('renewals', u, `r.status='active' AND ${w}`, p, 500), (r) => ({ date: r.renewal_date, type: 'renewal', title: `Renewal: ${r.name}`, sub: [r.kind === 'amc' ? 'Maintenance plan' : r.kind, r.client_name].filter(Boolean).join(' · '), link: '#/renewals' }));
  }
  if (hasFlag(u, 'leads')) {
    [w, p] = rng('l.next_followup');
    push(scopedAll('leads', u, `l.stage NOT IN ('won','lost') AND ${w}`, p, 500), (r) => ({ date: r.next_followup, type: 'followup', title: `Follow up: ${r.name}`, sub: r.company, link: `#/leads/${r.id}` }));
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  res.json({ from, to, items });
});

/* =====================================================  SEARCH  ===================================================== */
api.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
  const u = req.user; const out = [];
  const run = (name, type, cols, title, sub, link) => {
    const d = R[name]; const s = d.scope(u);
    if (s.where === '1=0') return;
    const where = cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ');
    for (const r of db.prepare(`${d.select} WHERE (${s.where}) AND (${where}) ORDER BY ${d.order} LIMIT 6`).all(...s.params, ...cols.map(() => like)))
      out.push({ type, title: title(r), sub: sub(r), link: link(r) });
  };
  run('clients', 'Client', ['c.company', 'c.gstin', 'c.tags', 'c.website'], (r) => r.company, (r) => r.industry || r.city || '', (r) => `#/clients/${r.id}`);
  run('contacts', 'Contact', ['ct.name', 'ct.email', 'ct.phone'], (r) => r.name, (r) => `${r.client_name}${r.email ? ' · ' + r.email : ''}`, (r) => `#/clients/${r.client_id}`);
  run('leads', 'Lead', ['l.name', 'l.company', 'l.email', 'l.phone'], (r) => r.name, (r) => `${r.company || ''} · ${r.stage}`, (r) => `#/leads/${r.id}`);
  run('projects', 'Project', ['p.name', 'p.code', 'p.tech_stack', 'p.live_url'], (r) => r.name, (r) => r.client_name || '', (r) => `#/projects/${r.id}`);
  run('tasks', 'Task', ['t.title'], (r) => r.title, (r) => r.assignee_name || '', () => '#/tasks');
  run('invoices', 'Invoice', ['i.number', 'i.title'], (r) => r.number, (r) => `${r.client_name} · ${r.status}`, (r) => `#/invoices/${r.id}`);
  run('quotes', 'Quote', ['q.number', 'q.title'], (r) => r.number, (r) => `${r.client_name || r.lead_name || ''} · ${r.status}`, (r) => `#/quotes/${r.id}`);
  run('documents', 'Document', ['d.title', 'd.filename'], (r) => r.title, (r) => r.entity_name || r.category, (r) => `#/documents`);
  run('renewals', 'Renewal', ['r.name', 'r.vendor'], (r) => r.name, (r) => r.client_name || '', () => '#/renewals');
  if (isFounder(u)) {
    for (const r of db.prepare(`${VSEL} WHERE cr.label LIKE ? ESCAPE '\\' OR cr.url LIKE ? ESCAPE '\\' OR cr.username LIKE ? ESCAPE '\\' LIMIT 6`).all(like, like, like))
      out.push({ type: 'Credential', title: r.label, sub: r.client_name || r.project_name || '', link: '#/vault' });
  }
  res.json(out);
});

/* =====================================================  FINANCE REPORTS  ===================================================== */
api.get('/finance/summary', founderOnly, (req, res) => {
  markOverdue();
  const t = today();
  const from = isDate(req.query.from) ? req.query.from : t.slice(0, 7) + '-01';
  const to = isDate(req.query.to) ? req.query.to : t;
  const inc = one('SELECT COALESCE(SUM(amount),0) cash, COALESCE(SUM(tds),0) tds, COUNT(*) n FROM payments WHERE date BETWEEN ? AND ?', from, to);
  const exp = one("SELECT COALESCE(SUM(amount),0) v, COALESCE(SUM(tax_amount),0) tax, COUNT(*) n FROM expenses WHERE status='paid' AND date BETWEEN ? AND ?", from, to);
  const inv = one("SELECT COALESCE(SUM(subtotal-discount),0) taxable, COALESCE(SUM(total),0) total, COALESCE(SUM(tax_amount),0) tax, COUNT(*) n FROM invoices WHERE kind='invoice' AND status NOT IN ('draft','cancelled') AND issue_date BETWEEN ? AND ?", from, to);
  const open = all("SELECT total-paid_amount bal, due_date FROM invoices WHERE kind='invoice' AND status IN ('sent','partial','overdue')");
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
  for (const r of open) {
    const days = r.due_date ? Math.floor((new Date(t) - new Date(r.due_date)) / 86400000) : 0;
    const k = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'd90p';
    aging[k] += r.bal;
  }
  // 12-month trend ending in `to`
  const end = new Date((to < t ? to : t) + 'T00:00:00'); const months = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(end.getFullYear(), end.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const mi = Object.fromEntries(all("SELECT strftime('%Y-%m',date) m, SUM(amount) v FROM payments WHERE date>=? GROUP BY m", months[0] + '-01').map((r) => [r.m, r.v]));
  const me = Object.fromEntries(all("SELECT strftime('%Y-%m',date) m, SUM(amount) v FROM expenses WHERE status='paid' AND date>=? GROUP BY m", months[0] + '-01').map((r) => [r.m, r.v]));
  const founders = all("SELECT id,name FROM users WHERE role='founder' AND active=1").map((f) => {
    const capital = one("SELECT COALESCE(SUM(amount),0) v FROM transfers WHERE user_id=? AND kind='capital_in'", f.id).v;
    const draw = one("SELECT COALESCE(SUM(amount),0) v FROM transfers WHERE user_id=? AND kind='withdrawal'", f.id).v;
    const paid = one('SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE paid_by_id=?', f.id).v;
    const reimb = one("SELECT COALESCE(SUM(amount),0) v FROM transfers WHERE user_id=? AND kind='reimbursement'", f.id).v;
    return { ...f, capital, withdrawals: draw, paid_personally: paid, reimbursed: reimb, company_owes: round2(paid - reimb) };
  });
  const accounts = all(R.accounts.select + ' WHERE a.active=1 ORDER BY a.name');
  res.json({
    from, to,
    income: inc, expenses: exp, invoiced: inv,
    profit: round2(inc.cash + inc.tds - exp.v),
    receivables: round2(open.reduce((s, r) => s + r.bal, 0)), aging,
    trend: months.map((m) => ({ month: m, income: mi[m] || 0, expense: me[m] || 0 })),
    expense_by_category: all("SELECT COALESCE(category,'Uncategorised') k, SUM(amount) v FROM expenses WHERE status='paid' AND date BETWEEN ? AND ? GROUP BY k ORDER BY v DESC", from, to),
    income_by_client: all("SELECT COALESCE(c.company,'Unassigned') k, SUM(pm.amount) v FROM payments pm LEFT JOIN clients c ON c.id=pm.client_id WHERE pm.date BETWEEN ? AND ? GROUP BY k ORDER BY v DESC LIMIT 8", from, to),
    projects: all(`SELECT p.id, p.name, c.company client_name, p.status, p.budget,
      (SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.project_id=p.id AND i.kind='invoice' AND i.status NOT IN ('draft','cancelled')) invoiced,
      (SELECT COALESCE(SUM(amount),0) FROM payments pm WHERE pm.project_id=p.id) received,
      (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.project_id=p.id AND e.status='paid') cost
      FROM projects p LEFT JOIN clients c ON c.id=p.client_id ORDER BY received DESC, p.id DESC LIMIT 60`),
    gst: { output: inv.tax, input: exp.tax, net: round2(inv.tax - exp.tax) },
    accounts, cash: round2(accounts.reduce((s, a) => s + a.balance, 0)), founders,
    pending_expenses: one("SELECT COALESCE(SUM(amount),0) v, COUNT(*) n FROM expenses WHERE status='pending'"),
    mrr: mrr(),
    renewals_60d: one("SELECT COALESCE(SUM(our_cost),0) cost, COALESCE(SUM(client_price),0) price, COUNT(*) n FROM renewals WHERE status='active' AND renewal_date BETWEEN ? AND ?", t, addDays(t, 60)),
  });
});

/* =====================================================  IMPORT FROM EXCEL / CSV  =====================================================
   The browser reads the sheet and maps its columns; the server only receives clean records and validates them again. */
const IMPORT_FIELDS = {
  leads: ['name', 'company', 'email', 'phone', 'city', 'website', 'source', 'service', 'value', 'stage', 'next_followup', 'notes'],
  clients: ['company', 'industry', 'website', 'gstin', 'pan', 'address', 'city', 'state', 'country', 'status', 'tags', 'notes', 'contact_name', 'contact_email', 'contact_phone'],
};
const LEAD_STAGES = ['new', 'contacted', 'meeting', 'proposal', 'negotiation', 'won', 'lost'];
const guessStage = (s) => {
  s = String(s || '').toLowerCase().trim();
  if (LEAD_STAGES.includes(s)) return s;
  return /won|convert|client|closed/.test(s) ? 'won' : /lost|dead|reject|not interested/.test(s) ? 'lost' : /meet|demo/.test(s) ? 'meeting'
    : /propos|quot/.test(s) ? 'proposal' : /negot/.test(s) ? 'negotiation' : /contact|call|follow/.test(s) ? 'contacted' : 'new';
};
function importDate(v) {
  v = String(v || '').trim(); if (!v) return null;
  if (isDate(v)) return v;
  const m = v.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);      // dd/mm/yyyy (Indian style)
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isDate(d) && !isNaN(new Date(d)) ? d : null; }
  return null;
}
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);
api.post('/import/:res', founderOnly, (req, res) => {
  const kind = req.params.res;
  need(Object.hasOwn(IMPORT_FIELDS, kind), 'Only leads and clients can be imported.');
  const records = (req.body || {}).records;
  need(Array.isArray(records) && records.length, 'Nothing to import.');
  need(records.length <= 5000, 'At most 5,000 rows per import. Split the sheet into smaller files.');
  const clean = records.map((r) => {
    const o = {};
    for (const k of IMPORT_FIELDS[kind]) { const v = r && typeof r === 'object' ? r[k] : null; o[k] = v == null ? null : String(v).trim().slice(0, k === 'notes' || k === 'address' ? 5000 : 300) || null; }
    return o;
  });
  // bad cells (e.g. "call later" in a phone column) are left empty and reported, the row is still imported
  const warnings = []; const keep = kind === 'leads' ? ['name'] : ['company'];
  clean.forEach((o, i) => {
    for (const k of Object.keys(o)) {
      if (keep.includes(k) || o[k] == null) continue;
      const kindK = RULES.kindFor(kind, k === 'value' ? 'value' : k); if (!kindK || kindK === 'money') continue;
      o[k] = RULES.normalize(kindK, o[k]);
      if (RULES.check(kindK, o[k])) { warnings.push(`Row ${i + 2}: ${k.replace(/_/g, ' ')} "${String(o[k]).slice(0, 40)}" was not valid, left empty`); o[k] = null; }
    }
  });
  const added = []; const duplicates = []; const skipped = [];
  db.transaction(() => {
    if (kind === 'leads') {
      const known = all('SELECT LOWER(email) e, phone p, LOWER(name) n, LOWER(COALESCE(company,\'\')) c FROM leads');
      const emails = new Set(known.map((k) => k.e).filter(Boolean)); const phones = new Set(known.map((k) => digits(k.p)).filter((p) => p.length >= 8));
      const names = new Set(known.map((k) => `${k.n}|${k.c}`));
      clean.forEach((r, i) => {
        const row = i + 2;
        if (!r.name && !r.company) return skipped.push(`Row ${row}: no name or company`);
        const name = r.name || r.company; const key = `${name.toLowerCase()}|${(r.company || '').toLowerCase()}`;
        if ((r.email && emails.has(r.email.toLowerCase())) || (digits(r.phone).length >= 8 && phones.has(digits(r.phone))) || names.has(key)) return duplicates.push(`Row ${row}: ${name}`);
        const id = db.prepare('INSERT INTO leads(name,company,email,phone,website,city,source,service,value,stage,notes,next_followup,owner_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(name, r.company, r.email, r.phone, r.website, r.city, r.source, r.service, Number(String(r.value || '0').replace(/[^0-9.]/g, '')) || 0, guessStage(r.stage), r.notes, importDate(r.next_followup), req.user.id, req.user.id).lastInsertRowid;
        added.push(id); if (r.email) emails.add(r.email.toLowerCase()); if (digits(r.phone).length >= 8) phones.add(digits(r.phone)); names.add(key);
      });
    } else {
      const companies = new Set(all('SELECT LOWER(company) c FROM clients').map((x) => x.c));
      clean.forEach((r, i) => {
        const row = i + 2;
        if (!r.company) return skipped.push(`Row ${row}: no company name`);
        if (companies.has(r.company.toLowerCase())) return duplicates.push(`Row ${row}: ${r.company}`);
        const status = ['prospect', 'active', 'past', 'archived'].includes((r.status || '').toLowerCase()) ? r.status.toLowerCase() : 'active';
        const cid = db.prepare('INSERT INTO clients(company,industry,website,gstin,pan,address,city,state,country,status,tags,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(r.company, r.industry, r.website, r.gstin && r.gstin.toUpperCase(), r.pan && r.pan.toUpperCase(), r.address, r.city, r.state, r.country || 'India', status, r.tags, r.notes).lastInsertRowid;
        if (r.contact_name || r.contact_email || r.contact_phone) db.prepare('INSERT INTO contacts(client_id,name,email,phone,is_primary) VALUES(?,?,?,?,1)').run(cid, r.contact_name || r.company, r.contact_email, r.contact_phone);
        added.push(cid); companies.add(r.company.toLowerCase());
      });
    }
  })();
  audit(req.user, 'import', kind, null, `${added.length} added, ${duplicates.length} duplicates, ${skipped.length} skipped`, req.ip);
  res.json({ added: added.length, duplicates, skipped, warnings });
});

/* =====================================================  ADMIN  ===================================================== */
api.get('/audit', founderOnly, (req, res) => {
  const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
  let sql = 'SELECT * FROM audit_log WHERE 1=1'; const p = [];
  if (req.query.user_id) { sql += ' AND user_id=?'; p.push(String(req.query.user_id)); }
  if (req.query.action) { sql += ' AND action=?'; p.push(String(req.query.action)); }
  res.json(all(sql + ` ORDER BY id DESC LIMIT ${lim}`, ...p));
});
api.get('/backup', founderOnly, (req, res, next) => {
  const f = path.join(require('./db').BACKUP_DIR, `manual-${Date.now()}.db`);
  db.backup(f).then(() => {
    audit(req.user, 'backup', 'system', null, 'Database downloaded', req.ip);
    res.download(f, `techsentinals-crm-backup-${today()}.db`, () => fs.unlink(f, () => {}));
  }).catch(next);
});

module.exports = { auth, api, requireUser, HttpError };
