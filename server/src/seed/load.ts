import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addMonths, round2, today } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import { nextNumber, refreshInvoice } from '../domain/billing';
import { projectCode } from '../domain/entities';
import { linkPeople, matchUser } from '../domain/people';
import { hashPassword, passwordProblem } from '../security/password';
import { clean, fixSwappedDates, norm, table, toDate, toMoney, type Record_ } from './parse';
import { clientName, projectName, tidyExpenses, tidyIncome, tidyLeads, tidySubscriptions, type TidyLog } from './tidy';
import { readWorkbook, type Sheet } from './xlsx';

const COMPANY = 'TechSentinals LLP';
const ACCOUNT = 'TechSentinals bank account';
const OWN_NAME = 'techsentinals';
const STRIKAR_PAYMENT_KEY = 'seed:payment:strikar-2';
const STRIKAR_DATE = '2026-10-14';

export interface TeamMember { name: string; email: string; title: string }
export const TEAM: TeamMember[] = [
  { name: 'Ashwin Solanki', email: 'techsentinalsprojects@gmail.com', title: 'Founder' },
  { name: 'Vansh Balyan', email: 'vansh@techsentinals.local', title: 'Founder' },
  { name: 'Dhruv Solanki', email: 'dhruv@techsentinals.local', title: 'Founder' },
  { name: 'Aastha Sangtani', email: 'aastha@techsentinals.local', title: 'Founder' },
];

/** What each project is (the sheet only has a name); fields the sheet does not have stay empty. */
const PROJECTS: Record<string, { type?: string; status: string; deadline?: string; description: string; value?: number }> = {
  'Inventa Website': { type: 'Website', status: 'completed', description: 'Website design and development for Inventa Systems.' },
  'RotoTech Custom Software Development': { type: 'Custom software', status: 'completed', description: 'Custom software development for RotoTech Systems (Phase 1).' },
  'RotoTech Maintenance & Support (Phase 2)': {
    type: 'Maintenance', status: 'maintenance', deadline: '2026-12-31',
    description: 'Maintenance and support for RotoTech Systems until 31 December 2026, covered by the ₹25,000 advance received on 12 Aug 2026.',
  },
  'Strikar Lifescience Website': { type: 'Website', status: 'active', value: 130000, description: 'Website design and development for Strikar Lifescience LLP. Agreed value ₹1.30 lakh, 10% TDS (₹13,000) is deducted by the client.' },
  'Vishalwin Foundation NGO Dashboard': { type: 'Dashboard', status: 'active', value: 350000, description: 'NGO dashboard for Vishalwin Foundation covering the Renu program and the Road Safety Guardian Angel program.' },
};

const STAGE: Record<string, string> = { new: 'new', contacted: 'contacted', qualified: 'qualified', demomeeting: 'meeting', proposalsent: 'proposal', negotiation: 'negotiation', converted: 'won', closed: 'closed', lost: 'lost', nurture: 'nurture' };
const ROUND: Record<string, string> = { notstarted: 'not_started', initialcontact: 'initial', '1stfollowup': 'first', '2ndfollowup': 'second', '3rdfollowup': 'third', followupcomplete: 'complete' };
const PROJECT_STATUS: Record<string, string> = { active: 'active', completed: 'completed', onhold: 'on_hold', cancelled: 'cancelled', pending: 'planning', atrisk: 'at_risk', planning: 'planning' };
const CLIENT_STATUS: Record<string, string> = { active: 'active', completed: 'past', onhold: 'on_hold', cancelled: 'archived', pending: 'prospect', atrisk: 'at_risk' };
const GRANT_STATUS: Record<string, string> = { applied: 'applied', approved: 'approved', disbursed: 'disbursed', closed: 'closed', rejected: 'rejected' };
const CLOSED = ['won', 'closed', 'lost'];

export interface SeedOptions {
  xlsDir: string;
  dryRun?: boolean;
  /** Remove what an earlier run loaded first (never anything typed in by hand). */
  reset?: boolean;
  /** Password for newly created team accounts (people who already exist are never touched). */
  password?: string;
  /** Login email of the main founder. */
  founderEmail?: string;
}

export interface Check { what: string; sheet: number | null; app: number; ok: boolean; note: string }
export interface SeedReport {
  created: { name: string; email: string; password: string }[];
  sections: Record<string, number>;
  extras: Record<string, number>;
  tidy: TidyLog;
  corrections: string[];
  warnings: string[];
  checks: Check[];
  counts: Record<string, number>;
  removed?: Record<string, number>;
}

class Dry extends Error {}

