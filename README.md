# TechSentinals CRM

One internal system for the whole company: leads → clients → projects → change requests → quotations → invoices → payments, plus expenses, recurring bills, grants, assets, documents, a credentials vault, tasks and team access.

Node.js + Express + SQLite on the server, React on the screen, one TypeScript codebase.

```
packages/shared   rules, option lists, dates and money maths used by both sides (one copy, so they cannot disagree)
server            Express API, SQL migrations, analytics, background jobs, the seed
web               React app (Vite), built into web/dist and served by the API
current_xls       the two workbooks the seed reads (not committed)
docs              architecture, API, runbook, seeding
```

## Run it

Needs Node 22+.

```bash
npm install
npm run migrate          # creates / upgrades data/crm.db (safe to repeat)
npm run seed             # loads current_xls/*.xlsx (see docs/seeding.md)
npm run dev              # API on :3000, web on :5173 (proxied)
```

Production-style, on one port:

```bash
npm run build
npm start                # http://localhost:3000
```

First start with an empty database shows the **Set up your workspace** screen (creates the first founder). After a seed, sign in as the founder named in `CRM_FOUNDER_EMAIL` (default: the first founder in `server/src/seed/load.ts`).

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `3000`, `0.0.0.0` | where to listen |
| `CRM_DATA_DIR` | `./data` | database, uploads, backups and the vault key file |
| `CRM_SECRET` | key file in the data folder | secret that encrypts stored credentials (16+ characters) |
| `TRUST_PROXY` | `0` | number of reverse proxies in front (Render, Caddy, nginx → `1`) |
| `SESSION_HOURS` | `12` | how long a sign-in lasts |
| `BACKUP_KEEP` | `14` | daily backups kept |
| `JOBS` | on | `0` switches off reminders, auto-debit and backups (tests do this) |
| `LOG_LEVEL` | `info` | pino level; logs are JSON lines |
| `CRM_FOUNDER_EMAIL`, `CRM_SEED_PASSWORD` | – | seed only, see docs/seeding.md |

An invalid value stops the server at start with a readable message.

## Checks

```bash
npm run typecheck && npm run lint
npm test                 # shared + server (API, security, analytics, migrations, seed) + web unit tests
npm run test:e2e         # real browser: setup, lead → CR → quote → invoice → payment, paging, palette, mobile, accessibility
```

The e2e run needs `npm run build` first and starts its own server on a throw-away database.

## Documentation

- [Architecture](docs/architecture.md) — layers, the resource engine, data flow, security model
- [API](docs/api.md) — every endpoint, paging, filters, errors
- [Runbook](docs/runbook.md) — deploy, backups, restore, upgrades, troubleshooting
- [Seeding](docs/seeding.md) — what the workbooks load, the agreed corrections, how it is verified
