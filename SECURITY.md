# Security review — TechSentinals CRM

**Date:** 7 Oct 2026 · **Scope:** whole application (server, API, browser app, data at rest) · **Method:** full code review + automated attack tests (`npm run test:security`, 139 checks) + manual browser testing of stored script injection + `npm audit` (0 known vulnerabilities).

## Result
All findings below are **fixed** and covered by an automated test so they cannot quietly come back. Remaining risks are operational (how and where you host it) — see the last section.

## Findings and fixes

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | The "change your temporary password" step was enforced only in the browser. Someone holding a temporary password could use the whole API directly. | The server refuses everything except profile + password change until the user chooses their own password. |
| 2 | High | Interns given "document library" access could also see invoice and expense attachments. | That access option is removed; interns only see files on their own projects and tasks. |
| 3 | High | No second factor: one leaked founder password exposed every client's server credentials. | Two-step login (authenticator app, TOTP). Secret encrypted at rest, codes can't be replayed, setup needs the password, founders can reset a lost phone, all changes logged. |
| 4 | Medium | Login brute-force limit was only per account+IP — password spraying many emails from one IP was unlimited; the attempt table never shrank. | Added a per-IP limit (30 failures / 15 min) on top of the per-account limit (8); old entries are cleaned up. |
| 5 | Medium | Unknown emails answered much faster than wrong passwords, revealing which emails have accounts. | Unknown emails now go through the same password check, so timing is equal. |
| 6 | Medium | Changing your password did not sign out other devices. | Changing password or turning on two-step login signs out every other session. |
| 7 | Medium | An intern could edit a maintenance entry and move it to another client/project/person, or create one for any client. | Interns can only update progress fields; new entries must be on their own projects. |
| 8 | Medium | Calendar reminders for every client were visible to all interns. | Interns see company-wide reminders and those for their own projects only. |
| 9 | Medium | The cookie `Secure` flag and HSTS trusted an `X-Forwarded-Proto` header even when not behind a proxy. | Only trusted when `TRUST_PROXY=1` is set. |
| 10 | Low | Status fields (task status, lead stage, invoice status, …) accepted any text. | Only known values are accepted. |
| 11 | Low | The logo setting only checked the start of the value, allowing HTML attribute injection into invoices. | Strict format check, and the value is escaped on display. |
| 12 | Low | Requests with names like `/api/constructor`, repeated query parameters, a malformed cookie, or a body over 4 MB caused 500 errors. | All return clean 4xx answers. |
| 13 | Low | Settings accepted keys like `toString`; negative TDS / tax amounts accepted; negative audit `limit` removed the row cap. | Validated. |
| 14 | Low | Interns could link their tasks to sales leads they cannot see. | Stripped unless they have lead access. |
| 15 | Info | Missing hardening headers. | Added `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, CSP `object-src 'none'` and `base-uri 'none'`. |

## Verified as already safe (tested, no change needed)
- **SQL injection** — every query is parameterised; injection attempts in filters, search and ids are inert.
- **Script injection (XSS)** — attack text in client, contact, project, note and spec fields was shown as plain text on every page and in search; no script ran. A strict Content-Security-Policy blocks inline scripts as a second layer. `javascript:` links are neutralised.
- **CSRF** — every state-changing request must carry a custom header, so cross-site forms and links cannot act as you. Cookie is `HttpOnly` + `SameSite=Lax`.
- **Sessions** — 256-bit random tokens, stored only as hashes, expire after 12 h, deleted on logout and when a user is deactivated.
- **Passwords** — salted scrypt hashes; minimum 10 characters with letters and numbers; no plaintext password or vault secret anywhere in the database file.
- **Access control** — 50+ tests: interns cannot read, create, change or delete any finance, invoice, quotation, renewal, account, vault, team, settings or audit data, cannot open other projects by id, and never receive money fields.
- **Credentials vault** — AES-256-GCM with a fresh IV per value; tampering is detected; list views never contain secrets; every reveal is logged with person and IP.
- **File uploads** — random file names on disk (no path traversal), always downloaded as attachments with a sandbox CSP and `nosniff`, so an uploaded HTML file can never run in the app.
- **CSV export** — spreadsheet formulas are neutralised.
- **Dependencies** — `npm audit`: 0 vulnerabilities.

## What you must do when you deploy (cannot be fixed in code)
1. **HTTPS only** (Caddy in front, `TRUST_PROXY=1`, `HOST=127.0.0.1`). Never plain http on the internet.
2. **Create the first founder account right after the first start** — until it exists, anyone reaching the site can create it.
3. **Every founder turns on two-step login.** Team & access shows who has not.
4. **Protect the vault key.** Prefer `CRM_SECRET` stored in a password manager; never keep `.vault.key` in the same place as off-site backups.
5. **Back up the `data` folder** to a second location; test a restore once.
6. Deactivate interns the day they leave (it signs them out instantly).
7. Keep the server OS updated and run `npm audit` every few months.
