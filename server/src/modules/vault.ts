import express, { type Request, type Response } from 'express';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import { badRequest, notFound, need } from '../shared/errors';
import { founderOnly } from '../http/middleware';
import { intOrNull, str } from '../http/validate';
import type { User } from '../security/permissions';

const SELECT = 'SELECT cr.*, c.company AS client_name, p.name AS project_name FROM credentials cr LEFT JOIN clients c ON c.id=cr.client_id LEFT JOIN projects p ON p.id=cr.project_id';

/** Server and account credentials for clients / projects. Passwords are encrypted at rest and every reveal is written to the activity log. */
export function vaultRoutes(ctx: AppContext): express.Router {
  const router = express.Router();
  const { db } = ctx;
  router.use(founderOnly);
  const user = (req: Request): User => req.user as User;
  const get = (id: unknown): Row => {
    const r = db.prepare('SELECT * FROM credentials WHERE id=?').get(Number(id)) as Row | undefined;
    if (!r) throw notFound('Not found');
    return r;
  };
  /** Never sends the password or secret itself — only whether one is stored. */
  const present = (r: Row) => ({
    id: r.id, client_id: r.client_id, project_id: r.project_id, label: r.label, kind: r.kind, url: r.url, username: r.username, notes: r.notes,
    has_password: !!r.password_enc, has_secret: !!r.secret_enc, client_name: r.client_name, project_name: r.project_name, updated_at: r.updated_at,
  });

  router.get('/', (req: Request, res: Response) => {
    let sql = `${SELECT} WHERE 1=1`;
    const params: unknown[] = [];
    if (req.query.client_id) { sql += ' AND cr.client_id=?'; params.push(String(req.query.client_id)); }
    if (req.query.project_id) { sql += ' AND cr.project_id=?'; params.push(String(req.query.project_id)); }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      sql += " AND (cr.label LIKE ? ESCAPE '\\' OR cr.url LIKE ? ESCAPE '\\' OR cr.username LIKE ? ESCAPE '\\' OR c.company LIKE ? ESCAPE '\\')";
      params.push(like, like, like, like);
    }
    res.json((db.prepare(`${sql} ORDER BY c.company COLLATE NOCASE, cr.label`).all(...params) as Row[]).map(present));
  });

  function save(req: Request, res: Response, existing: Row | null): void {
    const b = (req.body ?? {}) as Record<string, unknown>;
    need(str(b.label), 'Label is required.');
    need(intOrNull(b.client_id) || intOrNull(b.project_id), 'Link this to a client or a project.');
    const projectId = intOrNull(b.project_id);
    let clientId = intOrNull(b.client_id);
    if (!clientId && projectId) clientId = ((db.prepare('SELECT client_id FROM projects WHERE id=?').get(projectId) as Row | undefined)?.client_id as number | null) ?? null;
    const pw = b.password === undefined ? existing?.password_enc : ctx.vault.encrypt(String(b.password));
    const secret = b.secret === undefined ? existing?.secret_enc : ctx.vault.encrypt(String(b.secret));
    if (existing) {
      db.prepare("UPDATE credentials SET client_id=?,project_id=?,label=?,kind=?,url=?,username=?,password_enc=?,secret_enc=?,notes=?,updated_at=datetime('now') WHERE id=?")
        .run(clientId, projectId, str(b.label), str(b.kind), str(b.url, 1000), str(b.username), pw || null, secret || null, str(b.notes, 5000), existing.id);
      ctx.audit(user(req), 'update', 'credentials', existing.id, str(b.label), req.ip);
      res.json(present(db.prepare(`${SELECT} WHERE cr.id=?`).get(existing.id) as Row));
      return;
    }
    const id = Number(db.prepare('INSERT INTO credentials(client_id,project_id,label,kind,url,username,password_enc,secret_enc,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(clientId, projectId, str(b.label), str(b.kind), str(b.url, 1000), str(b.username), pw || null, secret || null, str(b.notes, 5000), user(req).id).lastInsertRowid);
    ctx.audit(user(req), 'create', 'credentials', id, str(b.label), req.ip);
    res.status(201).json(present(db.prepare(`${SELECT} WHERE cr.id=?`).get(id) as Row));
  }

  router.post('/', (req: Request, res: Response) => save(req, res, null));
  router.put('/:id', (req: Request, res: Response) => save(req, res, get(req.params.id)));
  router.post('/:id/reveal', (req: Request, res: Response) => {
    const r = get(req.params.id);
    ctx.audit(user(req), 'vault_reveal', 'credentials', r.id, r.label, req.ip);
    res.json({ password: ctx.vault.decrypt(r.password_enc), secret: ctx.vault.decrypt(r.secret_enc) });
  });
  router.delete('/:id', (req: Request, res: Response) => {
    const r = get(req.params.id);
    db.prepare('DELETE FROM credentials WHERE id=?').run(r.id);
    ctx.audit(user(req), 'delete', 'credentials', r.id, r.label, req.ip);
    res.json({ ok: true });
  });
  void badRequest;
  return router;
}
