/* Import the team's Google Sheets straight into THIS computer's CRM database (nothing goes online).

     node scripts/import-sheets.js <google-sheet-link-or-file.xlsx> [more …] [--dry-run] [--as you@company.com] [--account "Bank account"]

   - Reads every tab it knows (Master Leads, Contact Log, Clients, Projects, Income, Expenses, Grants,
     Subscriptions, Documents, Assets, Bank Transactions). Calculated tabs (dashboards, analytics, department views) are skipped.
   - --dry-run shows what would be added and changes nothing.  Running it again only adds new rows.
   - A copy of the database is saved in data/backups first.
   - Stop the CRM server while this runs (or run it before starting the server).  Uses CRM_DATA_DIR like the server. */
'use strict';
const fs = require('fs');
const path = require('path');
const { readWorkbook } = require('../lib/xlsx');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const dry = args.includes('--dry-run'); if (dry) args.splice(args.indexOf('--dry-run'), 1);
const as = flag('--as'); const accountName = flag('--account');
if (!args.length) { console.log('Usage: node scripts/import-sheets.js <google-sheet-link-or-file.xlsx> [more …] [--dry-run] [--as email] [--account "Bank account"]'); process.exit(1); }

async function load(src) {
  if (/^https?:\/\//i.test(src)) {
    const m = src.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
    if (!m) throw new Error(`Only Google Sheets links are supported: ${src}`);
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`, { redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || buf.subarray(0, 2).toString() !== 'PK') throw new Error('Google did not send the sheet. Share it as "Anyone with the link can view" while importing, or use File → Download → Microsoft Excel and pass the file instead.');
    return buf;
  }
  return fs.readFileSync(src);
}

(async () => {
  const { db, DATA_DIR } = require('../lib/db');
  const { importWorkbook } = require('../lib/sheetimport');
  const user = as ? db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(String(as).toLowerCase()) : db.prepare("SELECT * FROM users WHERE role='founder' AND active=1 ORDER BY id LIMIT 1").get();
  if (!user || user.role !== 'founder') throw new Error(as ? `No active founder with email ${as}.` : 'Create the founder account first (open the CRM once), then import.');
  if (!dry) {
    const dir = path.join(DATA_DIR || path.join(__dirname, '..', 'data'), 'backups'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `before-sheet-import-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`);
    await db.backup(file); console.log(`Backup saved: ${file}`);
  }
  for (const src of args) {
    const book = readWorkbook(await load(src));
    const tabs = {}; for (const s of book) tabs[s.name] = s.rows.map((r) => r.map((c) => String(c ?? '').trim()));
    const opts = { dry_run: dry, ip: 'local-cli' };
    if (accountName) { const a = db.prepare('SELECT id FROM accounts WHERE LOWER(name)=LOWER(?)').get(accountName); if (a) opts.account_id = a.id; else opts.new_account = accountName; }
    const r = importWorkbook(tabs, opts, user);
    console.log(`\n${dry ? '[preview — nothing saved] ' : ''}${src.replace(/\/edit.*$/, '')}`);
    console.log(`  tabs: ${book.map((s) => s.name).join(', ')}`);
    for (const [k, v] of Object.entries(r.sections)) console.log(`  ${k.padEnd(18)} in sheet ${String(v.found).padStart(4)}  added ${String(v.added).padStart(4)}  already ${String(v.already).padStart(4)}  skipped ${v.skipped.length}`);
    for (const [k, v] of Object.entries(r.sections)) for (const s of v.skipped) console.log(`    skipped (${k}): ${s}`);
    if (r.account_created) console.log(`  new account: ${r.account_created}`);
    if (Object.keys(r.people_not_found).length) console.log(`  not team members yet (kept, linked when added): ${Object.entries(r.people_not_found).map(([n, c]) => `${n} (${c})`).join(', ')}`);
    if (Object.keys(r.list_additions).length) console.log(`  dropdown values added: ${Object.entries(r.list_additions).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' | ')}`);
    if (r.lists_replaced) console.log(`  dropdown lists set from the sheet: ${r.lists_replaced.join(', ')}`);
    if (r.team_members && r.team_members.length) console.log(`  Team Members in the sheet: ${r.team_members.join(', ')}`);
    if (r.warnings.length) console.log(`  ${r.warnings.length} notes about rows (kept in the record notes)`);
  }
  // re-running the import over an already-imported database must never change the numbers
  if (!dry) console.log('\nDone. Open the CRM to check: Sales report, Follow-ups, Finance → Overview.');
})().catch((e) => { console.error('\nImport failed:', e.message); process.exit(1); });