const sheetsOf = (file: string): Record<string, Sheet> => Object.fromEntries(readWorkbook(fs.readFileSync(file)).map((s) => [s.name, s]));
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/** Removes rows an earlier seed run loaded (sheet / seed keys), never anything typed in by hand. */
export function resetSeeded(ctx: AppContext): Record<string, number> {
  const { db } = ctx;
  const keyed = "import_key LIKE 'gs:%' OR import_key LIKE 'seed:%'";
  const n: Record<string, number> = {};
  const del = (label: string, sql: string): void => { n[label] = db.prepare(sql).run().changes; };
  del('expenses', `DELETE FROM expenses WHERE ${keyed} OR renewal_id IN (SELECT id FROM renewals WHERE ${keyed})`);
  del('payments', `DELETE FROM payments WHERE ${keyed}`);
  del('invoices', `DELETE FROM invoices WHERE ${keyed}`);
  del('bank lines', `DELETE FROM bank_transactions WHERE ${keyed}`);
  del('renewals', `DELETE FROM renewals WHERE ${keyed}`);
  del('grants', `DELETE FROM grants WHERE ${keyed}`);
  del('assets', `DELETE FROM assets WHERE ${keyed}`);
  del('documents', `DELETE FROM documents WHERE ${keyed}`);
  db.exec(`DELETE FROM notes WHERE ${keyed} OR (entity_type='lead' AND entity_id IN (SELECT id FROM leads WHERE ${keyed})) OR (entity_type='client' AND entity_id IN (SELECT id FROM clients WHERE ${keyed}))
    OR (entity_type IN ('project','change_request') AND entity_id IN (SELECT id FROM projects WHERE ${keyed}));
    DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE ${keyed});
    DELETE FROM contacts WHERE client_id IN (SELECT id FROM clients WHERE ${keyed});`);
  del('projects', `DELETE FROM projects WHERE ${keyed}`);
  del('clients', `DELETE FROM clients WHERE ${keyed}`);
  del('leads', `DELETE FROM leads WHERE ${keyed}`);
  return n;
}

function createTeam(ctx: AppContext, opts: SeedOptions, report: SeedReport): void {
  const { db } = ctx;
  if (opts.password) {
    const p = passwordProblem(opts.password);
    if (p) throw new Error(`Seed password: ${p}`);
  }
  for (const t of TEAM) {
    const email = (t.name === 'Ashwin Solanki' && opts.founderEmail ? opts.founderEmail : t.email).toLowerCase();
    if (db.prepare('SELECT 1 FROM users WHERE LOWER(name)=LOWER(?) OR email=?').get(t.name, email)) continue;
    const pw = opts.password ?? `${crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x')}${crypto.randomInt(10, 99)}Ts`;
    const id = Number(db.prepare("INSERT INTO users(name,email,password_hash,role,title,must_change_password) VALUES(?,?,?, 'founder',?,?)").run(t.name, email, hashPassword(pw), t.title, opts.password ? 0 : 1).lastInsertRowid);
    ctx.audit({ id, name: t.name }, 'create', 'users', id, `${t.name} (founder) — created by the TechSentinals seed`, 'local-seed');
    report.created.push({ name: t.name, email, password: pw });
  }
}

/** "Recommended" blocks and list columns of the sheets' Lists & Settings / Settings tabs. */
function listColumn(sheet: Sheet | undefined, heading: string): string[] {
  if (!sheet) return [];
  const hi = sheet.rows.findIndex((r) => r.some((c) => norm(c) === norm(heading)));
  if (hi < 0) return [];
  const col = (sheet.rows[hi] as string[]).findIndex((c) => norm(c) === norm(heading));
  const out: string[] = [];
  for (let k = hi + 1; k < sheet.rows.length; k++) {
    const v = ((sheet.rows[k] as string[])[col] ?? '').trim();
    if (/^(recommended|stage|suggested)/i.test(v)) break;
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

function applyLists(ctx: AppContext, crm: Record<string, Sheet>, os: Record<string, Sheet>, extraExpenseCategories: string[]): void {
  const lists = crm['Lists & Settings'];
  const set = (key: string, vals: string[]): void => { if (vals.length) ctx.settings.set({ [key]: vals.join('\n') }); };
  // Service or Product per department comes from the sheet's Dept Analytics tab
  const side: Record<string, string> = {};
  for (const r of table(crm['Dept Analytics'], 'Department / Product', 'Business Side')) side[(r.departmentproduct ?? '').toLowerCase()] = /product/i.test(r.businessside ?? '') ? 'Product' : 'Service';
  const depts = listColumn(lists, 'Department / Product');
  set('lead_products', depts.filter((d) => side[d.toLowerCase()] === 'Product'));
  set('lead_services', depts.filter((d) => side[d.toLowerCase()] !== 'Product'));
  set('lead_categories', listColumn(lists, 'Category'));
  set('lead_sources', listColumn(lists, 'Lead Source'));
  const settings = os.Settings;
  const income = listColumn(settings, 'Income Categories');
  set('income_categories', income.length && !income.some((v) => /^client payment$/i.test(v)) ? ['Client payment', ...income] : income);
  const expense = listColumn(settings, 'Expense Categories');
  set('expense_categories', [...expense, ...extraExpenseCategories.filter((c) => !expense.some((e) => e.toLowerCase() === c.toLowerCase()))]);
  set('payment_modes', listColumn(settings, 'Payment Modes'));
  set('statuses', listColumn(settings, 'Statuses'));
}

/** The value next to / under a heading in a dashboard tab. */
function labelled(sheet: Sheet | undefined, label: string, dr: number, dc: number): number | null {
  if (!sheet) return null;
  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] as string[];
    for (let c = 0; c < row.length; c++) if (norm(row[c]) === norm(label)) return toMoney((sheet.rows[r + dr] ?? [])[c + dc]);
  }
  return null;
}

