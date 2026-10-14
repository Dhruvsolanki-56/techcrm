# Runbook

## Where things live

| What | Where |
|---|---|
| database | `$CRM_DATA_DIR/crm.db` (+ `-wal`, `-shm` while running) |
| uploaded files | `$CRM_DATA_DIR/uploads/` |
| daily and manual backups | `$CRM_DATA_DIR/backups/` (`auto-YYYY-MM-DD.db`, newest `BACKUP_KEEP` kept) |
| vault key | `CRM_SECRET`, or `$CRM_DATA_DIR/.vault.key` when unset |

**Losing the vault key means every stored credential is unreadable.** Keep a copy of `CRM_SECRET` / `.vault.key` somewhere separate from the backups.

## Deploy with Docker

```bash
docker build -t techsentinals-crm .
docker run -d --name crm -p 3000:3000 -v crm-data:/data \
  -e CRM_SECRET='a-long-random-secret' -e TRUST_PROXY=1 techsentinals-crm
```

The image runs as an unprivileged user, applies pending migrations on start and has a health check on `/api/health`. Put it behind HTTPS (Caddy, nginx, Render, Fly…); set `TRUST_PROXY` to the number of proxies so rate limiting and the Secure cookie flag see the real client.

`render.yaml` is a Render blueprint with a persistent disk on `/data`.

## Deploy without Docker

```bash
npm ci && npm run build
CRM_DATA_DIR=/var/lib/crm CRM_SECRET=… NODE_ENV=production npm start
```

On Windows `start.bat` does the same for a local install.

## Upgrades

1. Download a backup (Settings → Backup, or copy `crm.db` while the server is stopped).
2. Deploy the new version. Migrations run automatically at start and are recorded in `schema_migrations`; running them again does nothing.
3. Check `/api/health`, sign in, open Home.

Rolling back: stop, restore the backup file over `crm.db` (delete `crm.db-wal` and `crm.db-shm`), start the previous version.

## Backups and restore

- The server writes one backup a day (SQLite online backup, safe while running).
- Manual: Settings → Download a backup, or `GET /api/backup`.
- Restore: stop the server, replace `crm.db` with the backup, delete the `-wal` / `-shm` files, start. Uploaded files are not inside the database — back up `uploads/` as well.

## Recurring costs (auto-debit)

An item in **Subscriptions & renewals** with *Debit the cost automatically* records its expense on its date and moves the date forward. If the server was off for days, the missed debits are caught up on the next start, one per date (a unique index makes a double debit impossible). An item with *Amount changes every cycle* (a postpaid phone bill) records the debit as a **pending estimate** based on the last real bill; open Finance → Expenses and enter the real amount when the bill arrives.

## Operations

| Task | How |
|---|---|
| add a person | Team & access → Add person (temporary password unless *let them keep this password* is ticked) |
| give someone the same password as you | Team & access → edit the person → *New password* → tick *Let them keep this password* |
| remove a person | Team & access → trash icon (their records stay; to keep them listed, edit and untick *Active*) |
| lost phone for two-step login | Team & access → edit → *Turn off their two-step login* |
| unlock a blocked sign-in | wait 15 minutes, or restart the server |
| see who did what | Activity log |

## Troubleshooting

| Symptom | Check |
|---|---|
| server refuses to start with "Invalid configuration" | the message lists the bad variable |
| 401 on every call after deploy | cookie is `Secure` but the site is on plain HTTP behind a proxy → set `TRUST_PROXY` |
| "database is locked" | two servers on the same data folder; run one |
| credentials show as unreadable | `CRM_SECRET` differs from the one used when they were saved |
| numbers look wrong after editing seed data | `npm run seed -- --reset` removes only rows the seed created (keys starting `gs:` / `seed:`), never your own records |

Logs are JSON lines on stdout (`LOG_LEVEL=debug` for more). Each request line carries the method, path, status and duration.
