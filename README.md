# TechSentinals CRM

One small system for leads, clients, projects, tasks, documents, quotations, invoices, finance, server credentials, renewals and maintenance — built for a team of 4 founders and a few interns. Self-hosted: your data stays in one `data` folder.

## Start it (Windows)
Double-click **`start.bat`** → browser opens at http://localhost:3000.
First visit: create the first founder account. Then go to **Team & access** and add the other 3 founders and the interns. **Every founder should then turn on two-step login** (click your name, bottom-left → *Two-step login*).

Want to look around first? Double-click **`start-demo.bat`** — separate sample database (`demo-data` folder, port 3001). Demo logins: `aarav@demo.test` (founder), `kabir@demo.test` / `tara@demo.test` (interns), password `Demo-Pass-2026`.

Needs Node.js 20+. Manual: `npm install`, then `npm start`.

## Moving your Google Sheets / Excel in
**Whole workbook (recommended):** *Settings → Move from Google Sheets / Excel → Import a whole workbook*. Paste the Google Sheet link (it must be shared as *Anyone with the link can view* for this step) or drop the file from *File → Download → Microsoft Excel*. It reads every tab that holds data — **Master Leads, Contact Log, Lists & Settings, Dept Analytics** (sales sheet) and **Income, Expenses, Clients, Projects, Subscriptions, Grants, Documents, Assets, Bank Transactions, Settings** (money sheet). The other tabs (Dashboard, Follow Ups, the per-department tabs, Monthly / Dept / Source Analytics) are calculated from those, and the CRM calculates them itself: *Follow-ups*, *Pipeline* department tabs, *Sales report*, *Finance → Overview*. It shows a preview first: how many rows will be added, what is already in the CRM, and which people are not team members yet. Nothing is saved until you press *Import*. Running it again only adds new rows.
1. Import the sales sheet, then the money sheet (pick the bank account the money moved through, or let it create one).
2. Add your team under *Team & access*. People named in the sheet who are not team members yet are remembered: their leads, subscriptions, projects and assets are handed to them automatically the moment you add them (full name, or a first name only one person has).
3. Afterwards set both Google Sheets back to **Restricted** — they hold customers' phone numbers and emails.

**Same names as the sheets:** every field, column and dropdown uses the sheet's wording (Company / Person, Phone / WhatsApp, Sales Stage, Follow-Up Round, Next Follow-Up Date, Deal Value (INR), Weighted Pipeline, Payment Mode, Receipt Link, Amount Requested …), and the lists in *Settings → Lists & Settings* are taken from the sheets' own list tabs. Lead IDs stay the same numbers as in the sheet. Grant money that the sheet shows only under *Grants → Amount Received* is booked as Grant income so *Current Balance* and *Total Revenue* match the sheet's Dashboard (its date is a placeholder — set the real one in *Finance → Income*).

Cells with several phone numbers keep the first as the phone and the rest in the lead's notes; invalid emails/phones are kept in notes, not lost. Two sheet rows with the same phone are both kept (as in the sheet) with a note.

**From the command line (this computer only, nothing goes online):** stop the CRM, then
```
node scripts/import-sheets.js "<sales sheet link or .xlsx>" "<money sheet link or .xlsx>" --dry-run
node scripts/import-sheets.js "<sales sheet link or .xlsx>" "<money sheet link or .xlsx>" --account "Bank account"
```
`--dry-run` only shows what would happen. A copy of the database is saved in `data/backups` before anything is written.

**Single list:** **Pipeline → Import** (leads) or **Clients → Import** (also under *Settings → Move from Excel*). Drop an `.xlsx` or `.csv` file whose first row is the column headings. The CRM guesses which column is which (Name, Mobile, Budget, Remarks…), you check the matching, then press *Import*. Rows already in the CRM (same email/phone/name for leads, same company for clients) are skipped, so running it twice is safe. Dates like 05/11/2026 are read as day/month. Old `.xls` files: save as `.xlsx` first. Founders only.

## Public demo on Render + Netlify (free, no card)
Sample data only. It resets itself, because Render's free disk is wiped whenever the service restarts or wakes up.
1. **Render** (runs the server): sign in with GitHub, choose **New → Blueprint**, pick this repo, then **Apply**. `render.yaml` sets everything up: Node 22, Singapore region, demo mode, and a generated secret. Wait for the address, e.g. `https://techcrm-demo.onrender.com`.
2. **Netlify** (serves the screens): choose **Add new site → Import from GitHub**, pick this repo, then **Deploy**. `netlify.toml` publishes `public/` and forwards `/api/*` to Render. If your Render address differs from `techcrm-demo.onrender.com`, change it in `netlify.toml` and push.
3. Open the Netlify address and use the one-click demo accounts on the sign-in page.

In demo mode (`DEMO_MODE=1`), changing passwords, two-step login, team accounts and company settings are switched off, so visitors cannot lock each other out. Everything else works.
The free Render server sleeps after 15 minutes without visitors, so the first visit after that takes about 30–60 seconds.
**Do not put real company data in the demo.** For real use, see *Putting it online* below.

## Who sees what
| | Founders | Interns |
|---|---|---|
| Home, calendar, tasks | everything | tasks they are on (even outside their projects), projects they are added to |
| Projects (specs, files, timeline) | all | only assigned projects (no money) |
| Leads, all clients, all projects, maintenance log | all | only if a founder ticks it for that person |
| Quotations, invoices, renewals & plans, finance, grants | all | never |
| Credentials vault | all, every reveal logged | never |
| Team, activity log, settings, backups, CSV export | yes | never |

