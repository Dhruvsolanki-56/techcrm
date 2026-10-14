import type { AppContext } from '../core/context';

interface Person {
  id: number;
  name: string;
}

/** Full name, or a first name that only one team member has. */
export function matchUser(users: Person[], name: string): Person | null {
  const k = String(name).trim().toLowerCase();
  const first = k.split(/\s+/)[0];
  const exact = users.find((u) => u.name.toLowerCase() === k);
  if (exact) return exact;
  const byFirst = users.filter((u) => u.name.toLowerCase().split(/\s+/)[0] === first);
  return byFirst.length === 1 ? (byFirst[0] as Person) : null;
}

/** Names that were not team members when a record was created are kept; hand the records over once that person joins. */
export function linkPeople(ctx: AppContext): number {
  const users = ctx.db.prepare('SELECT id, name FROM users WHERE active=1').all() as Person[];
  let n = 0;
  const targets: [string, string][] = [['leads', 'owner_id'], ['renewals', 'owner_id'], ['projects', 'manager_id'], ['documents', 'owner_id'], ['assets', 'assigned_to']];
  for (const [table, col] of targets) {
    const rows = ctx.db.prepare(`SELECT id, assigned_name FROM ${table} WHERE assigned_name IS NOT NULL AND ${col} IS NULL`).all() as { id: number; assigned_name: string }[];
    for (const r of rows) {
      const u = matchUser(users, r.assigned_name);
      if (!u) continue;
      ctx.db.prepare(`UPDATE ${table} SET ${col}=?, assigned_name=NULL WHERE id=?`).run(u.id, r.id);
      if (table === 'projects') ctx.db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(r.id, u.id);
      n++;
    }
  }
  return n;
}
