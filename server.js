const express = require('express');
const path = require('path');
const fs = require('fs');
const { db, BACKUP_DIR, today, notify } = require('./lib/db');
const { buildRouter, HttpError, markOverdue } = require('./lib/resources');
const { auth, api, requireUser } = require('./lib/routes');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const app = express();
// TRUST_PROXY=1 behind one proxy (Caddy, Render). Use 2 when Netlify forwards to Render.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
const DEMO = process.env.DEMO_MODE === '1';
app.disable('x-powered-by');

// security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});

app.use(express.json({ limit: '4mb' }));

// API: every state-changing request must carry our custom header (blocks cross-site form posts)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'crm') {
    return res.status(403).json({ error: 'Blocked: missing request header.' });
  }
  next();
});
// public demo: visitors can try everything except things that would lock other visitors out
if (DEMO) {
  const blocked = [['POST', /^\/api\/auth\/setup$/], ['POST', /^\/api\/password$/], ['POST', /^\/api\/2fa\//], ['POST', /^\/api\/users$/], ['PUT', /^\/api\/users\//], ['PUT', /^\/api\/settings$/]];
  app.use((req, res, next) => (blocked.some(([m, re]) => m === req.method && re.test(req.path)) ? res.status(403).json({ error: 'This is switched off in the public demo, so visitors cannot lock each other out.' }) : next()));
}
app.use('/api/auth', auth);
app.use('/api', requireUser, api, buildRouter());

app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, index: 'index.html' }));
app.get('*', (req, res) => (req.path.startsWith('/api') ? res.status(404).json({ error: 'Not found' }) : res.sendFile(path.join(__dirname, 'public', 'index.html'))));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is larger than 60 MB.' });
  if (err && /UNIQUE constraint/.test(err.message)) return res.status(409).json({ error: 'That value already exists (must be unique).' });
  if (err && /FOREIGN KEY/.test(err.message)) return res.status(409).json({ error: 'This record is still linked to other records, or points to something that no longer exists.' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (err && err.expose && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Bad request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

/* ---------- daily reminders (in-app notifications) ---------- */
function once(userId, text, link) {
  const dup = db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND text=? AND date(at)=date('now','localtime')").get(userId, text);
  if (!dup) notify(userId, text, link);
}
function runReminders() {
  try {
    markOverdue();
    const t = today();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tm = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    for (const r of db.prepare("SELECT * FROM tasks WHERE status<>'done' AND assignee_id IS NOT NULL AND due_date<=?").all(tm))
      once(r.assignee_id, r.due_date < t ? `Overdue task: ${r.title}` : `Task due ${r.due_date === t ? 'today' : 'tomorrow'}: ${r.title}`, '#/tasks');
    const founders = db.prepare("SELECT id FROM users WHERE role='founder' AND active=1").all();
    const in14 = new Date(); in14.setDate(in14.getDate() + 14);
    const lim = `${in14.getFullYear()}-${String(in14.getMonth() + 1).padStart(2, '0')}-${String(in14.getDate()).padStart(2, '0')}`;
    for (const r of db.prepare("SELECT * FROM renewals WHERE status='active' AND renewal_date IS NOT NULL AND renewal_date<=?").all(lim))
      for (const f of founders) once(f.id, `Renewal ${r.renewal_date < t ? 'overdue' : 'due ' + r.renewal_date}: ${r.name}`, '#/renewals');
    for (const r of db.prepare("SELECT number, id FROM invoices WHERE status='overdue'").all())
      for (const f of founders) once(f.id, `Invoice overdue: ${r.number}`, `#/invoices/${r.id}`);
    for (const r of db.prepare("SELECT * FROM leads WHERE stage NOT IN ('won','lost') AND next_followup IS NOT NULL AND next_followup<=? AND owner_id IS NOT NULL").all(t))
      once(r.owner_id, `Follow up with lead: ${r.name}`, `#/leads/${r.id}`);
    db.prepare("DELETE FROM notifications WHERE at < datetime('now','-60 days')").run();
  } catch (e) { console.error('Reminder job failed:', e.message); }
}

/* ---------- automatic daily database backup (keeps 14) ---------- */
async function dailyBackup() {
  try {
    const f = path.join(BACKUP_DIR, `auto-${today()}.db`);
    if (fs.existsSync(f)) return;
    await db.backup(f);
    const olds = fs.readdirSync(BACKUP_DIR).filter((n) => n.startsWith('auto-')).sort();
    while (olds.length > 14) fs.unlinkSync(path.join(BACKUP_DIR, olds.shift()));
    console.log('Backup saved:', path.basename(f));
  } catch (e) { console.error('Backup failed:', e.message); }
}

function start() {
  return app.listen(PORT, HOST, () => {
    console.log(`\n  TechSentinals CRM is running\n  Open: http://localhost:${PORT}\n`);
    runReminders(); dailyBackup();
    setInterval(runReminders, 60 * 60 * 1000).unref();
    setInterval(dailyBackup, 6 * 60 * 60 * 1000).unref();
  });
}
if (require.main === module) start();
app.start = start;
module.exports = app;
