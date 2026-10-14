import { sp, type Record_ } from './parse';

/**
 * Tidies the workbooks' text before they are loaded: spelling, capitalisation, one clear wording per record, phone / email layout,
 * and the few entries the sheet filed in the wrong column. Every change is counted so the seed can print what it did.
 * Nothing here invents facts: names, amounts and dates stay as the sheet has them; only wording and obvious slips are fixed.
 */
export type TidyLog = Record<string, number>;
const count = (log: TidyLog, k: string): void => { log[k] = (log[k] ?? 0) + 1; };

/* ---------- names the money sheet spells two ways ---------- */
const CLIENT_NAME: Record<string, string> = {
  'strikar lifescience llp': 'Strikar Lifescience LLP', 'vishalwin foundation': 'Vishalwin Foundation', 'inventa systems': 'Inventa Systems', 'rototech systems': 'RotoTech Systems',
};
export const PROJECT_NAME: Record<string, string> = {
  'invents webiste': 'Inventa Website', 'rototech custom devp': 'RotoTech Custom Software Development', 'rototech custom phase 2': 'RotoTech Maintenance & Support (Phase 2)',
  'strikar lifescience': 'Strikar Lifescience Website', vishalwin: 'Vishalwin Foundation NGO Dashboard',
};
export const clientName = (n: string): string => CLIENT_NAME[sp(n).toLowerCase()] ?? sp(n);
export const projectName = (n: string): string => PROJECT_NAME[sp(n).toLowerCase()] ?? sp(n);

/* ---------- income wording ---------- */
const INCOME_NOTE: Record<string, string> = {
  'combine amount by all 4': "Founders' combined contribution (all four founders)",
  'vansh puts amount to check': 'Test deposit by Vansh (account check)',
  'hackhathon money': 'Hackathon prize money',
  'inventa half payment': 'Inventa Website — first payment (50%)',
  'invents other half': 'Inventa Website — final payment (50%)',
  'rototech half money': 'RotoTech Custom Development — first payment (50%)',
  'rototech other some money': 'RotoTech Custom Development — second payment',
  'rototech phase 1 completed': 'RotoTech Custom Development — final payment on Phase 1 completion',
  'rototech phase 2 advance.': 'RotoTech Maintenance & Support — advance payment (covers support until December 2026)',
  'data manthan money': 'Data Manthan prize money',
  'vansh puts back banner': 'Banner cost returned by Vansh',
  'strikar lifescience 1st trench': 'Strikar Lifescience Website — 1st tranche',
  'vishalwin foundation 1st trench': 'Vishalwin Foundation NGO Dashboard — 1st tranche',
};

/* ---------- expense wording, real category and (for grant-funded spend) which grant paid for it ----------
   The sheet used "Grant" as a category; the CRM keeps what the money was FOR as the category and records the grant separately ("Funded by"). */
interface ExpenseRule { note: string | null; cat?: string; vendor?: string; onlyCat?: string; other?: string }
const EXPENSE: Record<string, ExpenseRule> = {
  '': { note: null },
  'bank charges': { note: 'Bank charges', cat: 'Bank Charges' },
  'for monthly recharge': { note: 'Monthly recharge' },
  recharge: { note: 'Monthly recharge', onlyCat: 'Marketing', other: 'Recharge' },
  'marketing for hospex': { note: 'Marketing for HOSPEX expo' },
  'paid to vansh': { note: 'Paid to Vansh Balyan' },
  'claude subscription': { note: 'Claude subscription', cat: 'Software/SaaS', vendor: 'Anthropic' },
  'laptop repair': { note: 'Laptop repair' },
  office: { note: 'Office travel' },
  server: { note: 'Server hosting', cat: 'Hosting/Cloud' },
  domain: { note: 'Domain registration', cat: 'Hosting/Cloud' },
  standee: { note: 'Standee printing', cat: 'Marketing' },
  'e stamp': { note: 'E-stamp', cat: 'Legal & Admin' },
  'jenil amount': { note: 'Payroll — Jenil' },
  'ssd vansh': { note: 'SSD purchase — Vansh', cat: 'Hardware' },
  'utility patent': { note: 'Utility patent filing', cat: 'Legal & Admin' },
  'techsentinals domain retain': { note: 'TechSentinals domain renewal', cat: 'Hosting/Cloud' },
  'to ashwin for ssd': { note: 'SSD purchase — paid to Ashwin', cat: 'Hardware' },
  'ssd to ashwin': { note: 'SSD purchase — paid to Ashwin', cat: 'Hardware' },
  'banner + printouts.': { note: 'Banner and printouts', cat: 'Marketing' },
  travel: { note: 'Travel' },
  'airtel phone bill': { note: 'Airtel postpaid phone bill', cat: 'Telecom & Utilities', vendor: 'Airtel' },
  'google play store': { note: 'Google Play Store', cat: 'Software/SaaS', vendor: 'Google' },
  'ca sign': { note: 'CA signing fee', cat: 'Legal & Admin' },
  'notery & stamp': { note: 'Notary and stamp paper', cat: 'Legal & Admin' },
  'vansh travel expenses': { note: 'Travel — Vansh', cat: 'Travel' },
  'incubation fees': { note: 'Incubation fees', cat: 'Office/Rent' },
};

