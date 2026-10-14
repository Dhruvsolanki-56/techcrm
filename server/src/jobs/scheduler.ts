import fs from 'node:fs';
import path from 'node:path';
import { addDays, today } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import { markOverdue } from '../domain/billing';
import { runAutoDebits } from './autoDebit';

/** One notification per person per day for the same thing (the jobs run hourly). */
function once(ctx: AppContext, userId: number, text: string, link: string): void {
  const dup = ctx.db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND text=? AND date(at)=date('now','localtime')").get(userId, text);
  if (!dup) ctx.notify(userId, text, link);
}

/** Daily reminders as in-app notifications. */
export function runReminders(ctx: AppContext): void {
  const { db } = ctx;
  markOverdue(ctx);
  const t = today();
  const tomorrow = addDays(t, 1);
  for (const r of db.prepare("SELECT * FROM tasks WHERE status<>'done' AND assignee_id IS NOT NULL AND due_date<=?").all(tomorrow) as Row[]) {
    once(ctx, r.assignee_id, r.due_date < t ? `Overdue task: ${r.title}` : `Task due ${r.due_date === t ? 'today' : 'tomorrow'}: ${r.title}`, `/tasks?open=${r.id}`);
  }
  const founders = db.prepare("SELECT id FROM users WHERE role='founder' AND active=1").all() as { id: number }[];
  for (const r of db.prepare("SELECT * FROM renewals WHERE status='active' AND auto_debit=0 AND renewal_date IS NOT NULL AND renewal_date<=?").all(addDays(t, 14)) as Row[]) {
    for (const f of founders) once(ctx, f.id, `Renewal ${r.renewal_date < t ? 'overdue' : `due ${r.renewal_date}`}: ${r.name}`, '/renewals');
  }
  for (const r of db.prepare("SELECT number, id FROM invoices WHERE status='overdue'").all() as { number: string; id: number }[]) {
    for (const f of founders) once(ctx, f.id, `Invoice overdue: ${r.number}`, `/invoices/${r.id}`);
  }
  // change requests nobody has estimated for three days
  for (const r of db.prepare("SELECT id, title FROM change_requests WHERE status='requested' AND requested_on<=?").all(addDays(t, -3)) as { id: number; title: string }[]) {
    for (const f of founders) once(ctx, f.id, `Change request waiting for an estimate: ${r.title}`, '/change-requests');
  }
  for (const r of db.prepare("SELECT * FROM leads WHERE stage NOT IN ('won','closed','lost') AND next_followup IS NOT NULL AND next_followup<=? AND owner_id IS NOT NULL").all(t) as Row[]) {
    once(ctx, r.owner_id, `Follow up with lead: ${r.name}`, `/leads/${r.id}`);
  }
  db.prepare("DELETE FROM notifications WHERE at < datetime('now','-60 days')").run();
}

/** A copy of the database every day; only the newest N are kept. */
export async function dailyBackup(ctx: AppContext): Promise<void> {
  const file = path.join(ctx.config.backupDir, `auto-${today()}.db`);
  if (fs.existsSync(file)) return;
  await ctx.db.backup(file);
  const olds = fs.readdirSync(ctx.config.backupDir).filter((n) => n.startsWith('auto-')).sort();
  while (olds.length > ctx.config.backupKeep) fs.unlinkSync(path.join(ctx.config.backupDir, olds.shift() as string));
  ctx.log.info({ file: path.basename(file) }, 'backup saved');
}

/** Starts the hourly jobs; returns a function that stops them (graceful shutdown). */
export function startJobs(ctx: AppContext): () => void {
  const safe = (name: string, fn: () => void | Promise<void>) => async (): Promise<void> => {
    try { await fn(); } catch (err) { ctx.log.error({ err, job: name }, 'background job failed'); }
  };
  const jobs = [
    safe('auto-debit', () => { const done = runAutoDebits(ctx); if (done.length) ctx.log.info({ recorded: done.length }, 'recurring expenses recorded'); }),
    safe('reminders', () => runReminders(ctx)),
    safe('backup', () => dailyBackup(ctx)),
    safe('sessions', () => { ctx.sessions.purgeExpired(); ctx.limiter.sweep(); }),
  ];
  for (const j of jobs) void j();
  const timers = [setInterval(() => { void jobs[0]?.(); void jobs[1]?.(); void jobs[3]?.(); }, 60 * 60 * 1000), setInterval(() => void jobs[2]?.(), 6 * 60 * 60 * 1000)];
  for (const t of timers) t.unref();
  return () => timers.forEach(clearInterval);
}
