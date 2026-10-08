/* Start command for the hosted public demo (Render).
   Render's free disk is wiped on every restart, so each boot gets fresh sample data, which doubles as an automatic reset. */
'use strict';
const path = require('path'); const { execFileSync } = require('child_process');
process.env.CRM_DATA_DIR = process.env.CRM_DATA_DIR || path.join(__dirname, '..', 'demo-data');
process.env.DEMO_MODE = '1';
const Database = require('better-sqlite3'); const fs = require('fs');
fs.mkdirSync(process.env.CRM_DATA_DIR, { recursive: true });
const dbFile = path.join(process.env.CRM_DATA_DIR, 'crm.db');
let empty = true;
if (fs.existsSync(dbFile)) { try { const d = new Database(dbFile, { readonly: true }); empty = !d.prepare('SELECT COUNT(*) n FROM users').get().n; d.close(); } catch { empty = true; } }
if (empty) execFileSync(process.execPath, [path.join(__dirname, 'seed-demo.js')], { stdio: 'inherit', env: { ...process.env, DEMO_MODE: '0' } });   // seeding creates the accounts, so the demo guard is off for it
require('../server').start();     // same process: one server, clean shutdown
