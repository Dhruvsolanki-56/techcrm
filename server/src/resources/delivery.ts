import fs from 'node:fs';
import path from 'node:path';
import {
  CR_KINDS, CR_PHASES, CR_STATUSES, DELIVERED_PROJECT_STATUSES, MAINT_STATUSES, PRIORITIES, PROJECT_STATUSES, TASK_STATUSES, today, values,
} from '@crm/shared';
import { defineResource, inList } from '../crud/define';
import { refSql } from '../crud/refs';
import { ALL, NONE, type ResourceDef } from '../crud/types';
import type { Row } from '../db/connection';
import { forbidden, HttpError } from '../shared/errors';
import { hasFlag, isFounder } from '../security/permissions';
import { projectScope, visibleProjectIds } from '../domain/access';
import { projectCode, purgeEntity } from '../domain/entities';
import { ADVANCE_SQL, ADVANCE_STATE_SQL, CR_VALUE_SQL, PM_COLUMNS } from '../domain/projectMoney';
import { STATUS_LABEL, taskKey } from '../domain/tasks';
import type { ResourceDeps } from './deps';

const PROJECT_CR_VALUE = CR_VALUE_SQL;

export function deliveryResources(deps: ResourceDeps): Record<string, ResourceDef> {
  const { ctx, getEngine, tasks } = deps;
  const { db } = ctx;
  const pendingAssignees = new WeakMap<object, number[]>();
  const one = (sql: string, ...p: unknown[]): Row | undefined => db.prepare(sql).get(...p) as Row | undefined;

  const projects = defineResource({
    table: 'projects', alias: 'p', timestamps: true,
    label: (r) => r.name,
    fields: {
      client_id: 'i', name: 't', code: 't', type: 't', status: 't', priority: 't', start_date: 'd', deadline: 'd', completed_on: 'd', budget: 'n', tds_percent: 'n', advance_required: 'b', manager_id: 'i', assigned_name: 't',
      description: 't', specs: 't', tech_stack: 't', live_url: 't', staging_url: 't', repo_url: 't', design_url: 't',
    },
    required: ['name', 'client_id'], notNull: ['status', 'priority'], enums: { status: values(PROJECT_STATUSES), priority: values(PRIORITIES) },
    columns: `p.*, c.company AS client_name, u.name AS manager_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status='done') AS tasks_done,
      (SELECT GROUP_CONCAT(pm.user_id) FROM project_members pm WHERE pm.project_id=p.id) AS member_ids,
      COALESCE(u.name, p.assigned_name) AS manager_display,
      (SELECT COUNT(*) FROM change_requests cr WHERE cr.project_id=p.id) AS cr_count,
      (SELECT COUNT(*) FROM change_requests cr WHERE cr.project_id=p.id AND cr.status IN ('requested','estimated','quoted','approved','in_progress')) AS cr_open,
      (${PROJECT_CR_VALUE}) AS cr_value,
      p.budget + (${PROJECT_CR_VALUE}) AS revised_value,
      (SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.project_id=p.id AND i.kind='invoice' AND i.status NOT IN ('draft','cancelled'))
        + (SELECT COALESCE(SUM(x.amount),0) FROM payments x WHERE x.project_id=p.id AND x.invoice_id IS NULL) AS total_billed,
      (SELECT COALESCE(SUM(x.amount),0) FROM payments x WHERE x.project_id=p.id) AS total_received,
      (SELECT COALESCE(SUM(e.amount),0) FROM expenses e WHERE e.project_id=p.id AND e.status='paid') AS total_expenses,
      ${PM_COLUMNS},
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id=p.id) AS milestone_count,
      ${ADVANCE_SQL} AS advance_amount, ${ADVANCE_STATE_SQL} AS advance_state`,
    from: 'FROM projects p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN users u ON u.id=p.manager_id',
    founderCols: ['budget', 'total_billed', 'total_received', 'total_expenses', 'cr_value', 'revised_value', 'tds_total', 'to_invoice', 'pending_amount', 'to_get', 'tds_percent', 'advance_amount', 'advance_state', 'milestone_count'],
    search: ['p.name', 'p.code', 'p.type', 'p.tech_stack', 'p.description', 'p.live_url', 'c.company', 'u.name'],
    filters: { client_id: 'p.client_id', status: 'p.status', manager_id: 'p.manager_id', type: 'p.type' },
    sortable: { name: 'p.name COLLATE NOCASE', status: 'p.status', deadline: "COALESCE(p.deadline,'9999')", created_at: 'p.created_at', client_name: 'c.company COLLATE NOCASE', budget: 'p.budget', id: 'p.id' },
    order: 'p.created_at DESC, p.id DESC',
    scope: (u) => projectScope(ctx, u, 'p.id'),
    can: (u) => isFounder(u),
    before(op, d, ex, { body }) {
      if (op === 'update' && ex?.code) delete d.code; // a project code never changes
      if (d.status === 'completed' && !d.completed_on) d.completed_on = today();
      // TDS is optional: a new project starts from the company's default (0 unless set), and a project that never has TDS just stays at 0
      if (op === 'create' && (body.tds_percent === undefined || body.tds_percent === '' || body.tds_percent === null)) d.tds_percent = Number(ctx.settings.get().default_tds_percent) || 0;
    },
    after(op, row) {
      if (op === 'create' && !row.code) db.prepare('UPDATE projects SET code=? WHERE id=?').run(projectCode(row.id), row.id);
      if (row.manager_id) db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(row.id, row.manager_id);
    },
    beforeDelete(id) {
      const n = (db.prepare('SELECT (SELECT COUNT(*) FROM invoices WHERE project_id=?) + (SELECT COUNT(*) FROM payments WHERE project_id=?) + (SELECT COUNT(*) FROM expenses WHERE project_id=?) n').get(id, id, id) as { n: number }).n;
      if (n) throw new HttpError(409, 'This project has invoices, payments or expenses attached. Mark it Completed/Cancelled instead of deleting, so finance history stays intact.');
    },
    onDelete: (id) => purgeEntity(ctx, 'project', id),
  });

  const tasksDef = defineResource({
    table: 'tasks', alias: 't', timestamps: true,
    label: (r) => r.title,
    fields: { title: 't', description: 't', project_id: 'i', lead_id: 'i', change_request_id: 'i', assignee_id: 'i', priority: 't', status: 't', due_date: 'd' },
    required: ['title'], notNull: ['priority', 'status'], enums: { status: values(TASK_STATUSES), priority: values(PRIORITIES) },
    columns: `t.*, p.name AS project_name, p.client_id AS client_id, cl.company AS client_name, a.name AS assignee_name, cb.name AS creator_name, cr.title AS change_request_title,
      (SELECT json_group_array(json_object('id', au.id, 'name', au.name)) FROM (SELECT au.id, au.name FROM task_assignees ta JOIN users au ON au.id=ta.user_id WHERE ta.task_id=t.id ORDER BY ta.rowid) au) AS assignees,
      (SELECT COUNT(*) FROM notes n WHERE n.entity_type='task' AND n.entity_id=t.id AND n.kind='note') AS comment_count,
      (SELECT COUNT(*) FROM task_checklist c WHERE c.task_id=t.id) AS check_total,
      (SELECT COUNT(*) FROM task_checklist c WHERE c.task_id=t.id AND c.done=1) AS check_done`,
    from: `FROM tasks t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN clients cl ON cl.id=p.client_id
      LEFT JOIN users a ON a.id=t.assignee_id LEFT JOIN users cb ON cb.id=t.created_by LEFT JOIN change_requests cr ON cr.id=t.change_request_id`,
    json: ['assignees'],
    search: ['t.title', 't.description', "('T-' || t.id)", 'p.name', 'a.name'],
    filters: {
      project_id: 't.project_id', status: 't.status', priority: 't.priority', lead_id: 't.lead_id', change_request_id: 't.change_request_id',
      // "assigned to X" means X is any of the task's people, not only the first one
      assignee_id: (v) => (v === 'null'
        ? { sql: 'NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id=t.id)', params: [] }
        : { sql: `t.id IN (SELECT task_id FROM task_assignees WHERE user_id IN ${inList(v.split(','))})`, params: v.split(',') }),
      overdue: (v) => ({ sql: v === '1' ? "t.status<>'done' AND t.due_date < date('now','localtime')" : '1=1', params: [] }),
    },
    sortable: { title: 't.title COLLATE NOCASE', due_date: "COALESCE(t.due_date,'9999')", status: 't.status', priority: 't.priority', created_at: 't.created_at' },
    order: "CASE t.status WHEN 'done' THEN 1 ELSE 0 END, COALESCE(t.due_date,'9999'), t.id DESC",
    scope(u) {
      if (isFounder(u)) return ALL;
      const ids = visibleProjectIds(ctx, u);
      const mine = 't.assignee_id=? OR t.created_by=? OR t.id IN (SELECT task_id FROM task_assignees WHERE user_id=?)';
      if (ids === null) return { where: `(${mine} OR t.project_id IS NOT NULL)`, params: [u.id, u.id, u.id] };
      return { where: `(${mine} OR t.project_id IN ${inList(ids)})`, params: [u.id, u.id, u.id, ...ids] };
    },
    can(u, op, ex) {
      if (isFounder(u)) return true;
      if (op === 'create') return true;
      if (op === 'update') return !!ex && (ex.assignee_id === u.id || ex.created_by === u.id || tasks.isAssignee(ex.id, u.id));
      return false;
    },
    before(op, d, ex, { user, body }) {
      let ids: number[] | undefined;
      if (!isFounder(user)) {
        if (op === 'create') {
          ids = [user.id];
          if (!hasFlag(user, 'leads')) delete d.lead_id;
          delete d.change_request_id;
        }
        if (op === 'update') {
          // interns may only move their task along and describe progress
          for (const k of Object.keys(d)) if (!['status', 'description'].includes(k)) delete d[k];
        }
      } else if (Array.isArray(body.assignee_ids)) ids = tasks.cleanAssignees(body.assignee_ids);
      else if ('assignee_id' in d) ids = tasks.cleanAssignees(d.assignee_id ? [d.assignee_id] : []);
      if (ids) {
        d.assignee_id = ids[0] ?? null;
        pendingAssignees.set(body, ids);
      }
      if (d.status) {
        if (d.status === 'done' && !(ex && ex.status === 'done')) d.completed_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        if (d.status !== 'done') d.completed_at = null;
      }
      if (op === 'create') {
        d.created_by = user.id;
        // an intern cannot create a task inside a project they cannot see
        const visible = visibleProjectIds(ctx, user);
        if (!isFounder(user) && d.project_id && visible !== null && !visible.includes(d.project_id)) throw forbidden();
      }
      if (d.change_request_id) {
        const cr = one('SELECT project_id FROM change_requests WHERE id=?', d.change_request_id);
        if (!cr) throw new HttpError(400, 'That change request does not exist.');
        const pid = 'project_id' in d ? d.project_id : ex?.project_id;
        if (pid && pid !== cr.project_id) throw new HttpError(400, 'The change request belongs to a different project.');
        if (!pid) d.project_id = cr.project_id;
      }
    },
    after(op, row, ex, { user, body }) {
      const ids = pendingAssignees.get(body);
      const { added, removed } = tasks.syncAssignees(op === 'delete' ? 'update' : op, row, ids, user);
      const tell = (): void => {
        for (const i of added) if (i !== user.id) ctx.notify(i, `${user.name} assigned you ${taskKey(row.id)}: ${row.title}`, `/tasks?open=${row.id}`);
      };
      if (op === 'create') {
        tasks.watch(row.id, row.created_by || user.id);
        tasks.history(row.id, user, 'created this task');
        tell();
        return;
      }
      if (!ex) return;
      const ch: string[] = [];
      if (ex.status !== row.status) ch.push(`changed status from ${STATUS_LABEL[ex.status] ?? ex.status} to ${STATUS_LABEL[row.status] ?? row.status}`);
      if (ex.priority !== row.priority) ch.push(`changed priority from ${ex.priority} to ${row.priority}`);
      if ((ex.due_date || null) !== (row.due_date || null)) ch.push(row.due_date ? `set the due date to ${tasks.niceDate(row.due_date)}` : 'removed the due date');
      if (ex.title !== row.title) ch.push(`renamed this task (was "${ex.title}")`);
      if ((ex.description || '') !== (row.description || '')) ch.push('updated the description');
      if ((ex.project_id || null) !== (row.project_id || null)) ch.push(row.project_name ? `moved this task to ${row.project_name}` : 'took this task out of its project');
      if (added.length) ch.push(`added ${added.map(tasks.userName).join(', ')}`);
      if (removed.length) ch.push(`removed ${removed.map(tasks.userName).join(', ')}`);
      for (const c of ch) tasks.history(row.id, user, c);
      tell();
      if (ex.status !== row.status) tasks.notifyWatchers(row.id, user.id, `${user.name} moved ${taskKey(row.id)} "${row.title}" to ${STATUS_LABEL[row.status] ?? row.status}`, added);
    },
    onDelete: (id) => purgeEntity(ctx, 'task', id),
  });

  /* ---------- change requests: a client asks for something different (before delivery) or new (after delivery) ---------- */
  const changeRequests = defineResource({
    table: 'change_requests', alias: 'cr', timestamps: true,
    label: (r) => `${r.title}${r.project_name ? ` (${r.project_name})` : ''}`,
    fields: {
      project_id: 'i', title: 't', description: 't', kind: 't', phase: 't', status: 't', priority: 't', billable: 'b', requested_by: 't', requested_on: 'd',
      estimate_hours: 'n', estimate_amount: 'n', approved_on: 'd', delivered_on: 'd', notes: 't',
    },
    required: ['title', 'project_id'], notNull: ['kind', 'phase', 'status', 'priority'],
    enums: { kind: values(CR_KINDS), phase: values(CR_PHASES), status: values(CR_STATUSES), priority: values(PRIORITIES) },
    columns: `cr.*, p.name AS project_name, p.code AS project_code, p.status AS project_status, c.company AS client_name,
      q.number AS quote_number, q.status AS quote_status, q.total AS quote_total, i.number AS invoice_number, i.status AS invoice_status, i.total AS invoice_total, i.paid_amount AS invoice_paid,
      CASE WHEN cr.billable=0 THEN 'not_billable' WHEN i.id IS NOT NULL AND i.status='paid' THEN 'paid' WHEN i.id IS NOT NULL THEN 'invoiced'
        WHEN q.id IS NOT NULL THEN 'quoted' ELSE 'not_quoted' END AS billing_status,
      (SELECT COUNT(*) FROM tasks t WHERE t.change_request_id=cr.id) AS task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.change_request_id=cr.id AND t.status='done') AS tasks_done`,
    from: `FROM change_requests cr LEFT JOIN projects p ON p.id=cr.project_id LEFT JOIN clients c ON c.id=cr.client_id
      LEFT JOIN quotes q ON q.id=cr.quote_id LEFT JOIN invoices i ON i.id=cr.invoice_id`,
    founderCols: ['estimate_amount', 'quote_number', 'quote_status', 'quote_total', 'invoice_number', 'invoice_status', 'invoice_total', 'invoice_paid', 'billing_status'],
    search: ['cr.title', 'cr.description', 'cr.requested_by', 'p.name', 'c.company', refSql('change_requests', 'cr')],
    filters: { project_id: 'cr.project_id', client_id: 'cr.client_id', status: 'cr.status', phase: 'cr.phase', kind: 'cr.kind', priority: 'cr.priority',
      open: (v) => ({ sql: v === '1' ? "cr.status IN ('requested','estimated','quoted','approved','in_progress')" : '1=1', params: [] }) },
    sortable: { title: 'cr.title COLLATE NOCASE', status: 'cr.status', requested_on: 'cr.requested_on', created_at: 'cr.created_at', estimate_amount: 'cr.estimate_amount', project_name: 'p.name COLLATE NOCASE' },
    order: "CASE WHEN cr.status IN ('rejected','cancelled','delivered') THEN 1 ELSE 0 END, cr.requested_on DESC, cr.id DESC",
    scope: (u) => projectScope(ctx, u, 'cr.project_id'),
    // the people on a project record and progress requests; founders do the commercial side
    can: (u, op, ex) => (isFounder(u) ? true : op !== 'delete' && (op === 'create' || !!ex)),
    before(op, d, ex, { user }) {
      const projectId = 'project_id' in d ? d.project_id : ex?.project_id;
      const project = projectId ? one('SELECT id, client_id, status FROM projects WHERE id=?', projectId) : undefined;
      if (!project) throw new HttpError(400, 'Choose the project this change request is for.');
      if (op === 'create' && !isFounder(user)) {
        const visible = visibleProjectIds(ctx, user);
        if (visible !== null && !visible.includes(project.id)) throw forbidden();
      }
      if (!isFounder(user)) {
        // delivery people record and progress requests; money and approvals belong to founders
        for (const k of ['estimate_amount', 'billable', 'approved_on']) delete d[k];
        if (op === 'update') for (const k of Object.keys(d)) if (!['status', 'description', 'delivered_on', 'estimate_hours', 'notes'].includes(k)) delete d[k];
        if (d.status && !['in_progress', 'delivered'].includes(d.status)) throw new HttpError(403, 'Only a founder can approve, quote, reject or cancel a change request.');
      }
      if (op === 'create') {
        d.created_by = user.id;
        d.client_id = project.client_id;
        d.requested_on ||= today();
        // a request on a delivered project is a post-delivery change request
        d.phase ||= (DELIVERED_PROJECT_STATUSES as readonly string[]).includes(project.status) ? 'after_delivery' : 'before_delivery';
        d.status ||= 'requested';
      }
      if (d.status && ex && d.status !== ex.status) {
        if (d.status === 'approved' && !ex.approved_on && !d.approved_on) d.approved_on = today();
        if (d.status === 'delivered' && !d.delivered_on) d.delivered_on = today();
        if (d.status !== 'delivered' && ex.delivered_on && !('delivered_on' in d)) d.delivered_on = null;
      }
      if (op === 'create' && d.status === 'estimated' && !(Number(d.estimate_amount) > 0 || Number(d.estimate_hours) > 0)) d.status = 'requested';
    },
    after(op, row, ex, { user }) {
      // The change request's own page shows every field change in its history, so only the project timeline gets a line.
      const note = (text: string): void => {
        db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES('project',?,?,'system',?)").run(row.project_id, user.id, `CR-${String(row.id).padStart(4, '0')} — ${text}`);
      };
      if (op === 'create') {
        note(`Change request raised (${row.phase === 'after_delivery' ? 'after delivery' : 'before delivery'}): ${row.title}`);
        const mgr = one('SELECT manager_id FROM projects WHERE id=?', row.project_id);
        if (mgr?.manager_id && mgr.manager_id !== user.id) ctx.notify(mgr.manager_id, `New change request on ${row.project_name}: ${row.title}`, `/projects/${row.project_id}?tab=changes`);
      }
    },
    beforeDelete(id) {
      const q = one("SELECT number FROM quotes WHERE change_request_id=? AND status<>'rejected' LIMIT 1", id);
      const i = one("SELECT number FROM invoices WHERE change_request_id=? AND status<>'cancelled' LIMIT 1", id);
      if (i) throw new HttpError(409, `Invoice ${String(i.number)} was raised for this change request, so it cannot be deleted. Cancel the invoice first, or set the request to Cancelled.`);
      if (q) throw new HttpError(409, `Quotation ${String(q.number)} was written for this change request. Reject or delete the quotation first, or set the request to Cancelled.`);
    },
    onDelete: (id) => {
      db.prepare('UPDATE tasks SET change_request_id=NULL WHERE change_request_id=?').run(id);
      purgeEntity(ctx, 'change_request', id);
    },
  });

  const maintenance = defineResource({
    table: 'maintenance_logs', alias: 'ml',
    label: (r) => r.title,
    fields: { client_id: 'i', project_id: 'i', title: 't', description: 't', type: 't', priority: 't', status: 't', reported_on: 'd', resolved_on: 'd', hours: 'n', billable: 'b', assignee_id: 'i' },
    required: ['title'], notNull: ['status'], enums: { status: values(MAINT_STATUSES), priority: values(PRIORITIES) },
    columns: 'ml.*, c.company AS client_name, p.name AS project_name, a.name AS assignee_name',
    from: 'FROM maintenance_logs ml LEFT JOIN clients c ON c.id=ml.client_id LEFT JOIN projects p ON p.id=ml.project_id LEFT JOIN users a ON a.id=ml.assignee_id',
    search: ['ml.title', 'ml.description', 'ml.type', 'p.name', 'c.company', 'a.name'],
    filters: { client_id: 'ml.client_id', project_id: 'ml.project_id', status: 'ml.status', assignee_id: 'ml.assignee_id' },
    sortable: { title: 'ml.title COLLATE NOCASE', reported_on: "COALESCE(ml.reported_on,'0')", status: 'ml.status', priority: 'ml.priority' },
    order: "CASE ml.status WHEN 'resolved' THEN 1 ELSE 0 END, COALESCE(ml.reported_on,'0') DESC, ml.id DESC",
    scope(u) {
      if (hasFlag(u, 'maintenance')) return ALL;
      const ids = visibleProjectIds(ctx, u) ?? [];
      return { where: `(ml.assignee_id=? OR ml.project_id IN ${inList(ids)})`, params: [u.id, ...ids] };
    },
    can(u, op, ex) {
      if (isFounder(u)) return true;
      if (op === 'delete') return false;
      return op === 'create' || (!!ex && (ex.assignee_id === u.id || hasFlag(u, 'maintenance') || ex.created_by === u.id));
    },
    before(op, d, ex, { user }) {
      if (op === 'create') {
        d.created_by = user.id;
        d.reported_on ||= today();
      }
      if (!isFounder(user)) {
        delete d.billable;
        // interns record progress on existing items; they cannot re-point them at other clients/projects/people
        if (op === 'update') for (const k of Object.keys(d)) if (!['status', 'description', 'hours', 'resolved_on'].includes(k)) delete d[k];
        if (op === 'create' && !hasFlag(user, 'maintenance')) {
          if (!d.project_id) throw new HttpError(400, 'Choose the project this work is for.');
          const visible = visibleProjectIds(ctx, user);
          if (visible !== null && !visible.includes(d.project_id)) throw forbidden();
          d.assignee_id = user.id;
        }
      }
      if (d.project_id) d.client_id = one('SELECT client_id FROM projects WHERE id=?', d.project_id)?.client_id || d.client_id || null;
      if (d.status === 'resolved' && !d.resolved_on && !ex?.resolved_on) d.resolved_on = today();
    },
  });

  const events = defineResource({
    table: 'events', alias: 'ev',
    label: (r) => r.title,
    fields: { title: 't', date: 'd', end_date: 'd', kind: 't', client_id: 'i', project_id: 'i', notes: 't' },
    required: ['title', 'date'],
    columns: 'ev.*, c.company AS client_name, p.name AS project_name',
    from: 'FROM events ev LEFT JOIN clients c ON c.id=ev.client_id LEFT JOIN projects p ON p.id=ev.project_id',
    search: ['ev.title', 'ev.notes', 'c.company', 'p.name'],
    filters: { client_id: 'ev.client_id', project_id: 'ev.project_id' },
    dateField: 'ev.date',
    sortable: { date: 'ev.date', title: 'ev.title COLLATE NOCASE' },
    order: 'ev.date',
    // interns: company-wide reminders plus reminders on projects they work on
    scope(u) {
      if (isFounder(u)) return ALL;
      const ids = visibleProjectIds(ctx, u);
      if (ids === null) return ALL;
      return { where: `((ev.project_id IS NULL AND ev.client_id IS NULL) OR ev.project_id IN ${inList(ids)})`, params: ids };
    },
    can: (u) => isFounder(u),
    before(op, d, _ex, { user }) {
      if (op === 'create') d.created_by = user.id;
    },
  });

  const documents = defineResource({
    table: 'documents', alias: 'd',
    label: (r) => r.title,
    fields: { title: 't', category: 't', notes: 't', expiry_date: 'd', url: 't', status: 't', owner_id: 'i' },
    required: ['title'],
    columns: `d.*, u.name AS uploader_name, COALESCE(ow.name, d.assigned_name) AS owner_name,
      CASE d.entity_type
        WHEN 'client' THEN (SELECT company FROM clients WHERE id=d.entity_id)
        WHEN 'project' THEN (SELECT name FROM projects WHERE id=d.entity_id)
        WHEN 'lead' THEN (SELECT name FROM leads WHERE id=d.entity_id)
        WHEN 'invoice' THEN (SELECT number FROM invoices WHERE id=d.entity_id)
        WHEN 'quote' THEN (SELECT number FROM quotes WHERE id=d.entity_id)
        WHEN 'task' THEN (SELECT title FROM tasks WHERE id=d.entity_id)
        WHEN 'change_request' THEN (SELECT title FROM change_requests WHERE id=d.entity_id)
        WHEN 'expense' THEN (SELECT COALESCE(vendor, description) FROM expenses WHERE id=d.entity_id)
        WHEN 'payment' THEN (SELECT 'Payment ' || date FROM payments WHERE id=d.entity_id)
        WHEN 'grant' THEN (SELECT name FROM grants WHERE id=d.entity_id)
        WHEN 'renewal' THEN (SELECT name FROM renewals WHERE id=d.entity_id)
        WHEN 'asset' THEN (SELECT COALESCE(make_model, asset_type) FROM assets WHERE id=d.entity_id)
        WHEN 'milestone' THEN (SELECT title FROM milestones WHERE id=d.entity_id)
        WHEN 'maintenance' THEN (SELECT title FROM maintenance_logs WHERE id=d.entity_id)
        ELSE NULL END AS entity_name`,
    from: 'FROM documents d LEFT JOIN users u ON u.id=d.uploaded_by LEFT JOIN users ow ON ow.id=d.owner_id',
    search: ['d.title', 'd.filename', 'd.category', 'd.notes'],
    filters: { entity_type: 'd.entity_type', entity_id: 'd.entity_id', category: 'd.category', status: 'd.status' },
    sortable: { title: 'd.title COLLATE NOCASE', created_at: 'd.created_at', category: 'd.category' },
    order: 'd.created_at DESC, d.id DESC',
    before(op, d) {
      if (d.owner_id) d.assigned_name = null;
      if (d.url) {
        if (!/^https?:\/\//i.test(d.url)) d.url = `https://${d.url}`;
        if (!/^https?:\/\/[^\s<>"]+$/i.test(d.url)) throw new HttpError(400, 'That link does not look like a web address.');
      }
    },
    scope(u) {
      if (isFounder(u)) return ALL;
      const ids = visibleProjectIds(ctx, u) ?? [];
      return {
        where: `(d.uploaded_by=? OR (d.entity_type='project' AND d.entity_id IN ${inList(ids)}) OR (d.entity_type='task' AND d.entity_id IN (SELECT id FROM tasks WHERE assignee_id=? OR created_by=?)))`,
        params: [u.id, ...ids, u.id, u.id],
      };
    },
    can: (u, _op, ex) => isFounder(u) || (!!ex && ex.uploaded_by === u.id),
    onDelete(_id, row) {
      if (row.stored_name) {
        try { fs.unlinkSync(path.join(ctx.config.uploadDir, row.stored_name)); } catch { /* ok */ }
      }
    },
  });

  void getEngine;
  void NONE;
  return { projects, tasks: tasksDef, change_requests: changeRequests, maintenance_logs: maintenance, events, documents };
}
