import type { AppContext } from '../core/context';
import { hasFlag, isFounder, type User } from '../security/permissions';
import { NONE, type Scope } from '../crud/types';
import { inList } from '../crud/define';

/**
 * Which projects can this person see?
 * null = all of them (founders, and interns with the "all projects" switch); otherwise the ids they are on or manage.
 */
export function visibleProjectIds(ctx: AppContext, u: User): number[] | null {
  if (isFounder(u) || hasFlag(u, 'all_projects')) return null;
  return (ctx.db.prepare('SELECT project_id id FROM project_members WHERE user_id=? UNION SELECT id FROM projects WHERE manager_id=?').all(u.id, u.id) as { id: number }[]).map((r) => r.id);
}

export const founderScope = (u: User): Scope => (isFounder(u) ? { where: '1=1', params: [] } : NONE);

/** A scope that limits a column to the projects the person can see. */
export function projectScope(ctx: AppContext, u: User, column: string): Scope {
  const ids = visibleProjectIds(ctx, u);
  return ids === null ? { where: '1=1', params: [] } : { where: `${column} IN ${inList(ids)}`, params: ids };
}
