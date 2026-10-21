# Architecture

## Shape

```
browser (React, TanStack Query)  ──/api──▶  Express  ──▶  SQLite (better-sqlite3, WAL)
                                              │
                                              ├─ background jobs (reminders, auto-debit, daily backup, session purge)
                                              └─ uploads/ and backups/ on disk
```

One process, one SQLite file. Everything needed for a team of this size, with nothing to operate besides a disk.

## Server (`server/src`)

| Folder | Job |
|---|---|
| `config.ts`, `logger.ts`, `main.ts` | validated environment, pino JSON logs, start and graceful shutdown |
| `core/context.ts` | the `AppContext` every module receives: config, log, db, settings, vault, sessions, limiter, audit, notify. No globals, so tests build an isolated app per test |
| `db/migrations` | versioned SQL (`schema_migrations`). `0001` is idempotent and upgrades databases made by the earlier version; later files only add |
| `crud/` | the **resource engine**: a resource is a declarative object (table, columns, joins, searchable fields, filters, sortable keys, scope, permissions, hooks). The engine builds list / read / create / update / delete / CSV export for it |
| `resources/` | the definitions: leads, clients, contacts, projects, tasks, change_requests, maintenance_logs, events, documents, quotes, invoices, payments, expenses, accounts, transfers, grants, assets, bank_transactions, renewals |
| `domain/` | rules that span records: numbering, invoice status, task people, change-request lifecycle, people linking |
| `modules/` | routes that are not plain CRUD: auth, account (password, 2FA), users, settings, credentials vault, notes / task collaboration, documents (upload / link), flows (convert lead, quote→invoice, CR→quote, contact log), insights (dashboard, analytics, calendar, search, audit, backup) |
| `analytics/` | read-only SQL for the dashboard, sales, delivery and finance views |
| `jobs/` | daily reminders, **auto-debit** of recurring costs (catch-up, one expense per renewal per date, variable bills as pending estimates), backups |
| `security/` | scrypt passwords, AES-256-GCM vault, TOTP, 256-bit sessions (only a hash is stored), login limiter, role / module permissions |
| `seed/` | typed loader for the two workbooks |

### The resource engine

