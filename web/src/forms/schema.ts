import {
  MILESTONE_KINDS, ACCOUNT_TYPES, CLIENT_STATUSES, CR_KINDS, CR_PHASES, CR_STATUSES, CRED_KINDS, CYCLES, DOC_CATEGORIES, EVENT_KINDS, FOLLOWUP_ROUNDS, GRANT_STATUSES, LEAD_PRIORITIES, LEAD_STAGES,
  MAINT_STATUSES, MAINT_TYPES, MARKETS, MATCH_STATUSES, PRIORITIES, PROJECT_STATUSES, PROJECT_TYPES, RENEWAL_KINDS, RENEWAL_STATUSES, TASK_STATUSES, TDS_STATUSES, TRANSFER_KINDS, today,
  type Option,
} from '@crm/shared';
import { settingList, type Lookups } from '../lib/session';

export type OptionList = readonly (Option | string)[];
export type LookupName = 'users' | 'clients' | 'projects' | 'accounts' | 'leads' | 'grants';

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'date' | 'textarea' | 'select' | 'money' | 'number' | 'checkbox' | 'people' | 'password';
  required?: boolean;
  full?: boolean;
  options?: OptionList;
  lookup?: LookupName;
  blank?: string;
  default?: unknown;
  help?: string;
  placeholder?: string;
  rows?: number;
  readonly?: boolean;
}
export interface SectionDef { section: string; hint?: string }
export type FormItem = FieldDef | SectionDef;
export const isSection = (i: FormItem): i is SectionDef => 'section' in i;

export interface FormCtx { lookups: Lookups; isFounder: boolean; rec: Record<string, unknown> | null }

const PAY_STATUS: OptionList = [['paid', 'Completed'], ['pending', 'Pending']];
const withValue = (opts: OptionList, v: unknown): OptionList => (v == null || v === '' || opts.some((o) => (Array.isArray(o) ? o[0] : o) === String(v)) ? opts : [...opts, String(v)]);
const list = (c: FormCtx, key: string, current?: unknown): OptionList => withValue(settingList(c.lookups, key), current ?? undefined);

export const FORM_INFO: Record<string, string> = {
  leads: 'Someone who might become a client.',
  clients: 'A company you work for. Contacts, projects and invoices hang off this.',
  contacts: 'A person at this client.',
  projects: 'Everything about one piece of work: dates, links and scope.',
  tasks: 'One thing someone needs to do.',
  change_requests: 'Something the client wants changed or added — before or after the project is delivered.',
  documents: 'Details shown in the file list.',
  payments: 'Money received from a client.',
  expenses: 'Money the company spent.',
  accounts: 'A bank account, UPI or cash box whose balance you want to track.',
  transfers: 'Capital, withdrawals, reimbursements, tax payments or moves between accounts.',
  renewals: 'Anything that renews: maintenance plans, domains, hosting, SSL, subscriptions, bills.',
  maintenance_logs: 'A fix, update or support request for a live client.',
  milestones: 'A part of the project value, billed when its work is finished.',
  events: 'A date to remember. Shows on everyone’s calendar.',
  grants: 'Government or programme funding: what you asked for, what came in, what is due to report.',
  assets: 'A laptop, phone or other device the company owns.',
  bank_transactions: 'One line from the bank statement. Match it to income or an expense.',
};

export const RESOURCE_LABEL: Record<string, string> = {
  leads: 'lead', clients: 'client', contacts: 'contact', projects: 'project', tasks: 'task', change_requests: 'change request', documents: 'document', payments: 'payment',
  expenses: 'expense', accounts: 'account', transfers: 'transfer', renewals: 'renewal', maintenance_logs: 'maintenance item', events: 'event', grants: 'grant', assets: 'asset',
  bank_transactions: 'bank line', quotes: 'quotation', invoices: 'invoice', milestones: 'payment',
};

const S = (section: string, hint?: string): SectionDef => ({ section, hint });

