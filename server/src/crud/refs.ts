import type { Row } from '../db/connection';

/**
 * System-generated, never typed by hand: LD-0001, CL-0001, EXP-0001 …
 * Projects, invoices and quotes carry their own numbers.
 */
export const REF_PREFIX: Record<string, string> = {
  leads: 'LD', clients: 'CL', contacts: 'CT', tasks: 'T', documents: 'DOC', payments: 'PAY', expenses: 'EXP', accounts: 'ACC', transfers: 'TRF',
  grants: 'GR', assets: 'AST', bank_transactions: 'BNK', renewals: 'REN', maintenance_logs: 'MNT', events: 'EV', change_requests: 'CR', milestones: 'MS',
};

export function refOf(table: string, row: Row): string | null {
  if (table === 'projects') return row.code ?? null;
  if (table === 'invoices' || table === 'quotes') return row.number ?? null;
  const prefix = REF_PREFIX[table];
  return prefix ? `${prefix}-${String(row.id).padStart(4, '0')}` : null;
}

/** SQL expression producing the same ID inside a LIKE search (so "LD-0012" finds lead 12). */
export const refSql = (table: string, alias: string): string => `('${REF_PREFIX[table]}-' || printf('%04d', ${alias}.id))`;
