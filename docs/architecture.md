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

A project's value is the agreed value plus the **approved** change requests (`cr_value`, `revised_value`). Billing status of a change request is derived from its quote and invoice (`not quoted → quoted → invoiced → paid`), never typed by hand.

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
