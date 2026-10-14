-- Schema of the previous (plain JS) version of the app, plus a few rows. Used by migrations.test.ts.
PRAGMA foreign_keys=OFF;
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'intern',          -- founder | intern
  modules TEXT NOT NULL DEFAULT '[]',           -- extra access flags for interns (JSON array)
  title TEXT, phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,                             -- encrypted authenticator secret (two-step login)
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_last INTEGER NOT NULL DEFAULT 0,         -- last accepted 30s step, blocks code replay
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  ip TEXT, ua TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE clients (
  id INTEGER PRIMARY KEY,
  company TEXT NOT NULL,
  industry TEXT, website TEXT, gstin TEXT, pan TEXT,
  address TEXT, city TEXT, state TEXT, country TEXT DEFAULT 'India',
  status TEXT NOT NULL DEFAULT 'active',        -- prospect | active | past | archived
  account_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tags TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, import_key TEXT);
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT, email TEXT, phone TEXT, whatsapp TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE leads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, company TEXT, email TEXT, phone TEXT, website TEXT, city TEXT,
  source TEXT, service TEXT,
  value REAL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'new',            -- new|contacted|meeting|proposal|negotiation|won|lost
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  next_followup TEXT, expected_close TEXT,
  lost_reason TEXT, notes TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, market TEXT, country TEXT, business_side TEXT, department TEXT, category TEXT, requirement TEXT, priority TEXT DEFAULT 'medium', followup_round TEXT DEFAULT 'not_started', next_action TEXT, last_contact TEXT, meeting_date TEXT, proposal_date TEXT, closed_on TEXT, import_key TEXT, assigned_name TEXT);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, code TEXT, type TEXT,
  status TEXT NOT NULL DEFAULT 'planning',      -- planning|active|review|on_hold|completed|maintenance|cancelled
  priority TEXT NOT NULL DEFAULT 'medium',
  start_date TEXT, deadline TEXT, completed_on TEXT,
  budget REAL DEFAULT 0,
  manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  description TEXT, specs TEXT, tech_stack TEXT,
  live_url TEXT, staging_url TEXT, repo_url TEXT, design_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, import_key TEXT, assigned_name TEXT);
CREATE TABLE project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, description TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'todo',          -- todo|in_progress|review|done
  due_date TEXT, completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'note',            -- note | call | meeting | email | whatsapp | system
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, edited_at TEXT, mentions TEXT, import_key TEXT, followup_round TEXT, next_followup TEXT);
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, category TEXT DEFAULT 'Other',
  entity_type TEXT NOT NULL DEFAULT 'general', entity_id INTEGER,
  filename TEXT NOT NULL, stored_name TEXT NOT NULL, mime TEXT, size INTEGER DEFAULT 0,
  notes TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, expiry_date TEXT, url TEXT, status TEXT, owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL, assigned_name TEXT, import_key TEXT);