export function tidyIncome(rows: Record_[], log: TidyLog): void {
  for (const r of rows) {
    const raw = sp(r.notes).toLowerCase();
    const wording = INCOME_NOTE[raw];
    if (wording) { r.notes = wording; count(log, 'income wording'); }
    r.client = clientName(r.client ?? '');
    if (r.project) r.project = projectName(r.project);
    if (/^vishalwin/i.test(r.client) && /^other$/i.test(r.category ?? '')) { r.category = 'Product Sales'; count(log, 'income category (client payment filed as Other)'); }
  }
}

export function tidyExpenses(rows: Record_[], log: TidyLog): void {
  for (const r of rows) {
    const key = sp(r.notes).toLowerCase();
    const was = sp(r.category);
    const rule = EXPENSE[key];
    if (was === 'Grant') r.fundedby = 'SSIP'; // the sheet has one grant; every "Grant" expense was paid from it
    if (rule) {
      r.notes = (rule.onlyCat && was !== rule.onlyCat ? rule.other : rule.note) ?? '';
      if (rule.cat) r.category = rule.cat;
      if (rule.vendor && !r.vendor) r.vendor = rule.vendor;
      count(log, 'expense wording');
    } else if (r.notes) r.notes = sp(r.notes).replace(/^./, (c) => c.toUpperCase());
    if (r.category === 'Grant') { r.category = 'Other'; count(log, 'grant expense without a clear purpose'); }
    if (!r.notes) r.notes = `${r.category || 'Other'} expense`;
  }
}

const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

export function tidySubscriptions(rows: Record_[], log: TidyLog): void {
  for (const r of rows) {
    const name = r.softwareservice ?? '';
    const day = (String(r.renewaldate ?? '').match(/(\d+)(?:st|nd|rd|th)/) ?? [])[1];
    if (/^claude/i.test(name)) {
      r.softwareservice = `Claude subscription${day ? ` (billed on the ${ordinal(+day)})` : ''}`;
      r.vendor = 'Anthropic';
    } else if (/^chatgpt/i.test(name)) {
      r.softwareservice = 'ChatGPT Plus';
      r.vendor = 'OpenAI';
    }
    if (!r.category) r.category = 'Software/SaaS';
    count(log, 'subscription wording');
  }
}

