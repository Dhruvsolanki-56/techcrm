import { CLOSED_STAGES, round2, today } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import { projectCode } from './entities';

/**
 * The real sales-to-work flow, kept in one place so every screen moves the same records the same way:
 *
 *   lead → quotation sent → quotation ACCEPTED → (client + project plan appear, lead is "Accepted")
 *        → first payment (the advance) arrives → client becomes Active, lead becomes Converted.
 *
 * Nobody has to enter anything twice: accepting the quotation is the only step, and the payment is the only other.
 */
const one = (ctx: AppContext, sql: string, ...p: unknown[]): Row | undefined => ctx.db.prepare(sql).get(...p) as Row | undefined;
const note = (ctx: AppContext, type: string, id: number, userId: number | null, body: string): void => {
  ctx.db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES(?,?,?,'system',?)").run(type, id, userId, body);
};

/** The client of a lead: the one it already has, or a new one (with the lead's person as the main contact) carrying the sales notes. */
export function ensureClientForLead(ctx: AppContext, lead: Row, userId: number | null, status: 'prospect' | 'active'): number {
  const { db } = ctx;
  if (lead.client_id) return lead.client_id as number;
  const clientId = Number(db.prepare('INSERT INTO clients(company,website,city,status,account_manager_id,notes) VALUES(?,?,?,?,?,?)')
    .run(lead.company || lead.name, lead.website, lead.city, status, lead.owner_id, lead.notes).lastInsertRowid);
  db.prepare('INSERT INTO contacts(client_id,name,email,phone,is_primary) VALUES(?,?,?,?,1)').run(clientId, lead.name, lead.email, lead.phone);
  db.prepare('UPDATE leads SET client_id=?, updated_at=datetime(\'now\') WHERE id=?').run(clientId, lead.id);
  db.prepare('UPDATE quotes SET client_id=? WHERE lead_id=?').run(clientId, lead.id);
  note(ctx, 'client', clientId, userId, `Came from lead "${lead.name}" (source: ${lead.source || 'n/a'}, expected value ${lead.value || 0})`);
  note(ctx, 'lead', lead.id as number, userId, 'Became a client');
  for (const n of db.prepare("SELECT * FROM notes WHERE entity_type='lead' AND entity_id=? AND kind<>'system'").all(lead.id) as Row[]) {
    db.prepare('INSERT INTO notes(entity_type,entity_id,user_id,kind,body,created_at) VALUES(?,?,?,?,?,?)').run('client', clientId, n.user_id, n.kind, n.body, n.created_at);
  }
  return clientId;
}

/** A project for an accepted quotation: its value is the quotation, the lead's talk becomes the specification and its files follow the work. */
export function startProjectForQuote(ctx: AppContext, quote: Row, clientId: number, userId: number | null, name?: string): number {
  const { db } = ctx;
  if (quote.project_id) return quote.project_id as number;
  const lead = quote.lead_id ? one(ctx, 'SELECT * FROM leads WHERE id=?', quote.lead_id) : undefined;
  const value = round2(quote.subtotal - quote.discount);
  const projectId = Number(db.prepare("INSERT INTO projects(client_id,name,type,status,budget,manager_id,description) VALUES(?,?,?,'planning',?,?,?)")
    .run(clientId, name || quote.title || `Project ${quote.number}`, lead?.service ?? null, value, (lead?.owner_id as number | null) ?? userId, lead?.requirement ?? quote.notes ?? null).lastInsertRowid);
  db.prepare('UPDATE projects SET code=? WHERE id=?').run(projectCode(projectId), projectId);
  if (lead) {
    const specs = [lead.specs, lead.notes ? `Notes from the sales conversation:\n${lead.notes}` : ''].filter(Boolean).join('\n\n');
    db.prepare('UPDATE projects SET specs=? WHERE id=?').run(specs || null, projectId);
    // the lead's files go with the work; later quotations of the same lead keep pointing at the lead
    db.prepare("UPDATE documents SET entity_type='project', entity_id=? WHERE entity_type='lead' AND entity_id=?").run(projectId, lead.id);
    if (lead.owner_id) db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(projectId, lead.owner_id);
  }
  if (userId) db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(projectId, userId);
  db.prepare("UPDATE quotes SET project_id=?, client_id=?, updated_at=datetime('now') WHERE id=?").run(projectId, clientId, quote.id);
  note(ctx, 'project', projectId, userId, `Started from accepted quotation ${quote.number} (₹${value.toLocaleString('en-IN')}). Next: plan the payments.`);
  return projectId;
}

/**
 * A quotation was accepted. Idempotent: running it again changes nothing.
 * `startProject: false` is for "just invoice it" (a small one-off sale): the lead and client still move, no project is made.
 */
export function acceptQuotation(ctx: AppContext, quoteId: number, userId: number | null, opts: { startProject?: boolean; projectName?: string } = {}): { client_id: number | null; project_id: number | null } {
  const { db } = ctx;
  const startProject = opts.startProject !== false;
  return db.transaction(() => {
    let q = one(ctx, 'SELECT * FROM quotes WHERE id=?', quoteId) as Row;
    if (q.status !== 'accepted') db.prepare("UPDATE quotes SET status='accepted', updated_at=datetime('now') WHERE id=?").run(q.id);
    if (q.change_request_id) return { client_id: q.client_id as number | null, project_id: q.project_id as number | null }; // a change request's quotation belongs to its existing project
    const lead = q.lead_id ? one(ctx, 'SELECT * FROM leads WHERE id=?', q.lead_id) : undefined;
    let clientId = (q.client_id as number | null) ?? (lead?.client_id as number | null) ?? null;
    if (!clientId && lead) clientId = ensureClientForLead(ctx, lead, userId, 'prospect');
    if (clientId && !q.client_id) db.prepare('UPDATE quotes SET client_id=? WHERE id=?').run(clientId, q.id);
    q = one(ctx, 'SELECT * FROM quotes WHERE id=?', q.id) as Row;
    let projectId = (q.project_id as number | null) ?? null;
    if (clientId && !projectId && startProject) projectId = startProjectForQuote(ctx, q, clientId, userId, opts.projectName);
    if (lead && !(CLOSED_STAGES as readonly string[]).includes(String(lead.stage))) {
      db.prepare("UPDATE leads SET stage='accepted', next_followup=NULL, next_action='Collect the first payment (advance)', updated_at=datetime('now') WHERE id=?").run(lead.id);
      note(ctx, 'lead', lead.id as number, userId, `Quotation ${q.number} accepted — waiting for the first payment`);
    }
    return { client_id: clientId, project_id: projectId };
  })();
}

/**
 * Money arrived from a client. If this is the first payment the client ever made, the client is a real client now (Active)
 * and every lead of theirs that was waiting for the advance is Converted.
 */
export function paymentReceived(ctx: AppContext, clientId: number | null | undefined): void {
  if (!clientId) return;
  const { db } = ctx;
  const c = one(ctx, 'SELECT id, status FROM clients WHERE id=?', clientId);
  if (!c) return;
  if (c.status === 'prospect') db.prepare("UPDATE clients SET status='active', updated_at=datetime('now') WHERE id=?").run(clientId);
  for (const l of db.prepare("SELECT id FROM leads WHERE client_id=? AND stage='accepted'").all(clientId) as { id: number }[]) {
    db.prepare("UPDATE leads SET stage='won', closed_on=COALESCE(closed_on, ?), next_action=NULL, updated_at=datetime('now') WHERE id=?").run(today(), l.id);
    note(ctx, 'lead', l.id, null, 'First payment received — converted to a client');
  }
}
