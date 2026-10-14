import type { Db } from '../connection';
import type { Migration } from '../migrate';

/** Support / work log for live clients (a function so the old-version upgrade below can rebuild it). */
const maintLogsSql = (name: string): string => `CREATE TABLE IF NOT EXISTS ${name} (
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
);`;

const TABLES = `
CREATE TABLE IF NOT EXISTS users (
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
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  ip TEXT, ua TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  company TEXT NOT NULL,
  industry TEXT, website TEXT, gstin TEXT, pan TEXT,
  address TEXT, city TEXT, state TEXT, country TEXT DEFAULT 'India',
  status TEXT NOT NULL DEFAULT 'active',        -- prospect | active | past | archived
  account_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tags TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT, email TEXT, phone TEXT, whatsapp TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS leads (
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
);
CREATE TABLE IF NOT EXISTS projects (
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
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS tasks (
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
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'note',            -- note | call | meeting | email | whatsapp | system
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity_type, entity_id);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, category TEXT DEFAULT 'Other',
  entity_type TEXT NOT NULL DEFAULT 'general', entity_id INTEGER,
  filename TEXT NOT NULL, stored_name TEXT NOT NULL, mime TEXT, size INTEGER DEFAULT 0,
  notes TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_entity ON documents(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS quotes (
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
CREATE TABLE IF NOT EXISTS invoices (
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
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, type TEXT DEFAULT 'bank',  -- bank|cash|upi|card|wallet
  opening_balance REAL DEFAULT 0, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS payments (          -- money received from clients
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  date TEXT NOT NULL, amount REAL NOT NULL, tds REAL DEFAULT 0,
  method TEXT, reference TEXT, notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS expenses (
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
);
CREATE TABLE IF NOT EXISTS transfers (          -- founder capital, withdrawals, loans, tax payments, account transfers
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
CREATE TABLE IF NOT EXISTS credentials (
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
CREATE TABLE IF NOT EXISTS renewals (            -- domains, hosting, SSL, subscriptions, maintenance plans (kind 'amc')
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  kind TEXT DEFAULT 'domain', name TEXT NOT NULL, vendor TEXT,
  renewal_date TEXT, cycle TEXT DEFAULT 'yearly',
  our_cost REAL DEFAULT 0, client_price REAL DEFAULT 0,
  auto_renew INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
${maintLogsSql('maintenance_logs')}
CREATE TABLE IF NOT EXISTS events (               -- custom important dates
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, date TEXT NOT NULL, end_date TEXT,
  kind TEXT DEFAULT 'Reminder',
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER, user_name TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id INTEGER, detail TEXT, ip TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE TABLE IF NOT EXISTS grants (              -- government / programme grants
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, funder TEXT, applied_on TEXT,
  requested REAL DEFAULT 0, received REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'applied',       -- applied|approved|disbursed|closed|rejected
  next_report_date TEXT, notes TEXT, import_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL, link TEXT, read INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const TEAMWORK = `
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id);
CREATE TABLE IF NOT EXISTS task_watchers (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE TABLE IF NOT EXISTS task_checklist (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done INTEGER NOT NULL DEFAULT 0, done_by INTEGER REFERENCES users(id) ON DELETE SET NULL, done_at TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_checklist_task ON task_checklist(task_id);
`;

const SHEET_TABLES = `
CREATE TABLE IF NOT EXISTS assets (       -- laptops, phones, devices
  id INTEGER PRIMARY KEY, asset_type TEXT NOT NULL, make_model TEXT, serial_number TEXT, purchase_date TEXT, purchase_value REAL DEFAULT 0, current_value REAL,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL, assigned_name TEXT, status TEXT DEFAULT 'Active', notes TEXT, import_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS bank_transactions (    -- bank statement lines, matched against income / expenses
  id INTEGER PRIMARY KEY, account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, date TEXT NOT NULL, description TEXT, reference TEXT,
  withdrawal REAL DEFAULT 0, deposit REAL DEFAULT 0, balance REAL, type TEXT, matched_status TEXT NOT NULL DEFAULT 'Unmatched', match_note TEXT,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL, expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL, import_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_bank_date ON bank_transactions(date);
`;

type ColumnSpec = [column: string, definition: string];

function addColumns(db: Db, table: string, list: ColumnSpec[]): void {
  const have = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  for (const [c, def] of list) if (!have.includes(c)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${c} ${def}`);
}

/** Columns added over time by the earlier versions; a no-op on a database that already has them. */
function upgradeOlderDatabases(db: Db): void {
  const has = (t: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const cols = (t: string): string[] => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

  addColumns(db, 'users', [['totp_secret', 'TEXT'], ['totp_enabled', 'INTEGER NOT NULL DEFAULT 0'], ['totp_last', 'INTEGER NOT NULL DEFAULT 0']]);
  const firstWatchers = !has('task_watchers');
  db.exec(TEAMWORK);
  // tasks.assignee_id stays as the first assignee, so older screens and reports keep working
  db.exec('INSERT OR IGNORE INTO task_assignees(task_id,user_id) SELECT id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL');
  if (firstWatchers) {
    db.exec(`INSERT OR IGNORE INTO task_watchers(task_id,user_id) SELECT id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL;
      INSERT OR IGNORE INTO task_watchers(task_id,user_id) SELECT id, created_by FROM tasks WHERE created_by IS NOT NULL;`);
  }
  addColumns(db, 'notes', [['edited_at', 'TEXT'], ['mentions', 'TEXT'], ['import_key', 'TEXT']]);
  addColumns(db, 'leads', [
    ['market', 'TEXT'], ['country', 'TEXT'], ['business_side', 'TEXT'], ['department', 'TEXT'], ['category', 'TEXT'], ['requirement', 'TEXT'],
    ['priority', "TEXT DEFAULT 'medium'"], ['followup_round', "TEXT DEFAULT 'not_started'"], ['next_action', 'TEXT'], ['last_contact', 'TEXT'],
    ['meeting_date', 'TEXT'], ['proposal_date', 'TEXT'], ['closed_on', 'TEXT'], ['import_key', 'TEXT'],
  ]);
  addColumns(db, 'clients', [['import_key', 'TEXT']]);
  addColumns(db, 'projects', [['import_key', 'TEXT']]);
  addColumns(db, 'payments', [['category', 'TEXT'], ['grant_id', 'INTEGER REFERENCES grants(id) ON DELETE SET NULL'], ['import_key', 'TEXT']]);
  addColumns(db, 'expenses', [['grant_id', 'INTEGER REFERENCES grants(id) ON DELETE SET NULL'], ['receipt_url', 'TEXT'], ['import_key', 'TEXT']]);
  addColumns(db, 'renewals', [
    ['owner_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL'], ['import_key', 'TEXT'], ['auto_debit', 'INTEGER NOT NULL DEFAULT 0'],
    ['pay_account_id', 'INTEGER REFERENCES accounts(id) ON DELETE SET NULL'], ['last_debited', 'TEXT'],
  ]);
  addColumns(db, 'expenses', [['renewal_id', 'INTEGER REFERENCES renewals(id) ON DELETE SET NULL']]);
  addColumns(db, 'invoices', [['import_key', 'TEXT']]);
  addColumns(db, 'documents', [
    ['expiry_date', 'TEXT'], ['url', 'TEXT'], ['status', 'TEXT'], ['owner_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL'], ['assigned_name', 'TEXT'], ['import_key', 'TEXT'],
  ]);
  addColumns(db, 'leads', [['assigned_name', 'TEXT']]);
  addColumns(db, 'projects', [['assigned_name', 'TEXT']]);
  addColumns(db, 'renewals', [['assigned_name', 'TEXT'], ['category', 'TEXT']]);
  addColumns(db, 'notes', [['followup_round', 'TEXT'], ['next_followup', 'TEXT']]);
  db.exec(SHEET_TABLES);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
    CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads(next_followup);
    CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_exp_renewal_day ON expenses(renewal_id, date) WHERE renewal_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_exp_renewal ON expenses(renewal_id);
    CREATE INDEX IF NOT EXISTS idx_leads_import ON leads(import_key);
    CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
    CREATE INDEX IF NOT EXISTS idx_notes_import ON notes(import_key);`);

  // Versions before this one stored milestones, maintenance contracts and some intern flags differently.
  db.transaction(() => {
    if (has('milestones')) {
      const st: Record<string, string> = { pending: 'todo', in_progress: 'in_progress', done: 'done' };
      for (const m of db.prepare('SELECT * FROM milestones').all() as Record<string, string>[]) {
        db.prepare('INSERT INTO tasks(title,description,project_id,status,due_date) VALUES(?,?,?,?,?)')
          .run(`Milestone: ${m.title}`, m.notes, m.project_id, st[m.status ?? ''] ?? 'todo', m.due_date);
      }
      db.exec('DROP TABLE milestones');
    }
    if (has('maintenance_contracts')) {
      for (const c of db.prepare('SELECT * FROM maintenance_contracts').all() as Record<string, string | number>[]) {
        db.prepare("INSERT INTO renewals(client_id,project_id,kind,name,renewal_date,cycle,client_price,status,notes) VALUES(?,?,'amc',?,?,'monthly',?,?,?)")
          .run(c.client_id, c.project_id, c.plan, c.renewal_date, c.monthly_fee || 0, c.status === 'active' ? 'active' : 'cancelled', c.scope);
      }
    }
    if (cols('maintenance_logs').includes('contract_id')) {
      db.exec(maintLogsSql('maintenance_logs_new'));
      const keep = cols('maintenance_logs_new').join(',');
      db.exec(`INSERT INTO maintenance_logs_new (${keep}) SELECT ${keep} FROM maintenance_logs; DROP TABLE maintenance_logs; ALTER TABLE maintenance_logs_new RENAME TO maintenance_logs;`);
    }
    if (has('maintenance_contracts')) db.exec('DROP TABLE maintenance_contracts');
    for (const u of db.prepare("SELECT id, modules FROM users WHERE modules LIKE '%renewals%' OR modules LIKE '%documents_all%'").all() as { id: number; modules: string }[]) {
      let m: string[] = [];
      try { m = JSON.parse(u.modules) as string[]; } catch { /* reset */ }
      db.prepare('UPDATE users SET modules=? WHERE id=?').run(JSON.stringify(m.filter((x) => !['renewals', 'documents_all'].includes(x))), u.id);
    }
  })();
}

export const baseline: Migration = {
  id: '0001',
  name: 'baseline schema (everything the earlier versions created)',
  up(db) {
    db.exec(TABLES);
    upgradeOlderDatabases(db);
  },
};
