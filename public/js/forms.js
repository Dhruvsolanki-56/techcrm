/* Option lists and record forms shared by all pages */
'use strict';

/* ---------- option lists ---------- */
const OPT = {
  leadStage: [['new', 'New'], ['contacted', 'Contacted'], ['meeting', 'Meeting / Demo'], ['proposal', 'Proposal sent'], ['negotiation', 'Negotiation'], ['won', 'Won'], ['lost', 'Lost']],
  leadSource: ['Website', 'Referral', 'LinkedIn', 'Instagram', 'WhatsApp', 'Cold call / email', 'Existing client', 'Event / Meetup', 'Upwork / Freelance', 'Other'],
  service: ['Website', 'Web application', 'Mobile app', 'E-commerce', 'CRM / ERP / Custom software', 'UI / UX design', 'SEO / Digital marketing', 'Maintenance / AMC', 'Hosting / Domain', 'Consulting', 'Other'],
  clientStatus: [['prospect', 'Prospect'], ['active', 'Active'], ['past', 'Past client'], ['archived', 'Archived']],
  projectStatus: [['planning', 'Planning'], ['active', 'In progress'], ['review', 'In review / UAT'], ['on_hold', 'On hold'], ['completed', 'Completed'], ['maintenance', 'Maintenance'], ['cancelled', 'Cancelled']],
  priority: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']],
  taskStatus: [['todo', 'To do'], ['in_progress', 'In progress'], ['review', 'In review'], ['done', 'Done']],
  projectType: ['Website', 'Web application', 'Mobile app', 'E-commerce', 'CRM / ERP', 'Design', 'Marketing', 'Maintenance', 'Other'],
  docCategory: ['Contract / Agreement', 'NDA', 'Proposal', 'Requirements / Specification', 'Design / Mockup', 'Deliverable', 'Invoice / Receipt', 'KYC / Company docs', 'Meeting notes', 'Credentials document', 'Other'],
  expenseCategory: ['Salaries / Stipends', 'Freelancers / Contractors', 'Software & SaaS', 'Hosting & Domains', 'Office rent', 'Internet & Utilities', 'Marketing & Ads', 'Travel', 'Equipment', 'Legal & Professional', 'Taxes & Compliance', 'Bank charges', 'Food & Misc', 'Other'],
  payMethod: ['Bank transfer / NEFT / RTGS', 'UPI', 'Cheque', 'Cash', 'Card', 'Razorpay / Gateway', 'PayPal / International', 'Other'],
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
};
const FORMS = {
  leads: () => [
    S('Who'),
    { name: 'name', label: 'Contact person', required: true }, { name: 'company', label: 'Company' },
    { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone / WhatsApp', type: 'tel' },
    { name: 'city', label: 'City' }, { name: 'website', label: 'Website' },
    S('Deal'),
    { name: 'service', label: 'Interested in', type: 'select', options: OPT.service }, { name: 'value', label: 'Expected value (₹)', type: 'money' },
    { name: 'stage', label: 'Stage', type: 'select', options: OPT.leadStage, required: true, default: 'new' }, { name: 'source', label: 'Came from', type: 'select', options: OPT.leadSource },
    { name: 'owner_id', label: 'Owner', type: 'select', lookup: 'users' }, { name: 'next_followup', label: 'Next follow-up', type: 'date' },
    S('Notes'),
    { name: 'notes', label: 'Requirements / notes', type: 'textarea', full: true, rows: 3 },
  ],
  clients: () => [
    S('Company'),
    { name: 'company', label: 'Company / client name', required: true, full: true },
    { name: 'industry', label: 'Industry' }, { name: 'website', label: 'Website' },
    { name: 'status', label: 'Status', type: 'select', options: OPT.clientStatus, required: true, default: 'active' }, { name: 'account_manager_id', label: 'Account manager', type: 'select', lookup: 'users' },
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
    { name: 'name', label: 'Project name', required: true, full: true },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients', required: true }, { name: 'type', label: 'Type', type: 'select', options: OPT.projectType },
    { name: 'status', label: 'Status', type: 'select', options: OPT.projectStatus, required: true, default: 'planning' }, { name: 'priority', label: 'Priority', type: 'select', options: OPT.priority, required: true, default: 'medium' },
    { name: 'manager_id', label: 'Project lead', type: 'select', lookup: 'users' }, ...(isFounder() ? [{ name: 'budget', label: 'Project value (₹)', type: 'money' }] : []),
    S('Timeline'),
    { name: 'start_date', label: 'Start date', type: 'date' }, { name: 'deadline', label: 'Deadline', type: 'date' },
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
  documents: () => [
    { name: 'title', label: 'Title', required: true, full: true }, { name: 'category', label: 'Category', type: 'select', options: OPT.docCategory, full: true }, { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
  payments: () => [
    S('Payment'),
    { name: 'amount', label: 'Amount received (₹)', type: 'money', required: true }, { name: 'date', label: 'Date received', type: 'date', required: true, default: todayStr() },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients' }, { name: 'invoice_id', label: 'Against invoice', type: 'select', options: [], help: 'Pick the client first.' },
    { name: 'tds', label: 'TDS deducted (₹)', type: 'money', help: 'Counts towards the invoice, not cash in the bank.' }, { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' },
    S('Where it went'),
    { name: 'account_id', label: 'Into account', type: 'select', lookup: 'accounts' }, { name: 'method', label: 'Method', type: 'select', options: OPT.payMethod },
    { name: 'reference', label: 'Reference / UTR no.' }, { name: 'notes', label: 'Notes' },
  ],
  expenses: () => [
    S('Expense'),
    { name: 'amount', label: 'Amount incl. tax (₹)', type: 'money', required: true }, { name: 'date', label: 'Date', type: 'date', required: true, default: todayStr() },
    { name: 'category', label: 'Category', type: 'select', options: OPT.expenseCategory, required: true }, { name: 'vendor', label: 'Paid to' },
    { name: 'description', label: 'What for', full: true },
    { name: 'status', label: 'Status', type: 'select', options: [['paid', 'Paid'], ['pending', 'Pending / to pay']], required: true, default: 'paid' }, { name: 'tax_amount', label: 'GST included (₹)', type: 'money' },
    S('Who paid'),
    { name: 'account_id', label: 'From company account', type: 'select', lookup: 'accounts' }, { name: 'paid_by_id', label: 'Or paid personally by', type: 'select', lookup: 'users', blank: '— Nobody, company paid —', help: 'The company then owes this founder.' },
    { name: 'method', label: 'Method', type: 'select', options: OPT.payMethod }, { name: 'reference', label: 'Bill / reference no.' },
    S('Link to work'),
    { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' }, { name: 'client_id', label: 'Client (if you re-bill it)', type: 'select', lookup: 'clients' },
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
    { name: 'name', label: 'Name', required: true, full: true, placeholder: 'e.g. acmecorp.com domain, or Silver AMC' },
    { name: 'kind', label: 'Kind', type: 'select', options: OPT.renewalKind, required: true, default: 'domain' }, { name: 'vendor', label: 'Vendor / registrar' },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients' }, { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' },
    S('When & how much'),
    { name: 'renewal_date', label: 'Next renewal / billing date', type: 'date', required: true }, { name: 'cycle', label: 'Cycle', type: 'select', options: OPT.cycle, required: true, default: 'yearly' },
    { name: 'our_cost', label: 'We pay (₹)', type: 'money' }, { name: 'client_price', label: 'Client pays per cycle (₹)', type: 'money', help: 'Maintenance plans count as monthly recurring income.' },
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
  events: () => [
    { name: 'title', label: 'Title', required: true, full: true, placeholder: 'e.g. GST filing due' }, { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'kind', label: 'Kind', type: 'select', options: OPT.eventKind, required: true },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients' }, { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' }, { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
  ],
};
