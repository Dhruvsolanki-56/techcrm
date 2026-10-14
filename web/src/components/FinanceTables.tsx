import { INVOICE_STATUSES, MAINT_STATUSES, PRIORITIES, QUOTE_STATUSES } from '@crm/shared';
import { useNavigate } from 'react-router-dom';
import { useEditor } from '../forms/RecordEditor';
import { fmtDate } from '../lib/format';
import { useSession, settingList } from '../lib/session';
import { Amount, Cell2, editCol } from '../pages/common';
import { DataTable, type Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Badge, Due, TextStatus, Who } from '../ui/primitives';

export function InvoicesTable({ query, projectId, clientId, compact }: { query?: Record<string, unknown>; projectId?: number; clientId?: number; compact?: boolean }) {
  const nav = useNavigate();
  const newQuery = new URLSearchParams();
  if (clientId) newQuery.set('client', String(clientId));
  if (projectId) newQuery.set('project', String(projectId));
  const cols: Column[] = [
    { key: 'number', label: 'Invoice', sort: 'number', render: (r) => <Cell2 top={<b>{String(r.number)}</b>} sub={String(r.title ?? '')} /> },
    ...(compact ? [] : [{ key: 'client_name', label: 'Client', sort: 'client_name', render: (r: Record<string, unknown>) => <Cell2 top={String(r.client_name ?? '—')} sub={String(r.project_name ?? '')} /> } as Column]),
    { key: 'kind', label: 'Type', cls: 'opt', render: (r) => (r.change_request_id ? <span className="tag plum">Change request</span> : r.kind === 'proforma' ? <span className="tag">Proforma</span> : <span className="faint">—</span>) },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <Badge value={r.status} /> },
    { key: 'issue_date', label: 'Issued', cls: 'nowrap opt', sort: 'issue_date', render: (r) => fmtDate(r.issue_date) },
    { key: 'due_date', label: 'Due', cls: 'nowrap', sort: 'due_date', render: (r) => <Due date={r.due_date} done={['paid', 'cancelled'].includes(String(r.status))} /> },
    { key: 'total', label: 'Total', num: true, sort: 'total', render: (r) => <Amount v={r.total} /> },
    { key: 'balance', label: 'Balance', num: true, sort: 'balance', render: (r) => <Amount v={r.balance} neg={r.status === 'overdue'} dash /> },
  ];
  return (
    <DataTable resource="invoices" query={query} columns={cols} compact={compact} onRow={(r) => nav(`/invoices/${r.id}`)} searchPlaceholder="Search invoices…" noun="invoice" defaultSort="issue_date:desc" dates
      filters={compact ? [] : [{ key: 'status', label: 'All statuses', options: INVOICE_STATUSES }, { key: 'client_id', label: 'Any client', lookup: 'clients' }]}
      toolbar={<button type="button" className="btn primary" onClick={() => nav(`/invoices/new${newQuery.size ? `?${newQuery}` : ''}`)}><Icon name="plus" />New invoice</button>}
      empty={{ title: 'No invoices yet', text: 'Create an invoice from a quotation or from scratch.' }} />
  );
}

