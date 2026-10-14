import express, { type Request, type Response } from 'express';
import { FOLLOWUP_ROUNDS, validDate, today, values } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import type { Engine } from '../crud/engine';
import type { TaskDomain } from '../domain/tasks';
import { taskKey, taskLink } from '../domain/tasks';
import { badRequest, forbidden, HttpError, need, notFound } from '../shared/errors';
import { founderOnly } from '../http/middleware';
import { intOrNull, str } from '../http/validate';
import { isFounder, type User } from '../security/permissions';

const NOTE_ENTITIES: Record<string, string> = {
  lead: 'leads', client: 'clients', project: 'projects', task: 'tasks', invoice: 'invoices', quote: 'quotes', maintenance: 'maintenance_logs', change_request: 'change_requests',
};
const NOTE_KINDS = ['note', 'call', 'meeting', 'email', 'whatsapp', 'visit', 'demo', 'proposal'];
const NOTE_SELECT = 'SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id=n.user_id';

/** Notes & timelines, task checklists and watchers, notifications, project team. */
export function collabRoutes(ctx: AppContext, engine: Engine, tasks: TaskDomain): express.Router {
  const router = express.Router();
  const { db } = ctx;
  const user = (req: Request): User => req.user as User;
  const one = (sql: string, ...p: unknown[]): Row | undefined => db.prepare(sql).get(...p) as Row | undefined;

  function noteAccess(req: Request, type: unknown, id: number | null): void {
    need(typeof type === 'string', 'Unknown entity.');
    const resName = Object.hasOwn(NOTE_ENTITIES, type) ? NOTE_ENTITIES[type] : undefined;
    need(resName && id, 'Unknown entity.');
    if (!engine.scoped(resName, id, user(req))) throw forbidden();
  }

  /* ---------- notes / timeline ---------- */
  router.get('/notes', (req: Request, res: Response) => {
    const id = intOrNull(req.query.entity_id);
    noteAccess(req, req.query.entity_type, id);
    res.json(db.prepare(`${NOTE_SELECT} WHERE entity_type=? AND entity_id=? ORDER BY n.created_at DESC, n.id DESC`).all(req.query.entity_type, id));
  });

  router.post('/notes', (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = intOrNull(b.entity_id);
    const type = String(b.entity_type);
    noteAccess(req, type, id);
    need(b.body && String(b.body).trim(), 'Write something first.');
    const u = user(req);
    const kind = NOTE_KINDS.includes(String(b.kind)) ? String(b.kind) : 'note';
    // @mentions only count for people who can open the task (nobody gets pinged about something they cannot see)
    let mentioned: { id: number; name: string }[] = [];
    if (type === 'task' && Array.isArray(b.mentions)) {
      const ids = [...new Set(b.mentions.map((v) => Number.parseInt(String(v), 10)).filter(Number.isInteger))].slice(0, 20);
      mentioned = ids.filter((uid) => uid !== u.id && tasks.canSee(uid, id as number)).map((uid) => one('SELECT id, name FROM users WHERE id=?', uid) as { id: number; name: string });
    }
    const round = type === 'lead' && (values(FOLLOWUP_ROUNDS) as string[]).includes(String(b.followup_round)) ? String(b.followup_round) : null;
    const nextF = type === 'lead' && b.next_followup ? String(b.next_followup) : null;
    need(!nextF || validDate(nextF), 'Next Follow-Up Date must be a real date.');
    const nid = Number(db.prepare('INSERT INTO notes(entity_type,entity_id,user_id,kind,body,mentions,followup_round,next_followup) VALUES(?,?,?,?,?,?,?,?)')
      .run(type, id, u.id, kind, String(b.body).trim().slice(0, 10_000), mentioned.length ? JSON.stringify(mentioned) : null, round, nextF).lastInsertRowid);
    // talking to a lead (call, WhatsApp, visit …) moves its "last contact" date; a follow-up date set here becomes the lead's next follow-up
    if (type === 'lead' && kind !== 'note') db.prepare('UPDATE leads SET last_contact=? WHERE id=? AND (last_contact IS NULL OR last_contact<?)').run(today(), id, today());
    if (type === 'task') {
      const t = one('SELECT title FROM tasks WHERE id=?', id) as { title: string };
      tasks.watch(id as number, u.id);
      for (const m of mentioned) {
        tasks.watch(id as number, m.id);
        ctx.notify(m.id, `${u.name} mentioned you on ${taskKey(id as number)}: ${t.title}`, taskLink(id as number));
      }
      tasks.notifyWatchers(id as number, u.id, `${u.name} commented on ${taskKey(id as number)}: ${t.title}`, mentioned.map((m) => m.id));
    }
    res.status(201).json(one(`${NOTE_SELECT} WHERE n.id=?`, nid));
  });

  // fix a typo in your own comment (the thread shows it was edited)
  router.put('/notes/:id', (req: Request, res: Response) => {
    const n = one('SELECT * FROM notes WHERE id=?', req.params.id);
    if (!n) throw notFound('Not found');
    noteAccess(req, n.entity_type, n.entity_id);
    if (n.user_id !== user(req).id || ['system', 'history'].includes(n.kind)) throw forbidden();
    const body = str((req.body ?? {}).body, 10_000);
    need(body, 'Write something first.');
    db.prepare("UPDATE notes SET body=?, edited_at=datetime('now') WHERE id=?").run(body, n.id);
    res.json(one(`${NOTE_SELECT} WHERE n.id=?`, n.id));
  });

  router.delete('/notes/:id', (req: Request, res: Response) => {
    const n = one('SELECT * FROM notes WHERE id=?', req.params.id);
    if (!n) throw notFound('Not found');
    if (n.kind === 'history') throw forbidden(); // the task's history is a record, not a comment
    if (!(isFounder(user(req)) || (n.user_id === user(req).id && n.kind !== 'system'))) throw forbidden();
    db.prepare('DELETE FROM notes WHERE id=?').run(n.id);
    res.json({ ok: true });
  });

  /* ---------- task teamwork: checklist, watchers, who can be @mentioned ---------- */
  function taskFor(req: Request, write: boolean): Row {
    const hit = engine.scoped('tasks', String(req.params.id), user(req));
    if (!hit) throw new HttpError(404, 'Not found (or you do not have access).');
    const t = hit.row;
    // changing the checklist is for the people on the task (and founders); project teammates can read and comment
    if (write && !(isFounder(user(req)) || t.created_by === user(req).id || tasks.isAssignee(t.id, user(req).id))) throw forbidden();
    return t;
  }
  const checklistOf = (tid: number): Row[] => db.prepare(`SELECT c.*, a.name AS assignee_name, d.name AS done_by_name FROM task_checklist c
    LEFT JOIN users a ON a.id=c.assignee_id LEFT JOIN users d ON d.id=c.done_by WHERE c.task_id=? ORDER BY c.position, c.id`).all(tid) as Row[];
  function checkAssignee(t: Row, v: unknown): number | null {
    const id = intOrNull(v);
    if (id === null) return null;
    need(tasks.isAssignee(t.id, id), 'Checklist items can only go to people on this task.');
    return id;
  }

  router.get('/tasks/:id/collab', (req: Request, res: Response) => {
    const t = taskFor(req, false);
    const watchers = db.prepare('SELECT u.id, u.name FROM task_watchers w JOIN users u ON u.id=w.user_id WHERE w.task_id=? AND u.active=1 ORDER BY u.name').all(t.id) as { id: number; name: string }[];
    const people = (db.prepare('SELECT id, name, title, role FROM users WHERE active=1 ORDER BY name').all() as { id: number }[]).filter((p) => tasks.canSee(p.id, t.id));
    res.json({
      checklist: checklistOf(t.id), watchers, watching: watchers.some((w) => w.id === user(req).id), people,
      can_edit: isFounder(user(req)) || t.created_by === user(req).id || tasks.isAssignee(t.id, user(req).id),
    });
  });

  router.post('/tasks/:id/watch', (req: Request, res: Response) => {
    const t = taskFor(req, false);
    const on = (req.body ?? {}).on !== false;
    if (!on) db.prepare('DELETE FROM task_watchers WHERE task_id=? AND user_id=?').run(t.id, user(req).id);
    else tasks.watch(t.id, user(req).id);
    res.json({ watching: on });
  });

  router.post('/tasks/:id/checklist', (req: Request, res: Response) => {
    const t = taskFor(req, true);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const text = str(b.text, 300);
    need(text, 'Write what needs doing.');
    need((one('SELECT COUNT(*) n FROM task_checklist WHERE task_id=?', t.id) as { n: number }).n < 100, 'A checklist can have up to 100 items.');
    const assignee = checkAssignee(t, b.assignee_id);
    const pos = (one('SELECT COALESCE(MAX(position),0)+1 p FROM task_checklist WHERE task_id=?', t.id) as { p: number }).p;
    db.prepare('INSERT INTO task_checklist(task_id,text,assignee_id,position,created_by) VALUES(?,?,?,?,?)').run(t.id, text, assignee, pos, user(req).id);
    if (assignee && assignee !== user(req).id) ctx.notify(assignee, `${user(req).name} gave you a checklist item on ${taskKey(t.id)}: ${text}`, taskLink(t.id));
    res.status(201).json(checklistOf(t.id));
  });

  router.put('/tasks/:id/checklist/:cid', (req: Request, res: Response) => {
    const t = taskFor(req, true);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const c = one('SELECT * FROM task_checklist WHERE id=? AND task_id=?', req.params.cid, t.id);
    if (!c) throw notFound('Not found');
    if ('text' in b) {
      const text = str(b.text, 300);
      need(text, 'Write what needs doing.');
      db.prepare('UPDATE task_checklist SET text=? WHERE id=?').run(text, c.id);
    }
    if ('assignee_id' in b) {
      const a = checkAssignee(t, b.assignee_id);
      db.prepare('UPDATE task_checklist SET assignee_id=? WHERE id=?').run(a, c.id);
      if (a && a !== c.assignee_id && a !== user(req).id) ctx.notify(a, `${user(req).name} gave you a checklist item on ${taskKey(t.id)}: ${c.text}`, taskLink(t.id));
    }
    if ('done' in b) {
      const done = b.done === true || b.done === 1;
      db.prepare("UPDATE task_checklist SET done=?, done_by=?, done_at=CASE WHEN ? THEN datetime('now') END WHERE id=?").run(done ? 1 : 0, done ? user(req).id : null, done ? 1 : 0, c.id);
    }
    res.json(checklistOf(t.id));
  });

  router.delete('/tasks/:id/checklist/:cid', (req: Request, res: Response) => {
    const t = taskFor(req, true);
    const r = db.prepare('DELETE FROM task_checklist WHERE id=? AND task_id=?').run(req.params.cid, t.id);
    if (!r.changes) throw notFound('Not found');
    res.json(checklistOf(t.id));
  });

  /* ---------- notifications ---------- */
  router.get('/notifications', (req: Request, res: Response) => {
    res.json({
      unread: (one('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', user(req).id) as { n: number }).n,
      items: db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(user(req).id),
    });
  });
  router.post('/notifications/read', (req: Request, res: Response) => {
    db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(user(req).id);
    res.json({ ok: true });
  });

  /* ---------- project team ---------- */
  router.put('/projects/:id/members', founderOnly, (req: Request, res: Response) => {
    const pid = Number(req.params.id);
    const p = one('SELECT * FROM projects WHERE id=?', pid);
    if (!p) throw notFound('Project not found');
    const ids = [...new Set(((req.body ?? {}).user_ids ?? []).map(Number).filter(Number.isInteger))] as number[];
    const existing = (db.prepare('SELECT user_id FROM project_members WHERE project_id=?').all(pid) as { user_id: number }[]).map((r) => r.user_id);
    db.transaction(() => {
      db.prepare('DELETE FROM project_members WHERE project_id=?').run(pid);
      for (const uid of ids) db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(pid, uid);
    })();
    for (const uid of ids) if (!existing.includes(uid) && uid !== user(req).id) ctx.notify(uid, `You were added to project: ${p.name}`, `/projects/${pid}`);
    ctx.audit(user(req), 'update', 'projects', pid, `Team updated (${ids.length} members)`, req.ip);
    res.json({ ok: true });
  });
  router.get('/projects/:id/members', (req: Request, res: Response) => {
    if (!engine.scoped('projects', String(req.params.id), user(req))) throw forbidden();
    res.json(db.prepare('SELECT u.id, u.name, u.title, u.role FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=? ORDER BY u.name').all(req.params.id));
  });

  void badRequest;
  return router;
}
