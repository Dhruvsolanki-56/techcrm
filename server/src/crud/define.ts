import type { ResourceDef } from './types';

/** Fills in the computed parts of a resource definition. */
export function defineResource(def: Omit<ResourceDef, 'select'>): ResourceDef {
  return { ...def, select: `SELECT ${def.columns} ${def.from}` };
}

/** Escapes a value for use inside an IN (...) list of placeholders. */
export const inList = (ids: readonly unknown[]): string => (ids.length ? `(${ids.map(() => '?').join(',')})` : '(NULL)');
