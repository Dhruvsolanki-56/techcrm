import type { Row } from '../db/connection';
import type { User } from '../security/permissions';

/** t = text, n = number, i = id / integer, d = date (YYYY-MM-DD), b = yes/no, j = JSON */
export type FieldType = 't' | 'n' | 'i' | 'd' | 'b' | 'j';

export interface Scope {
  where: string;
  params: unknown[];
}
export const ALL: Scope = { where: '1=1', params: [] };
export const NONE: Scope = { where: '1=0', params: [] };

export type Operation = 'create' | 'update' | 'delete';

/** Who made the request and what they sent — handed to every hook. */
export interface Actor {
  user: User;
  ip?: string;
  body: Record<string, unknown>;
}

export type FilterFn = (value: string) => { sql: string; params: unknown[] };

/** Declarative description of one kind of record. The engine turns it into list / read / create / edit / delete endpoints. */
export interface ResourceDef {
  table: string;
  alias: string;
  /** Human label for the activity log. */
  label(row: Row): string;
  /** Writable fields and their types. Anything else in a request is ignored. */
  fields: Record<string, FieldType>;
  required?: string[];
  /** Fields that fall back to the column default when sent empty. */
  notNull?: string[];
  enums?: Record<string, readonly string[]>;
  /** Select list, e.g. "l.*, u.name AS owner_name". */
  columns: string;
  /** "FROM leads l LEFT JOIN users u ON …" (no WHERE / ORDER). */
  from: string;
  /** Computed by defineResource: SELECT columns + from. */
  select: string;
  /** Columns searched by ?q= (LIKE). */
  search: string[];
  filters?: Record<string, string | FilterFn>;
  /** Sort keys the client may ask for (?sort=key:asc|desc) → SQL expression. */
  sortable?: Record<string, string>;
  /** Default ORDER BY. */
  order: string;
  /** Column used by ?from= / ?to= date-range filters. */
  dateField?: string;
  json?: string[];
  /** Money columns removed from responses for non-founders. */
  founderCols?: string[];
  /** Table has an updated_at column. */
  timestamps?: boolean;
  scope(user: User): Scope;
  can(user: User, op: Operation, existing?: Row | null, body?: Record<string, unknown>): boolean;
  before?(op: Operation, data: Row, existing: Row | null, actor: Actor): void;
  after?(op: Operation, row: Row, existing: Row | null, actor: Actor): void;
  beforeDelete?(id: number, row: Row, actor: Actor): void;
  onDelete?(id: number, row: Row): void;
  /** Extra columns that hooks write directly (kept out of the "fields" list but allowed in UPDATE). */
  extraSet?: string[];
}

export type ResourceMap = Record<string, ResourceDef>;
