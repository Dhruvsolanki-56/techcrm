/* Option lists and record forms shared by all pages */
'use strict';

/* ---------- option lists ---------- */
const OPT = {
  leadStage: [['new', 'New'], ['contacted', 'Contacted'], ['qualified', 'Qualified'], ['meeting', 'Demo/Meeting'], ['proposal', 'Proposal Sent'], ['negotiation', 'Negotiation'], ['won', 'Converted'], ['closed', 'Closed'], ['lost', 'Lost'], ['nurture', 'Nurture']],
  leadPriority: [['hot', 'Hot'], ['medium', 'Medium'], ['cold', 'Cold']],
  followRound: [['not_started', 'Not Started'], ['initial', 'Initial Contact'], ['first', '1st Follow-Up'], ['second', '2nd Follow-Up'], ['third', '3rd Follow-Up'], ['complete', 'Follow-Up Complete']],
  market: [['India', 'India'], ['Foreign', 'Foreign']],
  contactKind: [['call', 'Call'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['meeting', 'Meeting'], ['demo', 'Demo'], ['proposal', 'Proposal'], ['visit', 'Visit'], ['note', 'Other']],
  grantStatus: [['applied', 'Applied'], ['approved', 'Approved'], ['disbursed', 'Disbursed'], ['closed', 'Closed'], ['rejected', 'Rejected']],
  // these lists are edited by founders in Settings → Sales lists
  get leadSource() { return settingList('lead_sources'); },
  get leadCategory() { return settingList('lead_categories'); },
  get incomeCategory() { return settingList('income_categories'); },
  // the money sheet's Settings tab: Expense Categories, Payment Modes, Statuses (+ asset types)
  get expenseCategory() { return settingList('expense_categories'); },
  get payMethod() { return settingList('payment_modes'); },
  get sheetStatus() { return settingList('statuses'); },
  get assetType() { return settingList('asset_types'); },
  get leadDept() { return [...settingList('lead_services').map((d) => [d, d + ' · Service']), ...settingList('lead_products').map((d) => [d, d + ' · Product'])]; },
  service: ['Website', 'Web application', 'Mobile app', 'E-commerce', 'CRM / ERP / Custom software', 'UI / UX design', 'SEO / Digital marketing', 'Maintenance / AMC', 'Hosting / Domain', 'Consulting', 'Other'],
  clientStatus: [['active', 'Active'], ['prospect', 'Pending'], ['on_hold', 'On Hold'], ['at_risk', 'At Risk'], ['past', 'Completed'], ['archived', 'Cancelled']],
  projectStatus: [['planning', 'Pending'], ['active', 'Active'], ['review', 'In Review'], ['on_hold', 'On Hold'], ['at_risk', 'At Risk'], ['completed', 'Completed'], ['maintenance', 'Maintenance'], ['cancelled', 'Cancelled']],
  matchStatus: [['Unmatched', 'Unmatched'], ['Matched', 'Matched'], ['Ignored', 'Ignored']],
  priority: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']],
  taskStatus: [['todo', 'To do'], ['in_progress', 'In progress'], ['review', 'In review'], ['done', 'Done']],
  projectType: ['Website', 'Web application', 'Mobile app', 'E-commerce', 'CRM / ERP', 'Design', 'Marketing', 'Maintenance', 'Other'],
  docCategory: ['Contract / Agreement', 'NDA', 'Proposal', 'Requirements / Specification', 'Design / Mockup', 'Deliverable', 'Invoice / Receipt', 'KYC / Company docs', 'Meeting notes', 'Credentials document', 'Other'],
  accountType: [['bank', 'Bank account'], ['upi', 'UPI / Wallet'], ['cash', 'Cash'], ['card', 'Credit card']],
  transferKind: [['capital_in', 'Founder capital put in'], ['withdrawal', 'Founder withdrawal / salary'], ['reimbursement', 'Reimburse founder (paid personally)'], ['tax_paid', 'Tax paid (GST / TDS / Income tax)'], ['transfer', 'Transfer between accounts']],
  renewalKind: [['amc', 'Maintenance plan (AMC)'], ['domain', 'Domain'], ['hosting', 'Hosting / Server'], ['ssl', 'SSL certificate'], ['email', 'Email / Workspace'], ['subscription', 'Software subscription'], ['other', 'Other']],
  cycle: [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['half-yearly', 'Half-yearly'], ['yearly', 'Yearly'], ['biennial', 'Every 2 years'], ['triennial', 'Every 3 years'], ['one-time', 'One-time']],
  credKind: ['Hosting / cPanel', 'Server / SSH', 'Database', 'Domain registrar', 'DNS (Cloudflare etc.)', 'CMS / Admin panel', 'Email account', 'Git / Repository', 'Cloud (AWS / GCP / Azure)', 'Payment gateway', 'API key', 'Social media', 'Analytics / Ads', 'Other'],
  maintType: ['Bug fix', 'Content update', 'Feature request', 'Security patch', 'Backup / Restore', 'Performance', 'Server issue', 'Domain / SSL', 'Other'],
  eventKind: ['Reminder', 'Meeting', 'Launch / Go-live', 'Payment follow-up', 'Client deadline', 'Holiday / Leave', 'Other'],
  taxType: [['cgst_sgst', 'CGST + SGST (same state)'], ['igst', 'IGST (other state)'], ['none', 'No tax']],
  quoteStatus: [['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['expired', 'Expired']],
  invoiceStatus: [['draft', 'Draft'], ['sent', 'Sent'], ['partial', 'Partially paid'], ['paid', 'Paid'], ['overdue', 'Overdue'], ['cancelled', 'Cancelled']],
};

function settingList(key) { return String((App.lookups.settings || {})[key] || '').split('\n').map((x) => x.trim()).filter(Boolean); }
// keep a record's current value selectable even if it was removed from the list since
const withValue = (opts, v) => (v == null || v === '' || opts.some((o) => String(Array.isArray(o) ? o[0] : o) === String(v)) ? opts : [...opts, v]);
const STAGE_PROB = { new: 10, contacted: 20, qualified: 35, meeting: 50, proposal: 65, negotiation: 80, won: 100, closed: 0, lost: 0, nurture: 10 };
const CLOSED_STAGES = ['won', 'closed', 'lost'];

/* ---------- record forms (used for create + edit everywhere) ----------
   S('Title') starts a labelled group inside the popup. */
const S = (section, hint) => ({ section, hint });
const FORM_INFO = {
  leads: 'Someone who might become a client.',
  clients: 'A company you work for. Contacts, projects and invoices hang off this.',
  contacts: 'A person at this client.',
  projects: 'Everything about one piece of work: dates, links and scope.',
  tasks: 'One thing someone needs to do.',
  documents: 'Details shown in the file list.',
  payments: 'Money received from a client.',
  expenses: 'Money the company spent.',
  accounts: 'A bank account, UPI or cash box whose balance you want to track.',
  transfers: 'Capital, withdrawals, reimbursements, tax payments or moves between accounts.',
  renewals: 'Anything that renews: maintenance plans, domains, hosting, SSL, subscriptions.',
  maintenance_logs: 'A fix, update or support request for a live client.',
  events: 'A date to remember. Shows on everyone’s calendar.',
  grants: 'Government or programme funding: what you asked for, what came in, what is due to report.',
  assets: 'A laptop, phone or other device the company owns.',
  bank_transactions: 'One line from the bank statement. Match it to income or an expense.',
};
const FORMS = {
  leads: (rec) => [
    S('Who'),
    { name: 'company', label: 'Company / Person', required: true }, { name: 'name', label: 'Contact Person', help: 'Leave empty if the lead is a person.' },
    { name: 'phone', label: 'Phone / WhatsApp', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
    { name: 'city', label: 'City' }, { name: 'country', label: 'Country', default: 'India' },
    { name: 'market', label: 'Market', type: 'select', options: OPT.market, default: 'India' }, { name: 'website', label: 'Website' },
    S('What they need'),
    { name: 'department', label: 'Department / Product', type: 'select', options: withValue(OPT.leadDept, rec && rec.department), help: 'Business Side (Service / Product) is filled in from this.' },
    { name: 'category', label: 'Category', type: 'select', options: withValue(OPT.leadCategory, rec && rec.category) },
    { name: 'requirement', label: 'Requirement / Interested In', type: 'textarea', full: true, rows: 2 },
    { name: 'source', label: 'Lead Source', type: 'select', options: withValue(OPT.leadSource, rec && rec.source) }, { name: 'owner_id', label: 'Assigned To', type: 'select', lookup: 'users', ...(rec && rec.assigned_name && !rec.owner_id ? { help: `In the sheet: ${rec.assigned_name} (not a team member yet)` } : {}) },
    S('Where it stands'),
    { name: 'priority', label: 'Priority', type: 'select', options: OPT.leadPriority, default: 'medium' }, { name: 'stage', label: 'Sales Stage', type: 'select', options: OPT.leadStage, required: true, default: 'new' },
    { name: 'followup_round', label: 'Follow-Up Round', type: 'select', options: OPT.followRound, required: true, default: 'not_started' }, { name: 'last_contact', label: 'Last Contact Date', type: 'date' },
    { name: 'next_followup', label: 'Next Follow-Up Date', type: 'date' }, { name: 'next_action', label: 'Next Action', placeholder: 'e.g. Send demo video and pricing' },
    { name: 'meeting_date', label: 'Meeting / Demo Date', type: 'date' }, { name: 'proposal_date', label: 'Proposal Date', type: 'date' },
    { name: 'value', label: 'Deal Value (INR)', type: 'money', help: 'Probability and Weighted Pipeline follow from the Sales Stage.' },
    { name: 'closed_on', label: 'Conversion / Close Date', type: 'date', help: 'Filled in automatically when the stage becomes Converted, Closed or Lost.' }, { name: 'lost_reason', label: 'Lost / Closed Reason', full: true },
    S('Notes'),
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 3 },
  ],
  clients: () => [
    S('Company'),
    { name: 'company', label: 'Client Name', required: true, full: true },
    { name: 'industry', label: 'Industry' }, { name: 'website', label: 'Website' },
    { name: 'status', label: 'Status', type: 'select', options: OPT.clientStatus, required: true, default: 'active' }, { name: 'account_manager_id', label: 'Account Manager', type: 'select', lookup: 'users' },
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
  projects: () => [
    S('Basics'),
    { name: 'name', label: 'Project Name', required: true, full: true },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients', required: true }, { name: 'type', label: 'Type', type: 'select', options: OPT.projectType },
    { name: 'status', label: 'Status', type: 'select', options: OPT.projectStatus, required: true, default: 'planning' }, { name: 'priority', label: 'Priority', type: 'select', options: OPT.priority, required: true, default: 'medium' },
    { name: 'manager_id', label: 'Project Manager', type: 'select', lookup: 'users' }, ...(isFounder() ? [{ name: 'budget', label: 'Budget (₹)', type: 'money' }] : []),
    S('Timeline'),
    { name: 'start_date', label: 'Start Date', type: 'date' }, { name: 'deadline', label: 'End Date', type: 'date' },
    S('Links', 'Shown on the project page so nobody has to ask.'),
    { name: 'live_url', label: 'Live site' }, { name: 'staging_url', label: 'Staging' }, { name: 'repo_url', label: 'Repository' }, { name: 'design_url', label: 'Design (Figma)' },
    { name: 'tech_stack', label: 'Tech stack', placeholder: 'e.g. React, Node.js, MySQL', full: true },
    S('Scope'),
    { name: 'description', label: 'One-line summary', type: 'textarea', full: true, rows: 2 },
    { name: 'specs', label: 'Specification', type: 'textarea', full: true, rows: 6, placeholder: 'Pages, features, integrations, hosting details, what is out of scope…' },
  ],
  tasks: (rec) => {
    const intern = !isFounder();
    const limited = intern && rec;      // interns can only move/describe their own tasks
    return [
      { name: 'title', label: 'Task', required: true, full: true, readonly: limited, placeholder: 'e.g. Build the contact form' },
      { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' },
      // founders hand work to one or more people; an intern's own task is always theirs
      ...(intern ? [] : [{ name: 'assignee_ids', label: 'People on this task', type: 'people', lookup: 'users', full: true, help: 'Pick everyone working on it. They can all update the status, tick the checklist and join the discussion.' }]),
      { name: 'status', label: 'Status', type: 'select', options: OPT.taskStatus, required: true, default: 'todo' }, { name: 'priority', label: 'Priority', type: 'select', options: OPT.priority, required: true, default: 'medium' },
      { name: 'due_date', label: 'Due date', type: 'date' },
      { name: 'description', label: 'Details / instructions', type: 'textarea', full: true, rows: 4 },
    ];
  },
  documents: (rec) => [
    { name: 'title', label: 'Document Name', required: true, full: true }, { name: 'category', label: 'Category', type: 'select', options: withValue(OPT.docCategory, rec && rec.category) },
    { name: 'expiry_date', label: 'Expiry Date', type: 'date', help: 'Shows on the calendar so renewals of licences, agreements and registrations are not missed.' },
    ...(rec && rec.url ? [{ name: 'url', label: 'Link/Location', full: true }] : []),
    ...(isFounder() ? [{ name: 'status', label: 'Status', type: 'select', options: withValue(OPT.sheetStatus, rec && rec.status) }, { name: 'owner_id', label: 'Owner', type: 'select', lookup: 'users' }] : []),
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
  payments: () => [
    S('Payment'),
    { name: 'amount', label: 'Amount (₹)', type: 'money', required: true }, { name: 'date', label: 'Date', type: 'date', required: true, default: todayStr() },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients' }, { name: 'invoice_id', label: 'Invoice ID', type: 'select', options: [], help: 'Pick the client first.' },
    { name: 'tds', label: 'TDS deducted (₹)', type: 'money', help: 'Counts towards the invoice, not cash in the bank.' }, { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' },
    S('Where it went'),
    { name: 'account_id', label: 'Into account', type: 'select', lookup: 'accounts' }, { name: 'method', label: 'Payment Mode', type: 'select', options: OPT.payMethod },
    { name: 'reference', label: 'Reference / UTR no.' }, { name: 'notes', label: 'Notes' },
    S('Type of income'),
    { name: 'category', label: 'Category', type: 'select', options: withValue(OPT.incomeCategory, null), default: 'Client payment' }, { name: 'grant_id', label: 'For grant', type: 'select', lookup: 'grants', help: 'Only when this money is a grant disbursement.' },
  ],
  expenses: () => [
    S('Expense'),
    { name: 'amount', label: 'Amount (₹)', type: 'money', required: true, help: 'Including tax.' }, { name: 'date', label: 'Date', type: 'date', required: true, default: todayStr() },
    { name: 'category', label: 'Category', type: 'select', options: OPT.expenseCategory, required: true }, { name: 'vendor', label: 'Vendor' },
    { name: 'description', label: 'What for', full: true },
    { name: 'status', label: 'Status', type: 'select', options: [['paid', 'Completed'], ['pending', 'Pending']], required: true, default: 'paid' }, { name: 'tax_amount', label: 'GST included (₹)', type: 'money' },
    S('Who paid'),
    { name: 'account_id', label: 'From company account', type: 'select', lookup: 'accounts' }, { name: 'paid_by_id', label: 'Or paid personally by', type: 'select', lookup: 'users', blank: '— Nobody, company paid —', help: 'The company then owes this founder.' },
    { name: 'method', label: 'Payment Mode', type: 'select', options: OPT.payMethod }, { name: 'reference', label: 'Bill / reference no.' },
    S('Link to work'),
    { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' }, { name: 'client_id', label: 'Client (if you re-bill it)', type: 'select', lookup: 'clients' },
    { name: 'grant_id', label: 'Paid from grant', type: 'select', lookup: 'grants', help: 'Counts as grant money used.' }, { name: 'receipt_url', label: 'Receipt Link', placeholder: 'Google Drive / Dropbox link' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
  accounts: () => [
    { name: 'name', label: 'Account name', required: true, placeholder: 'e.g. HDFC Current A/c', full: true }, { name: 'type', label: 'Type', type: 'select', options: OPT.accountType, required: true },
    { name: 'opening_balance', label: 'Opening balance (₹)', type: 'money' }, { name: 'active', label: 'In use', type: 'checkbox', default: 1, full: true }, { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
  transfers: () => [
    { name: 'kind', label: 'Type', type: 'select', options: OPT.transferKind, required: true, full: true },
    { name: 'amount', label: 'Amount (₹)', type: 'money', required: true }, { name: 'date', label: 'Date', type: 'date', required: true, default: todayStr() },
    { name: 'user_id', label: 'Founder', type: 'select', lookup: 'users', blank: '— Not about a founder —' }, { name: 'account_id', label: 'Account', type: 'select', lookup: 'accounts' },
    { name: 'to_account_id', label: 'To account (transfers only)', type: 'select', lookup: 'accounts' }, { name: 'notes', label: 'Notes' },
  ],
  renewals: () => [
    S('What'),
    { name: 'name', label: 'Software/Service', required: true, full: true, placeholder: 'e.g. Figma, acmecorp.com domain, or Silver AMC' },
    { name: 'kind', label: 'Kind', type: 'select', options: OPT.renewalKind, required: true, default: 'domain' }, { name: 'category', label: 'Category' }, { name: 'vendor', label: 'Vendor / registrar' },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients' }, { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' },
    S('When & how much'),
    { name: 'renewal_date', label: 'Renewal Date', type: 'date', required: true }, { name: 'cycle', label: 'Cycle', type: 'select', options: OPT.cycle, required: true, default: 'yearly' },
    { name: 'our_cost', label: 'Cost per cycle (₹)', type: 'money', help: 'Monthly Cost and Annual Cost are worked out from this and the cycle.' }, { name: 'client_price', label: 'Client pays per cycle (₹)', type: 'money', help: 'Maintenance plans count as monthly recurring income.' },
    { name: 'owner_id', label: 'Owner', type: 'select', lookup: 'users', blank: '— Company —' },
    { name: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['lapsed', 'Lapsed'], ['cancelled', 'Cancelled']], required: true, default: 'active' }, { name: 'auto_renew', label: 'Renews automatically', type: 'checkbox' },
    { name: 'notes', label: 'Notes / what is covered', type: 'textarea', full: true, rows: 2 },
  ],
  maintenance_logs: () => {
    const f = isFounder();
    return [
      { name: 'title', label: 'Issue / work item', required: true, full: true, placeholder: 'e.g. Contact form not sending emails' },
      { name: 'project_id', label: 'Project / website', type: 'select', lookup: 'projects' },
      f ? { name: 'client_id', label: 'Client (if no project)', type: 'select', lookup: 'clients' } : { name: 'assignee_id', label: 'Assigned to', type: 'select', lookup: 'users' },
      { name: 'type', label: 'Type', type: 'select', options: OPT.maintType }, { name: 'priority', label: 'Priority', type: 'select', options: OPT.priority, default: 'medium' },
      { name: 'status', label: 'Status', type: 'select', options: [['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved']], required: true, default: 'open' },
      ...(f ? [{ name: 'assignee_id', label: 'Assigned to', type: 'select', lookup: 'users' }] : []),
      { name: 'reported_on', label: 'Reported on', type: 'date', default: todayStr() }, { name: 'hours', label: 'Hours spent', type: 'number' },
      ...(f ? [{ name: 'billable', label: 'Bill this separately (outside the plan)', type: 'checkbox', full: true }] : []),
      { name: 'description', label: 'Details / what was done', type: 'textarea', full: true, rows: 3 },
    ];
  },
  grants: () => [
    { name: 'name', label: 'Grant Name', required: true, placeholder: 'e.g. State startup seed grant' }, { name: 'funder', label: 'Funder', placeholder: 'e.g. Incubator or government department' },
    { name: 'applied_on', label: 'Application Date', type: 'date' }, { name: 'status', label: 'Status', type: 'select', options: OPT.grantStatus, required: true, default: 'applied' },
    { name: 'requested', label: 'Amount Requested (₹)', type: 'money' }, { name: 'received', label: 'Amount Received (₹)', type: 'money' },
    { name: 'next_report_date', label: 'Next Reporting Date', type: 'date', help: 'Shows on the calendar.' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 3 },
  ],
  assets: (rec) => [
    { name: 'asset_type', label: 'Asset Type', type: 'select', options: withValue(OPT.assetType, rec && rec.asset_type), required: true }, { name: 'make_model', label: 'Make/Model', placeholder: 'e.g. Dell Latitude 5420' },
    { name: 'serial_number', label: 'Serial Number' }, { name: 'assigned_to', label: 'Assigned To', type: 'select', lookup: 'users', blank: '— Nobody / spare —', ...(rec && rec.assigned_name && !rec.assigned_to ? { help: `In the sheet: ${rec.assigned_name}` } : {}) },
    { name: 'purchase_date', label: 'Purchase Date', type: 'date' }, { name: 'status', label: 'Status', type: 'select', options: withValue(OPT.sheetStatus, rec && rec.status), default: 'Active' },
    { name: 'purchase_value', label: 'Purchase Value (₹)', type: 'money' }, { name: 'current_value', label: 'Current Value (₹)', type: 'money' },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
  bank_transactions: () => [
    { name: 'date', label: 'Date', type: 'date', required: true, default: todayStr() }, { name: 'account_id', label: 'Account', type: 'select', lookup: 'accounts' },
    { name: 'description', label: 'Description', full: true }, { name: 'reference', label: 'Reference No' }, { name: 'type', label: 'Type', placeholder: 'e.g. NEFT, UPI, Charges' },
    { name: 'withdrawal', label: 'Withdrawal (₹)', type: 'money' }, { name: 'deposit', label: 'Deposit (₹)', type: 'money' },
    { name: 'balance', label: 'Balance (₹)', type: 'money', help: 'Optional — as printed on the statement.' }, { name: 'matched_status', label: 'Matched Status', type: 'select', options: OPT.matchStatus, required: true, default: 'Unmatched' },
    { name: 'match_note', label: 'Match Note', full: true },
  ],
  events: () => [
    { name: 'title', label: 'Title', required: true, full: true, placeholder: 'e.g. GST filing due' }, { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'kind', label: 'Kind', type: 'select', options: OPT.eventKind, required: true },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients' }, { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' }, { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
};
