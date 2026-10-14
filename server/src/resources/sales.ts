import { CLIENT_STATUSES, CLOSED_STAGES, LEAD_PRIORITIES, LEAD_STAGES, FOLLOWUP_ROUNDS, MARKETS, BUSINESS_SIDES, STAGE_PROB, today, values } from '@crm/shared';
import { defineResource } from '../crud/define';
import { refSql } from '../crud/refs';
import { ALL, NONE, type ResourceDef } from '../crud/types';
import type { Row } from '../db/connection';
import { HttpError } from '../shared/errors';
import { hasFlag, isFounder } from '../security/permissions';
import { visibleProjectIds } from '../domain/access';
import { purgeEntity } from '../domain/entities';
import { PM_SQL } from '../domain/projectMoney';
import { inList } from '../crud/define';
import type { ResourceDeps } from './deps';

const STAGE_LABEL = Object.fromEntries(LEAD_STAGES);
export const PROBABILITY_SQL = `CASE l.stage ${Object.entries(STAGE_PROB).map(([k, v]) => `WHEN '${k}' THEN ${v}`).join(' ')} ELSE 0 END`;
/** Follow-Up Status, worked out the same way as the team's sheet column. */
export const FOLLOWUP_STATUS_SQL = `CASE WHEN l.stage IN ('won','closed','lost') THEN 'Completed' WHEN l.next_followup IS NULL OR l.next_followup='' THEN 'Not Scheduled'
  WHEN l.next_followup < date('now','localtime') THEN 'Overdue' WHEN l.next_followup = date('now','localtime') THEN 'Due Today' ELSE 'Scheduled' END`;

