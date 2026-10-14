import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import { HttpError } from '../shared/errors';
import type { User } from '../security/permissions';
import type { Engine } from '../crud/engine';

export const STATUS_LABEL: Record<string, string> = { todo: 'To do', in_progress: 'In progress', review: 'Review', done: 'Done' };
export const taskKey = (id: number): string => `T-${id}`;
export const taskLink = (id: number): string => `/tasks?open=${id}`;

/** Teamwork on tasks: several people, watchers, history lines, notifications. */
export function createTaskDomain(ctx: AppContext, getEngine: () => Engine) {
  const { db } = ctx;
  const userName = (id: number): string => (db.prepare('SELECT name FROM users WHERE id=?').get(id) as { name: string } | undefined)?.name ?? 'someone';
  const niceDate = (d: string): string => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const assigneeIds = (taskId: number): number[] =>
    (db.prepare('SELECT user_id FROM task_assignees WHERE task_id=? ORDER BY rowid').all(taskId) as { user_id: number }[]).map((r) => r.user_id);
  const isAssignee = (taskId: number, userId: number): boolean => !!db.prepare('SELECT 1 FROM task_assignees WHERE task_id=? AND user_id=?').get(taskId, userId);
  const watch = (taskId: number, userId: number | null | undefined): void => {
    if (userId) db.prepare('INSERT OR IGNORE INTO task_watchers(task_id,user_id) VALUES(?,?)').run(taskId, userId);
  };

  function canSee(userId: number, taskId: number): boolean {
    const u = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(userId) as User | undefined;
    return !!(u && getEngine().scoped('tasks', taskId, u));
  }
  function history(taskId: number, u: Pick<User, 'id'>, text: string): void {
    db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES('task',?,?,'history',?)").run(taskId, u.id, text);
  }
  /** Everyone watching the task who can still open it, except whoever did the thing (and anyone told separately). */
  function notifyWatchers(taskId: number, actorId: number, text: string, skip: number[] = []): void {
    for (const { user_id: id } of db.prepare('SELECT user_id FROM task_watchers WHERE task_id=?').all(taskId) as { user_id: number }[]) {
      if (id !== actorId && !skip.includes(id) && canSee(id, taskId)) ctx.notify(id, text, taskLink(taskId));
    }
  }
  function cleanAssignees(list: unknown): number[] {
    const ids = [...new Set((Array.isArray(list) ? list : []).map((v) => Number.parseInt(String(v), 10)).filter(Number.isInteger))];
    if (ids.length > 20) throw new HttpError(400, 'A task can have at most 20 people.');
    for (const id of ids) if (!db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(id)) throw new HttpError(400, 'One of the people you picked is not an active team member.');
    return ids;
  }
  /** Writes the assignee changes of an update and reports a change history. */
  function syncAssignees(op: 'create' | 'update', row: Row, ids: number[] | undefined, actor: User): { added: number[]; removed: number[] } {
    if (!ids) return { added: [], removed: [] };
    const had = op === 'create' ? [] : assigneeIds(row.id);
    const added = ids.filter((i) => !had.includes(i));
    const removed = had.filter((i) => !ids.includes(i));
    for (const i of removed) db.prepare('DELETE FROM task_assignees WHERE task_id=? AND user_id=?').run(row.id, i);
    for (const i of added) {
      db.prepare('INSERT OR IGNORE INTO task_assignees(task_id,user_id) VALUES(?,?)').run(row.id, i);
      watch(row.id, i);
    }
    void actor;
    return { added, removed };
  }
  return { userName, niceDate, assigneeIds, isAssignee, watch, canSee, history, notifyWatchers, cleanAssignees, syncAssignees };
}
export type TaskDomain = ReturnType<typeof createTaskDomain>;
