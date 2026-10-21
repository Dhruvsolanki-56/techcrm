import type { Migration } from '../migrate';

/**
 * Referential integrity the database itself enforces (so no screen, import or script can break it):
 *  - an invoice / quotation number and a project code, once given, never change;
 *  - an invoice's project belongs to the invoice's client; a payment belongs to the client of its invoice;
 *  - a project that already has invoices cannot be handed to another client.
 * Every message starts with "crm:" so the API can show it as plain words.
 * Also: what the company pays is always debited as an expense, so the old per-item switches are settled once.
 */
export const integrity: Migration = {
  id: '0010',
  name: 'integrity triggers, simpler subscriptions',
  up(db) {
    db.exec(`
      UPDATE renewals SET amount_varies=0, next_amount=NULL;
      UPDATE renewals SET auto_debit = CASE WHEN scope='company' AND kind<>'amc' AND our_cost>0 THEN 1 ELSE 0 END;

      DROP TRIGGER IF EXISTS trg_invoice_number_fixed;
      CREATE TRIGGER trg_invoice_number_fixed BEFORE UPDATE OF number ON invoices
      WHEN OLD.number IS NOT NULL AND NEW.number IS NOT OLD.number
      BEGIN SELECT RAISE(ABORT, 'crm: An invoice number can never be changed.'); END;

      DROP TRIGGER IF EXISTS trg_quote_number_fixed;
      CREATE TRIGGER trg_quote_number_fixed BEFORE UPDATE OF number ON quotes
      WHEN OLD.number IS NOT NULL AND NEW.number IS NOT OLD.number
      BEGIN SELECT RAISE(ABORT, 'crm: A quotation number can never be changed.'); END;

      DROP TRIGGER IF EXISTS trg_project_code_fixed;
      CREATE TRIGGER trg_project_code_fixed BEFORE UPDATE OF code ON projects
      WHEN OLD.code IS NOT NULL AND NEW.code IS NOT OLD.code
      BEGIN SELECT RAISE(ABORT, 'crm: A project code can never be changed.'); END;

      DROP TRIGGER IF EXISTS trg_invoice_project_client_ins;
      CREATE TRIGGER trg_invoice_project_client_ins BEFORE INSERT ON invoices
      WHEN NEW.project_id IS NOT NULL AND (SELECT client_id FROM projects WHERE id=NEW.project_id) IS NOT NEW.client_id
      BEGIN SELECT RAISE(ABORT, 'crm: That project belongs to a different client.'); END;

      DROP TRIGGER IF EXISTS trg_invoice_project_client_upd;
      CREATE TRIGGER trg_invoice_project_client_upd BEFORE UPDATE OF project_id, client_id ON invoices
      WHEN NEW.project_id IS NOT NULL AND (SELECT client_id FROM projects WHERE id=NEW.project_id) IS NOT NEW.client_id
      BEGIN SELECT RAISE(ABORT, 'crm: That project belongs to a different client.'); END;

      DROP TRIGGER IF EXISTS trg_payment_client_ins;
      CREATE TRIGGER trg_payment_client_ins BEFORE INSERT ON payments
      WHEN NEW.invoice_id IS NOT NULL AND (SELECT client_id FROM invoices WHERE id=NEW.invoice_id) IS NOT NEW.client_id
      BEGIN SELECT RAISE(ABORT, 'crm: A payment belongs to the client of its invoice.'); END;

      DROP TRIGGER IF EXISTS trg_payment_client_upd;
      CREATE TRIGGER trg_payment_client_upd BEFORE UPDATE OF invoice_id, client_id ON payments
      WHEN NEW.invoice_id IS NOT NULL AND (SELECT client_id FROM invoices WHERE id=NEW.invoice_id) IS NOT NEW.client_id
      BEGIN SELECT RAISE(ABORT, 'crm: A payment belongs to the client of its invoice.'); END;

      DROP TRIGGER IF EXISTS trg_project_client_with_invoices;
      CREATE TRIGGER trg_project_client_with_invoices BEFORE UPDATE OF client_id ON projects
      WHEN NEW.client_id IS NOT OLD.client_id AND (EXISTS (SELECT 1 FROM invoices WHERE project_id=OLD.id) OR EXISTS (SELECT 1 FROM payments WHERE project_id=OLD.id))
      BEGIN SELECT RAISE(ABORT, 'crm: This project already has invoices or payments, so it cannot be given to another client.'); END;

      DROP TRIGGER IF EXISTS trg_invoice_client_with_payments;
      CREATE TRIGGER trg_invoice_client_with_payments BEFORE UPDATE OF client_id ON invoices
      WHEN NEW.client_id IS NOT OLD.client_id AND EXISTS (SELECT 1 FROM payments WHERE invoice_id=OLD.id)
      BEGIN SELECT RAISE(ABORT, 'crm: Payments were recorded against this invoice, so it cannot be moved to another client.'); END;
    `);
  },
};
