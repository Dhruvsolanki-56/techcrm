/* Field rules — ONE copy used by the browser (live checks, messages under fields)
   and by the server (lib/resources.js, lib/routes.js), so the two can never disagree. */
'use strict';
const RULES = (() => {
  const K = {
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
    digitsText: { re: /^[0-9A-Za-z/ -]*$/, max: 40, msg: 'can only contain letters, numbers, / and -' },     // account / invoice numbers
    money: { num: true, min: 0, max: 1e11, msg: 'must be zero or more' },
    signedMoney: { num: true, min: -1e11, max: 1e11 },
    hours: { num: true, min: 0, max: 1000, msg: 'must be between 0 and 1000' },
    percent: { num: true, min: 0, max: 100, msg: 'must be between 0 and 100' },
    qty: { num: true, min: 0.01, max: 1e7, msg: 'must be more than 0' },
  };
  // which rule each field follows, per resource
  const F = {
    // lead names often carry a role, "Vani Mehta (Founder)", and cities can be "Pune / Mumbai": no numbers, but that punctuation is fine
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
    users: { name: 'person', email: 'email', phone: 'phone' },
    settings: { company_email: 'email', company_phone: 'phone', company_website: 'url', gstin: 'gstin', pan: 'pan', state: 'place', bank_account_name: 'person', bank_ifsc: 'ifsc', upi_id: 'upi', bank_account_no: 'digitsText', default_tax_rate: 'percent' },
  };
  // dates that must not be before another date on the same record
  const ORDER = {
    projects: [['deadline', 'start_date', 'Deadline cannot be before the start date.']],
    invoices: [['due_date', 'issue_date', 'Due date cannot be before the issue date.']],
    quotes: [['valid_until', 'issue_date', '"Valid until" cannot be before the issue date.']],
    maintenance_logs: [['resolved_on', 'reported_on', 'Resolved date cannot be before the reported date.']],
  };
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  // returns '' when fine, otherwise a message without the field name (caller adds the label)
  function check(kind, value) {
    const r = K[kind]; if (!r) return '';
    if (value === null || value === undefined || value === '') return '';
    if (r.num) {
      const n = Number(value); if (!Number.isFinite(n)) return 'must be a number';
      if (n < r.min) return r.msg || `must be at least ${r.min}`; if (n > r.max) return 'is too large'; return '';
    }
    const s = String(value).trim(); if (!s) return '';
    if (r.max && s.length > r.max) return `is too long (max ${r.max} characters)`;
    const v = r.upper ? s.toUpperCase() : s;
    if (!r.re.test(v)) return r.msg;
    if (r.digits) { const d = v.replace(/\D/g, '').length; if (d < r.digits[0] || d > r.digits[1]) return r.msg; }
    return '';
  }
  const kindFor = (res, field) => (F[res] && F[res][field]) || '';
  const normalize = (kind, value) => (K[kind] && K[kind].upper && typeof value === 'string' ? value.trim().toUpperCase() : value);
  function checkDates(res, rec) {
    for (const [late, early, msg] of ORDER[res] || []) if (rec[late] && rec[early] && DATE.test(rec[late]) && DATE.test(rec[early]) && rec[late] < rec[early]) return msg;
    return '';
  }
  const validDate = (s) => DATE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s && s >= '1990-01-01' && s <= '2100-12-31';
  return { K, F, ORDER, check, kindFor, normalize, checkDates, validDate };
})();
if (typeof module !== 'undefined') module.exports = RULES;