export const FORMS: Record<string, (c: FormCtx) => FormItem[]> = {
  leads: (c) => {
    const rec = c.rec;
    const dept: OptionList = withValue([
      ...settingList(c.lookups, 'lead_services').map((d): Option => [d, `${d} · Service`]),
      ...settingList(c.lookups, 'lead_products').map((d): Option => [d, `${d} · Product`]),
    ], rec?.department);
    return [
      S('Who', 'An existing client, a new company, or just a person — any of them can be a lead.'),
      { name: 'client_id', label: 'Existing client', type: 'select', lookup: 'clients', blank: '— New person or company —', full: true, help: 'Pick one for new work from someone you already serve; their details are filled in. Leave empty for a new lead.' },
      { name: 'company', label: 'Company (optional)', help: 'Leave empty if the lead is an individual.' }, { name: 'name', label: 'Contact person', help: 'Needed if there is no company and no existing client.' },
      { name: 'phone', label: 'Phone / WhatsApp', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'city', label: 'City' }, { name: 'country', label: 'Country', default: 'India' },
      { name: 'market', label: 'Market', type: 'select', options: MARKETS, default: 'India' }, { name: 'website', label: 'Website' },
      S('What they need'),
      { name: 'department', label: 'Department / Product', type: 'select', options: dept, help: 'Business Side (Service / Product) is filled in from this.' },
      { name: 'category', label: 'Category', type: 'select', options: list(c, 'lead_categories', rec?.category) },
      { name: 'requirement', label: 'Requirement / Interested In', type: 'textarea', full: true, rows: 2 },
      { name: 'specs', label: 'Specification (what they want built)', type: 'textarea', full: true, rows: 5, help: 'Pages, features, integrations, hosting. It is copied to the project when this lead is converted — keep adding to it after every conversation or demo.' },
      { name: 'source', label: 'Lead Source', type: 'select', options: list(c, 'lead_sources', rec?.source) },
      { name: 'owner_id', label: 'Assigned To', type: 'select', lookup: 'users', ...(rec?.assigned_name && !rec?.owner_id ? { help: `In the sheet: ${String(rec.assigned_name)} (not a team member yet)` } : {}) },
      S('Where it stands'),
      { name: 'priority', label: 'Priority', type: 'select', options: LEAD_PRIORITIES, default: 'medium' },
      { name: 'stage', label: 'Sales Stage', type: 'select', options: LEAD_STAGES, required: true, default: 'new' },
      { name: 'followup_round', label: 'Follow-Up Round', type: 'select', options: FOLLOWUP_ROUNDS, required: true, default: 'not_started' },
      { name: 'last_contact', label: 'Last Contact Date', type: 'date' },
      { name: 'next_followup', label: 'Next Follow-Up Date', type: 'date' }, { name: 'next_action', label: 'Next Action', placeholder: 'e.g. Send demo video and pricing' },
      { name: 'meeting_date', label: 'Meeting / Demo Date', type: 'date' }, { name: 'proposal_date', label: 'Proposal Date', type: 'date' },
      { name: 'value', label: 'Deal Value (INR)', type: 'money', help: 'Probability and Weighted Pipeline follow from the Sales Stage.' },
      { name: 'closed_on', label: 'Conversion / Close Date', type: 'date', help: 'Filled in automatically when the stage becomes Converted, Closed or Lost.' },
      { name: 'lost_reason', label: 'Lost / Closed Reason', full: true },
      S('Notes'),
      { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 3 },
    ];
  },
  clients: () => [
    S('Company'),
    { name: 'company', label: 'Client Name', required: true, full: true },
    { name: 'industry', label: 'Industry' }, { name: 'website', label: 'Website' },
    { name: 'status', label: 'Status', type: 'select', options: CLIENT_STATUSES, required: true, default: 'active' }, { name: 'account_manager_id', label: 'Account Manager', type: 'select', lookup: 'users' },
    S('Billing', 'Printed on invoices.'),
    { name: 'gstin', label: 'GSTIN' }, { name: 'pan', label: 'PAN' },
    { name: 'address', label: 'Billing address', type: 'textarea', full: true, rows: 2 },
    { name: 'city', label: 'City' }, { name: 'state', label: 'State' },
    S('Internal'),
    { name: 'tags', label: 'Tags', placeholder: 'e.g. vip, retainer' }, { name: 'country', label: 'Country', default: 'India' },
    { name: 'notes', label: 'Internal notes', type: 'textarea', full: true, rows: 2 },
  ],
  contacts: () => [
    { name: 'name', label: 'Name', required: true }, { name: 'role', label: 'Role / designation' },
    { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'whatsapp', label: 'WhatsApp (if different)', type: 'tel' }, { name: 'is_primary', label: 'Main contact for this client', type: 'checkbox' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
  projects: (c) => [
    S('Basics'),
    { name: 'name', label: 'Project Name', required: true, full: true },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients', required: true }, { name: 'type', label: 'Type', type: 'select', options: withValue(PROJECT_TYPES, c.rec?.type) },
    { name: 'status', label: 'Status', type: 'select', options: PROJECT_STATUSES, required: true, default: 'planning' }, { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, required: true, default: 'medium' },
    { name: 'manager_id', label: 'Project Manager', type: 'select', lookup: 'users' },
    ...(c.isFounder ? [{ name: 'budget', label: 'Agreed value (₹)', type: 'money', help: 'Change requests add to this separately.' } as FieldDef] : []),
    S('Timeline'),
    { name: 'start_date', label: 'Start Date', type: 'date' }, { name: 'deadline', label: 'End Date', type: 'date' },
    S('Links', 'Shown on the project page so nobody has to ask.'),
    { name: 'live_url', label: 'Live site' }, { name: 'staging_url', label: 'Staging' }, { name: 'repo_url', label: 'Repository' }, { name: 'design_url', label: 'Design (Figma)' },
    { name: 'tech_stack', label: 'Tech stack', placeholder: 'e.g. React, Node.js, MySQL', full: true },
    S('Scope'),
    { name: 'description', label: 'One-line summary', type: 'textarea', full: true, rows: 2 },
    { name: 'specs', label: 'Specification', type: 'textarea', full: true, rows: 6, placeholder: 'Pages, features, integrations, hosting details, what is out of scope…' },
  ],
  tasks: (c) => {
    const limited = !c.isFounder && !!c.rec;
    return [
      { name: 'title', label: 'Task', required: true, full: true, readonly: limited, placeholder: 'e.g. Build the contact form' },
      { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' },
      ...(c.isFounder ? [{ name: 'assignee_ids', label: 'People on this task', type: 'people', lookup: 'users', full: true, help: 'Pick everyone working on it. They can all update the status, tick the checklist and join the discussion.' } as FieldDef] : []),
      { name: 'status', label: 'Status', type: 'select', options: TASK_STATUSES, required: true, default: 'todo' }, { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, required: true, default: 'medium' },
      { name: 'due_date', label: 'Due date', type: 'date' },
      { name: 'description', label: 'Details / instructions', type: 'textarea', full: true, rows: 4 },
    ];
  },
  change_requests: (c) => [
    { name: 'title', label: 'What the client wants', required: true, full: true, placeholder: 'e.g. Add online payment to the booking page' },
    { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects', required: true },
    { name: 'kind', label: 'Kind', type: 'select', options: CR_KINDS, required: true, default: 'change' },
    { name: 'phase', label: 'When', type: 'select', options: CR_PHASES, required: true, default: 'before_delivery', help: 'Before delivery changes the agreed scope; after delivery is new work on a live project.' },
    { name: 'status', label: 'Status', type: 'select', options: CR_STATUSES, required: true, default: 'requested' },
    { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, required: true, default: 'medium' },
    { name: 'requested_by', label: 'Requested by', placeholder: 'Client contact name' }, { name: 'requested_on', label: 'Requested on', type: 'date', default: today() },
    ...(c.isFounder ? [
      { name: 'estimate_hours', label: 'Estimated hours', type: 'number' } as FieldDef,
      { name: 'estimate_amount', label: 'Estimated price (₹)', type: 'money', help: 'What you will quote the client.' } as FieldDef,
      { name: 'billable', label: 'Bill the client for this', type: 'checkbox', default: 1, full: true } as FieldDef,
    ] : []),
    { name: 'description', label: 'Details', type: 'textarea', full: true, rows: 4 },
    { name: 'notes', label: 'Internal notes', type: 'textarea', full: true, rows: 2 },
  ],
  documents: (c) => [
    { name: 'title', label: 'Document Name', required: true, full: true }, { name: 'category', label: 'Category', type: 'select', options: withValue(DOC_CATEGORIES, c.rec?.category) },
    { name: 'expiry_date', label: 'Expiry Date', type: 'date', help: 'Shows on the calendar so renewals of licences, agreements and registrations are not missed.' },
    ...(c.rec?.url ? [{ name: 'url', label: 'Link/Location', full: true } as FieldDef] : []),
    ...(c.isFounder ? [{ name: 'status', label: 'Status', type: 'select', options: list(c, 'statuses', c.rec?.status) } as FieldDef, { name: 'owner_id', label: 'Owner', type: 'select', lookup: 'users' } as FieldDef] : []),
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
  payments: (c) => [
    S('Payment'),
    { name: 'amount', label: 'Amount (₹)', type: 'money', required: true }, { name: 'date', label: 'Date', type: 'date', required: true, default: today() },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients' }, { name: 'invoice_id', label: 'Invoice', type: 'select', options: [], help: 'Pick the client first.' },
    { name: 'tds', label: 'TDS deducted (₹)', type: 'money', help: 'Tax the client deducted on this payment. It is not part of the invoice or of the money you received — it is tracked so you can claim it in your ITR.' }, { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' },
    ...[
      S('TDS credit', 'Tracked until you claim it in your income-tax return'),
      { name: 'tds_status', label: 'TDS status', type: 'select', options: TDS_STATUSES, default: 'deducted' } as FormItem, { name: 'tds_section', label: 'Section (optional)', help: 'e.g. 194J, 194C' } as FormItem,
      { name: 'tds_claimed_on', label: 'Claimed in ITR on', type: 'date', help: 'Filled in automatically when the status is Claimed.' } as FormItem,
    ],
    S('Where it went'),
    { name: 'account_id', label: 'Into account', type: 'select', lookup: 'accounts' }, { name: 'method', label: 'Payment Mode', type: 'select', options: list(c, 'payment_modes', c.rec?.method) },
    { name: 'reference', label: 'Reference / UTR no.' }, { name: 'notes', label: 'Notes' },
    S('Type of income'),
    { name: 'category', label: 'Category', type: 'select', options: list(c, 'income_categories', c.rec?.category), default: 'Client payment' },
    { name: 'grant_id', label: 'For grant', type: 'select', lookup: 'grants', help: 'Only when this money is a grant disbursement.' },
  ],
  expenses: (c) => [
    S('Expense'),
    { name: 'amount', label: 'Amount (₹)', type: 'money', required: true, help: 'Including tax.' }, { name: 'date', label: 'Date', type: 'date', required: true, default: today() },
    { name: 'category', label: 'Category', type: 'select', options: list(c, 'expense_categories', c.rec?.category), required: true }, { name: 'vendor', label: 'Vendor' },
    { name: 'description', label: 'What for', full: true },
    { name: 'status', label: 'Status', type: 'select', options: PAY_STATUS, required: true, default: 'paid' }, { name: 'tax_amount', label: 'GST included (₹)', type: 'money' },
    S('Who paid'),
    { name: 'account_id', label: 'From company account', type: 'select', lookup: 'accounts' },
    { name: 'paid_by_id', label: 'Or paid personally by', type: 'select', lookup: 'users', blank: '— Nobody, company paid —', help: 'The company then owes this founder.' },
    { name: 'method', label: 'Payment Mode', type: 'select', options: list(c, 'payment_modes', c.rec?.method) }, { name: 'reference', label: 'Bill / reference no.' },
    S('Link to work'),
    { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' }, { name: 'client_id', label: 'Client (if you re-bill it)', type: 'select', lookup: 'clients' },
    { name: 'grant_id', label: 'Paid from grant', type: 'select', lookup: 'grants', help: 'Counts as grant money used.' }, { name: 'receipt_url', label: 'Receipt Link', placeholder: 'Google Drive / Dropbox link' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
  accounts: () => [
    { name: 'name', label: 'Account name', required: true, placeholder: 'e.g. HDFC Current A/c', full: true }, { name: 'type', label: 'Type', type: 'select', options: ACCOUNT_TYPES, required: true, default: 'bank' },
    { name: 'opening_balance', label: 'Opening balance (₹)', type: 'money' }, { name: 'active', label: 'In use', type: 'checkbox', default: 1, full: true },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
  transfers: () => [
    { name: 'kind', label: 'Type', type: 'select', options: TRANSFER_KINDS, required: true, full: true },
    { name: 'amount', label: 'Amount (₹)', type: 'money', required: true }, { name: 'date', label: 'Date', type: 'date', required: true, default: today() },
    { name: 'user_id', label: 'Founder', type: 'select', lookup: 'users', blank: '— Not about a founder —' }, { name: 'account_id', label: 'Account', type: 'select', lookup: 'accounts' },
    { name: 'to_account_id', label: 'To account (transfers only)', type: 'select', lookup: 'accounts' }, { name: 'notes', label: 'Notes' },
  ],
  renewals: () => [
    S('What'),
    { name: 'name', label: 'Software / Service', required: true, full: true, placeholder: 'e.g. Figma, acmecorp.com domain, or Silver AMC' },
    { name: 'kind', label: 'Kind', type: 'select', options: RENEWAL_KINDS, required: true, default: 'domain' }, { name: 'category', label: 'Category' }, { name: 'vendor', label: 'Vendor / registrar' },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients' }, { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' },
    S('When & how much'),
    { name: 'renewal_date', label: 'Next date', type: 'date' }, { name: 'cycle', label: 'Cycle', type: 'select', options: CYCLES, default: 'yearly' },
    { name: 'our_cost', label: 'Cost per cycle (₹)', type: 'money', help: 'For a bill that changes every month, enter a typical amount and tick “amount changes”.' },
    { name: 'client_price', label: 'Client pays per cycle (₹)', type: 'money', help: 'Maintenance plans count as monthly recurring income.' },
    { name: 'scope', label: 'Who pays for it', type: 'select', options: [['company', 'The company (debited automatically)'], ['personal', 'A person (tracked only, not deducted)']], required: true, default: 'company', help: 'Company items are recorded as company expenses on their date. A personal subscription (e.g. one founder’s own tool) is tracked but never deducted from company money.' },
    { name: 'owner_id', label: 'Owner / person', type: 'select', lookup: 'users', blank: '— Company —' },
    { name: 'next_amount', label: 'Amount for the next cycle only (₹)', type: 'money', help: 'This month’s bill is different (e.g. ₹900 instead of ₹700)? Type it here: the next debit uses it once, then the normal cost applies again. Leave empty for the normal cost.' },
    { name: 'status', label: 'Status', type: 'select', options: RENEWAL_STATUSES, required: true, default: 'active' }, { name: 'auto_renew', label: 'Renews automatically', type: 'checkbox' },
    { name: 'auto_debit', label: 'Debit the cost automatically', type: 'checkbox', help: 'On the date the CRM records the expense for you and moves the date forward. Needs a cost, a repeating cycle and a date.' },
    { name: 'amount_varies', label: 'Amount changes every cycle (e.g. a postpaid bill)', type: 'checkbox', help: 'Each debit is recorded as a pending estimate; edit it when the real bill arrives.' },
    { name: 'pay_account_id', label: 'Debited from account', type: 'select', lookup: 'accounts', blank: '— Main bank account —' },
    { name: 'notes', label: 'Notes / what is covered', type: 'textarea', full: true, rows: 2 },
  ],
  maintenance_logs: (c) => [
    { name: 'title', label: 'Issue / work item', required: true, full: true, placeholder: 'e.g. Contact form not sending emails' },
    { name: 'project_id', label: 'Project / website', type: 'select', lookup: 'projects' },
    c.isFounder ? { name: 'client_id', label: 'Client (if no project)', type: 'select', lookup: 'clients' } : { name: 'assignee_id', label: 'Assigned to', type: 'select', lookup: 'users' },
    { name: 'type', label: 'Type', type: 'select', options: withValue(MAINT_TYPES, c.rec?.type) }, { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, default: 'medium' },
    { name: 'status', label: 'Status', type: 'select', options: MAINT_STATUSES, required: true, default: 'open' },
    ...(c.isFounder ? [{ name: 'assignee_id', label: 'Assigned to', type: 'select', lookup: 'users' } as FieldDef] : []),
    { name: 'reported_on', label: 'Reported on', type: 'date', default: today() }, { name: 'hours', label: 'Hours spent', type: 'number' },
    ...(c.isFounder ? [{ name: 'billable', label: 'Bill this separately (outside the plan)', type: 'checkbox', full: true } as FieldDef] : []),
    { name: 'description', label: 'Details / what was done', type: 'textarea', full: true, rows: 3 },
  ],
  grants: () => [
    { name: 'name', label: 'Grant Name', required: true, placeholder: 'e.g. State startup seed grant' }, { name: 'funder', label: 'Funder', placeholder: 'e.g. Incubator or government department' },
    { name: 'applied_on', label: 'Application Date', type: 'date' }, { name: 'status', label: 'Status', type: 'select', options: GRANT_STATUSES, required: true, default: 'applied' },
    { name: 'requested', label: 'Amount Requested (₹)', type: 'money' }, { name: 'received', label: 'Amount Received (₹)', type: 'money' },
    { name: 'next_report_date', label: 'Next Reporting Date', type: 'date', help: 'Shows on the calendar.' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 3 },
  ],
  assets: (c) => [
    { name: 'asset_type', label: 'Asset Type', type: 'select', options: list(c, 'asset_types', c.rec?.asset_type), required: true }, { name: 'make_model', label: 'Make / Model', placeholder: 'e.g. Dell Latitude 5420' },
    { name: 'serial_number', label: 'Serial Number' }, { name: 'assigned_to', label: 'Assigned To', type: 'select', lookup: 'users', blank: '— Nobody / spare —' },
    { name: 'purchase_date', label: 'Purchase Date', type: 'date' }, { name: 'status', label: 'Status', type: 'select', options: list(c, 'statuses', c.rec?.status), default: 'Active' },
    { name: 'purchase_value', label: 'Purchase Value (₹)', type: 'money' }, { name: 'current_value', label: 'Current Value (₹)', type: 'money' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
  bank_transactions: () => [
    { name: 'date', label: 'Date', type: 'date', required: true, default: today() }, { name: 'account_id', label: 'Account', type: 'select', lookup: 'accounts' },
    { name: 'description', label: 'Description', full: true }, { name: 'reference', label: 'Reference No' }, { name: 'type', label: 'Type', placeholder: 'e.g. NEFT, UPI, Charges' },
    { name: 'withdrawal', label: 'Withdrawal (₹)', type: 'money' }, { name: 'deposit', label: 'Deposit (₹)', type: 'money' },
    { name: 'balance', label: 'Balance (₹)', type: 'money', help: 'Optional — as printed on the statement.' }, { name: 'matched_status', label: 'Matched Status', type: 'select', options: MATCH_STATUSES, required: true, default: 'Unmatched' },
    { name: 'match_note', label: 'Match Note', full: true },
  ],
  milestones: () => [
    { name: 'title', label: 'What this payment is for', required: true, full: true, placeholder: 'e.g. Advance, Design approval, Go-live' },
    { name: 'kind', label: 'Kind', type: 'select', options: MILESTONE_KINDS, required: true, default: 'milestone' },
    { name: 'percent', label: 'Percent of agreed value', type: 'number', help: 'The amount is worked out from this. Leave empty to type an amount.' },
    { name: 'amount', label: 'Amount before tax (₹)', type: 'money' },
    { name: 'due_date', label: 'Bill on or after', type: 'date' },
    { name: 'reached_on', label: 'Work finished on', type: 'date', help: 'Set this when the work behind the payment is done — it then shows up as ready to invoice.' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
  events: () => [
    { name: 'title', label: 'Title', required: true, full: true, placeholder: 'e.g. GST filing due' }, { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'kind', label: 'Kind', type: 'select', options: EVENT_KINDS, required: true },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients' }, { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
};

export { CRED_KINDS };
