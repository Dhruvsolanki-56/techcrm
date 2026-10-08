const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, UPLOAD_DIR, getSettings, audit, notify, today } = require('./db');
const { isFounder, hasFlag } = require('./security');
const RULES = require('../public/js/rules');     // same field rules the browser uses

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const deny = () => { throw new HttpError(403, 'You do not have access to this.'); };
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* ---------- visibility helpers ---------- */
// null = sees everything; array = list of project ids this user can see
function visibleProjectIds(u) {
  if (isFounder(u) || hasFlag(u, 'all_projects')) return null;
  return db.prepare(`SELECT project_id id FROM project_members WHERE user_id=? UNION SELECT id FROM projects WHERE manager_id=?`)
    .all(u.id, u.id).map((r) => r.id);
}
const inList = (ids) => (ids.length ? `(${ids.map(() => '?').join(',')})` : '(NULL)');
const NONE = { where: '1=0', params: [] };
const ALL = { where: '1=1', params: [] };

/* ---------- invoice / quote maths ---------- */
function normalizeItems(items) {
  if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }
  if (!Array.isArray(items)) items = [];
  return items.map((it) => ({
    description: String(it.description || '').slice(0, 1000),
    hsn: String(it.hsn || '').slice(0, 20),
    qty: Number(it.qty) || 0,
    rate: Number(it.rate) || 0,
  })).filter((it) => it.description || it.qty || it.rate).map((it, i) => {
    if (!(it.qty > 0) || it.qty > 1e7) throw new HttpError(400, `Line ${i + 1}: quantity must be more than 0.`);
    if (!(it.rate >= 0) || it.rate > 1e11) throw new HttpError(400, `Line ${i + 1}: rate cannot be negative.`);
    if (!it.description.trim()) throw new HttpError(400, `Line ${i + 1}: add a description.`);
    return it;
  });
}
function computeTotals(items, discount, taxRate, taxType) {
  const subtotal = round2(items.reduce((s, it) => s + it.qty * it.rate, 0));
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const taxable = subtotal - disc;
  const rate = taxType === 'none' ? 0 : Number(taxRate) || 0;
  const tax = round2(taxable * rate / 100);
  return { subtotal, discount: round2(disc), tax_amount: tax, total: round2(taxable + tax) };
}
function fiscalYearLabel(dateStr) {
  const startM = parseInt(getSettings().fy_start_month, 10) || 4;
  const d = new Date(dateStr || today());
  let y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (startM === 1) return String(y);
  if (m < startM) y -= 1;
  return `${y}-${String(y + 1).slice(2)}`;
}
function nextNumber(table, prefix, dateStr) {
  const fy = fiscalYearLabel(dateStr);
  const head = `${prefix}/${fy}/`;
  const rows = db.prepare(`SELECT number FROM ${table} WHERE number LIKE ?`).all(head + '%');
  let max = 0;
  for (const r of rows) { const n = parseInt(r.number.slice(head.length), 10); if (n > max) max = n; }
  return head + String(max + 1).padStart(4, '0');
}

function refreshInvoice(id) {
  if (!id) return;
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  if (!inv) return;
  const paid = db.prepare('SELECT COALESCE(SUM(amount + COALESCE(tds,0)),0) s FROM payments WHERE invoice_id=?').get(id).s;
  let status = inv.status;
  if (status !== 'draft' && status !== 'cancelled') {
    if (inv.total > 0 && paid >= inv.total - 0.005) status = 'paid';
    else if (paid > 0) status = 'partial';
    else status = 'sent';
    if (status !== 'paid' && inv.due_date && inv.due_date < today()) status = 'overdue';
  }
  db.prepare("UPDATE invoices SET paid_amount=?, status=?, updated_at=datetime('now') WHERE id=?").run(round2(paid), status, id);
}
function markOverdue() {
  db.prepare("UPDATE invoices SET status='overdue' WHERE status IN ('sent','partial') AND due_date IS NOT NULL AND due_date < ?").run(today());
  db.prepare("UPDATE quotes SET status='expired' WHERE status='sent' AND valid_until IS NOT NULL AND valid_until < ?").run(today());
}

/* ---------- deleting an entity cleans up its files, notes, docs ---------- */
function purgeEntity(type, id) {
  const docs = db.prepare('SELECT stored_name FROM documents WHERE entity_type=? AND entity_id=?').all(type, id);
  for (const d of docs) { try { fs.unlinkSync(path.join(UPLOAD_DIR, d.stored_name)); } catch { /* already gone */ } }
  db.prepare('DELETE FROM documents WHERE entity_type=? AND entity_id=?').run(type, id);
  db.prepare('DELETE FROM notes WHERE entity_type=? AND entity_id=?').run(type, id);
}

/* ---------- resource definitions ----------
   f: writable fields -> type  (t text, n number, i id/int, d date, b bool, j json)
   scope(u): {where, params} the user may read; throws/returns NONE if no access
   can(u, op, existing, data): may this user create/update/delete?  (default: founders only)           */
const lead = (u) => (hasFlag(u, 'leads') ? ALL : NONE);
const founderOnly = (u) => (isFounder(u) ? ALL : NONE);

