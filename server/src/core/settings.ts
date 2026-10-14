import type { Db } from '../db/connection';

/** Company-wide settings and the dropdown lists (one value per line). */
export const DEFAULT_SETTINGS = {
  company_name: 'TechSentinals', company_address: '', company_email: '', company_phone: '', company_website: '',
  gstin: '', pan: '', state: '',
  bank_name: '', bank_account_name: '', bank_account_no: '', bank_ifsc: '', upi_id: '',
  invoice_prefix: 'INV', quote_prefix: 'QUO', default_tax_rate: '18', default_tax_type: 'cgst_sgst',
  currency: 'INR', fy_start_month: '4',
  terms_invoice: 'Payment is due by the due date mentioned above. Late payments may attract interest.',
  terms_quote: 'This quotation is valid until the date mentioned above. Work begins after the agreed advance is received.',
  logo: '',
  lead_services: ['Website', 'Web application', 'Mobile app', 'Healthcare', 'Manufacturing', 'Other Services'].join('\n'),
  lead_products: ['SaaS product', 'Other Products'].join('\n'),
  lead_categories: ['Pharma', 'Doctors', 'Other Healthcare', 'Manufacturing', 'NGO', 'Foundation', 'General Services', 'Security & Safety', 'Event Management', 'Retail', 'Other'].join('\n'),
  lead_sources: ['Referral', 'Website', 'LinkedIn', 'WhatsApp', 'Email', 'Phone', 'Event/Expo', 'Partner', 'Existing Client', 'Cold Outreach', 'Google', 'Social Media', 'Other'].join('\n'),
  income_categories: ['Client payment', 'Consulting', 'Product Sales', 'Retainer', 'Grant', 'Investment', 'Other'].join('\n'),
  expense_categories: ['Payroll', 'Software/SaaS', 'Marketing', 'Office/Rent', 'Travel', 'Legal & Admin', 'Hardware', 'Hosting/Cloud', 'Grant', 'Other'].join('\n'),
  payment_modes: ['Bank Transfer', 'UPI', 'Credit Card', 'Debit Card', 'Cash', 'Cheque', 'Stripe', 'PayPal', 'Other'].join('\n'),
  statuses: ['Active', 'Completed', 'On Hold', 'Cancelled', 'Pending', 'At Risk'].join('\n'),
  asset_types: ['Laptop', 'Desktop', 'Phone', 'Tablet', 'Monitor', 'Printer', 'Networking', 'Furniture', 'Other'].join('\n'),
};
export type Settings = Record<keyof typeof DEFAULT_SETTINGS, string>;
export const LIST_KEYS = ['lead_services', 'lead_products', 'lead_categories', 'lead_sources', 'income_categories', 'expense_categories', 'payment_modes', 'statuses', 'asset_types'] as const;

export interface SettingsService {
  get(): Settings;
  set(values: Record<string, unknown>): void;
  /** One dropdown list as an array. */
  list(key: (typeof LIST_KEYS)[number]): string[];
}

export function createSettings(db: Db): SettingsService {
  const upsert = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const get = (): Settings => {
    const out: Record<string, string> = { ...DEFAULT_SETTINGS };
    for (const r of db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]) out[r.key] = r.value;
    return out as Settings;
  };
  return {
    get,
    set(values) {
      db.transaction(() => {
        for (const [k, v] of Object.entries(values)) {
          if (Object.hasOwn(DEFAULT_SETTINGS, k)) upsert.run(k, v == null ? '' : String(v).slice(0, k === 'logo' ? 900_000 : 5000));
        }
      })();
    },
    list: (key) => get()[key].split('\n').map((x) => x.trim()).filter(Boolean),
  };
}
