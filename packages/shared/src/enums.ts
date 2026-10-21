/** Allowed values and labels, shared by the API (validation) and the screens (dropdowns, badges). */

export type Option = readonly [value: string, label: string];

export const LEAD_STAGES = [
  ['new', 'New'], ['contacted', 'Contacted'], ['qualified', 'Qualified'], ['meeting', 'Demo/Meeting'], ['proposal', 'Proposal Sent'],
  ['negotiation', 'Negotiation'], ['accepted', 'Accepted'], ['won', 'Converted'], ['closed', 'Closed'], ['lost', 'Lost'], ['nurture', 'Nurture'],
] as const satisfies readonly Option[];
export const CLOSED_STAGES = ['won', 'closed', 'lost'] as const;
/** How likely each stage is to close (the team's sheet guide) — drives the weighted pipeline. */
export const STAGE_PROB: Record<string, number> = { new: 10, contacted: 20, qualified: 35, meeting: 50, proposal: 65, negotiation: 80, accepted: 90, won: 100, closed: 0, lost: 0, nurture: 10 };
export const LEAD_PRIORITIES = [['hot', 'Hot'], ['medium', 'Medium'], ['cold', 'Cold']] as const satisfies readonly Option[];
export const FOLLOWUP_ROUNDS = [
  ['not_started', 'Not Started'], ['initial', 'Initial Contact'], ['first', '1st Follow-Up'], ['second', '2nd Follow-Up'], ['third', '3rd Follow-Up'], ['complete', 'Follow-Up Complete'],
] as const satisfies readonly Option[];
export const MARKETS = [['India', 'India'], ['Foreign', 'Foreign']] as const satisfies readonly Option[];
export const BUSINESS_SIDES = ['Service', 'Product'] as const;
export const CONTACT_KINDS = [
  ['call', 'Call'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['meeting', 'Meeting'], ['demo', 'Demo'], ['proposal', 'Proposal'], ['visit', 'Visit'], ['note', 'Other'],
] as const satisfies readonly Option[];
export const FOLLOWUP_STATUSES = ['Overdue', 'Due Today', 'Scheduled', 'Not Scheduled', 'Completed'] as const;

export const CLIENT_STATUSES = [
  ['active', 'Active'], ['prospect', 'Pending'], ['on_hold', 'On Hold'], ['at_risk', 'At Risk'], ['past', 'Completed'], ['archived', 'Cancelled'],
] as const satisfies readonly Option[];
export const PROJECT_STATUSES = [
  ['planning', 'Pending'], ['active', 'Active'], ['review', 'In Review'], ['on_hold', 'On Hold'], ['at_risk', 'At Risk'], ['completed', 'Completed'], ['maintenance', 'Maintenance'], ['cancelled', 'Cancelled'],
] as const satisfies readonly Option[];
/** Projects in these states are already delivered: a new request on them is a post-delivery change request. */
export const DELIVERED_PROJECT_STATUSES = ['completed', 'maintenance'] as const;
export const PRIORITIES = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']] as const satisfies readonly Option[];
export const TASK_STATUSES = [['todo', 'To do'], ['in_progress', 'In progress'], ['review', 'In review'], ['done', 'Done']] as const satisfies readonly Option[];

export const CR_KINDS = [['change', 'Change to agreed scope'], ['feature', 'New feature'], ['enhancement', 'Enhancement']] as const satisfies readonly Option[];
export const CR_PHASES = [['before_delivery', 'Before delivery'], ['after_delivery', 'After delivery']] as const satisfies readonly Option[];
export const CR_STATUSES = [
  ['requested', 'Requested'], ['estimated', 'Estimated'], ['quoted', 'Quoted'], ['approved', 'Approved'], ['in_progress', 'In progress'], ['delivered', 'Delivered'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'],
] as const satisfies readonly Option[];
/** What a change request may move to next. Billing follows the quote and invoice, not the status. */
export const CR_TRANSITIONS: Record<string, readonly string[]> = {
  requested: ['estimated', 'approved', 'rejected', 'cancelled'],
  estimated: ['quoted', 'approved', 'rejected', 'cancelled', 'requested'],
  quoted: ['approved', 'estimated', 'rejected', 'cancelled'],
  approved: ['in_progress', 'delivered', 'cancelled'],
  in_progress: ['delivered', 'approved', 'cancelled'],
  delivered: ['in_progress'],
  rejected: ['requested'],
  cancelled: ['requested'],
};

export const QUOTE_STATUSES = [['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['expired', 'Expired']] as const satisfies readonly Option[];
export const INVOICE_STATUSES = [
  ['draft', 'Draft'], ['sent', 'Sent'], ['partial', 'Partially paid'], ['paid', 'Paid'], ['overdue', 'Overdue'], ['cancelled', 'Cancelled'],
] as const satisfies readonly Option[];
export const INVOICE_KINDS = ['invoice', 'proforma'] as const;

export const GRANT_STATUSES = [['applied', 'Applied'], ['approved', 'Approved'], ['disbursed', 'Disbursed'], ['closed', 'Closed'], ['rejected', 'Rejected']] as const satisfies readonly Option[];
export const ACCOUNT_TYPES = [['bank', 'Bank account'], ['upi', 'UPI / Wallet'], ['cash', 'Cash'], ['card', 'Credit card'], ['wallet', 'Wallet']] as const satisfies readonly Option[];
export const TRANSFER_KINDS = [
  ['capital_in', 'Founder capital put in'], ['withdrawal', 'Founder withdrawal / salary'], ['reimbursement', 'Reimburse founder (paid personally)'],
  ['tax_paid', 'Income tax paid'], ['transfer', 'Transfer between accounts'],
] as const satisfies readonly Option[];
export const MATCH_STATUSES = [['Unmatched', 'Unmatched'], ['Matched', 'Matched'], ['Ignored', 'Ignored']] as const satisfies readonly Option[];
export const RENEWAL_KINDS = [
  ['amc', 'Maintenance plan (AMC)'], ['domain', 'Domain'], ['hosting', 'Hosting / Server'], ['ssl', 'SSL certificate'], ['email', 'Email / Workspace'], ['subscription', 'Software subscription'], ['bill', 'Utility / service bill'], ['other', 'Other'],
] as const satisfies readonly Option[];
export const CYCLES = [
  ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['half-yearly', 'Half-yearly'], ['yearly', 'Yearly'], ['biennial', 'Every 2 years'], ['triennial', 'Every 3 years'], ['one-time', 'One-time'],
] as const satisfies readonly Option[];
export const RENEWAL_STATUSES = [['active', 'Active'], ['lapsed', 'Lapsed'], ['cancelled', 'Cancelled']] as const satisfies readonly Option[];

export const MAINT_STATUSES = [['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved']] as const satisfies readonly Option[];
export const MAINT_TYPES = ['Bug fix', 'Content update', 'Feature request', 'Security patch', 'Backup / Restore', 'Performance', 'Server issue', 'Domain / SSL', 'Other'] as const;
export const EVENT_KINDS = ['Reminder', 'Meeting', 'Launch / Go-live', 'Payment follow-up', 'Client deadline', 'Holiday / Leave', 'Other'] as const;
export const PROJECT_TYPES = ['Website', 'Web application', 'Mobile app', 'E-commerce', 'CRM / ERP', 'Dashboard', 'Custom software', 'Design', 'Marketing', 'Maintenance', 'Other'] as const;
export const DOC_CATEGORIES = [
  'Contract / Agreement', 'NDA', 'Proposal', 'Requirements / Specification', 'Design / Mockup', 'Deliverable', 'Invoice / Receipt', 'KYC / Company docs', 'Meeting notes', 'Credentials document', 'Other',
] as const;
export const CRED_KINDS = [
  'Hosting / cPanel', 'Server / SSH', 'Database', 'Domain registrar', 'DNS (Cloudflare etc.)', 'CMS / Admin panel', 'Email account', 'Git / Repository', 'Cloud (AWS / GCP / Azure)',
  'Payment gateway', 'API key', 'Social media', 'Analytics / Ads', 'Other',
] as const;

/** Extra switches a founder can give an intern. Finance, invoices, quotes, renewals, vault, team and settings stay founder-only. */
export const INTERN_FLAGS = ['leads', 'clients', 'all_projects', 'maintenance'] as const;
export type InternFlag = (typeof INTERN_FLAGS)[number];

export const ROLES = ['founder', 'intern'] as const;
export type Role = (typeof ROLES)[number];

/** One-line lookup of a label from an option list. */
export function labelOf(list: readonly Option[], value: string | null | undefined): string {
  if (value == null || value === '') return '';
  return list.find(([v]) => v === value)?.[1] ?? String(value).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export const values = <T extends readonly Option[]>(list: T): T[number][0][] => list.map(([v]) => v);

export const MILESTONE_KINDS = [['advance', 'Advance'], ['milestone', 'Milestone'], ['final', 'Final payment'], ['retainer', 'Retainer']] as const satisfies readonly Option[];
/** Ready-made payment schedules: [title, kind, percent of the agreed value]. */
export const SCHEDULE_TEMPLATES: Record<string, { label: string; items: readonly (readonly [string, string, number])[] }> = {
  full: { label: '100% on delivery', items: [['Full payment', 'final', 100]] },
  '50-50': { label: '50% advance, 50% on delivery', items: [['Advance', 'advance', 50], ['Final payment', 'final', 50]] },
  '40-30-30': { label: '40% advance, 30% mid-way, 30% on go-live', items: [['Advance', 'advance', 40], ['Mid-way milestone', 'milestone', 30], ['Go-live payment', 'final', 30]] },
  '30-30-40': { label: '30% advance, 30% on design approval, 40% on go-live', items: [['Advance', 'advance', 30], ['Design approval', 'milestone', 30], ['Go-live payment', 'final', 40]] },
};
