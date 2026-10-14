import type { Migration } from '../migrate';

/**
 * Change requests: a client asks for something different (before delivery) or something new (after delivery).
 * The request is estimated, quoted, approved, delivered and billed — quote and invoice are linked, so the flow
 * lead → quote → client/project → change request → quote → invoice → payment can be followed end to end.
 */
export const changeRequests: Migration = {
  id: '0002',
  name: 'change requests linked to projects, quotes, invoices and tasks',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS change_requests (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        title TEXT NOT NULL, description TEXT,
        kind TEXT NOT NULL DEFAULT 'change',                  -- change | feature | enhancement
        phase TEXT NOT NULL DEFAULT 'before_delivery',        -- before_delivery | after_delivery
        status TEXT NOT NULL DEFAULT 'requested',             -- requested|estimated|quoted|approved|in_progress|delivered|rejected|cancelled
        priority TEXT NOT NULL DEFAULT 'medium',
        billable INTEGER NOT NULL DEFAULT 1,
        requested_by TEXT, requested_on TEXT,
        estimate_hours REAL DEFAULT 0, estimate_amount REAL DEFAULT 0,
        quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
        invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
        approved_on TEXT, delivered_on TEXT, notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cr_project ON change_requests(project_id);
      CREATE INDEX IF NOT EXISTS idx_cr_client ON change_requests(client_id);
      CREATE INDEX IF NOT EXISTS idx_cr_status ON change_requests(status);
      CREATE INDEX IF NOT EXISTS idx_cr_quote ON change_requests(quote_id);
      CREATE INDEX IF NOT EXISTS idx_cr_invoice ON change_requests(invoice_id);
    `);
    const has = (t: string, c: string): boolean => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((x) => x.name === c);
    if (!has('quotes', 'change_request_id')) db.exec('ALTER TABLE quotes ADD COLUMN change_request_id INTEGER REFERENCES change_requests(id) ON DELETE SET NULL');
    if (!has('tasks', 'change_request_id')) db.exec('ALTER TABLE tasks ADD COLUMN change_request_id INTEGER REFERENCES change_requests(id) ON DELETE SET NULL');
    if (!has('invoices', 'change_request_id')) db.exec('ALTER TABLE invoices ADD COLUMN change_request_id INTEGER REFERENCES change_requests(id) ON DELETE SET NULL');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_quotes_cr ON quotes(change_request_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_cr ON tasks(change_request_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_cr ON invoices(change_request_id);
    `);
  },
};
