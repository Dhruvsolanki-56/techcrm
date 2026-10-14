import express, { type Request, type Response } from 'express';
import { INTERN_FLAGS, ROLES } from '@crm/shared';
import type { AppContext } from '../core/context';
import { badRequest, conflict, HttpError, need, notFound } from '../shared/errors';
import { founderOnly } from '../http/middleware';
import { str } from '../http/validate';
import { hashPassword, passwordProblem } from '../security/password';
import { flagsOf, publicUser, type User } from '../security/permissions';
import { linkPeople } from '../domain/people';
import { ruleCheck } from './auth';

/** Team management (founders only): add, edit, reset password, deactivate, remove. */
export function userRoutes(ctx: AppContext): express.Router {
  const router = express.Router();
  const { db } = ctx;
  router.use(founderOnly);
  const get = (id: unknown): User => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(Number(id)) as User | undefined;
    if (!u) throw new HttpError(404, 'User not found');
    return u;
  };
  const cleanFlags = (v: unknown): string[] => (Array.isArray(v) ? v.filter((m): m is string => (INTERN_FLAGS as readonly string[]).includes(m as string)) : []);

  router.get('/', (_req: Request, res: Response) => {
    res.json((db.prepare('SELECT * FROM users ORDER BY active DESC, role, name').all() as User[]).map(publicUser));
  });

  router.post('/', (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    ruleCheck('users', b, { name: 'Name', email: 'Email', phone: 'Phone' });
    need(b.name && b.email && b.password, 'Name, email and a temporary password are required.');
    const problem = passwordProblem(b.password);
    if (problem) throw badRequest(problem);
    need((ROLES as readonly string[]).includes(String(b.role)), 'Role must be founder or intern.');
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(String(b.email).trim().toLowerCase())) throw conflict('A user with this email already exists.');
    const id = Number(db.prepare('INSERT INTO users(name,email,password_hash,role,modules,title,phone,must_change_password) VALUES(?,?,?,?,?,?,?,?)')
      .run(String(b.name).trim(), String(b.email).trim().toLowerCase(), hashPassword(String(b.password)), b.role, JSON.stringify(cleanFlags(b.modules)), str(b.title), str(b.phone), b.keep_password ? 0 : 1).lastInsertRowid);
    ctx.audit(req.user as User, 'create', 'users', id, `${b.name} (${b.role})`, req.ip);
    const linked = linkPeople(ctx);
    res.status(201).json({ ...publicUser(get(id)), linked });
  });

  router.put('/:id', (req: Request, res: Response) => {
    const u = get(req.params.id);
    const actor = req.user as User;
    const b = (req.body ?? {}) as Record<string, unknown>;
    ruleCheck('users', b, { name: 'Name', email: 'Email', phone: 'Phone' });
    const role = String(b.role ?? u.role);
    need((ROLES as readonly string[]).includes(role), 'Invalid role.');
    const active = b.active === undefined ? u.active : b.active ? 1 : 0;
    const otherFounders = (db.prepare("SELECT COUNT(*) n FROM users WHERE role='founder' AND active=1 AND id<>?").get(u.id) as { n: number }).n;
    if ((role !== 'founder' || !active) && u.role === 'founder' && otherFounders === 0) throw badRequest('You need at least one active founder account.');
    if (u.id === actor.id && !active) throw badRequest('You cannot deactivate your own account.');
    const mods = Array.isArray(b.modules) ? cleanFlags(b.modules) : flagsOf(u);
    db.prepare('UPDATE users SET name=?, email=?, role=?, modules=?, title=?, phone=?, active=? WHERE id=?')
      .run(str(b.name) ?? u.name, (str(b.email) ?? u.email).toLowerCase(), role, JSON.stringify(mods), b.title === undefined ? u.title : str(b.title), b.phone === undefined ? u.phone : str(b.phone), active, u.id);
    if (b.password) {
      const problem = passwordProblem(b.password);
      if (problem) throw badRequest(problem);
      db.prepare('UPDATE users SET password_hash=?, must_change_password=? WHERE id=?').run(hashPassword(String(b.password)), b.keep_password ? 0 : 1, u.id);
      ctx.sessions.destroyForUser(u.id);
      ctx.audit(actor, 'password_reset', 'users', u.id, u.name, req.ip);
    }
    if (!active) ctx.sessions.destroyForUser(u.id);
    if (b.reset_2fa && u.totp_enabled) {
      // lost phone: a founder switches two-step login off for them
      db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last=0 WHERE id=?').run(u.id);
      ctx.sessions.destroyForUser(u.id);
      ctx.audit(actor, '2fa_reset', 'users', u.id, u.name, req.ip);
    }
    ctx.audit(actor, 'update', 'users', u.id, `${u.name} → role ${role}, access: ${mods.join(',') || 'standard'}`, req.ip);
    res.json(publicUser(get(u.id)));
  });

  /** Removes a person completely. Their tasks, notes and records stay (they just lose the name); use Deactivate to keep them listed. */
  router.delete('/:id', (req: Request, res: Response) => {
    const u = get(req.params.id);
    const actor = req.user as User;
    if (u.id === actor.id) throw badRequest('You cannot remove your own account.');
    const otherFounders = (db.prepare("SELECT COUNT(*) n FROM users WHERE role='founder' AND active=1 AND id<>?").get(u.id) as { n: number }).n;
    if (u.role === 'founder' && u.active && otherFounders === 0) throw badRequest('You need at least one active founder account.');
    db.transaction(() => {
      ctx.sessions.destroyForUser(u.id);
      db.prepare('DELETE FROM users WHERE id=?').run(u.id);
    })();
    ctx.audit(actor, 'delete', 'users', u.id, `${u.name} (${u.role})`, req.ip);
    res.json({ ok: true });
  });

  void notFound;
  return router;
}
