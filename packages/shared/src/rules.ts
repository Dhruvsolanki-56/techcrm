/**
 * Field rules — ONE copy used by the browser (live checks under fields) and by the server (request validation),
 * so the two can never disagree.
 */

export interface TextRule {
  re: RegExp;
  block?: RegExp;
  max?: number;
  digits?: [number, number];
  msg: string;
  hint?: string;
  inputmode?: string;
  upper?: boolean;
  num?: false;
}
export interface NumberRule {
  num: true;
  min: number;
  max: number;
  msg?: string;
}
export type Rule = TextRule | NumberRule;

export const RULES: Record<string, Rule> = {
  // letters only (any language), with the punctuation real names use
  person: { re: /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u, block: /[^\p{L}\p{M} .'’-]/gu, max: 80, msg: 'can only contain letters (no numbers or symbols)', hint: 'Letters only' },
  place: { re: /^[\p{L}\p{M}][\p{L}\p{M} .'’()-]*$/u, block: /[^\p{L}\p{M} .'’()-]/gu, max: 60, msg: 'can only contain letters', hint: 'Letters only' },
  words: { re: /^[\p{L}\p{M}][\p{L}\p{M} .,&'’()/+-]*$/u, block: /[0-9]/g, max: 60, msg: 'cannot contain numbers', hint: 'No numbers' },
  phone: { re: /^\+?[0-9][0-9 ()-]*$/, block: /[^0-9+ ()-]/g, max: 20, digits: [7, 15], msg: 'must be a phone number: digits only, e.g. +91 98765 43210', hint: 'Digits only', inputmode: 'tel' },
  email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, max: 160, msg: 'is not a valid email address (e.g. name@company.com)', inputmode: 'email' },
  url: { re: /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(:\d+)?([/?#].*)?$/i, max: 300, msg: 'is not a valid web address (e.g. company.com)', inputmode: 'url' },
  gstin: { re: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, block: /[^0-9A-Za-z]/g, upper: true, max: 15, msg: 'must be 15 characters, e.g. 27ABCDE1234F1Z5' },
  pan: { re: /^[A-Z]{5}[0-9]{4}[A-Z]$/, block: /[^0-9A-Za-z]/g, upper: true, max: 10, msg: 'must be 10 characters, e.g. ABCDE1234F' },
  ifsc: { re: /^[A-Z]{4}0[A-Z0-9]{6}$/, block: /[^0-9A-Za-z]/g, upper: true, max: 11, msg: 'must be 11 characters, e.g. HDFC0001234' },
  upi: { re: /^[\w.-]{2,}@[a-zA-Z]{2,}$/, max: 60, msg: 'must look like name@bank' },
  digitsText: { re: /^[0-9A-Za-z/ -]*$/, max: 40, msg: 'can only contain letters, numbers, / and -' }, // account / invoice numbers
  money: { num: true, min: 0, max: 1e11, msg: 'must be zero or more' },
  signedMoney: { num: true, min: -1e11, max: 1e11 },
  hours: { num: true, min: 0, max: 1000, msg: 'must be between 0 and 1000' },
  percent: { num: true, min: 0, max: 100, msg: 'must be between 0 and 100' },
  qty: { num: true, min: 0.01, max: 1e7, msg: 'must be more than 0' },
};

/** Which rule each field follows, per resource (table name). */
export const FIELD_RULES: Record<string, Record<string, string>> = {
  leads: { name: 'words', email: 'email', phone: 'phone', city: 'words', country: 'place', website: 'url', value: 'money' },
  clients: { website: 'url', gstin: 'gstin', pan: 'pan', city: 'place', state: 'place', country: 'place', contact_name: 'person', contact_email: 'email', contact_phone: 'phone' },
  contacts: { name: 'person', email: 'email', phone: 'phone', whatsapp: 'phone' },
  projects: { budget: 'money', live_url: 'url', staging_url: 'url', repo_url: 'url', design_url: 'url' },
  payments: { amount: 'money', tds: 'money' },
  expenses: { amount: 'money', tax_amount: 'money' },
  accounts: { opening_balance: 'signedMoney' },
  transfers: { amount: 'money' },
  renewals: { our_cost: 'money', client_price: 'money' },
  maintenance_logs: { hours: 'hours' },
  invoices: { discount: 'money', tax_rate: 'percent', number: 'digitsText' },
  quotes: { discount: 'money', tax_rate: 'percent', number: 'digitsText' },
  change_requests: { estimate_hours: 'hours', estimate_amount: 'money' },
  users: { name: 'person', email: 'email', phone: 'phone' },
  settings: {
    company_email: 'email', company_phone: 'phone', company_website: 'url', gstin: 'gstin', pan: 'pan', state: 'place',
    bank_account_name: 'person', bank_ifsc: 'ifsc', upi_id: 'upi', bank_account_no: 'digitsText', default_tax_rate: 'percent',
  },
};

/** Dates that must not be before another date on the same record. */
export const DATE_ORDER: Record<string, [late: string, early: string, message: string][]> = {
  projects: [['deadline', 'start_date', 'Deadline cannot be before the start date.']],
  invoices: [['due_date', 'issue_date', 'Due date cannot be before the issue date.']],
  quotes: [['valid_until', 'issue_date', '"Valid until" cannot be before the issue date.']],
  maintenance_logs: [['resolved_on', 'reported_on', 'Resolved date cannot be before the reported date.']],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns '' when the value is fine, otherwise a message without the field name (the caller adds the label). */
export function check(kind: string, value: unknown): string {
  const r = RULES[kind];
  if (!r) return '';
  if (value === null || value === undefined || value === '') return '';
  if (r.num) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'must be a number';
    if (n < r.min) return r.msg || `must be at least ${r.min}`;
    if (n > r.max) return r.msg && /between/.test(r.msg) ? r.msg : 'is too large'; // "must be between 0 and 100" reads better than "is too large"
    return '';
  }
  const s = String(value).trim();
  if (!s) return '';
  if (r.max && s.length > r.max) return `is too long (max ${r.max} characters)`;
  const v = r.upper ? s.toUpperCase() : s;
  if (!r.re.test(v)) return r.msg;
  if (r.digits) {
    const d = v.replace(/\D/g, '').length;
    if (d < r.digits[0] || d > r.digits[1]) return r.msg;
  }
  return '';
}

export const kindFor = (resource: string, field: string): string => FIELD_RULES[resource]?.[field] ?? '';

export function normalize<T>(kind: string, value: T): T {
  const r = RULES[kind];
  if (kind === 'money' && typeof value === 'number') return (Math.round((value + Number.EPSILON) * 100) / 100) as T; // paise, never fractions of a paisa
  return r && !r.num && r.upper && typeof value === 'string' ? (value.trim().toUpperCase() as T) : value;
}

export function checkDates(resource: string, rec: Record<string, unknown>): string {
  for (const [late, early, msg] of DATE_ORDER[resource] ?? []) {
    const a = rec[late];
    const b = rec[early];
    if (typeof a === 'string' && typeof b === 'string' && DATE_RE.test(a) && DATE_RE.test(b) && a < b) return msg;
  }
  return '';
}

export function validDate(s: unknown): boolean {
  if (typeof s !== 'string' || !DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return false;
  return new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s && s >= '1990-01-01' && s <= '2100-12-31';
}
