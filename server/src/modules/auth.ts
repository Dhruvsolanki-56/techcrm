import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { check, kindFor } from '@crm/shared';
import type { AppContext } from '../core/context';
import { badRequest, HttpError, need } from '../shared/errors';
import { clearSessionCookie, parseCookies, SESSION_COOKIE, setSessionCookie } from '../http/cookies';
import { parse } from '../http/validate';
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from '../security/password';
import { publicUser, type User } from '../security/permissions';
import { checkTotp } from '../security/totp';

const setupBody = z.object({ name: z.string().trim().min(1, 'Name is required.'), email: z.string().trim().min(1, 'Email is required.'), password: z.string().min(1, 'Password is required.'), company_name: z.string().trim().optional() });
const loginBody = z.object({ email: z.string().trim().toLowerCase().max(200).default(''), password: z.string().max(200).default(''), code: z.union([z.string(), z.number()]).optional() });

/** Field rules shared with the browser: "Name cannot contain numbers" etc. */
export function ruleCheck(resource: string, values: Record<string, unknown>, labels: Record<string, string>): void {
  for (const [k, label] of Object.entries(labels)) {
    if (values[k] === undefined || values[k] === null) continue;
    const kind = kindFor(resource, k);
    if (!kind) continue;
    const msg = check(kind, typeof values[k] === 'string' ? (values[k] as string).trim() : values[k]);
    if (msg) throw badRequest(`${label} ${msg}.`);
  }
}

/** Public routes: who am I, first-time setup, sign in, sign out. */
export function authRoutes(ctx: AppContext): express.Router {
  const router = express.Router();
  const { db } = ctx;
  const maxAge = ctx.config.sessionMs / 1000;

  router.get('/state', (req: Request, res: Response) => {
    const count = (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
    const user = ctx.sessions.userFor(parseCookies(req)[SESSION_COOKIE]);
    const s = ctx.settings.get();
    res.json({ setup_needed: count === 0, user: user ? publicUser(user) : null, company_name: s.company_name, logo: s.logo, demo: ctx.config.demo });
  });

  router.post('/setup', (req: Request, res: Response) => {
    need((db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n === 0, 'Setup already completed.');
    const b = parse(setupBody, req.body);
    ruleCheck('users', b, { name: 'Name', email: 'Email' });
    const problem = passwordProblem(b.password);
    if (problem) throw badRequest(problem);
    const id = Number(db.prepare("INSERT INTO users(name,email,password_hash,role,title) VALUES(?,?,?, 'founder','Founder')").run(b.name, b.email.toLowerCase(), hashPassword(b.password)).lastInsertRowid);
    if (b.company_name) ctx.settings.set({ company_name: b.company_name });
    ctx.audit({ id, name: b.name }, 'setup', 'users', id, 'First founder account created', req.ip);
    setSessionCookie(req, res, ctx.sessions.create(id, req.ip, req.headers['user-agent']), maxAge);
    res.json({ ok: true });
  });

  router.post('/login', (req: Request, res: Response) => {
    const b = parse(loginBody, req.body);
    const ip = req.ip ?? 'unknown';
    if (ctx.limiter.tooMany(ip, b.email)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(b.email) as User | undefined;
    // always run one scrypt so unknown emails take as long as wrong passwords
    const pwOk = verifyPassword(b.password, u ? u.password_hash : DUMMY_HASH) && !!u && !!u.active;
    if (!pwOk || !u) {
      ctx.limiter.record(ip, b.email, false);
      ctx.audit(u ? { id: u.id, name: u.name } : null, 'login_failed', 'users', u?.id, b.email, ip);
      throw new HttpError(401, 'Invalid email or password.');
    }
    if (u.totp_enabled) {
      if (!b.code) {
        res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app.', need_code: true });
        return;
      }
      const step = checkTotp(ctx.vault.decrypt(u.totp_secret), b.code, u.totp_last);
      if (!step) {
        ctx.limiter.record(ip, b.email, false);
        ctx.audit(u, 'login_failed', 'users', u.id, 'wrong two-step code', ip);
        res.status(401).json({ error: 'That code is not valid. Check the time on your phone and try again.', need_code: true });
        return;
      }
      db.prepare('UPDATE users SET totp_last=? WHERE id=?').run(step, u.id);
    }
    ctx.limiter.record(ip, b.email, true);
    db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").run(u.id);
    ctx.audit(u, 'login', 'users', u.id, null, ip);
    setSessionCookie(req, res, ctx.sessions.create(u.id, ip, req.headers['user-agent']), maxAge);
    res.json({ ok: true, user: publicUser(u) });
  });

  router.post('/logout', (req: Request, res: Response) => {
    ctx.sessions.destroy(parseCookies(req)[SESSION_COOKIE]);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return router;
}