export function QuotesTable({ query, compact, noAdd }: { query?: Record<string, unknown>; compact?: boolean; noAdd?: boolean }) {
  const nav = useNavigate();
  const cols: Column[] = [
    { key: 'number', label: 'Quotation', sort: 'number', render: (r) => <Cell2 top={<b>{String(r.number)}</b>} sub={String(r.title ?? '')} /> },
    { key: 'client_name', label: 'For', sort: 'client_name', render: (r) => <Cell2 top={String(r.client_name ?? r.lead_name ?? '—')} sub={String(r.project_name ?? '')} /> },
    { key: 'cr', label: 'Type', cls: 'opt', render: (r) => (r.change_request_id ? <span className="tag plum">Change request</span> : <span className="faint">—</span>) },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <Badge value={r.status} /> },
    { key: 'issue_date', label: 'Issued', cls: 'nowrap opt', sort: 'issue_date', render: (r) => fmtDate(r.issue_date) },
    { key: 'valid_until', label: 'Valid until', cls: 'nowrap opt', render: (r) => fmtDate(r.valid_until) },
    { key: 'total', label: 'Total', num: true, sort: 'total', render: (r) => <Amount v={r.total} /> },
  ];
  return (
    <DataTable resource="quotes" query={query} columns={cols} compact={compact} onRow={(r) => nav(`/quotes/${r.id}`)} searchPlaceholder="Search quotations…" noun="quotation" defaultSort="issue_date:desc"
      filters={compact ? [] : [{ key: 'status', label: 'All statuses', options: QUOTE_STATUSES }, { key: 'client_id', label: 'Any client', lookup: 'clients' }]}
      toolbar={noAdd ? null : <button type="button" className="btn primary" onClick={() => nav('/quotes/new')}><Icon name="plus" />New quotation</button>}
      empty={{ title: 'No quotations yet', text: 'Quote a lead or a change request, then turn the accepted quote into an invoice.' }} />
  );
}

export function PaymentsTable({ query, compact, defaults }: { query?: Record<string, unknown>; compact?: boolean; defaults?: Record<string, unknown> }) {
  const editor = useEditor();
  const { lookups } = useSession();
  const cols: Column[] = [
    { key: 'date', label: 'Date', cls: 'nowrap', sort: 'date', render: (r) => fmtDate(r.date) },
    { key: 'client_name', label: 'Client', sort: 'client_name', render: (r) => <Cell2 top={String(r.client_name ?? r.grant_name ?? '—')} sub={[r.invoice_number, r.project_name].filter(Boolean).join(' · ')} /> },
    ...(compact ? [] : [
      { key: 'category', label: 'Category', cls: 'opt', sort: 'category', render: (r: Record<string, unknown>) => <span className="tag">{String(r.category ?? '—')}</span> } as Column,
      { key: 'method', label: 'Mode', cls: 'opt', render: (r: Record<string, unknown>) => <Cell2 top={String(r.method ?? '—')} sub={String(r.account_name ?? '')} /> } as Column,
    ]),
    { key: 'amount', label: 'Amount', num: true, sort: 'amount', render: (r) => <Amount v={r.amount} /> },
    editCol('payments', true),
  ];
  return (
    <DataTable resource="payments" query={query} columns={cols} compact={compact} noRef={compact} defaultSort="date:desc" searchPlaceholder="Search payments…" noun="payment"
      dates filters={compact ? [] : [{ key: 'category', label: 'All categories', options: settingList(lookups, 'income_categories') }, { key: 'client_id', label: 'Any client', lookup: 'clients' }, { key: 'project_id', label: 'Any project', lookup: 'projects' }, { key: 'grant_id', label: 'Any grant', lookup: 'grants' }, { key: 'account_id', label: 'Any account', lookup: 'accounts' }]}
      toolbar={<button type="button" className="btn primary" onClick={() => editor.open({ resource: 'payments', defaults })}><Icon name="plus" />Record payment</button>}
      empty={{ title: 'No payments yet', text: 'Record money received from clients, grants or anyone else.' }} />
  );
}

