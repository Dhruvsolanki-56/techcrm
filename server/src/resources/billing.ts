import {
  ACCOUNT_TYPES, CYCLES, GRANT_STATUSES, INVOICE_KINDS, INVOICE_STATUSES, MATCH_STATUSES, QUOTE_STATUSES, RENEWAL_KINDS, RENEWAL_STATUSES, TAX_TYPES, TRANSFER_KINDS, values,
} from '@crm/shared';
import { defineResource } from '../crud/define';
import { refSql } from '../crud/refs';
import { ALL, NONE, type ResourceDef } from '../crud/types';
import type { Row } from '../db/connection';
import { HttpError } from '../shared/errors';
import { isFounder } from '../security/permissions';
import { founderScope } from '../domain/access';
import { documentBefore, markOverdue, refreshInvoice } from '../domain/billing';
import { linkInvoiceToChangeRequest, syncChangeRequestWithQuote } from '../domain/changeRequests';
import { purgeEntity } from '../domain/entities';
import { runAutoDebits } from '../jobs/autoDebit';
import type { ResourceDeps } from './deps';

export function billingResources({ ctx }: ResourceDeps): Record<string, ResourceDef> {
  const { db } = ctx;
  const one = (sql: string, ...p: unknown[]): Row | undefined => db.prepare(sql).get(...p) as Row | undefined;
  const nonNegative = (d: Row, keys: string[], message: string): void => {
    for (const k of keys) if (d[k] !== undefined && d[k] !== null && d[k] < 0) throw new HttpError(400, message);
  };
  /** A change request linked to a quote / invoice must be on the same project. */
  const checkChangeRequest = (d: Row, ex: Row | null): void => {
    const crId = 'change_request_id' in d ? d.change_request_id : ex?.change_request_id;
    if (!crId) return;
    const cr = one('SELECT project_id, client_id FROM change_requests WHERE id=?', crId);
    if (!cr) throw new HttpError(400, 'That change request does not exist.');
    const pid = 'project_id' in d ? d.project_id : ex?.project_id;
    if (pid && pid !== cr.project_id) throw new HttpError(400, 'The change request belongs to a different project.');
    if (!pid) d.project_id = cr.project_id;
    if (!('client_id' in d) && !ex?.client_id) d.client_id = cr.client_id;
  };

  const quotes = defineResource({
    table: 'quotes', alias: 'q', timestamps: true, json: ['items'],
    label: (r) => r.number,
    fields: {
      number: 't', client_id: 'i', lead_id: 'i', project_id: 'i', change_request_id: 'i', title: 't', issue_date: 'd', valid_until: 'd', status: 't', items: 'j',
      discount: 'n', tax_type: 't', tax_rate: 'n', currency: 't', terms: 't', notes: 't',
    },
    required: ['title'], notNull: ['status'], enums: { status: values(QUOTE_STATUSES), tax_type: values(TAX_TYPES) },
    columns: `q.*, c.company AS client_name, l.name AS lead_name, p.name AS project_name, cr.title AS change_request_title`,
    from: `FROM quotes q LEFT JOIN clients c ON c.id=q.client_id LEFT JOIN leads l ON l.id=q.lead_id LEFT JOIN projects p ON p.id=q.project_id LEFT JOIN change_requests cr ON cr.id=q.change_request_id`,
    search: ['q.number', 'q.title', 'c.company', 'l.name', 'l.company', 'p.name'],
    filters: { client_id: 'q.client_id', lead_id: 'q.lead_id', status: 'q.status', project_id: 'q.project_id', change_request_id: 'q.change_request_id' },
    dateField: 'q.issue_date',
    sortable: { number: 'q.number', issue_date: 'q.issue_date', total: 'q.total', status: 'q.status', client_name: 'c.company COLLATE NOCASE', created_at: 'q.created_at' },
    order: 'q.created_at DESC, q.id DESC',
    scope: founderScope, can: (u) => isFounder(u),
    before(op, d, ex, actor) {
      documentBefore(ctx, 'quotes', 'quote_prefix', 'terms_quote')(op, d, ex, actor);
      checkChangeRequest(d, ex);
    },
    after(op, row, ex, { user }) {
      syncChangeRequestWithQuote(ctx, row, ex ? ex.status : null, user.id);
      if (op === 'create' && row.change_request_id) {
        db.prepare("UPDATE change_requests SET quote_id=?, status=CASE WHEN status IN ('requested','estimated') THEN 'quoted' ELSE status END, updated_at=datetime('now') WHERE id=?").run(row.id, row.change_request_id);
      }
    },
    onDelete: (id, row) => {
      if (row.change_request_id) db.prepare("UPDATE change_requests SET quote_id=NULL, status=CASE WHEN status='quoted' THEN 'estimated' ELSE status END WHERE quote_id=?").run(id);
      purgeEntity(ctx, 'quote', id);
    },
  });

  const invoices = defineResource({
    table: 'invoices', alias: 'i', timestamps: true, json: ['items'],
    label: (r) => r.number,
    fields: {
      number: 't', kind: 't', client_id: 'i', project_id: 'i', change_request_id: 'i', title: 't', issue_date: 'd', due_date: 'd', status: 't', items: 'j',
      discount: 'n', tax_type: 't', tax_rate: 'n', currency: 't', terms: 't', notes: 't',
    },
    required: ['client_id'], notNull: ['status', 'kind'], enums: { status: values(INVOICE_STATUSES), kind: [...INVOICE_KINDS], tax_type: values(TAX_TYPES) },
    columns: `i.*, (i.total - i.paid_amount) AS balance, c.company AS client_name, p.name AS project_name, q.number AS quote_number, cr.title AS change_request_title`,
    from: `FROM invoices i LEFT JOIN clients c ON c.id=i.client_id LEFT JOIN projects p ON p.id=i.project_id LEFT JOIN quotes q ON q.id=i.quote_id LEFT JOIN change_requests cr ON cr.id=i.change_request_id`,
    search: ['i.number', 'i.title', 'c.company', 'p.name', 'q.number'],
    filters: { client_id: 'i.client_id', project_id: 'i.project_id', status: 'i.status', kind: 'i.kind', change_request_id: 'i.change_request_id' },
    dateField: 'i.issue_date',
    sortable: { number: 'i.number', issue_date: 'i.issue_date', due_date: "COALESCE(i.due_date,'9999')", total: 'i.total', balance: 'balance', status: 'i.status', client_name: 'c.company COLLATE NOCASE' },
    order: 'i.issue_date DESC, i.id DESC',
    scope: founderScope, can: (u) => isFounder(u),
    before(op, d, ex, actor) {
      documentBefore(ctx, 'invoices', 'invoice_prefix', 'terms_invoice')(op, d, ex, actor);
      checkChangeRequest(d, ex);
    },
    after(op, row, _ex, { user }) {
      refreshInvoice(ctx, row.id);
      if (op === 'create') linkInvoiceToChangeRequest(ctx, row, user.id);
    },
    beforeDelete(id) {
      if ((one('SELECT COUNT(*) n FROM payments WHERE invoice_id=?', id) as { n: number }).n) {
        throw new HttpError(409, 'Payments are recorded against this invoice. Delete those payments first, or mark the invoice Cancelled.');
      }
    },
    onDelete: (id) => {
      db.prepare('UPDATE change_requests SET invoice_id=NULL WHERE invoice_id=?').run(id);
      purgeEntity(ctx, 'invoice', id);
    },
  });

  const payments = defineResource({
    table: 'payments', alias: 'pm',
    label: (r) => `₹${r.amount}`,
    fields: { invoice_id: 'i', client_id: 'i', project_id: 'i', account_id: 'i', date: 'd', amount: 'n', tds: 'n', method: 't', reference: 't', notes: 't', category: 't', grant_id: 'i' },
    required: ['date', 'amount'],
    columns: 'pm.*, c.company AS client_name, i.number AS invoice_number, p.name AS project_name, a.name AS account_name, g.name AS grant_name',
    from: `FROM payments pm LEFT JOIN clients c ON c.id=pm.client_id LEFT JOIN invoices i ON i.id=pm.invoice_id LEFT JOIN projects p ON p.id=pm.project_id
      LEFT JOIN accounts a ON a.id=pm.account_id LEFT JOIN grants g ON g.id=pm.grant_id`,
    search: ['pm.notes', 'pm.reference', 'pm.method', 'pm.category', 'c.company', 'i.number', 'p.name', 'g.name', refSql('payments', 'pm')],
    filters: { client_id: 'pm.client_id', invoice_id: 'pm.invoice_id', project_id: 'pm.project_id', account_id: 'pm.account_id', category: 'pm.category', grant_id: 'pm.grant_id' },
    dateField: 'pm.date',
    sortable: { date: 'pm.date', amount: 'pm.amount', client_name: 'c.company COLLATE NOCASE', category: 'pm.category' },
    order: 'pm.date DESC, pm.id DESC',
    scope: founderScope, can: (u) => isFounder(u),
    before(op, d, ex, { user }) {
      if (op === 'create') d.created_by = user.id;
      const invId = d.invoice_id !== undefined ? d.invoice_id : ex?.invoice_id;
      if (invId) {
        const inv = one('SELECT client_id, project_id FROM invoices WHERE id=?', invId);
        if (inv) {
          d.client_id = inv.client_id;
          if (!d.project_id) d.project_id = inv.project_id;
        }
      }
      if (d.amount !== undefined && !(d.amount > 0)) throw new HttpError(400, 'Amount must be greater than zero.');
      if (d.tds !== undefined && d.tds < 0) throw new HttpError(400, 'TDS cannot be negative.');
    },
    after(_op, row, ex) {
      refreshInvoice(ctx, row.invoice_id);
      if (ex && ex.invoice_id !== row.invoice_id) refreshInvoice(ctx, ex.invoice_id);
    },
    onDelete: (_id, row) => refreshInvoice(ctx, row.invoice_id),
  });

  const expenses = defineResource({
    table: 'expenses', alias: 'e',
    label: (r) => `${r.category || 'Expense'} ₹${r.amount}`,
    fields: {
      date: 'd', category: 't', vendor: 't', description: 't', amount: 'n', tax_amount: 'n', project_id: 'i', client_id: 'i', account_id: 'i', paid_by_id: 'i', method: 't',
      reference: 't', status: 't', notes: 't', grant_id: 'i', receipt_url: 't', is_estimate: 'b',
    },
    required: ['date', 'amount'], notNull: ['status'], enums: { status: ['paid', 'pending'] },
    columns: 'e.*, p.name AS project_name, c.company AS client_name, a.name AS account_name, u.name AS paid_by_name, g.name AS grant_name, r.name AS renewal_name',
    from: `FROM expenses e LEFT JOIN projects p ON p.id=e.project_id LEFT JOIN clients c ON c.id=e.client_id LEFT JOIN accounts a ON a.id=e.account_id
      LEFT JOIN users u ON u.id=e.paid_by_id LEFT JOIN grants g ON g.id=e.grant_id LEFT JOIN renewals r ON r.id=e.renewal_id`,
    search: ['e.description', 'e.vendor', 'e.category', 'e.notes', 'e.reference', 'p.name', 'g.name', refSql('expenses', 'e')],
    filters: { project_id: 'e.project_id', category: 'e.category', account_id: 'e.account_id', paid_by_id: 'e.paid_by_id', status: 'e.status', grant_id: 'e.grant_id', renewal_id: 'e.renewal_id', client_id: 'e.client_id' },
    dateField: 'e.date',
    sortable: { date: 'e.date', amount: 'e.amount', category: 'e.category', vendor: 'e.vendor COLLATE NOCASE', status: 'e.status' },
    order: 'e.date DESC, e.id DESC',
    scope: founderScope, can: (u) => isFounder(u),
    before(op, d, ex, { user }) {
      if (op === 'create') d.created_by = user.id;
      nonNegative(d, ['amount', 'tax_amount'], 'Amounts cannot be negative.');
      if (d.receipt_url && !/^https?:\/\//i.test(d.receipt_url)) d.receipt_url = `https://${d.receipt_url}`;
      // an estimated bill (a postpaid phone bill) is confirmed by entering the real amount or marking it paid
      if (ex?.is_estimate && !('is_estimate' in d) && ((('amount' in d) && d.amount !== ex.amount) || d.status === 'paid')) d.is_estimate = 0;
    },
    onDelete: (id) => purgeEntity(ctx, 'expense', id),
  });

  const accounts = defineResource({
    table: 'accounts', alias: 'a',
    label: (r) => r.name,
    fields: { name: 't', type: 't', opening_balance: 'n', notes: 't', active: 'b' },
    required: ['name'], enums: { type: values(ACCOUNT_TYPES) },
    columns: `a.*, a.opening_balance
      + COALESCE((SELECT SUM(amount) FROM payments WHERE account_id=a.id),0)
      - COALESCE((SELECT SUM(amount) FROM expenses WHERE account_id=a.id AND paid_by_id IS NULL AND status='paid'),0)
      + COALESCE((SELECT SUM(amount) FROM transfers WHERE (account_id=a.id AND kind IN ('capital_in','loan_in')) OR (to_account_id=a.id AND kind='transfer')),0)
      - COALESCE((SELECT SUM(amount) FROM transfers WHERE account_id=a.id AND kind IN ('withdrawal','loan_repay','tax_paid','transfer','reimbursement')),0) AS balance`,
    from: 'FROM accounts a',
    search: ['a.name', 'a.notes', 'a.type'],
    sortable: { name: 'a.name COLLATE NOCASE' },
    order: 'a.active DESC, a.name',
    scope: (u) => (isFounder(u) ? ALL : NONE), can: (u) => isFounder(u),
    beforeDelete(id) {
      const n = (one('SELECT (SELECT COUNT(*) FROM payments WHERE account_id=?) + (SELECT COUNT(*) FROM expenses WHERE account_id=?) + (SELECT COUNT(*) FROM transfers WHERE account_id=? OR to_account_id=?) n', id, id, id, id) as { n: number }).n;
      if (n) throw new HttpError(409, 'This account has transactions. Mark it inactive instead of deleting.');
    },
  });

  const transfers = defineResource({
    table: 'transfers', alias: 't',
    label: (r) => `${r.kind} ₹${r.amount}`,
    fields: { date: 'd', kind: 't', amount: 'n', account_id: 'i', to_account_id: 'i', user_id: 'i', notes: 't' },
    required: ['date', 'kind', 'amount'], enums: { kind: values(TRANSFER_KINDS) },
    columns: 't.*, a.name AS account_name, a2.name AS to_account_name, u.name AS user_name',
    from: 'FROM transfers t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN accounts a2 ON a2.id=t.to_account_id LEFT JOIN users u ON u.id=t.user_id',
    search: ['t.notes', 't.kind', 'u.name', 'a.name', refSql('transfers', 't')],
    filters: { kind: 't.kind', user_id: 't.user_id' },
    dateField: 't.date',
    sortable: { date: 't.date', amount: 't.amount', kind: 't.kind' },
    order: 't.date DESC, t.id DESC',
    scope: founderScope, can: (u) => isFounder(u),
    before(_op, d) {
      if (d.amount !== undefined && !(d.amount > 0)) throw new HttpError(400, 'Amount must be greater than zero.');
    },
  });

  const grants = defineResource({
    table: 'grants', alias: 'g', timestamps: true,
    label: (r) => r.name,
    fields: { name: 't', funder: 't', applied_on: 'd', requested: 'n', received: 'n', status: 't', next_report_date: 'd', notes: 't' },
    required: ['name'], notNull: ['status'], enums: { status: values(GRANT_STATUSES) },
    columns: `g.*, (SELECT COALESCE(SUM(e.amount),0) FROM expenses e WHERE e.grant_id=g.id AND e.status='paid') AS used,
      (SELECT COUNT(*) FROM expenses e WHERE e.grant_id=g.id) AS expense_count`,
    from: 'FROM grants g',
    search: ['g.name', 'g.funder', 'g.notes', refSql('grants', 'g')],
    filters: { status: 'g.status' },
    sortable: { name: 'g.name COLLATE NOCASE', requested: 'g.requested', received: 'g.received' },
    order: 'COALESCE(g.applied_on, g.created_at) DESC',
    scope: founderScope, can: (u) => isFounder(u),
    before(_op, d) {
      nonNegative(d, ['requested', 'received'], 'Amounts cannot be negative.');
    },
  });

  const assets = defineResource({
    table: 'assets', alias: 'ast', timestamps: true,
    label: (r) => `${r.asset_type}${r.make_model ? ` ${r.make_model}` : ''}`,
    fields: { asset_type: 't', make_model: 't', serial_number: 't', purchase_date: 'd', purchase_value: 'n', current_value: 'n', assigned_to: 'i', status: 't', notes: 't' },
    required: ['asset_type'],
    columns: 'ast.*, COALESCE(u.name, ast.assigned_name) AS assigned_to_name',
    from: 'FROM assets ast LEFT JOIN users u ON u.id=ast.assigned_to',
    search: ['ast.asset_type', 'ast.make_model', 'ast.serial_number', 'ast.notes', 'u.name', refSql('assets', 'ast')],
    filters: { status: 'ast.status', assigned_to: 'ast.assigned_to', asset_type: 'ast.asset_type' },
    sortable: { asset_type: 'ast.asset_type', purchase_date: 'ast.purchase_date', purchase_value: 'ast.purchase_value' },
    order: 'COALESCE(ast.purchase_date, ast.created_at) DESC',
    scope: founderScope, can: (u) => isFounder(u),
    before(_op, d) {
      nonNegative(d, ['purchase_value', 'current_value'], 'Values cannot be negative.');
      if (d.assigned_to) d.assigned_name = null;
    },
  });

  const bankTransactions = defineResource({
    table: 'bank_transactions', alias: 'bt',
    label: (r) => `${r.date} ${r.description || ''}`,
    fields: { account_id: 'i', date: 'd', description: 't', reference: 't', withdrawal: 'n', deposit: 'n', balance: 'n', type: 't', matched_status: 't', match_note: 't', payment_id: 'i', expense_id: 'i' },
    required: ['date'], notNull: ['matched_status'], enums: { matched_status: values(MATCH_STATUSES) },
    columns: 'bt.*, a.name AS account_name',
    from: 'FROM bank_transactions bt LEFT JOIN accounts a ON a.id=bt.account_id',
    search: ['bt.description', 'bt.reference', 'bt.type', 'bt.match_note'],
    filters: { account_id: 'bt.account_id', matched_status: 'bt.matched_status' },
    dateField: 'bt.date',
    sortable: { date: 'bt.date', withdrawal: 'bt.withdrawal', deposit: 'bt.deposit' },
    order: 'bt.date DESC, bt.id DESC',
    scope: founderScope, can: (u) => isFounder(u),
    before(op, d) {
      nonNegative(d, ['withdrawal', 'deposit'], 'Withdrawal and deposit cannot be negative.');
      if (op === 'create' && !(d.withdrawal > 0) && !(d.deposit > 0)) throw new HttpError(400, 'Enter a withdrawal or a deposit amount.');
      if (d.payment_id || d.expense_id) d.matched_status ||= 'Matched';
    },
  });

  const renewals = defineResource({
    table: 'renewals', alias: 'r',
    label: (r) => r.name,
    fields: {
      client_id: 'i', project_id: 'i', kind: 't', name: 't', vendor: 't', renewal_date: 'd', cycle: 't', our_cost: 'n', client_price: 'n', auto_renew: 'b', auto_debit: 'b',
      amount_varies: 'b', pay_account_id: 'i', status: 't', notes: 't', owner_id: 'i', category: 't',
    },
    required: ['name'], notNull: ['status'], enums: { kind: values(RENEWAL_KINDS), cycle: values(CYCLES), status: values(RENEWAL_STATUSES) },
    columns: `r.*, c.company AS client_name, p.name AS project_name, COALESCE(o.name, r.assigned_name) AS owner_name, pa.name AS pay_account_name,
      ROUND(r.our_cost / CASE r.cycle WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'half-yearly' THEN 6 WHEN 'yearly' THEN 12 WHEN 'biennial' THEN 24 WHEN 'triennial' THEN 36 ELSE NULL END, 2) AS monthly_cost,
      ROUND(r.our_cost * 12.0 / CASE r.cycle WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'half-yearly' THEN 6 WHEN 'yearly' THEN 12 WHEN 'biennial' THEN 24 WHEN 'triennial' THEN 36 ELSE NULL END, 2) AS annual_cost`,
    from: `FROM renewals r LEFT JOIN clients c ON c.id=r.client_id LEFT JOIN projects p ON p.id=r.project_id LEFT JOIN users o ON o.id=r.owner_id LEFT JOIN accounts pa ON pa.id=r.pay_account_id`,
    search: ['r.name', 'r.vendor', 'r.category', 'r.notes', 'c.company', 'p.name', refSql('renewals', 'r')],
    filters: { client_id: 'r.client_id', project_id: 'r.project_id', kind: 'r.kind', status: 'r.status', owner_id: 'r.owner_id', auto_debit: 'r.auto_debit' },
    sortable: { name: 'r.name COLLATE NOCASE', renewal_date: "COALESCE(r.renewal_date,'9999')", our_cost: 'r.our_cost', kind: 'r.kind', status: 'r.status' },
    order: "COALESCE(r.renewal_date,'9999')",
    scope: founderScope, can: (u) => isFounder(u),
    before(_op, d, ex) {
      if (d.owner_id) d.assigned_name = null;
      const on = 'auto_debit' in d ? d.auto_debit : ex?.auto_debit;
      const cost = 'our_cost' in d ? d.our_cost : ex?.our_cost;
      const cycle = d.cycle || ex?.cycle;
      if (on && !(cost > 0)) throw new HttpError(400, 'Enter the cost per cycle to debit automatically (for a bill that changes every month, enter a typical amount).');
      if (on && cycle === 'one-time') throw new HttpError(400, 'A one-time item has no next date, so it cannot debit automatically. Choose a repeating cycle.');
      if (on && !('renewal_date' in d ? d.renewal_date : ex?.renewal_date)) throw new HttpError(400, 'Set the renewal date: it is the day the first debit is recorded.');
    },
    after(_op, row) {
      if (row.auto_debit) runAutoDebits(ctx);
    },
  });

  return { quotes, invoices, payments, expenses, accounts, transfers, grants, assets, bank_transactions: bankTransactions, renewals };
}

export { markOverdue };
