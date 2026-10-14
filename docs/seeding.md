# Seeding from the workbooks

The CRM starts with the company's real data: `current_xls/TechSentinals CRM.xlsx` (sales) and `current_xls/TechSentinals OS.xlsx` (operations and money). The workbooks are the source of truth; the CRM never uploads sheets from the browser.

```bash
npm run seed -- --dry-run        # read and report, save nothing
npm run seed                     # load (adds what is missing, never duplicates)
npm run seed -- --reset          # remove what an earlier seed created, then load again
npm run seed -- --xls D:\other   # another folder
```

A backup of the database is written to `backups/before-seed-….db` before anything changes. `--reset` deletes only rows the seed itself created (identified by keys starting `gs:` / `seed:`); records you added by hand are never touched.

Environment: `CRM_FOUNDER_EMAIL` sets the founder login (Ashwin), `CRM_SEED_PASSWORD` the password for **new** team accounts (otherwise random, printed once). Existing accounts and their passwords are never changed.

## What is loaded

| From the sheets | In the CRM |
|---|---|
| Master Leads (all tabs) | leads with every sheet field: stage, priority, follow-up round and dates, department / business side, source, deal value, notes; owners linked to team members |
| Clients | clients with main contact; won leads are linked to their client |
| Projects | projects with `P-26-00x` codes, status, dates, value, client reference, details |
| Income | payments, with category, mode, account, TDS; grant money as grant income |
| Expenses | expenses with category, vendor, mode, status; subscriptions marked for auto-debit |
| Subscriptions | recurring items (Claude on the 12th and the 17th, ChatGPT Plus, the postpaid Airtel bill as a *variable* bill) |
| Grants | grants with requested / received and reporting dates |
| Settings tabs | dropdown lists (categories, sources, modes, statuses, asset types) |
| derived | one paid invoice per project that has payments; RotoTech maintenance plan until December 2026 (₹25,000); no maintenance plan for Inventa |

## Agreed corrections

- "RotoTech Phase 2" is not a separate client: its project and the ₹25,000 advance belong to **RotoTech Systems**.
- The company itself ("TechSentinals") is not a client.
- Strikar Lifescience is a **website build** project; Vishalwin Foundation is **one** project, the *NGO Dashboard* (Renu programme and Road Safety Guardian Angel programme).
- The SSIP grant receipt is booked on 13 Jul 2026.
- Dates the spreadsheet swapped between day and month (12/08 shown as 8 Dec) are put back in order using the rows around them; the dry run counts them.
- Wording is tidied (capitalisation, phone layout, alternate phones / emails moved to notes) and counted in the report.

## Verification

After loading, the seed recomputes the figures the sheets' own Dashboard / Analytics tabs show (totals, conversion, India vs Foreign, department and source counts, income and expense totals, …) and compares them with what the CRM now holds: **51 checks**, each listed as `ok` or `FAIL`. Any difference is printed with both numbers. `server/test/seed.test.ts` runs the same loader against the real workbooks on a throw-away database and asserts that all 51 match, that running it again is safe and that `--reset` leaves hand-typed records alone. The workbooks are not committed, so the test skips itself where they are missing (for example in CI).
