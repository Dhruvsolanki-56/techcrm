import type { Migration } from '../migrate';

/**
 * Payment milestones: how a project's agreed value is billed (advance, mid-way, go-live, final …).
 * A milestone is "reached" when the work is done, then invoiced; its state follows its invoice.
 */
export const milestones: Migration = {
  id: '0004',
  name: 'project payment milestones',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS milestones (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'milestone',            -- advance | milestone | final | retainer
        percent REAL,
        amount REAL NOT NULL DEFAULT 0,                     -- before tax
        due_date TEXT,                                      -- when it should be billed
        reached_on TEXT,                                    -- when the work behind it was finished
        position INTEGER NOT NULL DEFAULT 0,
        invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
      CREATE INDEX IF NOT EXISTS idx_milestones_invoice ON milestones(invoice_id);
    `);
  },
};