export function runSeed(ctx: AppContext, opts: SeedOptions): SeedReport {
  const { db } = ctx;
  const report: SeedReport = { created: [], sections: {}, extras: {}, tidy: {}, corrections: [], warnings: [], checks: [], counts: {} };
  const crmFile = path.join(opts.xlsDir, 'TechSentinals CRM.xlsx');
  const osFile = path.join(opts.xlsDir, 'TechSentinals OS.xlsx');
  for (const f of [crmFile, osFile]) if (!fs.existsSync(f)) throw new Error(`Cannot find ${f}. Put the two workbooks in ${opts.xlsDir} or pass --xls <folder>.`);
  const crm = sheetsOf(crmFile);
  const os = sheetsOf(osFile);
  const now = today();

  const leadRows = table(crm['Master Leads'], 'Lead ID', 'Company / Person');
  const income = table(os.Income, 'Client', 'Payment Mode').filter((r) => toMoney(r.amount) > 0);
  const expenses = table(os.Expenses, 'Vendor', 'Category').filter((r) => toMoney(r.amount) > 0);
  let clientRows = table(os.Clients, 'Client Name');
  const projectRows = table(os.Projects, 'Project Name');
  const subRows = table(os.Subscriptions, 'Software/Service');
  const grantRows = table(os.Grants, 'Grant Name');

  // ---- corrections agreed with the founders ----
  // "RotoTech Phase 2" is not a separate customer — it is phase 2 of RotoTech Systems — and the company's own name is not a client.
  for (const r of income) if (norm(r.client) === norm('RotoTech Phase 2')) { r.client = 'RotoTech Systems'; report.corrections.push('Income: the ₹25,000 "RotoTech Phase 2" advance is booked to client RotoTech Systems'); }
  const before = clientRows.length;
  clientRows = clientRows.filter((r) => norm(r.clientname) !== norm('RotoTech Phase 2') && norm(r.clientname) !== OWN_NAME);
  if (clientRows.length !== before) report.corrections.push('Clients: "RotoTech Phase 2" is merged into RotoTech Systems (now Active), and "TechSentinals" (our own company) is not a client');
  for (const r of clientRows) if (norm(r.clientname) === norm('RotoTech Systems')) r.status = 'Active';
  for (const r of projectRows) if (norm(r.projectname) === norm('Rototech custom phase 2')) { r.client = 'RotoTech Systems'; report.corrections.push('Projects: phase 2 belongs to client RotoTech Systems (the sheet said TechSentinals)'); }

  const swappedIn = fixSwappedDates(income, 'date', now);
  const swappedEx = fixSwappedDates(expenses, 'date', now);
  if (swappedIn) report.warnings.push(`Income: ${swappedIn} dates had day and month swapped by the spreadsheet — put back in date order`);
  if (swappedEx) report.warnings.push(`Expenses: ${swappedEx} dates had day and month swapped by the spreadsheet — put back in date order`);

  tidyIncome(income, report.tidy);
  tidyExpenses(expenses, report.tidy);
  tidySubscriptions(subRows, report.tidy);
  const { websites } = tidyLeads(leadRows, report.tidy);
  for (const r of clientRows) r.clientname = clientName(r.clientname ?? '');
  for (const r of projectRows) { r.projectname = projectName(r.projectname ?? ''); r.client = clientName(r.client ?? ''); }

  const one = (sql: string, ...p: unknown[]): Row | undefined => db.prepare(sql).get(...p) as Row | undefined;
  const all = (sql: string, ...p: unknown[]): Row[] => db.prepare(sql).all(...p) as Row[];
  const sec = (k: string, by = 1): void => { report.sections[k] = (report.sections[k] ?? 0) + by; };

  const work = (): void => {
    if (opts.reset) report.removed = resetSeeded(ctx);
    createTeam(ctx, opts, report);
    if (!ctx.settings.get().company_name || ctx.settings.get().company_name === 'TechSentinals') ctx.settings.set({ company_name: COMPANY });
    const founder = (one("SELECT * FROM users WHERE LOWER(name)='ashwin solanki' AND role='founder' AND active=1") ?? one("SELECT * FROM users WHERE role='founder' AND active=1 ORDER BY id LIMIT 1")) as Row;
    const people = all('SELECT id, name FROM users WHERE active=1') as { id: number; name: string }[];
    const placeholder = (n: string): boolean => /^(unassigned|other|owner \d+|-|none|n\/a)$/i.test(n);
    const person = (name: string): { id: number | null; pending: string | null } => {
      const n = clean(name);
      if (!n || placeholder(n)) return { id: null, pending: null };
      const hit = matchUser(people, n);
      return { id: hit ? hit.id : null, pending: hit ? null : clean(n, 80) };
    };
    const seen = (table_: string, key: string): boolean => !!one(`SELECT 1 FROM ${table_} WHERE import_key=?`, key);

    applyLists(ctx, crm, os, [...new Set(expenses.map((r) => r.category ?? '').filter(Boolean))]);
    const accountId = ((): number => {
      const hit = one('SELECT id FROM accounts WHERE LOWER(name)=LOWER(?)', ACCOUNT);
      return hit ? (hit.id as number) : Number(db.prepare("INSERT INTO accounts(name,type,opening_balance) VALUES(?,'bank',0)").run(ACCOUNT).lastInsertRowid);
    })();

    // ---------- grants ----------
    for (const r of grantRows) {
      const name = clean(r.grantname);
      if (!name) continue;
      const key = `gs:grant:${name.toLowerCase()}`;
      if (seen('grants', key)) continue;
      db.prepare('INSERT INTO grants(name,funder,applied_on,requested,received,status,next_report_date,notes,import_key) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(name, clean(r.funder), toDate(r.applicationdate), toMoney(r.amountrequested), toMoney(r.amountreceived), GRANT_STATUS[norm(r.status)] ?? 'applied', toDate(r.nextreportingdate), clean(r.notes, 5000), key);
      sec('grants');
    }
    const onlyGrant = ((): number | null => { const g = all('SELECT id FROM grants'); return g.length === 1 ? (g[0]?.id as number) : null; })();

    // ---------- clients ----------
    const clientId = (name: string, create: boolean, ownIsNone = false): number | null => {
      const n = clean(name);
      if (!n || (ownIsNone && norm(n) === OWN_NAME)) return null;
      const hit = one('SELECT id FROM clients WHERE LOWER(company)=LOWER(?)', n);
      if (hit) return hit.id as number;
      if (!create) return null;
      sec('clients');
      return Number(db.prepare("INSERT INTO clients(company,status,import_key) VALUES(?,'active',?)").run(n, `gs:client:${n.toLowerCase()}`).lastInsertRowid);
    };
    for (const r of clientRows) {
      const name = clean(r.clientname);
      if (!name || one('SELECT 1 FROM clients WHERE LOWER(company)=LOWER(?)', name)) continue;
      const id = Number(db.prepare('INSERT INTO clients(company,status,import_key) VALUES(?,?,?)').run(name, CLIENT_STATUS[norm(r.status)] ?? 'active', `gs:client:${name.toLowerCase()}`).lastInsertRowid);
      const cp = clean(r.contactperson);
      if (cp || r.email || r.phone) db.prepare('INSERT INTO contacts(client_id,name,email,phone,is_primary) VALUES(?,?,?,?,1)').run(id, cp ?? name, clean(r.email), clean(r.phone));
      sec('clients');
    }

    // ---------- projects ----------
    for (const r of projectRows) {
      const name = clean(r.projectname);
      if (!name) continue;
      const key = `gs:project:${name.toLowerCase()}`;
      if (seen('projects', key) || one('SELECT 1 FROM projects WHERE LOWER(name)=LOWER(?)', name)) continue;
      const mgr = person(r.projectmanager ?? '');
      const id = Number(db.prepare('INSERT INTO projects(client_id,name,status,start_date,deadline,budget,manager_id,assigned_name,import_key) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(clientId(r.client ?? '', true), name, PROJECT_STATUS[norm(r.status)] ?? 'active', toDate(r.startdate), toDate(r.enddate), toMoney(r.budget), mgr.id, mgr.pending, key).lastInsertRowid);
      db.prepare('UPDATE projects SET code=? WHERE id=?').run(projectCode(id), id);
      if (mgr.id) db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(id, mgr.id);
      sec('projects');
    }

    // ---------- leads (the CRM numbers them itself: LD-0001 …; the sheet's Lead ID is only remembered to avoid loading a row twice) ----------
    const ins = db.prepare(`INSERT INTO leads(name,company,email,phone,website,city,country,market,business_side,department,category,requirement,source,owner_id,assigned_name,priority,stage,followup_round,
        last_contact,next_followup,next_action,meeting_date,proposal_date,value,closed_on,lost_reason,notes,created_by,import_key,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,datetime('now')))`);
    const sideOf = (dep: string | null, given: string): string | null => {
      if (/^product$/i.test(given)) return 'Product';
      if (/^service$/i.test(given)) return 'Service';
      if (!dep) return null;
      return ctx.settings.list('lead_products').some((x) => x.toLowerCase() === dep.toLowerCase()) ? 'Product' : ctx.settings.list('lead_services').some((x) => x.toLowerCase() === dep.toLowerCase()) ? 'Service' : null;
    };
    for (const r of leadRows) {
      const company = clean(r.companyperson);
      const contact = clean(r.contactperson);
      if (!company && !contact) continue;
      const ref = String(Math.round(Number(r.leadid)) || `${(company ?? '').toLowerCase()}`);
      const key = `gs:lead:${ref}`;
      if (seen('leads', key)) continue;
      const stage = STAGE[norm(r.salesstage)] ?? 'new';
      const added = toDate(r.dateadded);
      const owner = person(r.assignedto ?? '');
      const country = clean(r.country);
      const market = /^foreign$/i.test(r.market ?? '') ? 'Foreign' : /^india$/i.test(r.market ?? '') ? 'India' : country ? (/^india$/i.test(country) ? 'India' : 'Foreign') : null;
      const dept = clean(r.departmentproduct);
      const ended = CLOSED.includes(stage);
      ins.run(contact ?? company, company, clean(r.email), clean(r.phonewhatsapp), websites[Math.round(Number(r.leadid))] ?? null, clean(r.city), country, market, sideOf(dept, r.businessside ?? ''), dept, clean(r.category),
        clean(r.requirementinterestedin, 2000), clean(r.leadsource), owner.id, owner.pending, ['hot', 'medium', 'cold'].includes(norm(r.priority)) ? norm(r.priority) : null, stage, ROUND[norm(r.followupround)] ?? 'not_started',
        toDate(r.lastcontactdate), ended ? null : toDate(r.nextfollowupdate), clean(r.nextaction, 500), toDate(r.meetingdemodate), toDate(r.proposaldate), toMoney(r.dealvalueinr), ended ? toDate(r.conversionclosedate) || toDate(r.lastcontactdate) || added || now : null,
        clean(r.lostclosedreason, 500), (r.notes ?? '').trim() || null, founder.id, key, added ? `${added} 09:00:00` : null);
      sec('leads');
    }

    // ---------- income → payments ----------
    let lastDate: string | null = null;
    for (const r of income) {
      if (r.status && !/^(completed|received|paid)$/i.test(r.status.trim())) continue;
      const amount = toMoney(r.amount);
      let date = toDate(r.date);
      if (!date) { date = lastDate ?? now; report.warnings.push(`Income row ${r._row} (₹${amount}) has no date — used ${date}`); }
      lastDate = date;
      const notes = clean(r.notes, 2000);
      const key = `gs:income:${date}|${amount}|${norm(r.client)}|${norm(notes).slice(0, 60)}|${norm(r.invoiceid)}`;
      if (seen('payments', key)) continue;
      const project = r.project ? one('SELECT id FROM projects WHERE LOWER(name)=LOWER(?)', r.project) : undefined;
      db.prepare('INSERT INTO payments(date,amount,client_id,project_id,account_id,method,reference,notes,category,grant_id,created_by,import_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(date, amount, clientId(r.client ?? '', true, true), project ? project.id : null, accountId, clean(r.paymentmode), clean(r.invoiceid), notes, clean(r.category), /grant/i.test(r.category ?? '') ? onlyGrant : null, founder.id, key);
      sec('income');
    }

    // ---------- expenses ----------
    for (const r of expenses) {
      if (/cancel/i.test(r.status ?? '')) continue;
      const amount = toMoney(r.amount);
      const date = toDate(r.date);
      if (!date) { report.warnings.push(`Expense row ${r._row} (₹${amount}) has no date — skipped`); continue; }
      const notes = clean(r.notes, 2000);
      const category = clean(r.category) ?? 'Other';
      const key = `gs:expense:${date}|${amount}|${norm(r.vendor)}|${norm(category)}|${norm(notes).slice(0, 60)}`;
      if (seen('expenses', key)) continue;
      const fund = clean(r.fundedby);
      const fundHit = fund ? one('SELECT id FROM grants WHERE LOWER(name)=LOWER(?)', fund) : undefined;
      let receipt = clean(r.receiptlink, 1000);
      if (receipt && !/^https?:\/\//i.test(receipt)) receipt = /^[\w.-]+\.[a-z]{2,}\//i.test(receipt) ? `https://${receipt}` : null;
      db.prepare('INSERT INTO expenses(date,category,vendor,description,amount,account_id,method,status,notes,grant_id,receipt_url,created_by,import_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(date, category, clean(r.vendor), notes ?? clean(r.vendor) ?? category, amount, accountId, clean(r.paymentmode), /pending/i.test(r.status ?? '') ? 'pending' : 'paid', notes, fundHit ? fundHit.id : /grant/i.test(category) ? onlyGrant : null, receipt, founder.id, key);
      sec('expenses');
    }

    // ---------- subscriptions → recurring items that debit themselves ----------
    const nextMonthDay = (day: number): string => {
      const d = new Date(now + 'T00:00:00');
      let next = new Date(d.getFullYear(), d.getMonth(), Math.min(day, 28));
      if (next < d) next = new Date(d.getFullYear(), d.getMonth() + 1, Math.min(day, 28));
      return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    };
    const insRenewal = db.prepare(`INSERT INTO renewals(kind,name,vendor,renewal_date,cycle,our_cost,status,notes,owner_id,assigned_name,category,import_key,auto_debit,pay_account_id,amount_varies)
      VALUES(?,?,?,?,?,?,'active',?,?,?,?,?,1,?,?)`);
    for (const r of subRows) {
      const name = clean(r.softwareservice);
      if (!name) continue;
      const key = `gs:sub:${name.toLowerCase()}|${norm(r.owner)}|${norm(r.renewaldate)}`;
      if (seen('renewals', key)) continue;
      const when = clean(r.renewaldate) ?? '';
      const day = when.match(/(\d{1,2})(st|nd|rd|th)?\s+of\s+every\s+month/i);
      const monthly = toMoney(r.monthlycost);
      const annual = toMoney(r.annualcost);
      const own = person(r.owner ?? '');
      const cycle = day || /month/i.test(when) ? 'monthly' : 'yearly';
      const cost = cycle === 'monthly' ? monthly || annual / 12 : annual || monthly * 12;
      insRenewal.run('subscription', name, clean(r.vendor), toDate(when) ?? (day ? nextMonthDay(+(day[1] as string)) : null), cycle, round2(cost),
        [!toDate(when) && !day && when ? `Renewal Date in sheet: ${when}` : null, clean(r.notes, 2000)].filter(Boolean).join('\n') || null, own.id, own.pending, clean(r.category), key, accountId, 0);
      sec('subscriptions');
    }
    // the postpaid phone bill: the amount is different every month
    if (!seen('renewals', 'seed:bill:airtel')) {
      insRenewal.run('bill', 'Airtel postpaid phone bill', 'Airtel', nextMonthDay(26), 'monthly', 834, 'Postpaid: the amount changes every month. The CRM adds an estimate (the last bill) each month — open it and enter the real amount.', null, null, 'Telecom & Utilities', 'seed:bill:airtel', accountId, 1);
      sec('subscriptions');
    }

    // ---------- grant money received (Grants → Amount Received) counts as income, like the sheet's Dashboard ----------
    for (const g of all("SELECT id, name, received, applied_on FROM grants WHERE received > 0 AND import_key LIKE 'gs:grant:%'")) {
      const key = `gs:grantin:${String(g.name).toLowerCase()}`;
      const booked = (one('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE grant_id=?', g.id) as { v: number }).v;
      if (seen('payments', key) || booked >= g.received) continue;
      const first = (one('SELECT MIN(date) d FROM expenses WHERE grant_id=?', g.id) as { d: string | null }).d;
      const date = first ?? g.applied_on ?? now;
      db.prepare("INSERT INTO payments(date,amount,account_id,category,grant_id,notes,created_by,import_key) VALUES(?,?,?,'Grant',?,?,?,?)")
        .run(date, round2(g.received - booked), accountId, g.id, `Grant money received — ${g.name} (Amount Received in the Grants tab). The sheet has no receipt date: ${date} (the day the first grant-funded spend happened) is used. Edit it here if the money arrived earlier.`, founder.id, key);
      report.warnings.push(`Grant "${g.name}": ₹${g.received - booked} received is booked as Grant income on ${date} — set the real date in Finance → Income`);
      sec('grant_income');
    }

    // ---------- connect the pieces ----------
    for (const [id, url] of Object.entries(websites)) db.prepare("UPDATE leads SET website=? WHERE import_key=? AND (website IS NULL OR website='')").run(url, `gs:lead:${id}`);
    // a lead that is Converted in the sales sheet is a client in the money sheet under a longer name ("Inventa" → "Inventa Systems")
    const bare = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]/g, '');
    const clients = all('SELECT id, company FROM clients').map((c) => ({ id: c.id as number, n: bare(c.company) }));
    for (const l of all("SELECT id, name, company, email, phone FROM leads WHERE stage='won' AND client_id IS NULL AND import_key LIKE 'gs:lead:%'")) {
      const k = bare(l.company || l.name);
      if (k.length < 4) continue;
      const hit = clients.filter((c) => c.n.startsWith(k));
      if (hit.length !== 1 || one('SELECT 1 FROM leads WHERE client_id=?', hit[0]?.id)) continue;
      db.prepare('UPDATE leads SET client_id=? WHERE id=?').run(hit[0]?.id, l.id);
      if (!one('SELECT 1 FROM contacts WHERE client_id=?', hit[0]?.id)) db.prepare('INSERT INTO contacts(client_id,name,email,phone,is_primary) VALUES(?,?,?,?,1)').run(hit[0]?.id, l.name, l.email, l.phone);
      sec('won_leads_linked');
    }

    // ---------- what each project is, its value, completion date; the RotoTech maintenance plan; one paid invoice per client project ----------
    const billed: Record<string, number> = {};
    for (const r of projectRows) billed[r.projectname ?? ''] = toMoney(r.totalbilled);
    for (const [name, info] of Object.entries(PROJECTS)) {
      const p = one('SELECT * FROM projects WHERE LOWER(name)=LOWER(?)', name);
      if (!p) continue;
      const pay = one('SELECT MIN(date) a, MAX(date) b, COALESCE(SUM(amount),0) s FROM payments WHERE project_id=?', p.id) as { a: string | null; b: string | null; s: number };
      db.prepare('UPDATE projects SET type=COALESCE(type,?), description=COALESCE(description,?), status=?, deadline=COALESCE(deadline,?), budget=CASE WHEN budget>0 THEN budget ELSE ? END, completed_on=?, start_date=COALESCE(start_date,?) WHERE id=?')
        .run(info.type ?? null, info.description, info.status, info.deadline ?? null, billed[name] || info.value || (info.status === 'maintenance' ? pay.s : 0), info.status === 'completed' ? pay.b : null, info.status === 'maintenance' ? pay.a : null, p.id);
      sec('project_details');
    }
    for (const c of all('SELECT id FROM clients')) {
      const first = (one('SELECT MIN(date) d FROM payments WHERE client_id=?', c.id) as { d: string | null }).d;
      if (first) db.prepare('UPDATE clients SET created_at=? WHERE id=?').run(`${first} 09:00:00`, c.id);
    }
    db.prepare("UPDATE clients SET notes=COALESCE(notes||char(10),'')||'Phase 2 of this work is the project \"RotoTech Maintenance & Support (Phase 2)\" (the sheet listed it as a separate client \"RotoTech Phase 2\").' WHERE LOWER(company)='rototech systems' AND (notes IS NULL OR notes NOT LIKE '%Phase 2%')").run();
    const roto = one("SELECT id FROM clients WHERE LOWER(company)='rototech systems'");
    const p2 = one("SELECT id FROM projects WHERE name LIKE 'RotoTech Maintenance%'");
    if (roto && p2 && !seen('renewals', 'seed:amc:rototech')) {
      db.prepare("INSERT INTO renewals(client_id,project_id,kind,name,renewal_date,cycle,our_cost,client_price,status,notes,import_key,owner_id) VALUES(?,?,'amc',?,?,'one-time',0,25000,'active',?,'seed:amc:rototech',?)")
        .run(roto.id, p2.id, 'RotoTech — Maintenance & support until December 2026', '2026-12-31', 'Maintenance and support for RotoTech Systems until 31 December 2026. ₹25,000 advance received on 12 Aug 2026. Decide on a renewal before the plan ends.', founder.id);
      sec('maintenance_plans');
    }
    const s = ctx.settings.get();
    const invProjects: (Row & { pays: Row[] })[] = (all('SELECT p.id, p.name, p.client_id, p.import_key FROM projects p WHERE p.client_id IS NOT NULL ORDER BY p.id'))
      .map((p) => ({ ...p, pays: all("SELECT id, date, amount, notes FROM payments WHERE project_id=? AND import_key LIKE 'gs:income:%' ORDER BY date, id", p.id) }))
      .filter((p) => p.pays.length).sort((a, b) => (a.pays[0]?.date as string).localeCompare(b.pays[0]?.date as string)); // invoice numbers follow the order of the work
    for (const p of invProjects) {
      const key = `seed:invoice:${p.import_key}`;
      if (seen('invoices', key)) continue;
      const items = p.pays.map((x) => ({ description: x.notes || 'Payment received', hsn: '', qty: 1, rate: x.amount }));
      const total = round2(items.reduce((t, i) => t + i.rate, 0));
      const issue = p.pays[0]?.date as string;
      const last = p.pays[p.pays.length - 1]?.date as string;
      const id = Number(db.prepare(`INSERT INTO invoices(number,kind,client_id,project_id,title,issue_date,due_date,status,items,subtotal,discount,tax_type,tax_rate,tax_amount,total,currency,terms,notes,created_by,import_key)
        VALUES(?,'invoice',?,?,?,?,?,'sent',?,?,0,'none',0,0,?,'INR',?,?,?,?)`)
        .run(nextNumber(ctx, 'invoices', s.invoice_prefix || 'INV', issue), p.client_id, p.id, p.name, issue, last, JSON.stringify(items), total, total, s.terms_invoice || null, 'Raised from the payments received for this project; every line below has been paid.', founder.id, key).lastInsertRowid);
      db.prepare("UPDATE payments SET invoice_id=? WHERE project_id=? AND import_key LIKE 'gs:income:%'").run(id, p.id);
      refreshInvoice(ctx, id);
      sec('invoices');
    }
    // Strikar's 2nd tranche (not in the sheets yet): ₹65,000 arrived on 14 Oct 2026 and the client deducted ₹13,000 TDS. The invoice is only for what we receive (₹65,000);
    // the TDS is a tax credit tracked apart for the ITR. Of the ₹1.30L project: ₹1,04,000 received, ₹13,000 TDS, so ₹13,000 is still to be billed and received.
    const strikar = one("SELECT c.id cid, p.id pid FROM clients c JOIN projects p ON p.client_id=c.id WHERE LOWER(c.company)='strikar lifescience llp' AND LOWER(p.name)='strikar lifescience website'");
    if (strikar && !seen('payments', STRIKAR_PAYMENT_KEY)) {
      const id = Number(db.prepare(`INSERT INTO invoices(number,kind,client_id,project_id,title,issue_date,due_date,status,items,subtotal,discount,tax_type,tax_rate,tax_amount,total,currency,terms,notes,created_by,import_key)
        VALUES(?,'invoice',?,?,?,?,?,'sent',?,?,0,'none',0,0,?,'INR',?,?,?,?)`)
        .run(nextNumber(ctx, 'invoices', s.invoice_prefix || 'INV', STRIKAR_DATE), strikar.cid, strikar.pid, 'Strikar Lifescience Website — 2nd tranche', STRIKAR_DATE, STRIKAR_DATE,
          JSON.stringify([{ description: 'Strikar Lifescience Website — 2nd tranche', hsn: '', qty: 1, rate: 65000 }]), 65000, 65000, s.terms_invoice || null,
          'Paid in full. The client deducted ₹13,000 TDS, which is tracked separately for the income-tax return.', founder.id, 'seed:invoice:strikar-2').lastInsertRowid);
      db.prepare("INSERT INTO payments(invoice_id,client_id,project_id,account_id,date,amount,tds,method,category,notes,created_by,import_key) VALUES(?,?,?,?,?,65000,13000,'Bank Transfer','Product Sales',?,?,?)")
        .run(id, strikar.cid, strikar.pid, accountId, STRIKAR_DATE, 'Strikar Lifescience Website — 2nd tranche. 10% TDS ₹13,000 deducted by the client.', founder.id, STRIKAR_PAYMENT_KEY);
      refreshInvoice(ctx, id);
      sec('income');
      sec('invoices');
    }
    linkPeople(ctx);
    if (opts.dryRun) throw new Dry();
  };

  try { db.transaction(work)(); } catch (e) { if (!(e instanceof Dry)) throw e; }

  if (!opts.dryRun) {
    report.checks = reconcile(ctx, crm, os, { 'Leads: India': -1, 'Leads: Foreign': 1, 'Total revenue (income + grant received)': 65000, 'Current balance': 65000 });
    for (const t of ['leads', 'clients', 'projects', 'invoices', 'payments', 'expenses', 'grants', 'renewals', 'users']) report.counts[t] = (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
  }
  return report;
}

/** Checks every total against what the sheets show themselves; differences the founders agreed to are listed in `adjust`. */
function reconcile(ctx: AppContext, crm: Record<string, Sheet>, os: Record<string, Sheet>, adjust: Record<string, number>): Check[] {
  const { db } = ctx;
  const q = (sql: string): { v: number } => db.prepare(sql).get() as { v: number };
  const checks: Check[] = [];
  const check = (what: string, sheet: number | null, app: number): void => {
    const want = sheet === null ? null : sheet + (adjust[what] ?? 0);
    checks.push({ what, sheet: want, app, ok: want === null || Math.abs(want - app) < 0.005, note: adjust[what] ? `sheet ${sheet}, corrected ${adjust[what] > 0 ? '+' : ''}${adjust[what]}` : '' });
  };
  const dash = os.Dashboard;
  const income = q('SELECT COALESCE(SUM(amount),0) v FROM payments').v;
  const expenses = q("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status='paid' AND renewal_id IS NULL").v;
  check('Total revenue (income + grant received)', labelled(dash, 'TOTAL REVENUE', 1, 0), round2(income));
  check('Total expenses', labelled(dash, 'TOTAL EXPENSES', 1, 0), round2(expenses));
  check('Current balance', labelled(dash, 'CURRENT BALANCE', 1, 0), round2(income - expenses));
  check('Grants: total requested', labelled(dash, 'Total Requested', 0, 1), q('SELECT COALESCE(SUM(requested),0) v FROM grants').v);
  check('Grants: total received', labelled(dash, 'Total Received', 0, 1), q('SELECT COALESCE(SUM(received),0) v FROM grants').v);
  check('Grants: pending amount', labelled(dash, 'Pending Amount', 0, 1), q('SELECT COALESCE(SUM(requested-received),0) v FROM grants').v);
  check('Grants: money used', labelled(dash, 'Grant Money Used', 0, 1), round2(q("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE grant_id IS NOT NULL AND status='paid'").v));
  const sum = (sheet: Sheet | undefined, head: string): number | null => {
    if (!sheet) return null;
    const rows = table(sheet, head);
    return round2(rows.reduce((s, r) => s + toMoney(r[norm(head)]), 0));
  };
  check('Income tab total = payments in CRM (excluding grant receipts)', sum(os.Income, 'Amount'), round2(q(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE import_key NOT LIKE 'gs:grantin:%' AND import_key <> '${STRIKAR_PAYMENT_KEY}'`).v));
  check('Expenses tab total = expenses in CRM', sum(os.Expenses, 'Amount'), round2(expenses));
  check('Subscriptions in sheet = recurring items in CRM', table(os.Subscriptions, 'Software/Service').length + 1, q("SELECT COUNT(*) v FROM renewals WHERE kind IN ('subscription','bill')").v);
  check('Invoices created = client payments they cover', round2(q('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE invoice_id IS NOT NULL').v), round2(q("SELECT COALESCE(SUM(total),0) v FROM invoices WHERE import_key LIKE 'seed:invoice:%'").v));
  const cd = crm.Dashboard;
  const L = (w?: string): number => q(`SELECT COUNT(*) v FROM leads ${w ? `WHERE ${w}` : ''}`).v;
  check('Leads: total', labelled(cd, 'Total Leads', 0, 1), L());
  check('Leads: open', labelled(cd, 'Open Leads', 0, 1), L("stage NOT IN ('won','closed','lost')"));
  check('Leads: converted', labelled(cd, 'Converted', 0, 1), L("stage='won'"));
  check('Leads: India', labelled(cd, 'India Leads', 0, 1), L("market='India'"));
  check('Leads: Foreign', labelled(cd, 'Foreign Leads', 0, 1), L("market='Foreign'"));
  check('Leads: India converted', labelled(cd, 'India Converted', 0, 1), L("market='India' AND stage='won'"));
  const rowsOf = (sheet: Sheet | undefined, key: string): Record_[] => (sheet ? table(sheet, key) : []);
  for (const d of rowsOf(crm['Dept Analytics'], 'Department / Product')) {
    const dep = d.departmentproduct ?? '';
    check(`Department ${dep}: leads`, toMoney(d.totalleads), L(`department=${lit(dep)}`));
    check(`Department ${dep}: converted`, toMoney(d.converted), L(`department=${lit(dep)} AND stage='won'`));
  }
  for (const d of rowsOf(crm['Source Analytics'], 'Lead Source')) check(`Source ${d.leadsource}: leads`, toMoney(d.totalleads), L(`source=${lit(d.leadsource ?? '')}`));
  for (const m of rowsOf(crm['Monthly Analytics'], 'Month').filter((x) => toMoney(x.newleads) > 0)) {
    const month = (toDate(m.month) ?? '').slice(0, 7);
    check(`Leads added in ${month}`, toMoney(m.newleads), L(`substr(created_at,1,7)=${lit(month)}`));
  }
  return checks;
}
void addMonths;
