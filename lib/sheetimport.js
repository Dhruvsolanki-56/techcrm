/* Import the team's Google Sheets workbooks ("TechSentinals CRM" sales sheet and "TechSentinals OS" money sheet).
   The browser reads the .xlsx (from a shared link or a downloaded file) and sends every tab as rows; this file finds the
   known tabs by their headings, maps the columns and writes everything in one transaction.
   Safe to run again: every imported row remembers where it came from (import_key) and is never added twice.
   Preview = the same run inside a transaction that is rolled back. */
'use strict';
const { db, getSettings, setSettings, audit, today } = require('./db');
const RULES = require('../public/js/rules');
const { HttpError, STAGE_PROB } = require('./resources');

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (v, max = 300) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s));
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function toDate(v) {
  const s = String(v ?? '').trim(); if (!s) return null;
  if (isISO(s.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);                 // 14/12/2025 (day first, Indian style)
  if (m) { const d = `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isISO(d) ? d : null; }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-,]+(\d{4})$/);              // 30-Aug-2026, 30 Aug 2026
  if (m && MONTHS[m[2].toLowerCase()]) { const d = `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isISO(d) ? d : null; }
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 30000 && +s < 80000) return new Date(Math.round((+s - 25569) * 86400000)).toISOString().slice(0, 10);   // spreadsheet day number
  return null;
}
const toMoney = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const pick = (row, ...keys) => { for (const k of keys) if (row[k] != null && String(row[k]).trim() !== '') return row[k]; return null; };

// find the heading row (first row that has all `need` headings), name blank headings by their contents (dates / amounts)
function table(rows, need) {
  if (!Array.isArray(rows)) return null;
  const hi = rows.slice(0, 15).findIndex((r) => Array.isArray(r) && need.every((n) => r.some((c) => norm(c) === n)));
  if (hi < 0) return null;
  const head = rows[hi].map(norm); const body = rows.slice(hi + 1).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim()));
  head.forEach((h, i) => {
    if (h) return;
    const vals = body.map((r) => r[i]).filter((v) => String(v ?? '').trim());
    if (!vals.length) return;
    if (vals.filter((v) => toDate(v)).length >= vals.length * 0.8 && !head.includes('date')) head[i] = 'date';
    else if (vals.filter((v) => /^[₹$\s]*-?[\d,]+(\.\d+)?$/.test(String(v).trim())).length >= vals.length * 0.8 && !head.includes('amount')) head[i] = 'amount';
  });
  return body.slice(0, 5000).map((r, n) => { const o = { _row: hi + n + 2 }; head.forEach((h, i) => { if (h && !(h in o)) o[h] = r[i]; }); return o; });
}
// only a tab with one of these names (for list / summary tabs whose headings also appear in data tabs)
const tabNamed = (tabs, names, need) => { for (const [name, rows] of Object.entries(tabs)) if (names.includes(norm(name))) { const t = table(rows, need); if (t) return t; } return null; };
const tabLike = (tabs, names, need) => {
  for (const [name, rows] of Object.entries(tabs)) if (names.includes(norm(name))) { const t = table(rows, need); if (t) return t; }
  for (const rows of Object.values(tabs)) { const t = table(rows, need); if (t) return t; }
  return null;
};

const STAGE = { new: 'new', contacted: 'contacted', qualified: 'qualified', demomeeting: 'meeting', meeting: 'meeting', demo: 'meeting', proposalsent: 'proposal', proposal: 'proposal',
  negotiation: 'negotiation', converted: 'won', won: 'won', closed: 'closed', lost: 'lost', nurture: 'nurture' };
const ROUND = { notstarted: 'not_started', initialcontact: 'initial', initial: 'initial', '1stfollowup': 'first', '2ndfollowup': 'second', '3rdfollowup': 'third', followupcomplete: 'complete', complete: 'complete' };
const NOTE_KIND = { call: 'call', phone: 'call', whatsapp: 'whatsapp', email: 'email', mail: 'email', meeting: 'meeting', demo: 'demo', proposal: 'proposal', visit: 'visit' };
const PROJECT_STATUS = { active: 'active', completed: 'completed', onhold: 'on_hold', cancelled: 'cancelled', pending: 'planning', atrisk: 'at_risk', planning: 'planning' };
const CLIENT_STATUS = { active: 'active', completed: 'past', onhold: 'on_hold', cancelled: 'archived', pending: 'prospect', atrisk: 'at_risk' };
const RENEWAL_STATUS = { active: 'active', completed: 'cancelled', cancelled: 'cancelled', onhold: 'lapsed', pending: 'active', atrisk: 'active', inactive: 'lapsed', lapsed: 'lapsed' };
const sheetId = (v) => { const s = clean(v); if (!s) return null; return /^\d+(\.0+)?$/.test(s) ? String(parseInt(s, 10)) : s; };     // "12.0" → "12"
const GRANT_STATUS = { applied: 'applied', approved: 'approved', disbursed: 'disbursed', closed: 'closed', rejected: 'rejected' };