export function ExpensesTable({ query, compact, defaults }: { query?: Record<string, unknown>; compact?: boolean; defaults?: Record<string, unknown> }) {
  const editor = useEditor();
  const { lookups } = useSession();
  const cols: Column[] = [
    { key: 'date', label: 'Date', cls: 'nowrap', sort: 'date', render: (r) => fmtDate(r.date) },
    { key: 'vendor', label: 'Expense', sort: 'vendor', render: (r) => <Cell2 top={<>{String(r.vendor ?? r.description ?? '—')}{r.is_estimate ? <span className="tag amber" style={{ marginLeft: 6 }} title="Estimated from the last bill — edit it when the real bill arrives">Estimate</span> : null}</>} sub={[r.description && r.vendor ? r.description : '', r.renewal_name ? `Auto-debit: ${r.renewal_name}` : '', r.project_name].filter(Boolean).join(' · ')} /> },
    { key: 'category', label: 'Category', cls: 'opt', sort: 'category', render: (r) => <span className="tag">{String(r.category ?? '—')}</span> },
    { key: 'paid', label: 'Paid by', cls: 'opt', render: (r) => (r.paid_by_name ? <Who name={r.paid_by_name} sub="personally" /> : <span className="muted">{String(r.account_name ?? 'Company')}</span>) },
    { key: 'status', label: 'Status', cls: 'opt', sort: 'status', render: (r) => <TextStatus value={r.status === 'paid' ? 'Completed' : 'Pending'} /> },
    { key: 'amount', label: 'Amount', num: true, sort: 'amount', render: (r) => <Amount v={r.amount} /> },
    editCol('expenses', true),
  ];
  return (
    <DataTable resource="expenses" query={query} columns={cols} compact={compact} noRef={compact} defaultSort="date:desc" searchPlaceholder="Search expenses…" noun="expense"
      dates filters={compact ? [] : [{ key: 'category', label: 'All categories', options: settingList(lookups, 'expense_categories') }, { key: 'status', label: 'Any status', options: [['paid', 'Completed'], ['pending', 'Pending']] }, { key: 'grant_id', label: 'Any grant', lookup: 'grants' }, { key: 'project_id', label: 'Any project', lookup: 'projects' }, { key: 'paid_by_id', label: 'Paid by anyone', lookup: 'users' }, { key: 'account_id', label: 'Any account', lookup: 'accounts' }]}
      toolbar={<button type="button" className="btn primary" onClick={() => editor.open({ resource: 'expenses', defaults })}><Icon name="plus" />Record expense</button>}
      empty={{ title: 'No expenses yet', text: 'Record what the company spends.' }} />
  );
}

export function MaintenanceTable({ query, compact, defaults }: { query?: Record<string, unknown>; compact?: boolean; defaults?: Record<string, unknown> }) {
  const editor = useEditor();
  const cols: Column[] = [
    { key: 'title', label: 'Issue / work', sort: 'title', render: (r) => <Cell2 top={String(r.title)} sub={[r.type, compact ? '' : r.project_name ?? r.client_name].filter(Boolean).join(' · ')} /> },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <Badge value={r.status} /> },
    { key: 'priority', label: 'Priority', cls: 'opt', sort: 'priority', render: (r) => <Badge value={r.priority} /> },
    { key: 'assignee_name', label: 'Assigned', cls: 'opt', render: (r) => <Who name={r.assignee_name} /> },
    { key: 'reported_on', label: 'Reported', cls: 'nowrap', sort: 'reported_on', render: (r) => fmtDate(r.reported_on) },
    { key: 'hours', label: 'Hours', num: true, cls: 'opt', render: (r) => (Number(r.hours) ? String(r.hours) : <span className="faint">—</span>) },
    { key: 'billable', label: 'Billable', cls: 'opt', render: (r) => (r.billable ? <span className="tag amber">Bill</span> : <span className="faint">In plan</span>) },
    editCol('maintenance_logs', true),
  ];
  return (
    <DataTable resource="maintenance_logs" query={query} columns={cols} compact={compact} noRef={compact} onRow={(r) => editor.open({ resource: 'maintenance_logs', record: r, canDelete: true })} searchPlaceholder="Search work log…" noun="item" defaultSort="reported_on:desc"
      filters={compact ? [] : [{ key: 'status', label: 'All statuses', options: MAINT_STATUSES }, { key: 'project_id', label: 'Any project', lookup: 'projects' }, { key: 'assignee_id', label: 'Anyone', lookup: 'users' }]}
      toolbar={<button type="button" className="btn primary" onClick={() => editor.open({ resource: 'maintenance_logs', defaults })}><Icon name="plus" />Log work</button>}
      empty={{ title: 'Nothing logged', text: 'Log fixes, updates and support requests for live sites.' }} />
  );
}

void PRIORITIES;