// allowed values for status-like fields (anything else is rejected with 400)
const PRIO = ['low', 'medium', 'high', 'urgent'];
const TAX = ['cgst_sgst', 'igst', 'none'];
const E = {
  leadStage: ['new', 'contacted', 'meeting', 'proposal', 'negotiation', 'won', 'lost'],
  clientStatus: ['prospect', 'active', 'past', 'archived'],
  projectStatus: ['planning', 'active', 'review', 'on_hold', 'completed', 'maintenance', 'cancelled'],
  taskStatus: ['todo', 'in_progress', 'review', 'done'],
  quoteStatus: ['draft', 'sent', 'accepted', 'rejected', 'expired'],
  invoiceStatus: ['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled'],
  transferKind: ['capital_in', 'withdrawal', 'reimbursement', 'tax_paid', 'transfer'],
  renewalKind: ['domain', 'hosting', 'ssl', 'email', 'subscription', 'amc', 'other'],
  cycle: ['monthly', 'quarterly', 'half-yearly', 'yearly', 'biennial', 'triennial', 'one-time'],
};

const R = {
  leads: {
    table: 'leads', alias: 'l', label: (r) => r.name + (r.company ? ` (${r.company})` : ''), ts: true,
    f: { name: 't', company: 't', email: 't', phone: 't', website: 't', city: 't', source: 't', service: 't', value: 'n', stage: 't',
      owner_id: 'i', next_followup: 'd', expected_close: 'd', lost_reason: 't', notes: 't' },
    required: ['name'], nn: ['stage'], enums: { stage: E.leadStage },
    select: `SELECT l.*, u.name AS owner_name, c.company AS client_name FROM leads l LEFT JOIN users u ON u.id=l.owner_id LEFT JOIN clients c ON c.id=l.client_id`,
    filters: { stage: 'l.stage', owner_id: 'l.owner_id', source: 'l.source' }, order: 'l.created_at DESC',
    scope: lead,
    can: (u, op) => (op === 'delete' ? isFounder(u) : hasFlag(u, 'leads')),
    before(op, d, ex, u) { if (op === 'create') { d.created_by = u.id; if (!d.owner_id) d.owner_id = u.id; } },
    after(op, row, ex, u) {
      if (op === 'update' && ex && ex.stage !== row.stage) {
        db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body) VALUES('lead',?,?,'system',?)")
          .run(row.id, u.id, `Stage changed: ${ex.stage} → ${row.stage}`);
      }
      if (op === 'create' && row.owner_id && row.owner_id !== u.id) notify(row.owner_id, `New lead assigned: ${row.name}`, `#/leads/${row.id}`);
    },
    onDelete: (id) => purgeEntity('lead', id),
  },

  clients: {
    table: 'clients', alias: 'c', label: (r) => r.company, ts: true,
    f: { company: 't', industry: 't', website: 't', gstin: 't', pan: 't', address: 't', city: 't', state: 't', country: 't',
      status: 't', account_manager_id: 'i', tags: 't', notes: 't' },
    required: ['company'], nn: ['status'], enums: { status: E.clientStatus },
    select: `SELECT c.*, u.name AS manager_name,
      (SELECT name FROM contacts WHERE client_id=c.id ORDER BY is_primary DESC, id LIMIT 1) AS contact_name,
      (SELECT phone FROM contacts WHERE client_id=c.id ORDER BY is_primary DESC, id LIMIT 1) AS contact_phone,
      (SELECT email FROM contacts WHERE client_id=c.id ORDER BY is_primary DESC, id LIMIT 1) AS contact_email,
      (SELECT COUNT(*) FROM projects p WHERE p.client_id=c.id) AS project_count,
      (SELECT COALESCE(SUM(i.total-i.paid_amount),0) FROM invoices i WHERE i.client_id=c.id AND i.kind='invoice' AND i.status NOT IN ('draft','cancelled')) AS outstanding,
      (SELECT COALESCE(SUM(pm.amount),0) FROM payments pm WHERE pm.client_id=c.id) AS lifetime_received
      FROM clients c LEFT JOIN users u ON u.id=c.account_manager_id`,
    founderCols: ['outstanding', 'lifetime_received'],
    filters: { status: 'c.status', account_manager_id: 'c.account_manager_id' }, order: 'c.company COLLATE NOCASE',
    scope(u) {
      if (hasFlag(u, 'clients')) return ALL;
      const ids = visibleProjectIds(u);
      return { where: `c.id IN (SELECT client_id FROM projects WHERE id IN ${inList(ids)})`, params: ids };
    },
    can: (u) => isFounder(u),
    beforeDelete(id) {
      const p =db.prepare('SELECT COUNT(*) n FROM projects WHERE client_id=?').get(id).n;
      const i = db.prepare('SELECT COUNT(*) n FROM invoices WHERE client_id=?').get(id).n;
      if (p || i) throw new HttpError(409, `This client has ${p} project(s) and ${i} invoice(s). Set status to "Archived" instead of deleting, so your history stays intact.`);
    },
    onDelete: (id) => purgeEntity('client', id),
  },

  contacts: {
    table: 'contacts', alias: 'ct', label: (r) => r.name,
    f: { client_id: 'i', name: 't', role: 't', email: 't', phone: 't', whatsapp: 't', is_primary: 'b', notes: 't' },
    required: ['name', 'client_id'],
    select: `SELECT ct.*, c.company AS client_name FROM contacts ct LEFT JOIN clients c ON c.id=ct.client_id`,
    filters: { client_id: 'ct.client_id' }, order: 'ct.is_primary DESC, ct.name',
    scope(u) {
      if (hasFlag(u, 'clients')) return ALL;
      const ids = visibleProjectIds(u);
      return { where: `ct.client_id IN (SELECT client_id FROM projects WHERE id IN ${inList(ids)})`, params: ids };
    },
    can: (u) => isFounder(u),
  },

  projects: {
    table: 'projects', alias: 'p', label: (r) => r.name, ts: true,
    f: { client_id: 'i', name: 't', code: 't', type: 't', status: 't', priority: 't', start_date: 'd', deadline: 'd', completed_on: 'd',
      budget: 'n', manager_id: 'i', description: 't', specs: 't', tech_stack: 't', live_url: 't', staging_url: 't', repo_url: 't', design_url: 't' },
    required: ['name'], nn: ['status', 'priority'], enums: { status: E.projectStatus, priority: PRIO },
    select: `SELECT p.*, c.company AS client_name, u.name AS manager_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status='done') AS tasks_done,
      (SELECT GROUP_CONCAT(pm.user_id) FROM project_members pm WHERE pm.project_id=p.id) AS member_ids
      FROM projects p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN users u ON u.id=p.manager_id`,
    founderCols: ['budget'],
    filters: { client_id: 'p.client_id', status: 'p.status', manager_id: 'p.manager_id' }, order: 'p.created_at DESC',
    scope(u) {
      const ids = visibleProjectIds(u);
      return ids === null ? ALL : { where: `p.id IN ${inList(ids)}`, params: ids };
    },
    can: (u) => isFounder(u),
    before(op, d) {
      if (d.status === 'completed' && !d.completed_on) d.completed_on = today();
    },
    after(op, row) {
      if (op === 'create') {
        if (!row.code) db.prepare('UPDATE projects SET code=? WHERE id=?').run(`P-${String(new Date().getFullYear()).slice(2)}-${String(row.id).padStart(3, '0')}`, row.id);
        if (row.manager_id) db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(row.id, row.manager_id);
      } else if (row.manager_id) {
        db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(row.id, row.manager_id);
      }
    },
    beforeDelete(id) {
      const n = db.prepare('SELECT (SELECT COUNT(*) FROM invoices WHERE project_id=?) + (SELECT COUNT(*) FROM payments WHERE project_id=?) + (SELECT COUNT(*) FROM expenses WHERE project_id=?) n').get(id, id, id).n;
      if (n) throw new HttpError(409, 'This project has invoices, payments or expenses attached. Mark it Completed/Cancelled instead of deleting, so finance history stays intact.');
    },
    onDelete: (id) => purgeEntity('project', id),
  },

  tasks: {
    table: 'tasks', alias: 't', label: (r) => r.title, ts: true,
    f: { title: 't', description: 't', project_id: 'i', lead_id: 'i', assignee_id: 'i', priority: 't', status: 't', due_date: 'd' },
    required: ['title'], nn: ['priority', 'status'], enums: { status: E.taskStatus, priority: PRIO },
    select: `SELECT t.*, p.name AS project_name, p.client_id AS client_id, cl.company AS client_name, a.name AS assignee_name, cb.name AS creator_name
      FROM tasks t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN clients cl ON cl.id=p.client_id
      LEFT JOIN users a ON a.id=t.assignee_id LEFT JOIN users cb ON cb.id=t.created_by`,
    filters: { project_id: 't.project_id', assignee_id: 't.assignee_id', status: 't.status', priority: 't.priority', lead_id: 't.lead_id' },
    order: `CASE t.status WHEN 'done' THEN 1 ELSE 0 END, COALESCE(t.due_date,'9999'), t.id DESC`,
    scope(u) {
      if (isFounder(u)) return ALL;
      const ids = visibleProjectIds(u);
      return { where: `(t.assignee_id=? OR t.created_by=? OR t.project_id IN ${inList(ids || [])})`, params: [u.id, u.id, ...(ids || [])] };
    },
    can(u, op, ex, data) {
      if (isFounder(u)) return true;
      if (op === 'create') return true;
      if (op === 'update') return ex && (ex.assignee_id === u.id || ex.created_by === u.id);
      return false;
    },
    before(op, d, ex, u) {
      if (!isFounder(u)) {
        if (op === 'create') { d.assignee_id = u.id; if (!hasFlag(u, 'leads')) delete d.lead_id; }
        if (op === 'update') {               // interns may only move their task along and describe progress
          for (const k of Object.keys(d)) if (!['status', 'description'].includes(k)) delete d[k];
        }
      }
      if (d.status) {
        if (d.status === 'done' && !(ex && ex.status === 'done')) d.completed_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        if (d.status !== 'done') d.completed_at = null;
      }
    },
    after(op, row, ex, u) {
      if (row.assignee_id && row.assignee_id !== u.id && (op === 'create' || (ex && ex.assignee_id !== row.assignee_id))) {
        notify(row.assignee_id, `${u.name} assigned you a task: ${row.title}`, '#/tasks');
      }
      if (op === 'update' && ex && ex.status !== row.status && row.created_by && row.created_by !== u.id) {
        notify(row.created_by, `${u.name} moved "${row.title}" to ${row.status.replace('_', ' ')}`, '#/tasks');
      }
    },
    extraSet: ['completed_at'],
    onDelete: (id) => purgeEntity('task', id),
  },

  documents: {
    table: 'documents', alias: 'd', label: (r) => r.title,
    f: { title: 't', category: 't', notes: 't' },
    required: ['title'],
    select: `SELECT d.*, u.name AS uploader_name,
      CASE d.entity_type
        WHEN 'client' THEN (SELECT company FROM clients WHERE id=d.entity_id)
        WHEN 'project' THEN (SELECT name FROM projects WHERE id=d.entity_id)
        WHEN 'lead' THEN (SELECT name FROM leads WHERE id=d.entity_id)
        WHEN 'invoice' THEN (SELECT number FROM invoices WHERE id=d.entity_id)
        WHEN 'quote' THEN (SELECT number FROM quotes WHERE id=d.entity_id)
        WHEN 'task' THEN (SELECT title FROM tasks WHERE id=d.entity_id)
        ELSE NULL END AS entity_name
      FROM documents d LEFT JOIN users u ON u.id=d.uploaded_by`,
    filters: { entity_type: 'd.entity_type', entity_id: 'd.entity_id', category: 'd.category' }, order: 'd.created_at DESC',
    scope(u) {
      if (isFounder(u)) return ALL;
      const ids = visibleProjectIds(u) || [];
      return { where: `(d.uploaded_by=? OR (d.entity_type='project' AND d.entity_id IN ${inList(ids)}) OR (d.entity_type='task' AND d.entity_id IN (SELECT id FROM tasks WHERE assignee_id=? OR created_by=?)))`, params: [u.id, ...ids, u.id, u.id] };
    },
    can: (u, op, ex) => isFounder(u) || (ex && ex.uploaded_by === u.id),
    onDelete(id, row) { try { fs.unlinkSync(path.join(UPLOAD_DIR, row.stored_name)); } catch { /* ok */ } },
  },

  quotes: {
    table: 'quotes', alias: 'q', label: (r) => r.number, ts: true, json: ['items'],
    f: { number: 't', client_id: 'i', lead_id: 'i', project_id: 'i', title: 't', issue_date: 'd', valid_until: 'd', status: 't',
      items: 'j', discount: 'n', tax_type: 't', tax_rate: 'n', currency: 't', terms: 't', notes: 't' },
    required: ['title'], nn: ['status'], enums: { status: E.quoteStatus, tax_type: TAX },
    select: `SELECT q.*, c.company AS client_name, l.name AS lead_name, p.name AS project_name FROM quotes q
      LEFT JOIN clients c ON c.id=q.client_id LEFT JOIN leads l ON l.id=q.lead_id LEFT JOIN projects p ON p.id=q.project_id`,
    filters: { client_id: 'q.client_id', lead_id: 'q.lead_id', status: 'q.status', project_id: 'q.project_id' }, order: 'q.created_at DESC',
    scope: founderOnly, can: (u) => isFounder(u),
    before: docBefore('quotes', 'quote_prefix', 'terms_quote'),
    onDelete: (id) => purgeEntity('quote', id),
  },

  invoices: {
    table: 'invoices', alias: 'i', label: (r) => r.number, ts: true, json: ['items'],
    f: { number: 't', kind: 't', client_id: 'i', project_id: 'i', title: 't', issue_date: 'd', due_date: 'd', status: 't',
      items: 'j', discount: 'n', tax_type: 't', tax_rate: 'n', currency: 't', terms: 't', notes: 't' },
    required: ['client_id'], nn: ['status', 'kind'], enums: { status: E.invoiceStatus, kind: ['invoice', 'proforma'], tax_type: TAX },
    select: `SELECT i.*, (i.total - i.paid_amount) AS balance, c.company AS client_name, p.name AS project_name, q.number AS quote_number
      FROM invoices i LEFT JOIN clients c ON c.id=i.client_id LEFT JOIN projects p ON p.id=i.project_id LEFT JOIN quotes q ON q.id=i.quote_id`,
    filters: { client_id: 'i.client_id', project_id: 'i.project_id', status: 'i.status', kind: 'i.kind' }, order: 'i.issue_date DESC, i.id DESC',
    scope: founderOnly, can: (u) => isFounder(u),
    before: docBefore('invoices', 'invoice_prefix', 'terms_invoice'),
    after(op, row) { refreshInvoice(row.id); },
    beforeDelete(id) {
      if (db.prepare('SELECT COUNT(*) n FROM payments WHERE invoice_id=?').get(id).n)
        throw new HttpError(409, 'Payments are recorded against this invoice. Delete those payments first, or mark the invoice Cancelled.');
    },
    onDelete: (id) => purgeEntity('invoice', id),
  },

  payments: {
    table: 'payments', alias: 'pm', label: (r) => `₹${r.amount}`,
    f: { invoice_id: 'i', client_id: 'i', project_id: 'i', account_id: 'i', date: 'd', amount: 'n', tds: 'n', method: 't', reference: 't', notes: 't' },
    required: ['date', 'amount'],
    select: `SELECT pm.*, c.company AS client_name, i.number AS invoice_number, p.name AS project_name, a.name AS account_name FROM payments pm
      LEFT JOIN clients c ON c.id=pm.client_id LEFT JOIN invoices i ON i.id=pm.invoice_id LEFT JOIN projects p ON p.id=pm.project_id LEFT JOIN accounts a ON a.id=pm.account_id`,
    filters: { client_id: 'pm.client_id', invoice_id: 'pm.invoice_id', project_id: 'pm.project_id', account_id: 'pm.account_id' }, order: 'pm.date DESC, pm.id DESC',
    scope: founderOnly, can: (u) => isFounder(u),
    before(op, d, ex, u) {
      if (op === 'create') d.created_by = u.id;
      const invId = d.invoice_id !== undefined ? d.invoice_id : ex && ex.invoice_id;
      if (invId) {
        const inv = db.prepare('SELECT client_id, project_id FROM invoices WHERE id=?').get(invId);
        if (inv) { d.client_id = inv.client_id; if (!d.project_id) d.project_id = inv.project_id; }
      }
      if (d.amount !== undefined && !(d.amount > 0)) throw new HttpError(400, 'Amount must be greater than zero.');
      if (d.tds !== undefined && d.tds < 0) throw new HttpError(400, 'TDS cannot be negative.');
    },
    after(op, row, ex) { refreshInvoice(row.invoice_id); if (ex && ex.invoice_id !== row.invoice_id) refreshInvoice(ex.invoice_id); },
    onDelete(id, row) { refreshInvoice(row.invoice_id); },
  },

  expenses: {
    table: 'expenses', alias: 'e', label: (r) => `${r.category || 'Expense'} ₹${r.amount}`,
    f: { date: 'd', category: 't', vendor: 't', description: 't', amount: 'n', tax_amount: 'n', project_id: 'i', client_id: 'i', account_id: 'i',
      paid_by_id: 'i', method: 't', reference: 't', status: 't', notes: 't' },
    required: ['date', 'amount'], nn: ['status'], enums: { status: ['paid', 'pending'] },
    select: `SELECT e.*, p.name AS project_name, c.company AS client_name, a.name AS account_name, u.name AS paid_by_name FROM expenses e
      LEFT JOIN projects p ON p.id=e.project_id LEFT JOIN clients c ON c.id=e.client_id LEFT JOIN accounts a ON a.id=e.account_id LEFT JOIN users u ON u.id=e.paid_by_id`,
    filters: { project_id: 'e.project_id', category: 'e.category', account_id: 'e.account_id', paid_by_id: 'e.paid_by_id', status: 'e.status' }, order: 'e.date DESC, e.id DESC',
    scope: founderOnly, can: (u) => isFounder(u),
    before(op, d, ex, u) {
      if (op === 'create') d.created_by = u.id;
      if ((d.amount !== undefined && d.amount < 0) || (d.tax_amount !== undefined && d.tax_amount < 0)) throw new HttpError(400, 'Amounts cannot be negative.');
    },
    onDelete: (id) => purgeEntity('expense', id),
  },

  accounts: {
    table: 'accounts', alias: 'a', label: (r) => r.name,
    f: { name: 't', type: 't', opening_balance: 'n', notes: 't', active: 'b' }, required: ['name'], enums: { type: ['bank', 'cash', 'upi', 'card', 'wallet'] },
    select: `SELECT a.*, a.opening_balance
      + COALESCE((SELECT SUM(amount) FROM payments WHERE account_id=a.id),0)
      - COALESCE((SELECT SUM(amount) FROM expenses WHERE account_id=a.id AND paid_by_id IS NULL AND status='paid'),0)
      + COALESCE((SELECT SUM(amount) FROM transfers WHERE (account_id=a.id AND kind IN ('capital_in','loan_in')) OR (to_account_id=a.id AND kind='transfer')),0)
      - COALESCE((SELECT SUM(amount) FROM transfers WHERE account_id=a.id AND kind IN ('withdrawal','loan_repay','tax_paid','transfer','reimbursement')),0) AS balance
      FROM accounts a`,
    filters: {}, order: 'a.active DESC, a.name',
    scope: (u) => (isFounder(u) ? ALL : NONE), can: (u) => isFounder(u),
    beforeDelete(id) {
      const n = db.prepare('SELECT (SELECT COUNT(*) FROM payments WHERE account_id=?) + (SELECT COUNT(*) FROM expenses WHERE account_id=?) + (SELECT COUNT(*) FROM transfers WHERE account_id=? OR to_account_id=?) n').get(id, id, id, id).n;
      if (n) throw new HttpError(409, 'This account has transactions. Mark it inactive instead of deleting.');
    },
  },

  transfers: {
    table: 'transfers', alias: 't', label: (r) => `${r.kind} ₹${r.amount}`,
    f: { date: 'd', kind: 't', amount: 'n', account_id: 'i', to_account_id: 'i', user_id: 'i', notes: 't' },
    required: ['date', 'kind', 'amount'], enums: { kind: E.transferKind },
    select: `SELECT t.*, a.name AS account_name, a2.name AS to_account_name, u.name AS user_name FROM transfers t
      LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN accounts a2 ON a2.id=t.to_account_id LEFT JOIN users u ON u.id=t.user_id`,
    filters: { kind: 't.kind', user_id: 't.user_id' }, order: 't.date DESC, t.id DESC',
    scope: founderOnly, can: (u) => isFounder(u),
    before(op, d) { if (d.amount !== undefined && !(d.amount > 0)) throw new HttpError(400, 'Amount must be greater than zero.'); },
  },

  renewals: {
    table: 'renewals', alias: 'r', label: (r) => r.name,
    f: { client_id: 'i', project_id: 'i', kind: 't', name: 't', vendor: 't', renewal_date: 'd', cycle: 't', our_cost: 'n', client_price: 'n', auto_renew: 'b', status: 't', notes: 't' },
    required: ['name'], nn: ['status'], enums: { kind: E.renewalKind, cycle: E.cycle, status: ['active', 'lapsed', 'cancelled'] },
    select: `SELECT r.*, c.company AS client_name, p.name AS project_name FROM renewals r LEFT JOIN clients c ON c.id=r.client_id LEFT JOIN projects p ON p.id=r.project_id`,
    filters: { client_id: 'r.client_id', project_id: 'r.project_id', kind: 'r.kind', status: 'r.status' }, order: `COALESCE(r.renewal_date,'9999')`,
    scope: founderOnly, can: (u) => isFounder(u),
  },

  maintenance_logs: {
    table: 'maintenance_logs', alias: 'ml', label: (r) => r.title,
    f: { client_id: 'i', project_id: 'i', title: 't', description: 't', type: 't', priority: 't', status: 't',
      reported_on: 'd', resolved_on: 'd', hours: 'n', billable: 'b', assignee_id: 'i' },
    required: ['title'], nn: ['status'], enums: { status: ['open', 'in_progress', 'resolved'], priority: PRIO },
    select: `SELECT ml.*, c.company AS client_name, p.name AS project_name, a.name AS assignee_name FROM maintenance_logs ml
      LEFT JOIN clients c ON c.id=ml.client_id LEFT JOIN projects p ON p.id=ml.project_id LEFT JOIN users a ON a.id=ml.assignee_id`,
    filters: { client_id: 'ml.client_id', project_id: 'ml.project_id', status: 'ml.status' }, order: `CASE ml.status WHEN 'resolved' THEN 1 ELSE 0 END, COALESCE(ml.reported_on,'0') DESC, ml.id DESC`,
    scope(u) {
      if (hasFlag(u, 'maintenance')) return ALL;
      const ids = visibleProjectIds(u) || [];
      return { where: `(ml.assignee_id=? OR ml.project_id IN ${inList(ids)})`, params: [u.id, ...ids] };
    },
    can(u, op, ex) { if (isFounder(u)) return true; if (op === 'delete') return false; return op === 'create' || (ex && (ex.assignee_id === u.id || hasFlag(u, 'maintenance') || ex.created_by === u.id)); },
    before(op, d, ex, u) {
      if (op === 'create') { d.created_by = u.id; if (!d.reported_on) d.reported_on = today(); }
      if (!isFounder(u)) {
        delete d.billable;
        // interns record progress on existing items; they cannot re-point them at other clients/projects/people
        if (op === 'update') for (const k of Object.keys(d)) if (!['status', 'description', 'hours', 'resolved_on'].includes(k)) delete d[k];
        if (op === 'create' && !hasFlag(u, 'maintenance')) { if (!d.project_id) throw new HttpError(400, 'Choose the project this work is for.'); d.assignee_id = u.id; }
      }
      if (d.project_id) d.client_id = (db.prepare('SELECT client_id FROM projects WHERE id=?').get(d.project_id) || {}).client_id || d.client_id || null;
      if (d.status === 'resolved' && !d.resolved_on && !(ex && ex.resolved_on)) d.resolved_on = today();
    },
  },

  events: {
    table: 'events', alias: 'ev', label: (r) => r.title,
    f: { title: 't', date: 'd', end_date: 'd', kind: 't', client_id: 'i', project_id: 'i', notes: 't' }, required: ['title', 'date'],
    select: `SELECT ev.*, c.company AS client_name, p.name AS project_name FROM events ev LEFT JOIN clients c ON c.id=ev.client_id LEFT JOIN projects p ON p.id=ev.project_id`,
    filters: { client_id: 'ev.client_id', project_id: 'ev.project_id' }, order: 'ev.date',
    // interns: company-wide reminders plus reminders on projects they work on
    scope(u) {
      if (isFounder(u)) return ALL;
      const ids = visibleProjectIds(u);
      if (ids === null) return ALL;
      return { where: `((ev.project_id IS NULL AND ev.client_id IS NULL) OR ev.project_id IN ${inList(ids)})`, params: ids };
    },
    can: (u) => isFounder(u),
    before(op, d, ex, u) { if (op === 'create') d.created_by = u.id; },
  },
};

