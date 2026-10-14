import { addDays, lastMonths, round2, today } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import type { User } from '../security/permissions';
import { isFounder } from '../security/permissions';
import { visibleProjectIds } from '../domain/access';

/** How the work is going: projects, change requests (and their money), tasks, support tickets and who carries the load. */
export function deliveryAnalytics(ctx: AppContext, user: User): Row {
  const { db } = ctx;
  const all = (sql: string, ...p: unknown[]): Row[] => db.prepare(sql).all(...p) as Row[];
  const one = (sql: string, ...p: unknown[]): Row => db.prepare(sql).get(...p) as Row;
  const t = today();
  const founder = isFounder(user);
  const ids = visibleProjectIds(ctx, user);
  const scopeP = ids === null ? '1=1' : `p.id IN (${ids.length ? ids.join(',') : 'NULL'})`;
  const scopeCR = ids === null ? '1=1' : `cr.project_id IN (${ids.length ? ids.join(',') : 'NULL'})`;
  const scopeT = ids === null ? '1=1' : `(t.project_id IN (${ids.length ? ids.join(',') : 'NULL'}) OR t.assignee_id=${user.id})`;

  const projectsByStatus = all(`SELECT p.status k, COUNT(*) n FROM projects p WHERE ${scopeP} GROUP BY p.status ORDER BY n DESC`);
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = new Date();
    end.setDate(end.getDate() - 7 * (7 - i));
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const iso = (d: Date): string => d.toISOString().slice(0, 10);
    return { start: iso(start), end: iso(end) };
  });
  const doneByWeek = weeks.map((w) => ({
    week: w.start, done: (one(`SELECT COUNT(*) n FROM tasks t WHERE t.status='done' AND date(t.completed_at) BETWEEN ? AND ? AND ${scopeT}`, w.start, w.end).n as number),
    created: (one(`SELECT COUNT(*) n FROM tasks t WHERE date(t.created_at) BETWEEN ? AND ? AND ${scopeT}`, w.start, w.end).n as number),
  }));
  const crMonthsKeys = lastMonths(6);
  const crByMonth = Object.fromEntries(all(`SELECT strftime('%Y-%m', cr.requested_on) m, COUNT(*) n FROM change_requests cr WHERE cr.requested_on>=? AND ${scopeCR} GROUP BY m`, `${crMonthsKeys[0]}-01`).map((r) => [r.m, r.n]));
  const crMoney = founder
    ? one(`SELECT
        COALESCE(SUM(CASE WHEN cr.billable=1 AND cr.status IN ('requested','estimated') THEN cr.estimate_amount END),0) AS awaiting_quote,
        COALESCE(SUM(CASE WHEN cr.billable=1 AND cr.status='quoted' THEN cr.estimate_amount END),0) AS quoted,
        COALESCE(SUM(CASE WHEN cr.billable=1 AND cr.status IN ('approved','in_progress','delivered') THEN cr.estimate_amount END),0) AS approved,
        COALESCE(SUM(CASE WHEN i.id IS NOT NULL THEN i.paid_amount END),0) AS collected
      FROM change_requests cr LEFT JOIN invoices i ON i.id=cr.invoice_id WHERE ${scopeCR}`)
    : undefined;
  const crOpen = one(`SELECT COUNT(*) n FROM change_requests cr WHERE cr.status IN ('requested','estimated','quoted','approved','in_progress') AND ${scopeCR}`).n as number;
  const approvalDays = one(`SELECT AVG(julianday(cr.approved_on) - julianday(cr.requested_on)) d FROM change_requests cr WHERE cr.approved_on IS NOT NULL AND cr.requested_on IS NOT NULL AND ${scopeCR}`).d as number | null;

  return {
    today: t,
    projects: {
      by_status: projectsByStatus,
      total: projectsByStatus.reduce((s, r) => s + r.n, 0),
      deadlines: all(`SELECT p.id, p.name, p.code, p.deadline, p.status, c.company client_name FROM projects p LEFT JOIN clients c ON c.id=p.client_id
        WHERE p.status IN ('planning','active','review','at_risk') AND p.deadline IS NOT NULL AND p.deadline<=? AND ${scopeP} ORDER BY p.deadline LIMIT 10`, addDays(t, 30)),
      at_risk: all(`SELECT p.id, p.name, p.code, p.status, p.deadline FROM projects p WHERE (p.status='at_risk' OR (p.deadline IS NOT NULL AND p.deadline<? AND p.status IN ('planning','active','review'))) AND ${scopeP} ORDER BY p.deadline LIMIT 10`, t),
      progress: all(`SELECT p.id, p.name, p.status, (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS total, (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status='done') AS done
        FROM projects p WHERE p.status IN ('planning','active','review','at_risk') AND ${scopeP} ORDER BY p.created_at DESC LIMIT 8`),
    },
    change_requests: {
      open: crOpen,
      by_status: all(`SELECT cr.status k, COUNT(*) n FROM change_requests cr WHERE ${scopeCR} GROUP BY cr.status ORDER BY n DESC`),
      by_phase: all(`SELECT cr.phase k, COUNT(*) n FROM change_requests cr WHERE ${scopeCR} GROUP BY cr.phase`),
      by_kind: all(`SELECT cr.kind k, COUNT(*) n FROM change_requests cr WHERE ${scopeCR} GROUP BY cr.kind`),
      monthly: crMonthsKeys.map((m) => ({ month: m, requested: crByMonth[m] || 0 })),
      avg_days_to_approval: approvalDays === null ? null : Math.round(approvalDays * 10) / 10,
      money: crMoney ? Object.fromEntries(Object.entries(crMoney).map(([k, v]) => [k, round2(v as number)])) : undefined,
      needs_action: all(`SELECT cr.id, cr.title, cr.status, cr.phase, p.name AS project_name, cr.requested_on FROM change_requests cr JOIN projects p ON p.id=cr.project_id
        WHERE cr.status IN ('requested','estimated') AND ${scopeCR} ORDER BY cr.requested_on LIMIT 8`),
    },
    tasks: {
      by_status: all(`SELECT t.status k, COUNT(*) n FROM tasks t WHERE ${scopeT} GROUP BY t.status`),
      overdue: one(`SELECT COUNT(*) n FROM tasks t WHERE t.status<>'done' AND t.due_date<? AND ${scopeT}`, t).n,
      due_this_week: one(`SELECT COUNT(*) n FROM tasks t WHERE t.status<>'done' AND t.due_date BETWEEN ? AND ? AND ${scopeT}`, t, addDays(t, 7)).n,
      weekly: doneByWeek,
    },
    maintenance: {
      open: one(`SELECT COUNT(*) n FROM maintenance_logs ml WHERE ml.status<>'resolved' AND (${ids === null ? '1=1' : `ml.project_id IN (${ids.length ? ids.join(',') : 'NULL'}) OR ml.assignee_id=${user.id}`})`).n,
      hours_30d: round2(one("SELECT COALESCE(SUM(hours),0) v FROM maintenance_logs WHERE reported_on>=date('now','-30 day')").v as number),
      by_type: all("SELECT COALESCE(type,'Other') k, COUNT(*) n FROM maintenance_logs GROUP BY k ORDER BY n DESC LIMIT 6"),
    },
    team: all(`SELECT u.id, u.name, u.role,
        (SELECT COUNT(*) FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id WHERE ta.user_id=u.id AND t.status<>'done') AS open_tasks,
        (SELECT COUNT(*) FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id WHERE ta.user_id=u.id AND t.status<>'done' AND t.due_date<?) AS overdue_tasks,
        (SELECT COUNT(*) FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id WHERE ta.user_id=u.id AND t.status='done' AND t.completed_at>=datetime('now','-7 days')) AS done_week,
        (SELECT COUNT(*) FROM projects p WHERE p.manager_id=u.id AND p.status IN ('planning','active','review','at_risk')) AS projects_led
      FROM users u WHERE u.active=1 ORDER BY open_tasks DESC, u.name`, t),
  };
}
