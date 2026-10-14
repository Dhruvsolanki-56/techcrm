import type { Migration } from '../migrate';

/**
 * - Recurring bills whose amount changes every month (a postpaid phone bill): the expense is created as an estimate
 *   and confirmed with the real amount when the bill arrives.
 * - Indexes on every foreign key and on the columns lists are filtered / sorted by, so screens stay fast as data grows.
 */
export const variableBillsAndIndexes: Migration = {
  id: '0003',
  name: 'variable recurring bills + performance indexes',
  up(db) {
    const has = (t: string, c: string): boolean => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((x) => x.name === c);
    if (!has('renewals', 'amount_varies')) db.exec('ALTER TABLE renewals ADD COLUMN amount_varies INTEGER NOT NULL DEFAULT 0');
    if (!has('expenses', 'is_estimate')) db.exec('ALTER TABLE expenses ADD COLUMN is_estimate INTEGER NOT NULL DEFAULT 0');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_tasks_lead ON tasks(lead_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_contacts_client ON contacts(client_id);
      CREATE INDEX IF NOT EXISTS idx_leads_client ON leads(client_id);
      CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
      CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);
      CREATE INDEX IF NOT EXISTS idx_quotes_lead ON quotes(lead_id);
      CREATE INDEX IF NOT EXISTS idx_quotes_project ON quotes(project_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id);
      CREATE INDEX IF NOT EXISTS idx_payments_project ON payments(project_id);
      CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payments_grant ON payments(grant_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses(project_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
      CREATE INDEX IF NOT EXISTS idx_expenses_grant ON expenses(grant_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
      CREATE INDEX IF NOT EXISTS idx_renewals_date ON renewals(renewal_date, status);
      CREATE INDEX IF NOT EXISTS idx_renewals_client ON renewals(client_id);
      CREATE INDEX IF NOT EXISTS idx_credentials_client ON credentials(client_id);
      CREATE INDEX IF NOT EXISTS idx_credentials_project ON credentials(project_id);
      CREATE INDEX IF NOT EXISTS idx_maint_project ON maintenance_logs(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
      CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
    `);
  },
};