/* ---------- leads ---------- */
interface LeadFix { company?: string; contact?: string; city?: string; country?: string }
// by the sheet's Lead ID: company / contact / place the sheet got wrong or wrote in capitals
const LEAD_FIX: Record<number, LeadFix> = {
  1: { company: 'Inventa Systems' }, 2: { company: 'RotoTech Systems' }, 4: { company: 'Vishalwin Foundation' }, 6: { company: 'Strikar Lifescience LLP' },
  10: { contact: 'Chirag Kayastha (House Manager)' }, 11: { contact: 'Anis Husain' }, 27: { contact: 'Dr. Bhagyesh Shah' },
  33: { company: 'Rein Enterprise', contact: '' }, 34: { company: 'Singh Enterprises' }, 35: { company: 'Dev Opus Pvt. Ltd.' }, 36: { company: 'Fluid Flow Engineers' }, 42: { company: 'GPE Expo Pvt. Ltd.' },
  72: { company: 'Ich Dien Wellness / Ich Dien Nutraceutical' }, 75: { company: 'Ich Dien Wellness / Ich Dien Nutraceutical' }, 73: { company: 'MSC Nutra' },
  81: { company: 'Miorah' }, 87: { company: 'Avinya' }, 89: { company: 'Seven Dot' }, 90: { company: 'Inrean Pharmaceutical' }, 93: { company: 'Asoj Soft Caps Pvt. Ltd.' },
  96: { company: 'SLA Integrated Logistics & Assurance Services Limited' }, 98: { company: 'SCOPE Kenya' },
  100: { company: 'Success Shows Pvt Ltd', contact: 'Vivek More (Director)', city: 'Bangalore' }, 110: { company: 'Afyalitics', contact: 'Oduor (Otieno) Kevin (Founder)' },
  112: { company: 'Ministry of Health', contact: 'Emmanuel Ainebyoona' }, 115: { company: 'Rainbow Foundation India' }, 126: { contact: 'Pratik Patel' },
  55: { company: 'Prosmit (by SMIT Digital Marketing Pvt Ltd)' }, 130: { company: 'Furniture Business' }, 94: { contact: 'Treasure David Enyinnaya (Founder)' },
  // the sheet put the country in City and a wrong country in Country
  95: { city: 'Accra', country: 'Ghana' }, 114: { city: 'Dubai', country: 'United Arab Emirates' },
};
const PLACE: Record<number, [string, string]> = { 94: ['', 'Nigeria'], 96: ['', 'Nigeria'], 98: ['', 'Kenya'], 99: ['', 'Uganda'], 110: ['', 'Kenya'], 112: ['Kampala', 'Uganda'], 113: ['', 'Uganda'] };
// text typed into the Email column that is not an email
const EMAIL_TEXT: Record<number, { website?: string; note?: string }> = {
  94: { website: 'africasmeassembly.org' }, 122: { note: 'Call back after 11 AM.' }, 123: { note: 'Call back after 10:30 AM.' }, 124: { note: 'Share the documents with the contact.' },
};
const ACRONYMS = new Set(['LLP', 'PVT', 'LTD', 'HVACR', 'TFL', 'CHL', 'GPE', 'MPRS', 'MSC', 'JP', 'SAL', 'DN', 'CIMS', 'SLA', 'KES', 'UAE', 'SME', 'NGO']);
const titleCaps = (s: string): string => (/[a-z]/.test(s) ? s : s.replace(/[A-Za-z][A-Za-z'’]*/g, (w) => (ACRONYMS.has(w) ? w : (w[0] as string) + w.slice(1).toLowerCase())));
const tidyParens = (s: string): string =>
  s.replace(/\s*\(\s*/g, ' (').replace(/\(\s*([a-z])/g, (_m, c: string) => `(${c.toUpperCase()}`).replace(/\s*\)/g, ')').replace(/\)(?=[A-Za-z])/g, ') ');

function phones(raw: string, india: boolean): { list: string[]; odd: string[] } {
  let s = sp(raw);
  if (!s) return { list: [], odd: [] };
  if (/^\d(\.\d+)?e\+?\d+$/i.test(s)) s = String(Math.round(Number(s))); // Excel showed 9876543210 as 9.87654321E9
  const parts = s.split(/\s*[;,/|]\s*|\s+(?:or|and)\s+/i).map((x) => x.trim()).filter(Boolean);
  const odd: string[] = [];
  const list = parts.map((p) => {
    const d = p.replace(/\D/g, '');
    if (india && d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
    if (india && d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
    if (india && d.length < 10) odd.push(sp(p));
    if (!india && d.length >= 10 && !p.startsWith('+')) return `+${d}`;
    return sp(p);
  });
  return { list, odd };
}

export interface LeadTidy {
  /** sheet lead id → website typed in the email column */
  websites: Record<number, string>;
}

export function tidyLeads(rows: Record_[], log: TidyLog): LeadTidy {
  const websites: Record<number, string> = {};
  for (const r of rows) {
    const id = Math.round(Number(r.leadid));
    const fix = LEAD_FIX[id] ?? {};
    const notes: string[] = [];
    let company = sp(r.companyperson);
    let contact = sp(r.contactperson);
    company = fix.company ?? titleCaps(company);
    contact = fix.contact !== undefined ? fix.contact : tidyParens(titleCaps(contact));
    if (company !== r.companyperson || contact !== r.contactperson) count(log, 'names and capitalisation');
    r.companyperson = company;
    r.contactperson = contact;
    const place = PLACE[id];
    if (place) { r.city = place[0]; r.country = place[1]; r.market = 'Foreign'; count(log, 'country / market'); }
    if (fix.city !== undefined) {
      r.city = fix.city;
      if (fix.country) { r.country = fix.country; r.market = 'Foreign'; }
      count(log, 'country / market');
    }
    r.city = sp(r.city).replace(/^Banglore$/i, 'Bangalore');
    const india = /^india$/i.test(r.country ?? '');
    const ph = phones(r.phonewhatsapp ?? '', india);
    r.phonewhatsapp = ph.list[0] ?? '';
    if (ph.list.length) count(log, 'phone layout');
    if (ph.list.length > 1) { notes.push(`Alternate phone number${ph.list.length > 2 ? 's' : ''}: ${ph.list.slice(1).join(', ')}`); count(log, 'alternate phones moved to notes'); }
    if (ph.odd.length) { notes.push(`Phone number ${ph.odd.join(', ')} in the sheet looks incomplete — please verify.`); count(log, 'incomplete phone flagged'); }
    let em = sp(r.email);
    const extra = EMAIL_TEXT[id];
    if (extra) {
      if (extra.website) websites[id] = extra.website;
      if (extra.note) notes.push(extra.note);
      em = '';
      count(log, 'text typed in the Email column moved');
    } else if (em) {
      const all = [...new Set(em.split(/[\s/;,]+/).map((x) => x.toLowerCase()).filter(Boolean))];
      em = all[0] ?? '';
      if (all.length > 1) { notes.push(`Alternate email${all.length > 2 ? 's' : ''}: ${all.slice(1).join(', ')}`); count(log, 'alternate emails moved to notes'); }
    }
    r.email = em;
    if (notes.length) r.notes = [r.notes, ...notes].filter(Boolean).join('\n');
  }
  return { websites };
}
