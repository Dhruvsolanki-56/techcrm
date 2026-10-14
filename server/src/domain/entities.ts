import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../core/context';

/** Deleting a record removes its files, notes and attached documents too. */
export function purgeEntity(ctx: AppContext, type: string, id: number): void {
  const docs = ctx.db.prepare('SELECT stored_name FROM documents WHERE entity_type=? AND entity_id=?').all(type, id) as { stored_name: string }[];
  for (const d of docs) {
    if (!d.stored_name) continue;
    try { fs.unlinkSync(path.join(ctx.config.uploadDir, d.stored_name)); } catch { /* already gone */ }
  }
  ctx.db.prepare('DELETE FROM documents WHERE entity_type=? AND entity_id=?').run(type, id);
  ctx.db.prepare('DELETE FROM notes WHERE entity_type=? AND entity_id=?').run(type, id);
}

/** A readable project code: P-26-003. */
export const projectCode = (id: number, now = new Date()): string => `P-${String(now.getFullYear()).slice(2)}-${String(id).padStart(3, '0')}`;

/** Which "entity_type" files and notes use for each table. */
export const ENTITY_TYPE: Record<string, string> = {
  leads: 'lead', clients: 'client', projects: 'project', tasks: 'task', invoices: 'invoice', quotes: 'quote', change_requests: 'change_request', expenses: 'expense',
  payments: 'payment', grants: 'grant', renewals: 'renewal', assets: 'asset', milestones: 'milestone', maintenance_logs: 'maintenance',
};
