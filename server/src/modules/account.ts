import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import type { AppContext } from '../core/context';
import { badRequest, need } from '../shared/errors';
import { parse } from '../http/validate';
import { hashPassword, passwordProblem, verifyPassword } from '../security/password';
import { publicUser, type User } from '../security/permissions';
import { checkTotp, newTotpSecret } from '../security/totp';

const changePassword = z.object({ current: z.string().default(''), next: z.string().default('') });
const passwordOnly = z.object({ password: z.string().default('') });
const codeOnly = z.object({ code: z.union([z.string(), z.number()]).optional() });

/** The signed-in person's own account: profile, password, two-step login. */
export function accountRoutes(ctx: AppContext): express.Router {
  const router = express.Router();
  const { db } = ctx;
  const me = (req: Request): User => req.user as User;

  router.get('/me', (req: Request, res: Response) => {
    res.json(publicUser(me(req)));
  });

  router.post('/password', (req: Request, res: Response) => {
    const { current, next } = parse(changePassword, req.body);
    const u = me(req);
    need(verifyPassword(current, u.password_hash), 'Current password is incorrect.');
    const problem = passwordProblem(next);
    if (problem) throw badRequest(problem);
    need(next !== current, 'The new password must be different from the current one.');
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hashPassword(next), u.id);
    ctx.sessions.destroyForUser(u.id, req.sessionToken); // sign out every other device
    ctx.audit(u, 'password_change', 'users', u.id, null, req.ip);
    res.json({ ok: true });
  });

  router.post('/2fa/setup', (req: Request, res: Response) => {
    const u = me(req);
    need(!u.totp_enabled, 'Two-step login is already on. Turn it off first to set up a new phone.');
    need(verifyPassword(parse(passwordOnly, req.body).password, u.password_hash), 'Password is incorrect.');
    const secret = newTotpSecret();
    db.prepare('UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=?').run(ctx.vault.encrypt(secret), u.id);
    const company = ctx.settings.get().company_name || 'CRM';
    const label = encodeURIComponent(`${company}:${u.email}`);
    res.json({ secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(company)}&digits=6&period=30` });
  });

  router.post('/2fa/enable', (req: Request, res: Response) => {
    const u = me(req);
    need(u.totp_secret && !u.totp_enabled, 'Start the setup first.');
    const step = checkTotp(ctx.vault.decrypt(u.totp_secret), parse(codeOnly, req.body).code, 0);
    need(step, 'That code is not valid. Type the 6 digits currently shown in the app.');
    db.prepare('UPDATE users SET totp_enabled=1, totp_last=? WHERE id=?').run(step, u.id);
    ctx.sessions.destroyForUser(u.id, req.sessionToken);
    ctx.audit(u, '2fa_on', 'users', u.id, null, req.ip);
    res.json({ ok: true });
  });

  router.post('/2fa/disable', (req: Request, res: Response) => {
    const u = me(req);
    need(verifyPassword(parse(passwordOnly, req.body).password, u.password_hash), 'Password is incorrect.');
    db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last=0 WHERE id=?').run(u.id);
    ctx.audit(u, '2fa_off', 'users', u.id, null, req.ip);
    res.json({ ok: true });
  });

  return router;
}
