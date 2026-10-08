# Go-live readiness audit: TechSentinals CRM

**Date:** 7 October 2026
**Verdict: ready for daily use by the 4 founders and the interns**, once the five go-live steps at the end are done. Steps 1 and 2 matter most: HTTPS if it is reachable from the internet, and backups kept off the machine.

---

## 1. What was tested and the results

| Area | How it was tested | Result |
|---|---|---|
| Server features | `npm test`, smoke suite: every module end-to-end through the API | **66 / 66 pass** |
| Security | `npm test`, security suite: login, brute force, 2FA, CSRF, intern isolation, injection, file uploads, vault encryption, headers, import, input validation | **184 / 184 pass** |
| Every form, filled in through the real popups | `scripts/ui-flow-test.js`, run in the browser as a founder | **190 / 190 pass** |
| Every page and popup on screen | `scripts/ui-audit.js`: layout, alignment, labels, loading, charts, popups | **555 / 555 pass** at desktop size |
| Intern account | Signed in as an intern in the browser | Menu shows only Home, My work, Calendar, Projects, Documents. All 8 founder areas show "No access". No ₹ amounts anywhere. Only their own 2 projects. Can update their own task's status, but its title, assignee, priority and due date are locked. |
| Fresh install | New empty data folder, server started from scratch | **8 / 8 pass.** Asks for the first founder. Weak passwords refused. Setup cannot be run a second time. Backup written on start. Encryption key created. Data survives a restart. |
| Third-party packages | `npm audit --omit=dev` | **0 known vulnerabilities** |
| Database | SQLite `integrity_check` and foreign-key check on the demo data after all the tests | **ok, 0 problems** |

### What the form test covers
It fills in and saves each of these, then reads the record back from the server and compares every field:
- client, contact, lead, project and task (including "Mark done" and edit)
- payment, expense, bank account, founder transfer
- renewal or plan, maintenance log, calendar reminder
- invoice: two lines, live totals, wrong due date refused, "Save & mark as sent", full payment turns it "paid"
- quotation
- lead converted to a client
- document upload
- credential, including an exact decrypted reveal and a check that the list never shows the password
- new intern account, which must change its temporary password on first login
- company settings

It also feeds bad input to the forms and checks it is blocked. Afterwards it deletes everything it created.

---

## 2. Input validation (added in this round)

The rules live in one file, `public/js/rules.js`. The browser uses it to block bad characters as you type and to show a message under the field. The server uses the same file, so bad data is refused even if someone bypasses the browser.

| Field type | Rule |
|---|---|
| People's names: lead, contact, team member, account holder | Letters only, in any language (e.g. "राहुल शर्मा"). Spaces, `.`, `'` and `-` are allowed. Numbers and symbols are removed as you type, with a message saying why. |
| City, State, Country | Letters only. |
| Phone / WhatsApp | Digits, `+`, spaces, `-` and `()` only. 7 to 15 digits. |
| Email | Must look like name@company.com. |
| Website and project links | Must be a real address, e.g. company.com. |
| GSTIN, PAN, IFSC | Exact Indian formats. Switched to capitals automatically. |
| UPI ID | Must look like name@bank. |
| All ₹ amounts | Numbers only; `e`, `+` and `-` are blocked; no negatives. The opening balance of a bank account is the one exception. Pasting "₹1,20,000" becomes 120000. |
| Tax rate | 0 to 100. |
| Hours | 0 to 1000. |
| Dates | Must be real dates (30 Feb is refused). Deadline cannot be before start; invoice due date cannot be before issue date; a quotation's "valid until" cannot be before its issue date. |
| Invoice lines | Each line needs a description, a quantity above 0, and a rate that is not negative. |
| Required fields | A field that contains only spaces counts as empty. |
| Excel import | A bad cell (e.g. "call later" in a phone column) is left empty and reported. The row is still imported. |

Industry and contact "Role" are left as free text on purpose. Real values like "Retail / D2C", "B2B SaaS" and "Web3" contain digits.

---

## 3. Problems found and fixed in this round

1. **Adding a contact from a client's page failed** with "client is required". The same root cause meant a task added from a lead's page silently lost its link to that lead. Fixed: the context the page passes in (which client, which lead) is now always sent with the form.
2. The "Numbers are not allowed" warning was shown and then cleared straight away, so it never appeared. Fixed.
3. The first-founder setup screen did not check the name and email format. Fixed.
4. Earlier rounds, all re-checked:
   - Dashboard gaps, charts with no hover, missing loading states.
   - On phones: invoice and quotation pages scrolled sideways, and the chart was squashed.
   - Popups that discarded typed text without asking.
   - A required dropdown that silently picked the first client.

---

## 4. Known limits (acceptable for a team this size)

- **One server and one database file.** This is fine for about 4 to 20 people. There is no automatic failover. If the machine is off, the CRM is off.
- **Backups are automatic but stay on the same machine** (`data/backups`, last 14 days). If that disk dies, they die with it. This is why go-live step 2 exists.
- **Reminders appear inside the app only.** The app sends no emails or SMS. Payment reminders are copied and sent by you over WhatsApp or email.
- **The two browser test scripts are run by hand.** They are not part of `npm test`, because they need a signed-in browser. Run them after any UI change; the README explains how.
- **The full phone-size (375 px) audit was last run before the validation changes.** The changed forms were spot-checked at that size, but the full audit was not repeated.

---

## 5. Go-live steps (owner actions)

1. **Choose where it runs** (see below), and use **HTTPS** whenever it is reachable from the internet. Never send passwords over plain `http://` outside the office network.
2. **Off-machine backups.** Copy the whole `data` folder to Google Drive or OneDrive, or download *Settings → Download database backup*, at least weekly. That folder holds the database, uploaded files and `.vault.key`. Without the key, stored passwords cannot be decrypted.
3. **Create the first founder account immediately after the first start.** Until it exists, anyone who opens the site could create it. Then add the other 3 founders and the interns under *Team & access*. Share each temporary password privately.
4. **Every founder turns on two-step login:** click your name, then *Two-step login*. Founders can see finance and every client password.
5. **Optional but recommended:** set the `CRM_SECRET` environment variable to a long random value and keep it in a password manager. The vault key is then not stored next to the backups.

### Where it can run

| Option | Who can reach it | Cost | Effort | Notes |
|---|---|---|---|---|
| **A. Office PC on the local network** | People on the office Wi-Fi only | Free | 5 minutes | Plain http inside the office. The PC must stay on. Not reachable from home. |
| **B. Small cloud server (VPS) + your domain + Caddy** | Anyone, anywhere, over HTTPS | About ₹400–800/month | About 1 hour | The proper long-term setup. Needs a VPS account and a domain such as crm.techsentinals.com. |
| **C. Office PC + Cloudflare Tunnel** | Anyone, anywhere, over HTTPS | Free (needs a Cloudflare account and a domain on Cloudflare) | About 20 minutes | No port forwarding. The PC must stay on. |