New accounts get a temporary password and can do nothing until they choose their own.

## What is inside
- **Pipeline** – board or list with the same fields as the sales sheet: department/product (Service or Product is worked out from it), category, market (India / Foreign), **priority (Hot / Medium / Cold)**, follow-up round (Initial → 3rd → Complete), next action, last contact, meeting/proposal/close dates, win probability by stage. Filter by department, priority, market, owner, source. *Convert to client (+ project)*.
- **Follow-ups** – the morning call list: overdue, today, next 7 days, later, no date; *Mine / Everyone*; call and WhatsApp buttons; **Log contact** records the call/WhatsApp/visit, its outcome, moves the stage and round, and sets the next follow-up in one popup.
- **Sales report** – funnel by stage, India vs Foreign, Service vs Product, 12-month added/converted/lost, and tables by department, source, person and category (conversion, hot, overdue, pipeline, weighted value). CSV export.
- **Contact Log** – every call, WhatsApp, email, meeting, demo, proposal and visit across all leads, with Follow-Up Round and Next Follow-Up Date; CSV export.
- **Assets** (founders) – laptops, phones and devices: Asset Type, Make/Model, Serial Number, Purchase / Current Value, Assigned To, Status.
- **Bank Transactions** (*Finance*) – statement lines (Withdrawal / Deposit / Balance) with **Auto-match** to income and expenses of the same amount within 5 days.
- **Grants** (founders) – requested, received, still to come, how much is spent (expenses tagged with the grant) and the next reporting date (also on the calendar).
- **Clients** – details, GSTIN, contacts, projects, invoices & payments, files, credentials, support log, timeline.
- **Projects** – scope/specs, links, team, task board, files, credentials, project profit.
- **Tasks as team work** (the useful parts of Jira, nothing more) – put **several people** on one task; split it into a **checklist** where each step can belong to one of them; a **discussion** where typing **@** mentions a teammate; an automatic **history** (who changed status, due date, people…); **watchers** who get a bell notification for new comments and status changes (people on the task, the creator, anyone who comments or is mentioned — anyone can Watch/Unwatch). Every task has a short key like **T-12** you can search for, and notifications open the task directly. Interns on a task can move it, tick the checklist and discuss; only founders change who is on it. Teammates on the project who aren't on the task can read and comment but not change it.
- **Quotations → Invoices** – GST (CGST+SGST / IGST), FY numbering, print/PDF, part-payments with TDS, auto *paid / overdue*, and a one-click **payment reminder** (copy, WhatsApp or email — ready-written with your bank/UPI details).
- **Renewals & plans** – maintenance plans (AMC), domains, hosting, SSL, subscriptions (with who owns each); *Mark renewed* rolls the date. Active plans = your monthly recurring income.
- **Maintenance** – support work log per client/project.
- **Finance** – received vs spent (income types: client payment, consulting, product sales, grant…; expenses can carry a receipt link), profit, unpaid-invoice ageing, GST position, bank/cash accounts, founders' capital / withdrawals / money paid personally.
- **Credentials vault** – AES-256-GCM encrypted, founders only, every reveal logged.
- **Documents** – upload files or save links (Google Drive, Dropbox…); expiry dates (registrations, certificates, contracts) show on the calendar.
- Every *New…* / *Edit* opens as a popup over the page you are on (bottom sheet on phones). Unsaved changes are never lost by a stray click — it asks first. **Ctrl+Enter** saves.
- **Calendar**, **Ctrl+K search**, in-app reminders, **activity log** (Team → Activity log).

## Putting it online for all founders
1. A small VPS is enough. `npm install --omit=dev`, then run with `TRUST_PROXY=1 HOST=127.0.0.1 PORT=3000 node server.js` (keep it running with `pm2`), or use the `Dockerfile` (mount a volume at `/data`).
2. Put **Caddy** in front for HTTPS: `crm.yourcompany.com { reverse_proxy localhost:3000 }`.
3. Create the first founder account **immediately** after the first start — until then anyone who opens the site could create it.
4. Never serve it over plain http on the internet.

## Checking the screens after a change
`npm test` checks the server (66 functional + 148 security checks). For the screens, sign in as a founder, open the browser's DevTools console, paste the contents of `scripts/ui-audit.js` and press Enter. It visits every page and form and reports: pages that scroll sideways, cards that don't line up, loaders that never finish, unlabeled buttons/fields, charts without tooltips, popups that go off-screen or lose typed text. Run it at desktop and phone width (DevTools device toolbar). Run it after every UI change; it should report 0 failed.

## Backups — important
- A database copy is saved daily in `data/backups` (last 14).
- **Copy the whole `data` folder somewhere else regularly.** It holds the database, uploaded files and `.vault.key` (the key that decrypts the vault — lose it and stored passwords are gone). Better: set `CRM_SECRET` and keep that secret in a password manager, separate from backups.

## Environment variables
`PORT` (3000) · `HOST` (0.0.0.0 — use 127.0.0.1 behind a proxy) · `CRM_DATA_DIR` · `CRM_SECRET` (vault key; never change it later) · `TRUST_PROXY=1` (behind Caddy/nginx).

## Tests
`npm test` runs the functional checks (permissions, money maths) and the security suite (`npm run test:security`, 139 attack-style checks). See `SECURITY.md` for the latest security review.
