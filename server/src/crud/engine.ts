import express, { type Request, type Response } from 'express';
import { checkDates, kindFor, normalize, check, validDate } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import { forbidden, HttpError, notFound } from '../shared/errors';
import { isFounder, type User } from '../security/permissions';
import { refOf } from './refs';
import { NONE, type Actor, type ResourceDef, type ResourceMap } from './types';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

const NICE: Record<string, string> = {
  value: 'Deal value', budget: 'Project value', tds: 'TDS', gstin: 'GSTIN', pan: 'PAN', tax_amount: 'GST amount', live_url: 'Live site', staging_url: 'Staging',
  repo_url: 'Repository', design_url: 'Design link', our_cost: 'We pay', client_price: 'Client pays', opening_balance: 'Opening balance', tax_rate: 'Tax rate',
  estimate_amount: 'Estimated amount', estimate_hours: 'Estimated hours',
};
const nice = (k: string): string => NICE[k] ?? k.replace(/_id$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Turns a request body into clean column values: right types, trimmed text, field rules, allowed values. Throws a readable 400. */
export function coerce(def: ResourceDef, body: Record<string, unknown>, op: 'create' | 'update'): Row {
  const out: Row = {};
  for (const [k, t] of Object.entries(def.fields)) {
    if (!(k in body)) continue;
    let v = body[k];
    if (typeof v === 'string') v = v.trim();
    const empty = v === undefined || v === null || v === '';
    switch (t) {
      case 't': out[k] = empty ? null : String(v).slice(0, 20000); break;
      case 'n': {
        const n = empty ? 0 : Number(v);
        if (!Number.isFinite(n)) throw new HttpError(400, `${nice(k)} must be a number.`);
        out[k] = n;
        break;
      }
      case 'i': {
        const n = empty ? null : Number.parseInt(String(v), 10);
        if (n !== null && !Number.isInteger(n)) throw new HttpError(400, `${nice(k)} is invalid.`);
        out[k] = n;
        break;
      }
      case 'd':
        if (!empty && !validDate(String(v))) throw new HttpError(400, `${nice(k)} must be a real date (YYYY-MM-DD).`);
        out[k] = empty ? null : v;
        break;
      case 'b': out[k] = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0; break;
      case 'j': out[k] = typeof v === 'string' ? v : JSON.stringify(v ?? []); break;
    }
  }
  // field rules (letters-only names, phone digits, GSTIN, no negative money …)
  for (const k of Object.keys(out)) {
    const kind = kindFor(def.table, k);
    if (!kind) continue;
    out[k] = normalize(kind, out[k]);
    const msg = check(kind, out[k]);
    if (msg) throw new HttpError(400, `${nice(k)} ${msg}.`);
  }
  for (const k of def.notNull ?? []) if (k in out && out[k] === null) delete out[k]; // keep the database default
  for (const [k, allowed] of Object.entries(def.enums ?? {})) {
    if (out[k] != null && !allowed.includes(out[k] as string)) throw new HttpError(400, `${k.replace(/_/g, ' ')} must be one of: ${allowed.join(', ')}.`);
  }
  if (op === 'create') for (const k of def.required ?? []) if (out[k] === undefined || out[k] === null) throw new HttpError(400, `${k.replace(/_id$/, '').replace(/_/g, ' ')} is required.`);
  if (op === 'update') for (const k of def.required ?? []) if (k in out && out[k] === null) throw new HttpError(400, `${k.replace(/_/g, ' ')} cannot be empty.`);
  return out;
}

/** Parses JSON columns, adds the system ID, and hides money fields from interns. */
export function shape(def: ResourceDef, row: Row | undefined, user: User): Row | undefined {
  if (!row) return row;
  for (const k of def.json ?? []) {
    try { row[k] = JSON.parse(row[k] || '[]'); } catch { row[k] = []; }
  }
  const ref = refOf(def.table, row);
  if (ref) row.ref = ref;
  if (!isFounder(user)) for (const k of def.founderCols ?? []) delete row[k];
  return row;
}

export interface ListOptions {
  limit?: number;
  /** Ignore the page-size cap (CSV export, internal reports). */
  all?: boolean;
  offset?: number;
  q?: string;
  sort?: string;
  query?: Record<string, unknown>;
}

const likeEscape = (q: string): string => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

/** Engine: one instance per app. Holds the resource registry and exposes the lookups other modules need. */
export function createEngine(ctx: AppContext, resources: ResourceMap) {
  const { db } = ctx;

  function scoped(name: string, id: number | string, user: User): { def: ResourceDef; row: Row } | null {
    const def = resources[name];
    if (!def) return null;
    const sc = def.scope(user);
    const row = db.prepare(`${def.select} WHERE ${def.alias}.id=? AND (${sc.where})`).get(Number(id), ...sc.params) as Row | undefined;
    return row ? { def, row } : null;
  }

  function buildWhere(def: ResourceDef, user: User, opts: ListOptions): { sql: string; params: unknown[] } {
    const sc = def.scope(user);
    if (sc.where === NONE.where) throw forbidden();
    let sql = `(${sc.where})`;
    const params = [...sc.params];
    for (const [k, col] of Object.entries(def.filters ?? {})) {
      const raw = opts.query?.[k];
      const v = raw === undefined || raw === null ? '' : String(raw);
      if (v === '') continue;
      if (typeof col === 'function') {
        const c = col(v);
        sql += ` AND ${c.sql}`;
        params.push(...c.params);
      } else if (v === 'null') sql += ` AND ${col} IS NULL`;
      else if (v.includes(',')) {
        const parts = v.split(',');
        sql += ` AND ${col} IN (${parts.map(() => '?').join(',')})`;
        params.push(...parts);
      } else {
        sql += ` AND ${col} = ?`;
        params.push(v);
      }
    }
    if (def.dateField) {
      const from = opts.query?.from;
      const to = opts.query?.to;
      if (typeof from === 'string' && validDate(from)) { sql += ` AND ${def.dateField} >= ?`; params.push(from); }
      if (typeof to === 'string' && validDate(to)) { sql += ` AND ${def.dateField} <= ?`; params.push(to); }
    }
    const q = (opts.q ?? '').trim().slice(0, 100);
    if (q && def.search.length) {
      sql += ` AND (${def.search.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`;
      params.push(...def.search.map(() => likeEscape(q)));
    }
    return { sql, params };
  }

  function orderBy(def: ResourceDef, sort?: string): string {
    if (sort) {
      const [key, dir] = sort.split(':');
      const col = key && Object.hasOwn(def.sortable ?? {}, key) ? def.sortable?.[key] : undefined;
      if (col) return `${col} ${dir === 'desc' ? 'DESC' : 'ASC'}, ${def.alias}.id ${dir === 'desc' ? 'DESC' : 'ASC'}`;
    }
    return def.order;
  }

  function list(name: string, user: User, opts: ListOptions = {}): { rows: Row[]; total: number } {
    const def = resources[name];
    if (!def) throw notFound('Unknown resource');
    const { sql, params } = buildWhere(def, user, opts);
    const limit = opts.all ? 1_000_000 : Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(Math.trunc(opts.offset ?? 0) || 0, 0);
    const total = (db.prepare(`SELECT COUNT(*) AS n ${def.from} WHERE ${sql}`).get(...params) as { n: number }).n;
    const rows = db.prepare(`${def.select} WHERE ${sql} ORDER BY ${orderBy(def, opts.sort)} LIMIT ? OFFSET ?`).all(...params, limit, offset) as Row[];
    return { rows: rows.map((r) => shape(def, r, user) as Row), total };
  }

  /** A filtered, scoped slice of a resource for internal reports (dashboards): `where` is trusted SQL, values go in `params`. */
  function query(name: string, user: User, where = '1=1', params: unknown[] = [], limit = 50, order?: string): Row[] {
    const def = resources[name];
    if (!def) throw notFound('Unknown resource');
    const sc = def.scope(user);
    if (sc.where === NONE.where) return [];
    const rows = db.prepare(`${def.select} WHERE (${sc.where}) AND (${where}) ORDER BY ${order ?? def.order} LIMIT ?`).all(...sc.params, ...params, limit) as Row[];
    return rows.map((r) => shape(def, r, user) as Row);
  }

  const getRow = (def: ResourceDef, id: number): Row | undefined => db.prepare(`${def.select} WHERE ${def.alias}.id=?`).get(id) as Row | undefined;

  function create(name: string, actor: Actor): Row {
    const def = resources[name];
    if (!def) throw notFound('Unknown resource');
    const { user, body } = actor;
    if (!def.can(user, 'create', null, body)) throw forbidden();
    const data = coerce(def, body, 'create');
    def.before?.('create', data, null, actor);
    const dmsg = checkDates(def.table, data);
    if (dmsg) throw new HttpError(400, dmsg);
    const cols = Object.keys(data);
    const run = db.transaction(() => {
      const id = Number(db.prepare(`INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => data[c])).lastInsertRowid);
      const row = getRow(def, id) as Row;
      def.after?.('create', row, null, actor);
      return id;
    });
    const id = run();
    const row = getRow(def, id) as Row;
    ctx.audit(user, 'create', def.table, id, def.label(row), actor.ip);
    return shape(def, row, user) as Row;
  }

  function update(name: string, id: number, actor: Actor): Row {
    const def = resources[name];
    if (!def) throw notFound('Unknown resource');
    const hit = scoped(name, id, actor.user);
    if (!hit) throw notFound();
    const existing = hit.row;
    if (!def.can(actor.user, 'update', existing, actor.body)) throw forbidden();
    const data = coerce(def, actor.body, 'update');
    def.before?.('update', data, existing, actor);
    const dmsg = checkDates(def.table, { ...existing, ...data });
    if (dmsg) throw new HttpError(400, dmsg);
    const cols = Object.keys(data);
    db.transaction(() => {
      if (cols.length) {
        db.prepare(`UPDATE ${def.table} SET ${cols.map((c) => `${c}=?`).join(',')}${def.timestamps ? ",updated_at=datetime('now')" : ''} WHERE id=?`).run(...cols.map((c) => data[c]), existing.id);
      }
      def.after?.('update', getRow(def, existing.id) as Row, existing, actor);
    })();
    const row = getRow(def, existing.id) as Row;
    ctx.audit(actor.user, 'update', def.table, existing.id, def.label(row), actor.ip);
    return shape(def, row, actor.user) as Row;
  }

  function remove(name: string, id: number, actor: Actor): void {
    const def = resources[name];
    if (!def) throw notFound('Unknown resource');
    const hit = scoped(name, id, actor.user);
    if (!hit) throw notFound();
    if (!def.can(actor.user, 'delete', hit.row, actor.body)) throw forbidden();
    def.beforeDelete?.(hit.row.id, hit.row, actor);
    db.transaction(() => {
      db.prepare(`DELETE FROM ${def.table} WHERE id=?`).run(hit.row.id);
      def.onDelete?.(hit.row.id, hit.row);
    })();
    ctx.audit(actor.user, 'delete', def.table, hit.row.id, def.label(hit.row), actor.ip);
  }

  return { scoped, list, query, create, update, remove, resources };
}
export type Engine = ReturnType<typeof createEngine>;

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  const formula = /^[=+\-@]/.test(s);
  return /[",\n\r]/.test(s) || formula ? `"${(formula ? "'" : '') + s.replace(/"/g, '""')}"` : s;
};

/** A whole number, or undefined: "12abc" and "1 OR 1=1" are not numbers. */
const intParam = (v: unknown): number | undefined => (/^-?\d{1,15}$/.test(String(v ?? '')) ? Number(v) : undefined);

/** REST endpoints for every resource: GET /:res (paged), /:res/export.csv, /:res/:id, POST, PUT, DELETE. */
export function crudRouter(ctx: AppContext, engine: Engine): express.Router {
  const router = express.Router();
  const actorOf = (req: Request): Actor => ({ user: req.user as User, ip: req.ip, body: (req.body ?? {}) as Record<string, unknown> });
  const idOf = (req: Request): number => {
    const id = intParam(req.params.id);
    if (id === undefined) throw notFound();
    return id;
  };
  const known = (req: Request): string => {
    const name = String(req.params.res);
    if (!Object.hasOwn(engine.resources, name)) throw notFound('Unknown resource');
    return name;
  };

  router.get('/:res', (req: Request, res: Response) => {
    const name = known(req);
    const { rows, total } = engine.list(name, req.user as User, {
      limit: intParam(req.query.limit), offset: intParam(req.query.offset), q: typeof req.query.q === 'string' ? req.query.q : '',
      sort: typeof req.query.sort === 'string' ? req.query.sort : undefined, query: req.query as Record<string, unknown>,
    });
    res.setHeader('X-Total-Count', String(total));
    res.json(rows);
  });

  router.get('/:res/export.csv', (req: Request, res: Response) => {
    const name = known(req);
    const user = req.user as User;
    if (!isFounder(user)) throw forbidden();
    const { rows } = engine.list(name, user, { all: true, query: req.query as Record<string, unknown> });
    const def = engine.resources[name] as ResourceDef;
    const cols = rows.length ? Object.keys(rows[0] as Row).filter((k) => !(def.json ?? []).includes(k)) : [];
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');
    ctx.audit(user, 'export', def.table, null, `${rows.length} rows`, req.ip);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${def.table}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\uFEFF${csv}`);
  });

  router.get('/:res/:id', (req: Request, res: Response) => {
    const name = known(req);
    const hit = engine.scoped(name, idOf(req), req.user as User);
    if (!hit) throw notFound();
    res.json(shape(hit.def, hit.row, req.user as User));
  });

  router.post('/:res', (req: Request, res: Response) => {
    res.status(201).json(engine.create(known(req), actorOf(req)));
  });

  router.put('/:res/:id', (req: Request, res: Response) => {
    res.json(engine.update(known(req), idOf(req), actorOf(req)));
  });

  router.delete('/:res/:id', (req: Request, res: Response) => {
    engine.remove(known(req), idOf(req), actorOf(req));
    res.json({ ok: true });
  });

  return router;
}