// shared before-hook for quotes & invoices: items, totals, number, defaults
function docBefore(table, prefixKey, termsKey) {
  return function (op, d, ex, u) {
    const s = getSettings();
    if (op === 'create') {
      d.created_by = u.id;
      if (!d.issue_date) d.issue_date = today();
      if (d.tax_rate === undefined || d.tax_rate === null) d.tax_rate = Number(s.default_tax_rate) || 0;
      if (!d.tax_type) d.tax_type = s.default_tax_type;
      if (!d.currency) d.currency = s.currency;
      if (!d.terms) d.terms = s[termsKey];
      if (table === 'invoices' && !d.due_date) {
        const x = new Date(d.issue_date); x.setDate(x.getDate() + 15); d.due_date = x.toISOString().slice(0, 10);
      }
      if (table === 'quotes' && !d.valid_until) {
        const x = new Date(d.issue_date); x.setDate(x.getDate() + 30); d.valid_until = x.toISOString().slice(0, 10);
      }
    }
    if (!d.number && (op === 'create' || (ex && !ex.number))) {
      const pfx = table === 'invoices' && (d.kind || (ex && ex.kind)) === 'proforma' ? 'PI' : s[prefixKey];
      d.number = nextNumber(table, pfx, d.issue_date || (ex && ex.issue_date));
    }
    if (d.items !== undefined || d.discount !== undefined || d.tax_rate !== undefined || d.tax_type !== undefined || op === 'create') {
      const items = normalizeItems(d.items !== undefined ? JSON.parse(d.items) : ex ? ex.items : []);
      const discount = d.discount !== undefined ? d.discount : ex ? ex.discount : 0;
      const taxRate = d.tax_rate !== undefined ? d.tax_rate : ex ? ex.tax_rate : 0;
      const taxType = d.tax_type !== undefined ? d.tax_type : ex ? ex.tax_type : 'none';
      d.items = JSON.stringify(items);
      Object.assign(d, computeTotals(items, discount, taxRate, taxType));
    }
  };
}