Every list endpoint takes the same parameters: `limit` (default 50, max 500), `offset`, `q` (search), `sort=key:asc|desc` (whitelisted per resource), `from` / `to` (date range on the resource's date field) and the resource's own filters. The answer is the page of rows plus an `X-Total-Count` header. Counting uses the same joins and filters as the page, so a screen can show "26–50 of 121" without loading everything.

Scope is applied inside the SQL, never after: an intern's query can only ever match rows of the projects they belong to. Money columns are stripped from the response for non-founders.

### System IDs

Every record gets a readable ID derived from its number: `LD-0001`, `CL-0001`, `CT-`, `T-`, `DOC-`, `PAY-`, `EXP-`, `ACC-`, `TRF-`, `GR-`, `AST-`, `BNK-`, `REN-`, `MNT-`, `EV-`, `CR-`. Projects use `P-26-001`, quotes and invoices use `QUO/2026-27/0001` and `INV/2026-27/0001` (restarting each financial year). IDs are searchable and shown first in every list.

## The sales → delivery → billing flow

```
lead ──convert──▶ client + project (value from an accepted quotation)
                      │
                      ├─ change request (before or after delivery)
                      │      requested → estimated → quoted → approved → in progress → delivered
                      │            │                    ▲
                      │            └─ "Create quotation"┘  one open quote per request
                      ▼
                 quotation ──accepted──▶ change request approved
                      │
                      └─ "Convert to invoice" ──▶ invoice (carries the change request) ──▶ payments
```

Billing a project: its agreed value is split into a **payment schedule** (advance → milestones → final). When the work behind a payment is finished it is marked so, an invoice is raised from it, and its state follows that invoice. Sending a quotation to a lead moves the lead to *Proposal Sent*; an accepted quotation of an existing client can start the project directly.

The **Action center** (`analytics/attention.ts`) turns the same data into a ranked to-do list: overdue invoices, payments ready to invoice, accepted quotations nobody acted on, delivered work not billed, finished projects not fully billed, unanswered quotations, leads without a follow-up date, hot leads gone quiet, projects past deadline, renewals and maintenance plans about to lapse.

A project's value is the agreed value plus the **approved** change requests (`cr_value`, `revised_value`). Billing status of a change request is derived from its quote and invoice (`not quoted → quoted → invoiced → paid`), never typed by hand.

### Nothing is locked

Records stay editable in every state: any change-request status can be set at any time, invoiced payments can be changed, a payment schedule can exceed the project value, an incomplete recurring item can be saved. Every create / change / delete is written to a per-record **history** (who, when, field, from → to), shown on each record. Only deletions that would erase money history (an invoice with payments, a client or project with invoices) are refused, with a message saying what to do instead.

### Exports

Lists export to **Excel** and **PDF** only (server-side, same filters and order as the screen). There is no CSV anywhere. Text that looks like a formula is stored as plain text in the workbook.

### Subscriptions

A recurring item belongs to the company (debited automatically as an expense on its date) or to a person (tracked, never deducted). A price that differs for one cycle is set as *Amount for the next cycle only*; the next debit uses it once, then the normal cost applies again. Variable bills (postpaid phone) are recorded as pending estimates until the real amount is entered.

## Frontend (`web/src`)

- **Design system**: `styles/app.css` (tokens, layout, tables, forms) + `styles/extra.css` (React-specific additions). Geist fonts are self-hosted.
- **`lib/api.ts`**: one fetch wrapper (CSRF header, readable errors, total-count header, 401 → sign-in screen).
- **`lib/session.tsx`**: signed-in user and the dropdown lookups.
- **`forms/`**: `schema.ts` describes every record form once; `Fields.tsx` renders and validates with the *shared* rules; `RecordEditor.tsx` is the create / edit / delete dialog used from every screen.
- **`ui/`**: `DataTable` (server paging, search, sort), `Modal` (focus trap, unsaved-changes guard), `Kanban`, SVG charts, popovers, toasts.
- **`pages/`** lazy-loaded per route; `components/` hold pieces shared between pages (notes timeline, files, credentials, task dialog, change requests, analytics blocks).

## Security model

- Passwords: scrypt with a per-user salt, minimum 10 characters with letters and numbers; one scrypt is always run so unknown emails cost the same as wrong passwords.
- Sessions: 256-bit random token in an HttpOnly, SameSite=Lax cookie (Secure behind HTTPS); the database stores only the SHA-256 of it. Changing a password or turning on 2FA signs out other devices.
- Sign-in limiter: 8 failures per account and 30 per IP in 15 minutes.
- CSRF: every state-changing API call must carry `X-Requested-With: crm` (browsers cannot add it cross-site without CORS approval, which is never granted).
- CSP: `script-src 'self'`, no inline scripts, `frame-ancestors 'none'`.
- Vault: AES-256-GCM with a key from `CRM_SECRET` (or a key file in the data folder); a reveal is written to the activity log.
- Roles: founders see everything. Interns see their own projects and tasks, plus modules a founder switches on (`leads`, `clients`, `all_projects`, `maintenance`). Finance, invoices, quotations, renewals, credentials, team and settings are founder-only.
- Every create, update, delete, export, upload, download, sign-in (success and failure) and password reveal is in the activity log.

## Testing strategy

| Layer | Where | What |
|---|---|---|
| shared rules | `packages/shared/test` | field rules, dates, money, change-request transitions |
| API | `server/test` | every endpoint through HTTP (supertest) on an isolated database: CRUD for all resources, pagination and filters, security and access, change-request flow, recurring bills, analytics against SQL, jobs, migrations from the old schema, seed against the workbooks |
| UI units | `web/test` | forms, data table, modal, API client |
| End to end | `web/e2e` | a real browser on a real server: setup, lead → CR → quote → invoice → payment, edit / delete, paging, palette, mobile, accessibility |

## TDS

TDS deducted by a client is a tax credit, not money received. Invoices are written for what the client will actually pay; the TDS is recorded on the payment (`payments.tds`, with `tds_status` deducted → certificate → claimed, section and claim date) and is excluded from an invoice's paid amount, from cash and from profit. A project's *not yet invoiced* figure is its value minus TDS minus what is invoiced. `GET /analytics/tds` reports it by Indian financial year (April–March, with the assessment year), client and payment, and the Action center flags an ended year that is still unclaimed.

## Tranches, TDS ratio and the advance rule

A project has a payment schedule (milestones): a ready-made split or your own percentages (the first part is the advance, the last the final payment; they must total 100%). The project can carry the **TDS %** its client deducts, and every payment on it — change requests included — follows that ratio: a milestone invoice, or the invoice made from a change-request quotation, is written for the amount *less* TDS, remembers the TDS it expects (`invoices.expected_tds`), and the payment form fills the TDS in proportionally unless a TDS amount is typed (even 0). "Still to get" leaves the project's expected TDS out. A project can require its **advance before work starts** (`advance_required`): moving it to Active while the advance invoice is unpaid asks for confirmation, shows a banner on the project, and raises an Action center item until the advance is paid. A cancelled milestone invoice frees its payment to be invoiced again.

## Access control (RBAC)

Two roles. A **founder** sees and does everything. An **intern** sees only their own work, plus whatever modules a founder switches on for them (`leads`, `clients`, `maintenance`, `all_projects`). Every resource declares a *scope* (which rows a person may see), a *can* rule (what they may change) and its *founder-only columns* (money). The same rules apply to lists, single records, history, notes, files, search, the calendar, notifications, the dashboard, the Action center and exports (exports are founder-only). `server/test/rbac.test.ts` checks this for every resource, for three kinds of intern, by comparing what they get with what a founder gets and by trying to read, edit and delete every record they cannot see. Nobody can change their own role or access; the last active founder cannot be demoted, deactivated or deleted; a deactivated person is signed out immediately.

## Security and data notes

- Passwords: scrypt with a per-password salt; login is throttled per account and per address; the answer is identical for an unknown email and a wrong password; optional two-step login (TOTP) with replay protection; changing a password signs out other devices.
- Sessions: random 256-bit token, only its hash is stored, HttpOnly + SameSite=Lax cookie (Secure behind https), custom request header required for every change (CSRF).
- Credentials vault: AES-256-GCM with a fresh IV per secret; every reveal is logged; the key lives in `data/.vault.key`, **not** in database backups — keep a copy of that file with your backups, or the saved credentials cannot be decrypted after a restore.
- Files: stored under random names, always sent as a download (only PDF and images open inline), sandboxed by a strict Content-Security-Policy.
- Input: every query is parameterised; sort and filter names are whitelisted; spreadsheet cells are written as text, never as formulas (the only formulas are the totals row's own SUBTOTAL).
- Duplicates: the same person sending the same new record twice within 3 seconds gets the first one back; an invoice cannot be created twice for one quotation or change request.
- Known, accepted: `npm audit` reports a moderate issue in a transitive `uuid` used by `exceljs` (only reachable when a caller passes its own buffer, which `exceljs` does not) and a development-server issue in `esbuild` (not used in production).

## No GST, and TDS only when it applies

This company never charges GST: invoices and quotations are their lines less the discount, there is no GSTIN, tax type, tax rate, HSN or GST report anywhere (the old columns remain in the database, always empty, so history stays readable). TDS is optional at every level: a company default (Settings → Default TDS %, 0 unless set), a TDS % on each project, and an optional TDS % on each payment of the schedule that overrides the project's (empty = the project's, 0 = none for that payment). A hand-written invoice can name the TDS it expects. Wherever there is TDS the invoice is for what will actually be received, the payment follows the ratio, and "still to get" leaves it out; wherever there is none, nothing changes.

## Things that are refused so the books stay consistent

A payment against a cancelled invoice; an invoice for a project that belongs to another client; a project without a client; invoicing or starting a project from a rejected or expired quotation; deleting a quotation that has a live invoice; a second live invoice for one quotation or change request. A payment on a draft invoice turns it into a sent / part-paid / paid invoice. A deleted record takes its history, notes and files with it, so the next record that gets its id starts clean.

## The sales-to-work flow (nothing is entered twice)

lead → quotations (a lead can have several) → **Client accepted** → client + project + lead move together → payment plan → first payment → client Active, lead Converted.

- Accepting a quotation (the one button, or setting its status to Accepted anywhere) makes the client (status *Pending*) with the lead's person as main contact, makes the project (value = the quotation, the lead's talk becomes its specification, the lead's files follow it), moves the lead to **Accepted** and opens the project's payment planner. Doing it again changes nothing. A second quotation of the same lead stays untouched until it is accepted too, and then becomes its own project for the same client. A small one-off job takes the same path with a single 100% payment in the plan.
- The **payment plan** (percentages, TDS, advance-before-work) belongs to the project; every later invoice follows it. A project without a plan is flagged on its page and in the Action center.
- The **first payment** from a client turns a Pending client Active and every lead of theirs that was *Accepted* into *Converted*.
- The contact log lists every contact against its lead (company, person, stage), can be filtered by lead, and a contact can be logged from the page itself.

## Subscriptions

Two choices only: **who pays** (the company, or someone else) and the cost, repeat and date. What the company pays is added to Expenses automatically on its date (from the chosen account); what someone else pays (e.g. a tool Vansh pays for himself) is listed so it is remembered and never touches company money. A month that costs more is corrected on that month's expense; the subscription itself keeps its usual amount.

## Fixed things and presentation rules

Invoice and quotation numbers and project codes can never be changed (enforced by the API and by the database). An invoice's project must belong to its client, a payment to its invoice's client, and a project with invoices cannot be handed to another client. Dates are written like 21 Jan 2026 and moments like 21 Jan 2026, 01:30 PM everywhere (screens, exports, notifications) and typed or picked in that format. A new record's history shows only who made it and when. Every screen has a Back button.

## Phones and the installable app

Below 900px the app behaves like a phone app: a bottom tab bar (Home, Actions, Pipeline or My work, Projects, More → full menu), a sticky header with Back, search and notifications, page buttons on their own row, tables turned into cards (first visible column is the title, other columns are labelled), filters behind one "Filters" button, 16px inputs (no iOS zoom), 40px+ touch targets, bottom-sheet dialogs and safe-area padding. Report tables scroll sideways inside their own box; the page itself never does. It can be added to the home screen (`web/public/manifest.webmanifest`, icons, `viewport-fit=cover`). The e2e test "mobile layout" checks the tab bar and that no page overflows at 390px.
