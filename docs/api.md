# API

Base path `/api`. JSON in, JSON out. Every request that changes data must send `X-Requested-With: crm`. Sign in sets an HttpOnly cookie; there are no tokens to manage in the browser.

Errors are `{ "error": "readable message" }` with the right status: `400` invalid input, `401` not signed in, `403` not allowed, `404` not found (also for rows outside your scope), `409` conflict (e.g. deleting a client that has invoices), `429` too many sign-in attempts.

## Health and auth

| Call | Notes |
|---|---|
| `GET /health` | `{ok, uptime}`; no login; used by Docker / uptime monitors |
| `GET /auth/state` | `{setup_needed, user, company_name, logo, demo}` |
| `POST /auth/setup` | first founder, only while there are no users |
| `POST /auth/login` | `{email, password, code?}` → `401 {need_code:true}` when two-step login is on |
| `POST /auth/logout` | |
| `GET /me`, `POST /password`, `POST /2fa/setup`, `POST /2fa/enable`, `POST /2fa/disable` | the signed-in person's own account |

A person with a temporary password can only reach `/me`, `/password` and `/lookups` until they choose their own.

## Records (one set of endpoints per resource)

Resources: `leads`, `clients`, `contacts`, `projects`, `tasks`, `change_requests`, `maintenance_logs`, `events`, `documents`, `quotes`, `invoices`, `payments`, `expenses`, `accounts`, `transfers`, `grants`, `assets`, `bank_transactions`, `renewals`.

```
GET    /:resource                 page of rows (see below)
GET    /:resource/export.csv      same filters, every row (founders)
GET    /:resource/:id
POST   /:resource                 create → 201 + the row
PUT    /:resource/:id             update (send only what changed) → the row
DELETE /:resource/:id
```

### Paging, search, sort, filter

| Parameter | Meaning |
|---|---|
| `limit` | rows per page, default 50, max 500 |
| `offset` | rows to skip |
| `q` | text search over the resource's searchable columns (and its system ID, e.g. `EXP-0012`) |
| `sort=key:asc` / `key:desc` | only keys the resource lists as sortable; anything else is ignored |
| `from`, `to` | date range on the resource's main date (`YYYY-MM-DD`) |
| *filters* | per resource: `stage`, `owner_id`, `client_id`, `project_id`, `status`, `kind`, `open=1`, `followup_status`… |

The response body is the array of rows; the total number of matching rows is in the **`X-Total-Count`** header.

Ids in the path must be plain integers; `/projects/1%20OR%201=1` is a 404, not project 1.

### Rows

- Every row has `ref`, its system ID.
- Joined names are included (`client_name`, `project_name`, `owner_name`, `assignees`…).
- Founder-only money columns (`budget`, `cr_value`, `total_billed`, `estimate_amount`, quote / invoice totals on change requests…) are absent for interns.
- `projects` also return `cr_count`, `cr_open`, `cr_value` (approved change-request money), `revised_value` (= `budget + cr_value`), `total_billed`, `total_received`, `total_expenses`.
- `change_requests` also return `billing_status` (`not_quoted | quoted | invoiced | paid | not_billable`), `quote_number`, `invoice_number` and their amounts.

## Business flows

| Call | What it does |
|---|---|
| `POST /leads/:id/contact` | log a call / WhatsApp / meeting, move the stage and set the next follow-up in one step |
| `POST /leads/:id/convert` | lead → client (+ main contact, notes and files moved); `create_project`, `project_name`, `quote_id` optional — an accepted quotation sets the project's value |
| `POST /change-requests/:id/quote` | creates a quotation from the request's estimate (one open quote per request) |
| `POST /quotes/:id/to-invoice` | draft invoice carrying the client, project and change request; the quote becomes accepted |
| `POST /renewals/:id/renew` | roll a manual renewal's date forward one cycle |
| `POST /bank-match` | match unmatched statement lines to income / expenses (same amount, within 5 days) |
| `GET /contact-log` | every logged contact, newest first, paged (`kind`, `user_id`, `lead_id`, `from`, `to`, `q`) |

Change-request status moves only along `requested → estimated → quoted → approved → in_progress → delivered` (plus `rejected` / `cancelled`, and back to `requested`). Accepting its quotation approves it; rejecting or expiring the quotation returns it to `estimated`.

## Collaboration

| Call | |
|---|---|
| `GET/POST /notes`, `PUT/DELETE /notes/:id` | timeline for a lead, client, project, task, change request, quote or invoice (`entity_type`, `entity_id`) |
| `GET /tasks/:id/collab` | checklist, watchers, people who can be @mentioned |
| `POST /tasks/:id/watch`, `POST/PUT/DELETE /tasks/:id/checklist[/:cid]` | |
| `GET /projects/:id/members`, `PUT /projects/:id/members` | project team |
| `GET /notifications`, `POST /notifications/read` | |
| `POST /documents/upload` (multipart), `POST /documents/link`, `GET /files/:id[?inline=1]` | files up to 60 MB and links |

## Founders only

| Call | |
|---|---|
| `GET /credentials`, `POST`, `PUT /:id`, `DELETE /:id`, `POST /credentials/:id/reveal` | the vault; passwords are never in a list response |
| `GET /users`, `POST`, `PUT /users/:id`, `DELETE /users/:id` | team; `keep_password` lets a founder set a permanent password; `reset_2fa` for a lost phone |
| `GET/PUT /settings` | company details, numbering, tax defaults, dropdown lists |
| `GET /audit` | activity log, paged, filters `user_id`, `action`, `entity`, `q` |
| `GET /backup` | a consistent copy of the database |

## Read-only views

| Call | |
|---|---|
| `GET /lookups` | small lists for dropdowns, already limited to what the person may see |
| `GET /dashboard` | everything on Home |
| `GET /analytics/sales?year=` | funnel, by market / side / department / category / source / owner, monthly, sales cycle |
| `GET /analytics/delivery` | projects, change requests (+ money for founders), tasks per week, support, team load |
| `GET /analytics/finance?months=` | monthly income / expense / invoiced / margin, top clients, ageing, project profit, grants, recurring cost, 60-day forecast |
| `GET /finance/summary?from=&to=` | the Finance overview for a period |
| `GET /calendar?from=&to=` | everything with a date |
| `GET /search?q=` | global search across everything the person may open |
