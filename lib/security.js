const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./db');

/* ---------- password hashing (scrypt) ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [, saltHex, hashHex] = stored.split('$');
    const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  } catch { return false; }
}
// compared against when the email is unknown, so a wrong email takes as long as a wrong password
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (pw.length > 200) return 'Password is too long (max 200 characters).';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers.';
  return null;
}

/* ---------- vault encryption (AES-256-GCM) ----------
   Key comes from CRM_SECRET env var, or is generated once into data/.vault.key.
   BACK UP THAT FILE with the database - without it stored passwords cannot be decrypted. */
function loadKey() {
  if (process.env.CRM_SECRET) return crypto.createHash('sha256').update(process.env.CRM_SECRET).digest();
  const f = path.join(DATA_DIR, '.vault.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
}
const KEY = loadKey();
function encrypt(text) {
  if (text == null || text === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'v1.' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decrypt(blob) {
  if (!blob) return '';
  const raw = Buffer.from(blob.slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

/* ---------- sessions ---------- */
const SESSION_MS = 1000 * 60 * 60 * 12;      // 12 hours
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,ip,ua) VALUES(?,?,?,?,?)')
    .run(sha(token), userId, Date.now() + SESSION_MS, req.ip, String(req.headers['user-agent'] || '').slice(0, 200));
  return token;
}
function destroySession(token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token)); }
function destroyUserSessions(userId, exceptToken) {
  if (exceptToken) db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(userId, sha(exceptToken));
  else db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}
function userForToken(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(sha(token));
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  return row;
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 1000 * 60 * 30).unref();

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed cookie: ignore */ } }
  }
  return out;
}

/* ---------- login rate limiting ----------
   8 failures per IP+email, and 30 per IP across all emails, within 15 minutes. */
const WINDOW = 15 * 60 * 1000;
const LIMITS = { acct: 8, ip: 30 };
const attempts = new Map();
const blocked = (key, max) => { const a = attempts.get(key); return !!a && a.count >= max && Date.now() - a.first < WINDOW; };
function bump(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}
function tooManyAttempts(ip, email) { return blocked(`ip|${ip}`, LIMITS.ip) || blocked(`acct|${ip}|${email}`, LIMITS.acct); }
function recordAttempt(ip, email, ok) {
  if (ok) return attempts.delete(`acct|${ip}|${email}`);
  bump(`ip|${ip}`); bump(`acct|${ip}|${email}`);
}
setInterval(() => { const now = Date.now(); for (const [k, a] of attempts) if (now - a.first > WINDOW) attempts.delete(k); }, WINDOW).unref();

/* ---------- two-step login (TOTP, RFC 6238 — works with Google Authenticator, Authy, 1Password …) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  let bits = 0, val = 0; const out = [];
  for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function hotp(key, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const newTotpSecret = () => base32(crypto.randomBytes(20));
// returns the matching time step (accepts ±1 step of clock drift) or null; steps <= lastStep are refused (no replay)
function checkTotp(secretB32, code, lastStep = 0) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const key = unbase32(secretB32); const now = Math.floor(Date.now() / 30000);
  for (const step of [now - 1, now, now + 1]) {
    if (step > lastStep && crypto.timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code))) return step;
  }
  return null;
}

/* ---------- permissions ---------- */
// Extra flags a founder can switch on for an intern. Finance, invoices, quotations, renewals, vault, team and settings stay founder-only.
const INTERN_FLAGS = ['leads', 'clients', 'all_projects', 'maintenance'];

function flags(user) {
  try { return JSON.parse(user.modules || '[]'); } catch { return []; }
}
function isFounder(user) { return user.role === 'founder'; }
function hasFlag(user, f) { return isFounder(user) || (INTERN_FLAGS.includes(f) && flags(user).includes(f)); }

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, title: u.title, phone: u.phone,
    modules: flags(u).filter((f) => INTERN_FLAGS.includes(f)), must_change_password: !!u.must_change_password, two_factor: !!u.totp_enabled,
    active: !!u.active, last_login: u.last_login, created_at: u.created_at };
}

module.exports = {
  hashPassword, verifyPassword, passwordProblem, encrypt, decrypt, DUMMY_HASH,
  createSession, destroySession, destroyUserSessions, userForToken, parseCookies, SESSION_MS,
  tooManyAttempts, recordAttempt, newTotpSecret, checkTotp, hotp, unbase32,
  INTERN_FLAGS, flags, isFounder, hasFlag, publicUser,
};