CREATE TABLE quotes (
  id INTEGER PRIMARY KEY,
  number TEXT UNIQUE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT, issue_date TEXT, valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'draft',         -- draft|sent|accepted|rejected|expired
  items TEXT NOT NULL DEFAULT '[]',
  subtotal REAL DEFAULT 0, discount REAL DEFAULT 0,
  tax_type TEXT DEFAULT 'cgst_sgst', tax_rate REAL DEFAULT 18, tax_amount REAL DEFAULT 0,
  total REAL DEFAULT 0, currency TEXT DEFAULT 'INR',
  terms TEXT, notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  number TEXT UNIQUE,
  kind TEXT NOT NULL DEFAULT 'invoice',         -- invoice | proforma
  client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  title TEXT, issue_date TEXT, due_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',         -- draft|sent|partial|paid|overdue|cancelled
  items TEXT NOT NULL DEFAULT '[]',
  subtotal REAL DEFAULT 0, discount REAL DEFAULT 0,
  tax_type TEXT DEFAULT 'cgst_sgst', tax_rate REAL DEFAULT 18, tax_amount REAL DEFAULT 0,
  total REAL DEFAULT 0, paid_amount REAL DEFAULT 0, currency TEXT DEFAULT 'INR',
  terms TEXT, notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, import_key TEXT);
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, type TEXT DEFAULT 'bank',  -- bank|cash|upi|card|wallet
  opening_balance REAL DEFAULT 0, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE payments (          -- money received from clients
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  date TEXT NOT NULL, amount REAL NOT NULL, tds REAL DEFAULT 0,
  method TEXT, reference TEXT, notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, category TEXT, grant_id INTEGER REFERENCES grants(id) ON DELETE SET NULL, import_key TEXT);
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL, category TEXT, vendor TEXT, description TEXT,
  amount REAL NOT NULL, tax_amount REAL DEFAULT 0,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  paid_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- founder who paid personally (null = company account)
  reimbursed INTEGER NOT NULL DEFAULT 0,
  method TEXT, reference TEXT,
  status TEXT NOT NULL DEFAULT 'paid',          -- paid | pending
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, grant_id INTEGER REFERENCES grants(id) ON DELETE SET NULL, receipt_url TEXT, import_key TEXT, renewal_id INTEGER REFERENCES renewals(id) ON DELETE SET NULL);
CREATE TABLE transfers (          -- founder capital, withdrawals, loans, tax payments, account transfers
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,                           -- capital_in|withdrawal|loan_in|loan_repay|tax_paid|transfer
  amount REAL NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  to_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE credentials (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL, kind TEXT DEFAULT 'Other',
  url TEXT, username TEXT,
  password_enc TEXT, secret_enc TEXT, notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE renewals (            -- domains, hosting, SSL, subscriptions, maintenance plans (kind 'amc')
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  kind TEXT DEFAULT 'domain', name TEXT NOT NULL, vendor TEXT,
  renewal_date TEXT, cycle TEXT DEFAULT 'yearly',
  our_cost REAL DEFAULT 0, client_price REAL DEFAULT 0,
  auto_renew INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL, import_key TEXT, auto_debit INTEGER NOT NULL DEFAULT 0, pay_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, last_debited TEXT, assigned_name TEXT, category TEXT);
CREATE TABLE maintenance_logs (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT,
  type TEXT DEFAULT 'Bug fix', priority TEXT DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',          -- open|in_progress|resolved
  reported_on TEXT, resolved_on TEXT, hours REAL DEFAULT 0, billable INTEGER DEFAULT 0,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE events (               -- custom important dates
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, date TEXT NOT NULL, end_date TEXT,
  kind TEXT DEFAULT 'Reminder',
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER, user_name TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id INTEGER, detail TEXT, ip TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE grants (              -- government / programme grants
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, funder TEXT, applied_on TEXT,
  requested REAL DEFAULT 0, received REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'applied',       -- applied|approved|disbursed|closed|rejected
  next_report_date TEXT, notes TEXT, import_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL, link TEXT, read INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE TABLE task_watchers (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE TABLE task_checklist (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done INTEGER NOT NULL DEFAULT 0, done_by INTEGER REFERENCES users(id) ON DELETE SET NULL, done_at TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE assets (       -- laptops, phones, devices (sheet: Assets)
    id INTEGER PRIMARY KEY, asset_type TEXT NOT NULL, make_model TEXT, serial_number TEXT, purchase_date TEXT, purchase_value REAL DEFAULT 0, current_value REAL,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL, assigned_name TEXT, status TEXT DEFAULT 'Active', notes TEXT, import_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE bank_transactions (    -- bank statement lines, matched against income / expenses (sheet: Bank Transactions)
    id INTEGER PRIMARY KEY, account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, date TEXT NOT NULL, description TEXT, reference TEXT,
    withdrawal REAL DEFAULT 0, deposit REAL DEFAULT 0, balance REAL, type TEXT, matched_status TEXT NOT NULL DEFAULT 'Unmatched', match_note TEXT,
    payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL, expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL, import_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_notes_entity ON notes(entity_type, entity_id);
CREATE INDEX idx_docs_entity ON documents(entity_type, entity_id);
CREATE INDEX idx_audit_at ON audit_log(at);
CREATE INDEX idx_task_assignees_user ON task_assignees(user_id);
CREATE INDEX idx_task_checklist_task ON task_checklist(task_id);
CREATE INDEX idx_bank_date ON bank_transactions(date);
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_followup ON leads(next_followup);
CREATE INDEX idx_leads_owner ON leads(owner_id);
CREATE UNIQUE INDEX idx_exp_renewal_day ON expenses(renewal_id, date) WHERE renewal_id IS NOT NULL;
CREATE INDEX idx_exp_renewal ON expenses(renewal_id);
CREATE INDEX idx_leads_import ON leads(import_key);
CREATE INDEX idx_payments_date ON payments(date);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_notes_import ON notes(import_key);
INSERT INTO users(id,name,email,password_hash,role,modules,title,phone,active,must_change_password,totp_secret,totp_enabled,totp_last,last_login,created_at) VALUES(1,'Old Founder','old@x.test','scrypt$aa$bb','founder','[]',NULL,NULL,1,0,NULL,0,0,NULL,'2026-10-14 10:38:44');
INSERT INTO clients(id,company,industry,website,gstin,pan,address,city,state,country,status,account_manager_id,tags,notes,created_at,updated_at,import_key) VALUES(1,'Legacy Client',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'India','active',NULL,NULL,NULL,'2026-10-14 10:38:44','2026-10-14 10:38:44',NULL);
INSERT INTO projects(id,client_id,name,code,type,status,priority,start_date,deadline,completed_on,budget,manager_id,description,specs,tech_stack,live_url,staging_url,repo_url,design_url,created_at,updated_at,import_key,assigned_name) VALUES(1,1,'Legacy Project',NULL,NULL,'planning','medium',NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-10-14 10:38:44','2026-10-14 10:38:44',NULL,NULL);
INSERT INTO leads(id,name,company,email,phone,website,city,source,service,value,stage,owner_id,next_followup,expected_close,lost_reason,notes,client_id,created_by,created_at,updated_at,market,country,business_side,department,category,requirement,priority,followup_round,next_action,last_contact,meeting_date,proposal_date,closed_on,import_key,assigned_name) VALUES(1,'Legacy Lead','Legacy Co',NULL,NULL,NULL,NULL,NULL,NULL,0,'won',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-10-14 10:38:44','2026-10-14 10:38:44',NULL,NULL,NULL,NULL,NULL,NULL,'medium','not_started',NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO renewals(id,client_id,project_id,kind,name,vendor,renewal_date,cycle,our_cost,client_price,auto_renew,status,notes,created_at,owner_id,import_key,auto_debit,pay_account_id,last_debited,assigned_name,category) VALUES(1,NULL,NULL,'subscription','Legacy sub',NULL,'2026-11-01','monthly',100,0,0,'active',NULL,'2026-10-14 10:38:44',NULL,NULL,1,NULL,NULL,NULL,NULL);