function nextMonthDay(day) {        // "12th of every month" → next 12th
  const now = new Date(); let d = new Date(now.getFullYear(), now.getMonth(), Math.min(day, 28));
  if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(day, 28));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function run(tabs, opts, user) {
  const out = { sections: {}, warnings: [], people_not_found: {}, list_additions: {} };
  const sec = (k) => (out.sections[k] = out.sections[k] || { found: 0, added: 0, already: 0, skipped: [] });
  const warn = (m) => { if (out.warnings.length < 300) out.warnings.push(m); };
  const users = db.prepare('SELECT id, name FROM users WHERE active=1').all();
  const placeholder = (n) => /^(unassigned|other|owner \d+|-|none|n\/a)$/i.test(n);
  const person = (name) => {
    const n = clean(name); if (!n || placeholder(n)) return null;
    const hit = matchUser(users, n);
    if (!hit) out.people_not_found[n] = (out.people_not_found[n] || 0) + 1;
    return hit ? hit.id : null;
  };
  const pending = (name, id) => { const n = clean(name, 80); return !id && n && !placeholder(n) ? n : null; };      // kept until that person joins
  let s = getSettings(); const lists = {};
  const listHas = (key, v) => String(s[key] || '').split('\n').some((x) => x.trim().toLowerCase() === v.toLowerCase());
  const remember = (key, v, side) => {           // a value the sheet uses that the CRM dropdown does not have yet → add it
    if (!v) return; const k = key || (side === 'Product' ? 'lead_products' : 'lead_services');
    if (key === null && (listHas('lead_services', v) || listHas('lead_products', v))) return;
    if (key && listHas(k, v)) return;
    lists[k] = lists[k] || new Set(); lists[k].add(v);
  };
  const seen = (table, key) => !!db.prepare(`SELECT 1 FROM ${table} WHERE import_key=?`).get(key);
  const companyName = String(s.company_name || '').toLowerCase();
  let accountId = opts.account_id || null;
  const needAccount = () => {
    if (accountId || opts.new_account === undefined) return accountId;
    const name = clean(opts.new_account, 60) || 'Bank account';
    const hit = db.prepare('SELECT id FROM accounts WHERE LOWER(name)=LOWER(?)').get(name);
    accountId = hit ? hit.id : db.prepare("INSERT INTO accounts(name,type,opening_balance) VALUES(?,'bank',0)").run(name).lastInsertRowid;
    if (!hit) out.account_created = name;
    return accountId;
  };

  // ---------- dropdown lists: the sheets' "Lists & Settings" / "Settings" tabs become the CRM's lists ----------
  // (values already used by records in the CRM are kept, so nothing loses its value)
  const column = (rows, key) => { const seen = new Set(); const vals = [];
    for (const r of rows || []) { const v = clean(r[key], 60); if (!v || seen.has(v.toLowerCase())) continue; if (/^(recommended|stage|suggested)/i.test(v)) break; seen.add(v.toLowerCase()); vals.push(v); } return vals; };
  const inUse = { lead_services: 'SELECT DISTINCT department v FROM leads', lead_products: 'SELECT DISTINCT department v FROM leads', lead_categories: 'SELECT DISTINCT category v FROM leads',
    lead_sources: 'SELECT DISTINCT source v FROM leads', income_categories: 'SELECT DISTINCT category v FROM payments', expense_categories: 'SELECT DISTINCT category v FROM expenses',
    payment_modes: 'SELECT DISTINCT method v FROM payments UNION SELECT DISTINCT method FROM expenses', statuses: 'SELECT DISTINCT status v FROM documents UNION SELECT DISTINCT status FROM assets' };
  const setList = (key, vals, other) => {
    if (!vals.length) return;
    const keep = String(s[key] || '').split('\n').map((x) => x.trim()).filter((x) => x && !vals.some((v) => v.toLowerCase() === x.toLowerCase())
      && !(other || []).some((v) => v.toLowerCase() === x.toLowerCase()) && db.prepare(`SELECT 1 FROM (${inUse[key]}) WHERE LOWER(v)=LOWER(?)`).get(x));
    const next = [...vals, ...keep].join('\n'); if (next === s[key]) return;
    setSettings({ [key]: next }); out.lists_replaced = [...(out.lists_replaced || []), key];
  };
  const salesLists = tabNamed(tabs, ['listssettings', 'lists'], ['departmentproduct', 'leadsource']);
  if (salesLists) {
    // Service or Product per department comes from the sheet's Dept Analytics tab (falls back to the name)
    const sideOf = {}; for (const r of tabNamed(tabs, ['deptanalytics'], ['departmentproduct', 'businessside']) || []) { const d = clean(r.departmentproduct, 60); if (d) sideOf[d.toLowerCase()] = /product/i.test(r.businessside || '') ? 'Product' : 'Service'; }
    const depts = column(salesLists, 'departmentproduct');
    const prod = depts.filter((d) => sideOf[d.toLowerCase()] === 'Product' || (!sideOf[d.toLowerCase()] && /product/i.test(d)));
    const serv = depts.filter((d) => !prod.includes(d));
    setList('lead_services', serv, prod); setList('lead_products', prod, serv);
    setList('lead_categories', column(salesLists, 'category')); setList('lead_sources', column(salesLists, 'leadsource'));
  }
  const moneyLists = tabNamed(tabs, ['settings'], ['incomecategories', 'expensecategories']);
  if (moneyLists) {
    const inc = column(moneyLists, 'incomecategories'); setList('income_categories', inc.length && !inc.some((v) => /^client payment$/i.test(v)) ? ['Client payment', ...inc] : inc);
    setList('expense_categories', column(moneyLists, 'expensecategories')); setList('payment_modes', column(moneyLists, 'paymentmodes')); setList('statuses', column(moneyLists, 'statuses'));
    out.team_members = column(moneyLists, 'teammembers');
  }
  s = getSettings();

  // ---------- grants ----------
  const grantRows = tabLike(tabs, ['grants'], ['grantname']) || [];
  for (const r of grantRows) {
    const S = sec('grants'); const name = clean(r.grantname); if (!name) continue; S.found++;
    const key = `gs:grant:${name.toLowerCase()}`; if (seen('grants', key) || db.prepare('SELECT 1 FROM grants WHERE LOWER(name)=LOWER(?)').get(name)) { S.already++; continue; }
    const requested = toMoney(pick(r, 'amountrequested', 'requested', 'requestedamount', 'amount'));
    const recKey = Object.keys(r).find((k) => /receiv/.test(k)); const received = recKey ? toMoney(r[recKey]) : 0;
    db.prepare('INSERT INTO grants(name,funder,applied_on,requested,received,status,next_report_date,notes,import_key) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(name, clean(r.funder), toDate(r.applicationdate), requested, received, GRANT_STATUS[norm(r.status)] || 'applied', toDate(r.nextreportingdate), clean(r.notes, 5000), key);
    S.added++;
  }
  const allGrants = db.prepare('SELECT id FROM grants').all(); const onlyGrant = allGrants.length === 1 ? allGrants[0].id : null;

  // ---------- clients ----------
  // own-company rows: kept as a client for internal projects, but money "from TechSentinals" is the founders' own, not client income
  const clientId = (name, create, ownIsNone) => {
    const n = clean(name); if (!n || (ownIsNone && n.toLowerCase() === companyName)) return null;
    const hit = db.prepare('SELECT id FROM clients WHERE LOWER(company)=LOWER(?)').get(n); if (hit) return hit.id;
    if (!create) return null;
    const id = db.prepare("INSERT INTO clients(company,status,import_key) VALUES(?,'active',?)").run(n, `gs:client:${n.toLowerCase()}`).lastInsertRowid;
    sec('clients').added++; return id;
  };
  for (const r of tabLike(tabs, ['clients'], ['clientname']) || []) {
    const S = sec('clients'); const name = clean(r.clientname); if (!name) continue; S.found++;
    if (db.prepare('SELECT 1 FROM clients WHERE LOWER(company)=LOWER(?)').get(name)) { S.already++; continue; }
    const status = CLIENT_STATUS[norm(r.status)] || 'active';
    const id = db.prepare('INSERT INTO clients(company,status,import_key) VALUES(?,?,?)').run(name, status, `gs:client:${name.toLowerCase()}`).lastInsertRowid;
    const cp = clean(r.contactperson); const em = clean(r.email); const ph = clean(r.phone);
    if (cp || em || ph) db.prepare('INSERT INTO contacts(client_id,name,email,phone,is_primary) VALUES(?,?,?,?,1)').run(id, cp || name, em && !RULES.check('email', em) ? em : null, ph && !RULES.check('phone', ph) ? ph : null);
    S.added++;
  }

  // ---------- projects ----------
  for (const r of tabLike(tabs, ['projects'], ['projectname']) || []) {
    const S = sec('projects'); const name = clean(r.projectname); if (!name) continue; S.found++;
    const cid = clientId(r.client, true);
    const key = `gs:project:${name.toLowerCase()}`;
    if (seen('projects', key) || db.prepare('SELECT 1 FROM projects WHERE LOWER(name)=LOWER(?)').get(name)) { S.already++; continue; }
    const mgrId = person(r.projectmanager);
    const id = db.prepare('INSERT INTO projects(client_id,name,status,start_date,deadline,budget,manager_id,assigned_name,import_key) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(cid, name, PROJECT_STATUS[norm(r.status)] || 'active', toDate(r.startdate), toDate(r.enddate), toMoney(r.budget), mgrId, pending(r.projectmanager, mgrId), key).lastInsertRowid;
    db.prepare('UPDATE projects SET code=? WHERE id=?').run(`P-${String(new Date().getFullYear()).slice(2)}-${String(id).padStart(3, '0')}`, id);
    const mgr = db.prepare('SELECT manager_id FROM projects WHERE id=?').get(id).manager_id;
    if (mgr) db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(id, mgr);
    if (/completed/i.test(r.status || '')) db.prepare('UPDATE projects SET completed_on=COALESCE(deadline, ?) WHERE id=?').run(today(), id);
    S.added++;
  }

  // ---------- leads (Master Leads) ----------
  const leadIdByRef = {};
  const known = db.prepare("SELECT id, LOWER(COALESCE(email,'')) e, phone p, import_key k FROM leads").all();       // leads typed into the CRM by hand count as duplicates; earlier sheet rows only as twins
  const digits = (x) => String(x || '').replace(/\D/g, '').slice(-10);
  const fromSheet = (k) => String(k.k || '').startsWith('gs:lead:'); const byEmail = (list) => new Map(list.filter((k) => k.e).map((k) => [k.e, k.id])); const byPhone = (list) => new Map(list.filter((k) => digits(k.p).length >= 8).map((k) => [digits(k.p), k.id]));
  const emails = byEmail(known.filter((k) => !fromSheet(k))); const phones = byPhone(known.filter((k) => !fromSheet(k))); const sheetEmails = byEmail(known.filter(fromSheet)); const sheetPhones = byPhone(known.filter(fromSheet));
  for (const r of tabLike(tabs, ['masterleads', 'leads'], ['companyperson']) || []) {
    const S = sec('leads');
    const company = clean(r.companyperson); const contact = clean(r.contactperson);
    if (!company && !contact) continue; S.found++;
    const ref = sheetId(r.leadid) || `${(company || '').toLowerCase()}|${digits(r.phonewhatsapp)}`;
    const key = `gs:lead:${ref}`;
    const prev = db.prepare('SELECT id FROM leads WHERE import_key=?').get(key);
    if (prev) { S.already++; leadIdByRef[ref] = prev.id; continue; }
    const extra = [];
    let email = clean(r.email); if (email && RULES.check('email', email)) { const first = email.split(/[\s/,;]+/).find((x) => !RULES.check('email', x)); extra.push(`Email in sheet: ${email}`); email = first || null; }
    let phone = clean(r.phonewhatsapp);
    if (phone && /^\d(\.\d+)?e\+?\d+$/i.test(phone)) phone = String(Math.round(Number(phone)));     // Excel showed 9876543210 as 9.87654321E9
    if (phone && RULES.check('phone', phone)) {     // several numbers in one cell: keep the first good one, the rest go to notes
      const nums = phone.split(/[;,/|]+|\s+(?:or|and)\s+/i).map((x) => x.trim()).filter(Boolean); const first = nums.find((x) => !RULES.check('phone', x));
      if (first) { if (nums.length > 1) extra.push(`Other phones: ${nums.filter((x) => x !== first).join(', ')}`); }
      else { extra.push(`Phone in sheet: ${phone}`); warn(`Lead ${ref} (${company || contact}): phone "${phone}" kept in notes`); }
      phone = first || null;
    }
    // a lead already in the CRM (added by hand) is not added twice; two rows of the same sheet are both kept, as in the sheet
    const dup = (email && emails.get(email.toLowerCase())) || (digits(phone).length >= 8 && phones.get(digits(phone)));
    const twin = (email && sheetEmails.get(email.toLowerCase())) || (digits(phone).length >= 8 && sheetPhones.get(digits(phone)));
    if (!dup && twin) extra.push(`Same phone/email as Lead ID ${twin} in the sheet`);
    if (dup) { S.skipped.push(`Lead ID ${ref} — ${company || contact}: same phone/email as lead #${dup} (kept that one)`); leadIdByRef[ref] = dup; continue; }
    const country = clean(r.country); let market = clean(r.market);
    market = /^foreign$/i.test(market || '') ? 'Foreign' : /^india$/i.test(market || '') ? 'India' : country ? (/^india$/i.test(country) ? 'India' : 'Foreign') : null;
    const dept = clean(r.departmentproduct);
    const side = /^product$/i.test(r.businessside || '') ? 'Product' : /^service$/i.test(r.businessside || '') ? 'Service' : dept ? (listHas('lead_products', dept) ? 'Product' : listHas('lead_services', dept) ? 'Service' : null) : null; const cat = clean(r.category); const src = clean(r.leadsource);
    remember(null, dept, side); remember('lead_categories', cat); remember('lead_sources', src);
    const stage = STAGE[norm(r.salesstage)] || 'new';
    const closed = toDate(pick(r, 'conversionclosedate', 'closedate', 'conversiondate'));
    const added = toDate(r.dateadded);
    const notes = [clean(r.notes, 5000), ...extra].filter(Boolean).join('\n') || null;
    const ownerId = person(r.assignedto);
    const wantId = /^\d+$/.test(ref) && +ref > 0 && !db.prepare('SELECT 1 FROM leads WHERE id=?').get(+ref) ? +ref : null;      // same Lead ID as the sheet
    const id = db.prepare(`INSERT INTO leads(id,name,company,email,phone,city,country,market,business_side,department,category,requirement,source,owner_id,assigned_name,priority,stage,followup_round,
        last_contact,next_followup,next_action,meeting_date,proposal_date,value,closed_on,lost_reason,notes,created_by,import_key,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,datetime('now')))`)
      .run(wantId, contact || company, company, email, phone, clean(r.city), country, market, side, dept, cat, clean(r.requirementinterestedin, 2000), src, ownerId, pending(r.assignedto, ownerId),
        ['hot', 'medium', 'cold'].includes(norm(r.priority)) ? norm(r.priority) : null, stage, ROUND[norm(r.followupround)] || 'not_started',
        toDate(r.lastcontactdate), ['won', 'closed', 'lost'].includes(stage) ? null : toDate(r.nextfollowupdate), clean(r.nextaction, 500), toDate(r.meetingdemodate), toDate(r.proposaldate),
        toMoney(r.dealvalueinr ?? r.dealvalue), ['won', 'closed', 'lost'].includes(stage) ? closed || toDate(r.lastcontactdate) || added || today() : null, clean(pick(r, 'lostclosedreason', 'lostreason'), 500), notes, user.id, key, added ? added + ' 09:00:00' : null).lastInsertRowid;
    leadIdByRef[ref] = id; if (email) sheetEmails.set(email.toLowerCase(), id); if (digits(phone).length >= 8) sheetPhones.set(digits(phone), id);
    S.added++;
  }

  // ---------- contact log → lead timeline ----------
  for (const r of tabLike(tabs, ['contactlog'], ['leadid', 'contacttype']) || []) {
    const S = sec('contact_log'); const ref = sheetId(r.leadid); if (!ref) continue; S.found++;
    const lid = leadIdByRef[ref] || (db.prepare('SELECT id FROM leads WHERE import_key=?').get(`gs:lead:${ref}`) || {}).id;
    if (!lid) { S.skipped.push(`Row ${r._row}: lead ${ref} not found`); continue; }
    const date = toDate(r.contactdate) || today();
    const key = `gs:log:${clean(r.activityid) || `${ref}|${date}|${norm(r.contacttype)}|${norm(r.outcome).slice(0, 40)}`}`;
    if (seen('notes', key)) { S.already++; continue; }
    const type = clean(r.contacttype) || 'Contact';
    const body = [clean(r.outcome, 2000), clean(r.notes, 5000)].filter(Boolean).join(' — ') || `${type} (no outcome written)`;
    db.prepare("INSERT INTO notes(entity_type,entity_id,user_id,kind,body,import_key,created_at,followup_round,next_followup) VALUES('lead',?,?,?,?,?,?,?,?)")
      .run(lid, person(r.assignedto) || user.id, NOTE_KIND[norm(type)] || 'note', body, key, date + ' 10:00:00', ROUND[norm(r.followupround)] || null, toDate(r.nextfollowupdate));
    db.prepare('UPDATE leads SET last_contact=? WHERE id=? AND (last_contact IS NULL OR last_contact<?)').run(date, lid, date);
    S.added++;
  }

  // ---------- income → payments ----------
  let lastDate = null;
  for (const r of tabLike(tabs, ['income'], ['client', 'paymentmode']) || []) {
    const S = sec('income'); const amount = toMoney(r.amount); if (!(amount > 0)) continue; S.found++;
    if (r.status && !/^(completed|received|paid)$/i.test(String(r.status).trim())) { S.skipped.push(`Row ${r._row}: status "${clean(r.status)}" — not received yet`); continue; }
    let date = toDate(r.date);
    if (!date) { date = lastDate || today(); warn(`Income row ${r._row} (₹${amount}) has no date — used ${date}`); }
    lastDate = date;
    const notes = clean(r.notes, 2000);
    const key = `gs:income:${date}|${amount}|${norm(r.client)}|${norm(notes).slice(0, 60)}|${norm(r.invoiceid)}`;
    if (seen('payments', key)) { S.already++; continue; }
    const cat = clean(r.category); remember('income_categories', cat);
    const proj = clean(r.project) && db.prepare('SELECT id FROM projects WHERE LOWER(name)=LOWER(?)').get(clean(r.project));
    const mode = clean(r.paymentmode); remember('payment_modes', mode);
    db.prepare('INSERT INTO payments(date,amount,client_id,project_id,account_id,method,reference,notes,category,grant_id,created_by,import_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(date, amount, clientId(r.client, true, true), proj ? proj.id : null, needAccount(), mode, clean(r.invoiceid), notes, cat,
        /grant/i.test(cat || '') ? onlyGrant : null, user.id, key);
    S.added++;
  }

  // ---------- expenses ----------
  for (const r of tabLike(tabs, ['expenses'], ['vendor', 'category']) || []) {
    const S = sec('expenses'); const amount = toMoney(r.amount); if (!(amount > 0)) continue; S.found++;
    if (/cancel/i.test(r.status || '')) { S.skipped.push(`Row ${r._row}: cancelled`); continue; }
    const date = toDate(r.date); if (!date) { S.skipped.push(`Row ${r._row} (₹${amount}): no date`); continue; }
    const notes = clean(r.notes, 2000); const rawCat = clean(r.category) || 'Other';
    const key = `gs:expense:${clean(r.expenseid) || `${date}|${amount}|${norm(r.vendor)}|${norm(rawCat)}|${norm(notes).slice(0, 60)}`}`;
    if (seen('expenses', key)) { S.already++; continue; }
    const grant = /grant/i.test(rawCat) ? onlyGrant : null;
    const mode = clean(r.paymentmode); remember('expense_categories', rawCat); remember('payment_modes', mode);
    let receipt = clean(r.receiptlink, 1000); if (receipt && !/^https?:\/\//i.test(receipt)) receipt = /^[\w.-]+\.[a-z]{2,}\//i.test(receipt) ? 'https://' + receipt : null;
    db.prepare('INSERT INTO expenses(date,category,vendor,description,amount,account_id,method,status,notes,grant_id,receipt_url,created_by,import_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(date, rawCat, clean(r.vendor), notes || clean(r.vendor) || rawCat, amount, needAccount(), mode,
        /pending/i.test(r.status || '') ? 'pending' : 'paid', notes, grant, receipt, user.id, key);
    S.added++;
  }

  // ---------- subscriptions → renewals ----------
  for (const r of tabLike(tabs, ['subscriptions'], ['softwareservice']) || []) {
    const S = sec('subscriptions'); const name = clean(r.softwareservice); if (!name) continue; S.found++;
    const key = `gs:sub:${name.toLowerCase()}|${norm(r.owner)}|${norm(r.renewaldate)}`;
    if (seen('renewals', key)) { S.already++; continue; }
    const when = clean(r.renewaldate) || ''; const day = when.match(/(\d{1,2})(st|nd|rd|th)?\s+of\s+every\s+month/i);
    const date = toDate(when) || (day ? nextMonthDay(+day[1]) : null);
    const cycle = day || /month/i.test(when) ? 'monthly' : /quarter/i.test(when) ? 'quarterly' : 'yearly';
    const monthly = toMoney(r.monthlycost); const annual = toMoney(r.annualcost); const other = toMoney(pick(r, 'cost', 'amount'));
    const cost = cycle === 'monthly' ? monthly || (annual ? annual / 12 : other) : cycle === 'quarterly' ? (monthly ? monthly * 3 : annual ? annual / 4 : other) : annual || (monthly ? monthly * 12 : other);
    const ownerId = person(r.owner);
    db.prepare("INSERT INTO renewals(kind,name,vendor,renewal_date,cycle,our_cost,status,notes,owner_id,assigned_name,category,import_key) VALUES('subscription',?,?,?,?,?,?,?,?,?,?,?)")
      .run(name, name.replace(/\s*subscription$/i, ''), date, cycle, Math.round(cost * 100) / 100, RENEWAL_STATUS[norm(r.status)] || 'active',
        [!date && when ? `Renewal Date in sheet: ${when}` : null, clean(r.notes, 2000)].filter(Boolean).join('\n') || null, ownerId, pending(r.owner, ownerId), clean(r.category), key);
    S.added++;
  }

  // ---------- grant money received (Grants → Amount Received) counts as income, like the sheet's Dashboard ----------
  for (const g of db.prepare("SELECT id, name, received, applied_on FROM grants WHERE received > 0 AND import_key LIKE 'gs:grant:%'").all()) {
    const key = `gs:grantin:${g.name.toLowerCase()}`;
    const booked = db.prepare('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE grant_id=?').get(g.id).v;
    if (seen('payments', key) || booked >= g.received) continue;
    const S = sec('grant_income'); S.found++;
    const first = db.prepare('SELECT MIN(date) d FROM expenses WHERE grant_id=?').get(g.id).d;
    const date = first || g.applied_on || today();
    db.prepare("INSERT INTO payments(date,amount,account_id,category,grant_id,notes,created_by,import_key) VALUES(?,?,?,'Grant',?,?,?,?)")
      .run(date, Math.round((g.received - booked) * 100) / 100, needAccount(), g.id, `Grant money received — ${g.name} (Amount Received in the Grants tab). The sheet has no date for it: ${date} is a placeholder, please set the real date.`, user.id, key);
    warn(`Grant "${g.name}": ₹${g.received - booked} received is booked as Grant income on ${date} — set the real date in Finance → Income`);
    S.added++;
  }

  // ---------- documents ----------
  for (const r of tabLike(tabs, ['documents'], ['documentname']) || []) {
    const S = sec('documents'); const title = clean(r.documentname); if (!title) continue; S.found++;
    const key = `gs:doc:${sheetId(r.documentid) || title.toLowerCase()}`; if (seen('documents', key)) { S.already++; continue; }
    const where = clean(pick(r, 'linklocation', 'link', 'location'), 1000);
    const url = where && (/^https?:\/\//i.test(where) ? where : /^[\w.-]+\.[a-z]{2,}\//i.test(where) ? 'https://' + where : null);
    const ownerId = person(r.owner); const up = toDate(r.uploaddate);
    db.prepare("INSERT INTO documents(title,category,entity_type,filename,stored_name,mime,size,notes,uploaded_by,url,expiry_date,status,owner_id,assigned_name,import_key,created_at) VALUES(?,?,'general','','',?,0,?,?,?,?,?,?,?,?,COALESCE(?,datetime('now')))")
      .run(title, clean(r.category, 60) || 'Other', url ? 'text/uri-list' : 'text/plain', [!url && where ? `Location: ${where}` : null, clean(r.notes, 2000)].filter(Boolean).join('\n') || null,
        user.id, url, toDate(r.expirydate), clean(r.status, 40), ownerId, pending(r.owner, ownerId), key, up ? up + ' 09:00:00' : null);
    remember('statuses', clean(r.status, 40)); S.added++;
  }

  // ---------- assets ----------
  for (const r of tabLike(tabs, ['assets'], ['assettype']) || []) {
    const S = sec('assets'); const type = clean(r.assettype, 60); if (!type) continue; S.found++;
    const key = `gs:asset:${sheetId(r.assetid) || `${norm(type)}|${norm(r.serialnumber)}|${norm(r.makemodel)}`}`; if (seen('assets', key)) { S.already++; continue; }
    const who = person(r.assignedto); const cur = clean(r.currentvalue);
    db.prepare('INSERT INTO assets(asset_type,make_model,serial_number,purchase_date,purchase_value,current_value,assigned_to,assigned_name,status,notes,import_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(type, clean(r.makemodel), clean(r.serialnumber), toDate(r.purchasedate), toMoney(r.purchasevalue), cur ? toMoney(cur) : null, who, pending(r.assignedto, who), clean(r.status, 40) || 'Active', clean(r.notes, 2000), key);
    remember('asset_types', type); remember('statuses', clean(r.status, 40)); S.added++;
  }

  // ---------- bank transactions (statement lines) ----------
  for (const r of tabLike(tabs, ['banktransactions', 'bankstatement'], ['withdrawal', 'deposit']) || []) {
    const S = sec('bank_transactions'); const out_ = toMoney(r.withdrawal); const in_ = toMoney(r.deposit);
    if (!(out_ > 0) && !(in_ > 0)) continue; S.found++;
    const date = toDate(r.date); if (!date) { S.skipped.push(`Row ${r._row}: no date`); continue; }
    const key = `gs:bank:${date}|${out_}|${in_}|${norm(r.referenceno)}|${norm(r.description).slice(0, 60)}`; if (seen('bank_transactions', key)) { S.already++; continue; }
    const ms = /^matched$/i.test(clean(r.matchedstatus) || '') ? 'Matched' : /^ignored?$/i.test(clean(r.matchedstatus) || '') ? 'Ignored' : 'Unmatched';
    db.prepare('INSERT INTO bank_transactions(account_id,date,description,reference,withdrawal,deposit,balance,type,matched_status,match_note,import_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(needAccount(), date, clean(r.description, 500), clean(r.referenceno, 120), out_, in_, clean(r.balance) ? toMoney(r.balance) : null, clean(r.type, 60), ms, clean(r.matchnote, 500), key);
    S.added++;
  }

  // dropdown values from the sheet that the CRM did not know yet
  const upd = {};
  s = getSettings();
  for (const [k, set] of Object.entries(lists)) { out.list_additions[k] = [...set]; upd[k] = [String(s[k] || '').trim(), ...set].filter(Boolean).join('\n'); }
  if (Object.keys(upd).length) setSettings(upd);
  linkPeople();
  return out;
}

/* full name, or a first name that only one team member has */
function matchUser(users, name) {
  const k = String(name).trim().toLowerCase(); const first = k.split(/\s+/)[0];
  const exact = users.find((u) => u.name.toLowerCase() === k); if (exact) return exact;
  const byFirst = users.filter((u) => u.name.toLowerCase().split(/\s+/)[0] === first);
  return byFirst.length === 1 ? byFirst[0] : null;
}
/* names from the sheets that were not team members at import time → give them their records once they join */
function linkPeople() {
  const users = db.prepare('SELECT id, name FROM users WHERE active=1').all(); let n = 0;
  for (const [table, col] of [['leads', 'owner_id'], ['renewals', 'owner_id'], ['projects', 'manager_id'], ['documents', 'owner_id'], ['assets', 'assigned_to']]) {
    for (const r of db.prepare(`SELECT id, assigned_name FROM ${table} WHERE assigned_name IS NOT NULL AND ${col} IS NULL`).all()) {
      const u = matchUser(users, r.assigned_name); if (!u) continue;
      db.prepare(`UPDATE ${table} SET ${col}=?, assigned_name=NULL WHERE id=?`).run(u.id, r.id); n++;
      if (table === 'projects') db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(r.id, u.id);
    }
  }
  return n;
}

class Rollback extends Error {}
function importWorkbook(tabs, opts, user) {
  if (!tabs || typeof tabs !== 'object' || Array.isArray(tabs)) throw new HttpError(400, 'Nothing to import.');
  const names = Object.keys(tabs); if (!names.length || names.length > 60) throw new HttpError(400, 'The workbook has no tabs (or too many).');
  for (const n of names) {
    const rows = tabs[n];
    if (!Array.isArray(rows) || rows.length > 20000) throw new HttpError(400, `Tab "${String(n).slice(0, 40)}" is too large.`);
    tabs[n] = rows.slice(0, 20000).map((r) => (Array.isArray(r) ? r.slice(0, 80).map((c) => String(c ?? '').slice(0, 5000)) : []));
  }
  if (opts.account_id && !db.prepare('SELECT 1 FROM accounts WHERE id=?').get(opts.account_id)) throw new HttpError(400, 'Pick an existing bank / cash account.');
  if (opts.new_account !== undefined && opts.new_account !== null && (typeof opts.new_account !== 'string' || opts.new_account.length > 60)) throw new HttpError(400, 'Account name is too long.');
  let result;
  try {
    db.transaction(() => { result = run(tabs, opts, user); if (opts.dry_run) throw new Rollback(); })();
  } catch (e) { if (!(e instanceof Rollback)) throw e; }
  result.dry_run = !!opts.dry_run;
  if (!result.dry_run) audit(user, 'import', 'workbook', null, Object.entries(result.sections).map(([k, v]) => `${k}: ${v.added} added`).join(', '), opts.ip);
  return result;
}

module.exports = { importWorkbook, linkPeople, matchUser, toDate, toMoney };