export function salesResources({ ctx }: ResourceDeps): Record<string, ResourceDef> {
  const { db } = ctx;
  const businessSideOf = (dep: string): string | null => {
    const k = dep.toLowerCase();
    if (ctx.settings.list('lead_services').some((x) => x.toLowerCase() === k)) return 'Service';
    if (ctx.settings.list('lead_products').some((x) => x.toLowerCase() === k)) return 'Product';
    return null;
  };

  const leads = defineResource({
    table: 'leads', alias: 'l', timestamps: true,
    label: (r) => r.name + (r.company ? ` (${r.company})` : ''),
    fields: {
      name: 't', company: 't', email: 't', phone: 't', website: 't', city: 't', country: 't', market: 't', source: 't', service: 't', value: 'n', stage: 't',
      business_side: 't', department: 't', category: 't', requirement: 't', specs: 't', priority: 't', followup_round: 't', next_action: 't', assigned_name: 't',
      owner_id: 'i', client_id: 'i', next_followup: 'd', last_contact: 'd', meeting_date: 'd', proposal_date: 'd', closed_on: 'd', expected_close: 'd', lost_reason: 't', notes: 't',
    },
    notNull: ['stage', 'followup_round'],
    enums: { stage: values(LEAD_STAGES), priority: values(LEAD_PRIORITIES), followup_round: values(FOLLOWUP_ROUNDS), market: values(MARKETS), business_side: [...BUSINESS_SIDES] },
    columns: `l.*, COALESCE(u.name, l.assigned_name) AS owner_name, c.company AS client_name, ${PROBABILITY_SQL} AS probability, ${FOLLOWUP_STATUS_SQL} AS followup_status`,
    from: 'FROM leads l LEFT JOIN users u ON u.id=l.owner_id LEFT JOIN clients c ON c.id=l.client_id',
    search: ['l.name', 'l.company', 'c.company', 'l.email', 'l.phone', 'l.city', 'l.country', 'l.requirement', 'l.notes', 'l.department', refSql('leads', 'l')],
    filters: {
      stage: 'l.stage', owner_id: 'l.owner_id', source: 'l.source', department: 'l.department', category: 'l.category', market: 'l.market', priority: 'l.priority',
      business_side: 'l.business_side', followup_round: 'l.followup_round', client_id: 'l.client_id',
      followup_status: (v) => ({ sql: `(${FOLLOWUP_STATUS_SQL}) = ?`, params: [v] }),
      open: (v) => ({ sql: v === '1' ? "l.stage NOT IN ('won','closed','lost')" : '1=1', params: [] }),
    },
    sortable: { company: 'l.company COLLATE NOCASE', name: 'l.name COLLATE NOCASE', stage: 'l.stage', priority: 'l.priority', created_at: 'l.created_at', next_followup: "COALESCE(l.next_followup,'9999')", value: 'l.value', owner_name: 'owner_name', city: 'l.city', id: 'l.id', last_contact: 'l.last_contact' },
    order: 'l.created_at DESC, l.id DESC',
    scope: (u) => (hasFlag(u, 'leads') ? ALL : NONE),
    can: (u, op) => (op === 'delete' ? isFounder(u) : hasFlag(u, 'leads')),
    before(op, d, ex, { user }) {
      if (op === 'create') {
        d.created_by = user.id;
        if (!d.owner_id && !d.assigned_name) d.owner_id = user.id;
      }
      // a lead for someone we already work for: take their details from the client record
      if (d.client_id) {
        const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(d.client_id) as Row | undefined;
        if (!cl) throw new HttpError(400, 'That client does not exist.');
        const pc = db.prepare('SELECT * FROM contacts WHERE client_id=? ORDER BY is_primary DESC, id LIMIT 1').get(d.client_id) as Row | undefined;
        const blank = (k: string): boolean => !(k in d ? d[k] : ex?.[k]);
        if (blank('company')) d.company = cl.company;
        if (blank('name')) d.name = pc?.name ?? cl.company;
        if (blank('phone') && pc?.phone) d.phone = pc.phone;
        if (blank('email') && pc?.email) d.email = pc.email;
        if (blank('city') && cl.city) d.city = cl.city;
        if (blank('website') && cl.website) d.website = cl.website;
      }
      // a company is optional (an individual is a lead too); one of company / person / client is needed
      const company = 'company' in d ? d.company : ex?.company;
      const name = 'name' in d ? d.name : ex?.name;
      if (!company && !name) throw new HttpError(400, 'Enter a company, a person’s name, or pick an existing client.');
      if (!name) d.name = company;
      if (d.owner_id) d.assigned_name = null;
      // Service or Product follows from the department / product picked (lists in Settings)
      if (d.department && !d.business_side) d.business_side = businessSideOf(d.department) ?? ex?.business_side ?? null;
      // a deal that ends gets its close date; reopening clears it
      if (d.stage) {
        if ((CLOSED_STAGES as readonly string[]).includes(d.stage) && !d.closed_on && !(ex?.closed_on && (CLOSED_STAGES as readonly string[]).includes(ex.stage))) d.closed_on = today();
        if (!(CLOSED_STAGES as readonly string[]).includes(d.stage) && !('closed_on' in d)) d.closed_on = null;
      }
    },
    after(op, row, ex, { user }) {
      if (op === 'update' && ex && ex.stage !== row.stage) {
        db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES('lead',?,?,'system',?)")
          .run(row.id, user.id, `Stage changed: ${STAGE_LABEL[ex.stage as keyof typeof STAGE_LABEL] ?? ex.stage} → ${STAGE_LABEL[row.stage as keyof typeof STAGE_LABEL] ?? row.stage}`);
      }
      if (op === 'create' && row.owner_id && row.owner_id !== user.id) ctx.notify(row.owner_id, `New lead assigned: ${row.name}`, `/leads/${row.id}`);
    },
    onDelete: (id) => purgeEntity(ctx, 'lead', id),
  });

  const clients = defineResource({
    table: 'clients', alias: 'c', timestamps: true,
    label: (r) => r.company,
    fields: { company: 't', industry: 't', website: 't', gstin: 't', pan: 't', address: 't', city: 't', state: 't', country: 't', status: 't', account_manager_id: 'i', tags: 't', notes: 't' },
    required: ['company'], notNull: ['status'], enums: { status: values(CLIENT_STATUSES) },
    columns: `c.*, u.name AS manager_name,
      (SELECT name FROM contacts WHERE client_id=c.id ORDER BY is_primary DESC, id LIMIT 1) AS contact_name,
      (SELECT phone FROM contacts WHERE client_id=c.id ORDER BY is_primary DESC, id LIMIT 1) AS contact_phone,
      (SELECT email FROM contacts WHERE client_id=c.id ORDER BY is_primary DESC, id LIMIT 1) AS contact_email,
      (SELECT COUNT(*) FROM projects p WHERE p.client_id=c.id) AS project_count,
      (SELECT COUNT(*) FROM projects p WHERE p.client_id=c.id AND p.status IN ('planning','active','review','at_risk')) AS active_projects,
      (SELECT COALESCE(SUM(MAX(i.total-i.paid_amount,0)),0) FROM invoices i WHERE i.client_id=c.id AND i.kind='invoice' AND i.status NOT IN ('draft','cancelled')) AS outstanding,
      (SELECT COALESCE(SUM(pm.amount),0) FROM payments pm WHERE pm.client_id=c.id) AS lifetime_received,
      (SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.client_id=c.id AND i.kind='invoice' AND i.status NOT IN ('draft','cancelled'))
        + (SELECT COALESCE(SUM(pm.amount),0) FROM payments pm WHERE pm.client_id=c.id AND pm.invoice_id IS NULL) AS total_billed,
      (SELECT COALESCE(SUM(MAX(0, ${PM_SQL.value} - ${PM_SQL.tds} - ${PM_SQL.invoiced}) + ${PM_SQL.pending}),0) FROM projects p WHERE p.client_id=c.id AND p.status<>'cancelled')
        + (SELECT COALESCE(SUM(MAX(i.total-i.paid_amount,0)),0) FROM invoices i WHERE i.client_id=c.id AND i.project_id IS NULL AND i.kind='invoice' AND i.status NOT IN ('draft','cancelled')) AS to_get,
      (SELECT COALESCE(SUM(x.tds),0) FROM payments x WHERE x.client_id=c.id) AS tds_total`,
    from: 'FROM clients c LEFT JOIN users u ON u.id=c.account_manager_id',
    founderCols: ['outstanding', 'lifetime_received', 'total_billed', 'to_get', 'tds_total'],
    search: ['c.company', 'c.industry', 'c.city', 'c.gstin', 'c.tags', 'c.website', 'c.notes', refSql('clients', 'c'),
      "(SELECT GROUP_CONCAT(name || ' ' || COALESCE(email,'') || ' ' || COALESCE(phone,''), ' ') FROM contacts WHERE client_id=c.id)"],
    filters: { status: 'c.status', account_manager_id: 'c.account_manager_id' },
    sortable: { company: 'c.company COLLATE NOCASE', status: 'c.status', created_at: 'c.created_at', project_count: 'project_count', lifetime_received: 'lifetime_received', outstanding: 'outstanding', to_get: 'to_get', id: 'c.id' },
    order: 'c.company COLLATE NOCASE',
    scope(u) {
      if (hasFlag(u, 'clients')) return ALL;
      const ids = visibleProjectIds(ctx, u) ?? [];
      return { where: `c.id IN (SELECT client_id FROM projects WHERE id IN ${inList(ids)})`, params: ids };
    },
    can: (u) => isFounder(u),
    beforeDelete(id) {
      const p = (db.prepare('SELECT COUNT(*) n FROM projects WHERE client_id=?').get(id) as { n: number }).n;
      const i = (db.prepare('SELECT COUNT(*) n FROM invoices WHERE client_id=?').get(id) as { n: number }).n;
      if (p || i) throw new HttpError(409, `This client has ${p} project(s) and ${i} invoice(s). Set status to "Archived" instead of deleting, so your history stays intact.`);
    },
    onDelete: (id) => purgeEntity(ctx, 'client', id),
  });

  const contacts = defineResource({
    table: 'contacts', alias: 'ct',
    label: (r) => r.name,
    fields: { client_id: 'i', name: 't', role: 't', email: 't', phone: 't', whatsapp: 't', is_primary: 'b', notes: 't' },
    required: ['name', 'client_id'],
    columns: 'ct.*, c.company AS client_name',
    from: 'FROM contacts ct LEFT JOIN clients c ON c.id=ct.client_id',
    search: ['ct.name', 'ct.email', 'ct.phone', 'ct.role', 'c.company'],
    filters: { client_id: 'ct.client_id' },
    sortable: { name: 'ct.name COLLATE NOCASE' },
    order: 'ct.is_primary DESC, ct.name',
    scope(u) {
      if (hasFlag(u, 'clients')) return ALL;
      const ids = visibleProjectIds(ctx, u) ?? [];
      return { where: `ct.client_id IN (SELECT client_id FROM projects WHERE id IN ${inList(ids)})`, params: ids };
    },
    can: (u) => isFounder(u),
  });

  return { leads, clients, contacts };
}