/* ---------- generic engine ---------- */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NICE = { value: 'Deal value', budget: 'Project value', tds: 'TDS', gstin: 'GSTIN', pan: 'PAN', tax_amount: 'GST amount', live_url: 'Live site', staging_url: 'Staging', repo_url: 'Repository', design_url: 'Design link', our_cost: 'We pay', client_price: 'Client pays', opening_balance: 'Opening balance', tax_rate: 'Tax rate' };
const nice = (k) => NICE[k] || (k.replace(/_id$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
function coerce(def, body, op) {
  const out = {};
  for (const [k, t] of Object.entries(def.f)) {
    if (!(k in body)) continue;
    let v = body[k];
    if (typeof v === 'string') v = v.trim();
    const empty = v === undefined || v === null || v === '';
    switch (t) {
      case 't': out[k] = empty ? null : String(v).slice(0, 20000); break;
      case 'n': { const n = empty ? 0 : Number(v); if (!Number.isFinite(n)) throw new HttpError(400, `${k} must be a number.`); out[k] = n; break; }
      case 'i': { const n = empty ? null : parseInt(v, 10); if (n !== null && !Number.isInteger(n)) throw new HttpError(400, `${k} is invalid.`); out[k] = n; break; }
      case 'd': if (!empty && !RULES.validDate(String(v))) throw new HttpError(400, `${nice(k)} must be a real date (YYYY-MM-DD).`); out[k] = empty ? null : v; break;
      case 'b': out[k] = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0; break;
      case 'j': out[k] = typeof v === 'string' ? v : JSON.stringify(v == null ? [] : v); break;
    }
  }
  // field rules (letters-only names, phone digits, GSTIN, no negative money …)
  for (const k of Object.keys(out)) {
    const kind = RULES.kindFor(def.table, k); if (!kind) continue;
    out[k] = RULES.normalize(kind, out[k]);
    const e = RULES.check(kind, out[k]); if (e) throw new HttpError(400, `${nice(k)} ${e}.`);
  }
  for (const k of def.nn || []) if (k in out && out[k] === null) delete out[k];   // keep DB default
  for (const [k, allowed] of Object.entries(def.enums || {})) {
    if (out[k] != null && !allowed.includes(out[k])) throw new HttpError(400, `${k.replace(/_/g, ' ')} must be one of: ${allowed.join(', ')}.`);
  }
  if (op === 'create') for (const k of def.required || []) if (out[k] === undefined || out[k] === null) throw new HttpError(400, `${k.replace(/_id$/, '').replace(/_/g, ' ')} is required.`);
  if (op === 'update') for (const k of def.required || []) if (k in out && out[k] === null) throw new HttpError(400, `${k.replace(/_/g, ' ')} cannot be empty.`);
  return out;
}

function shape(def, row, user) {
  if (!row) return row;
  for (const k of def.json || []) { try { row[k] = JSON.parse(row[k] || '[]'); } catch { row[k] = []; } }
  if (!isFounder(user)) for (const k of def.founderCols || []) delete row[k];
  return row;
}

function getScoped(name, id, user) {
  const def = R[name];
  const sc = def.scope(user);
  const row = db.prepare(`${def.select} WHERE ${def.alias}.id=? AND (${sc.where})`).get(id, ...sc.params);
  return row ? { def, row } : null;
}

function buildRouter() {
  const router = express.Router();
  const defOf = (req) => { if (!Object.hasOwn(R, req.params.res)) throw new HttpError(404, 'Unknown resource'); return R[req.params.res]; };

  router.get('/:res', (req, res) => {
    const def = defOf(req);
    const sc = def.scope(req.user);
    if (sc === NONE || sc.where === '1=0') deny();
    if (def.table === 'invoices' || def.table === 'quotes') markOverdue();
    let sql = `${def.select} WHERE (${sc.where})`;
    const params = [...sc.params];
    for (const [k, col] of Object.entries(def.filters || {})) {
      const v = req.query[k] === undefined ? undefined : String(req.query[k]);
      if (v !== undefined && v !== '') {
        if (v === 'null') sql += ` AND ${col} IS NULL`;
        else if (String(v).includes(',')) { const parts = String(v).split(','); sql += ` AND ${col} IN (${parts.map(() => '?').join(',')})`; params.push(...parts); }
        else { sql += ` AND ${col} = ?`; params.push(v); }
      }
    }
    sql += ` ORDER BY ${def.order} LIMIT 5000`;
    res.json(db.prepare(sql).all(...params).map((r) => shape(def, r, req.user)));
  });

  router.get('/:res/export.csv', (req, res) => {
    const def = defOf(req);
    const sc = def.scope(req.user);
    if (sc.where === '1=0') deny();
    if (!isFounder(req.user)) deny();
    const rows = db.prepare(`${def.select} WHERE (${sc.where}) ORDER BY ${def.order}`).all(...sc.params).map((r) => shape(def, r, req.user));
    const cols = rows.length ? Object.keys(rows[0]).filter((k) => !(def.json || []).includes(k)) : [];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
    audit(req.user, 'export', def.table, null, `${rows.length} rows`, req.ip);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${def.table}-${today()}.csv"`);
    res.send('﻿' + csv);
  });

  router.get('/:res/:id', (req, res) => {
    const def = defOf(req);
    const hit = getScoped(req.params.res, req.params.id, req.user);
    if (!hit) throw new HttpError(404, 'Not found (or you do not have access).');
    res.json(shape(def, hit.row, req.user));
  });

  router.post('/:res', (req, res) => {
    const def = defOf(req);
    if (def.scope(req.user).where === '1=0' && !(def.can(req.user, 'create'))) deny();
    if (!def.can(req.user, 'create', null, req.body)) deny();
    const data = coerce(def, req.body || {}, 'create');
    if (def.before) def.before('create', data, null, req.user);
    const dmsg = RULES.checkDates(def.table, data); if (dmsg) throw new HttpError(400, dmsg);
    // interns creating a task inside a project they cannot see is not allowed
    if (!isFounder(req.user) && def.table === 'tasks' && data.project_id) {
      const ids = visibleProjectIds(req.user);
      if (ids !== null && !ids.includes(data.project_id)) deny();
    }
    if (!isFounder(req.user) && def.table === 'maintenance_logs' && !hasFlag(req.user, 'maintenance')) {
      const ids = visibleProjectIds(req.user);
      if (ids !== null && !ids.includes(data.project_id)) deny();
    }
    const cols = Object.keys(data);
    if (def.table === 'tasks' && !data.created_by) { data.created_by = req.user.id; cols.push('created_by'); }
    const id = db.prepare(`INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((c) => data[c])).lastInsertRowid;
    const row = db.prepare(`${def.select} WHERE ${def.alias}.id=?`).get(id);
    if (def.after) def.after('create', row, null, req.user);
    audit(req.user, 'create', def.table, id, def.label(row), req.ip);
    res.status(201).json(shape(def, db.prepare(`${def.select} WHERE ${def.alias}.id=?`).get(id), req.user));
  });

  router.put('/:res/:id', (req, res) => {
    const def = defOf(req);
    const hit = getScoped(req.params.res, req.params.id, req.user);
    if (!hit) throw new HttpError(404, 'Not found (or you do not have access).');
    const ex = hit.row;
    if (!def.can(req.user, 'update', ex, req.body)) deny();
    const data = coerce(def, req.body || {}, 'update');
    if (def.before) def.before('update', data, ex, req.user);
    const dmsg = RULES.checkDates(def.table, { ...ex, ...data }); if (dmsg) throw new HttpError(400, dmsg);
    const cols = Object.keys(data);
    if (cols.length) {
      db.prepare(`UPDATE ${def.table} SET ${cols.map((c) => `${c}=?`).join(',')}${def.ts ? ",updated_at=datetime('now')" : ''} WHERE id=?`)
        .run(...cols.map((c) => data[c]), ex.id);
    }
    const row = db.prepare(`${def.select} WHERE ${def.alias}.id=?`).get(ex.id);
    if (def.after) def.after('update', row, ex, req.user);
    audit(req.user, 'update', def.table, ex.id, def.label(row), req.ip);
    res.json(shape(def, db.prepare(`${def.select} WHERE ${def.alias}.id=?`).get(ex.id), req.user));
  });

  router.delete('/:res/:id', (req, res) => {
    const def = defOf(req);
    const hit = getScoped(req.params.res, req.params.id, req.user);
    if (!hit) throw new HttpError(404, 'Not found (or you do not have access).');
    if (!def.can(req.user, 'delete', hit.row)) deny();
    if (def.beforeDelete) def.beforeDelete(hit.row.id, hit.row);
    db.prepare(`DELETE FROM ${def.table} WHERE id=?`).run(hit.row.id);
    if (def.onDelete) def.onDelete(hit.row.id, hit.row);
    audit(req.user, 'delete', def.table, hit.row.id, def.label(hit.row), req.ip);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { R, buildRouter, HttpError, getScoped, visibleProjectIds, refreshInvoice, markOverdue, normalizeItems, computeTotals, nextNumber, purgeEntity, inList, round2, deny };
