import { toPdf, toXlsx } from '../modules/exporters';
import express, { type Request, type Response } from 'express';
import { checkDates, kindFor, normalize, check, validDate, today } from '@crm/shared';
import type { AppContext } from '../core/context';
import type { Row } from '../db/connection';
import { forbidden, HttpError, notFound } from '../shared/errors';
import { isFounder, type User } from '../security/permissions';
import { ENTITY_TYPE, purgeEntity } from '../domain/entities';
import { refOf } from './refs';
import { NONE, type Actor, type ResourceDef, type ResourceMap } from './types';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

const NICE: Record<string, string> = {
  value: 'Deal value', budget: 'Project value', tds: 'TDS', pan: 'PAN', live_url: 'Live site', staging_url: 'Staging',
  repo_url: 'Repository', design_url: 'Design link', our_cost: 'We pay', client_price: 'Client pays', opening_balance: 'Opening balance',
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
  // field rules (letters-only names, phone digits, no negative money …)
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

  const SKIP = new Set(['updated_at', 'created_at', 'created_by']);
  const logHistory = (table: string, id: number, user: User, action: string, changes: { field: string; from?: unknown; to?: unknown }[]): void => {
    if (action === 'update' && !changes.length) return;
    db.prepare('INSERT INTO history(entity,entity_id,action,user_id,user_name,changes) VALUES(?,?,?,?,?,?)').run(table, id, action, user.id, user.name, JSON.stringify(changes));
  };
  const plain = (v: unknown): unknown => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v ?? null);

  const getRow = (def: ResourceDef, id: number): Row | undefined => db.prepare(`${def.select} WHERE ${def.alias}.id=?`).get(id) as Row | undefined;

  // The same person sending the very same new record twice within a moment is a double click or a retry, not two records: the first one is returned.
  const recent = new Map<string, { id: number; at: number }>();
  function create(name: string, actor: Actor): Row {
    const def = resources[name];
    if (!def) throw notFound('Unknown resource');
    const { user, body } = actor;
    if (!def.can(user, 'create', null, body)) throw forbidden();
    const sig = `${user.id}|${def.table}|${JSON.stringify(body)}`;
    const seen = recent.get(sig);
    const nowMs = Date.now();
    if (seen && nowMs - seen.at < 3000) {
      const again = getRow(def, seen.id);
      if (again && again.status !== 'cancelled') return shape(def, again, user) as Row;
    }
    for (const [k, v] of recent) if (nowMs - v.at > 10_000) recent.delete(k);
    const data = coerce(def, body, 'create');
    def.before?.('create', data, null, actor);
    const dmsg = checkDates(def.table, data);
    if (dmsg) throw new HttpError(400, dmsg);
    const cols = Object.keys(data);
    const run = db.transaction(() => {
      const id = Number(db.prepare(`INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => data[c])).lastInsertRowid);
      db.prepare('DELETE FROM history WHERE entity=? AND entity_id=?').run(def.table, id); // never inherit the history of an earlier, deleted record that had this id
      const row = getRow(def, id) as Row;
      def.after?.('create', row, null, actor);
      return id;
    });
    const id = run();
    recent.set(sig, { id, at: Date.now() });
    const row = getRow(def, id) as Row;
    logHistory(def.table, id, user, 'create', Object.keys(data).filter((k) => !SKIP.has(k) && data[k] !== null && data[k] !== '').map((k) => ({ field: k, to: plain(data[k]) })));
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
    const same = (a: unknown, b: unknown): boolean => String(plain(a) ?? '') === String(plain(b) ?? '');
    logHistory(def.table, existing.id, actor.user, 'update', cols.filter((k) => !SKIP.has(k) && !same(existing[k], data[k])).map((k) => ({ field: k, from: plain(existing[k]), to: plain(data[k]) })));
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
      const type = ENTITY_TYPE[def.table];
      if (type) purgeEntity(ctx, type, hit.row.id); // its files and notes go with it
    })();
    // the record is gone, and its id may be handed to the next new record: its field history must not follow that id (the activity log keeps the deletion)
    db.prepare('DELETE FROM history WHERE entity=? AND entity_id=?').run(def.table, hit.row.id);
    ctx.audit(actor.user, 'delete', def.table, hit.row.id, def.label(hit.row), actor.ip);
  }

  /** A link to another record is shown by its name ("RotoTech Systems"), never as a bare number. */
  const NAME_OF: Record<string, [string, string]> = {
    client_id: ['clients', 'company'], project_id: ['projects', 'name'], account_id: ['accounts', 'name'], pay_account_id: ['accounts', 'name'], to_account_id: ['accounts', 'name'],
    grant_id: ['grants', 'name'], invoice_id: ['invoices', 'number'], quote_id: ['quotes', 'number'], change_request_id: ['change_requests', 'title'], renewal_id: ['renewals', 'name'],
    lead_id: ['leads', "COALESCE(NULLIF(company,''), name)"], owner_id: ['users', 'name'], manager_id: ['users', 'name'], assignee_id: ['users', 'name'], paid_by_id: ['users', 'name'],
    account_manager_id: ['users', 'name'], user_id: ['users', 'name'], created_by: ['users', 'name'],
  };
  const readable = (field: string, v: unknown): unknown => {
    const m = NAME_OF[field];
    if (!m || v === null || v === undefined || v === '') return v;
    const hit = db.prepare(`SELECT ${m[1]} AS n FROM ${m[0]} WHERE id=?`).get(v) as { n: string } | undefined;
    return hit?.n ?? `${m[0].replace(/s$/, '')} #${String(v)} (removed)`;
  };

  /** Who changed what on one record, newest first. */
  function historyOf(name: string, id: number, user: User): Row[] {
    if (!scoped(name, id, user)) throw notFound();
    const def = resources[name] as ResourceDef;
    return (db.prepare('SELECT * FROM history WHERE entity=? AND entity_id=? ORDER BY id DESC LIMIT 200').all(def.table, id) as Row[]).map((r) => {
      let changes: { field: string; from?: unknown; to?: unknown }[] = [];
      try { changes = JSON.parse(r.changes || '[]'); } catch { /* empty */ }
      if (!isFounder(user)) changes = changes.filter((c) => !(def.founderCols ?? []).includes(c.field));
      if (r.action === 'create') {
        // a new record's story is what a person typed, not the numbers the system worked out from it
        const noise = new Set(['number', 'subtotal', 'tax_amount', 'tax_type', 'tax_rate', 'total', 'currency', 'terms', 'paid_amount', 'import_key']);
        changes = changes.filter((c) => !noise.has(c.field) && !(c.field === 'discount' && Number(c.to) === 0));
      }
      return { ...r, changes: changes.map((c) => ({ ...c, from: readable(c.field, c.from), to: readable(c.field, c.to) })) };
    });
  }

  return { scoped, list, query, create, update, remove, historyOf, resources };
}
export type Engine = ReturnType<typeof createEngine>;

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

  router.get('/history', (req: Request, res: Response) => {
    const name = String(req.query.entity ?? '');
    if (!Object.hasOwn(engine.resources, name)) throw notFound('Unknown resource');
    const id = intParam(req.query.entity_id);
    if (id === undefined) throw notFound();
    res.json(engine.historyOf(name, id, req.user as User));
  });

  router.get('/:res', (req: Request, res: Response) => {
    const name = known(req);
    const { rows, total } = engine.list(name, req.user as User, {
      limit: intParam(req.query.limit), offset: intParam(req.query.offset), q: typeof req.query.q === 'string' ? req.query.q : '',
      sort: typeof req.query.sort === 'string' ? req.query.sort : undefined, query: req.query as Record<string, unknown>,
    });
    res.setHeader('X-Total-Count', String(total));
    res.json(rows);
  });

  /** Excel or PDF of exactly what the list shows (same filters and search), every matching row. */
  const exportList = (format: 'xlsx' | 'pdf') => async (req: Request, res: Response): Promise<void> => {
    const name = known(req);
    const user = req.user as User;
    if (!isFounder(user)) throw forbidden();
    const { rows } = engine.list(name, user, { all: true, q: typeof req.query.q === 'string' ? req.query.q : '', sort: typeof req.query.sort === 'string' ? req.query.sort : undefined, query: req.query as Record<string, unknown> });
    const def = engine.resources[name] as ResourceDef;
    if (rows.length > 50_000) rows.length = 50_000; // an export is for reading, and a spreadsheet that size is not; narrow it with a filter
    const title = def.table.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    const file = `${def.table}-${today()}.${format}`;
    const filters = Object.entries(req.query).filter(([k, v]) => typeof v === 'string' && v && !['q', 'sort', 'limit', 'offset'].includes(k)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`);
    const note = [typeof req.query.q === 'string' && req.query.q ? `search “${req.query.q}”` : '', ...filters].filter(Boolean).join(' · ') || undefined;
    const body = format === 'xlsx' ? await toXlsx(title, rows, note, def.table, user.name) : await toPdf(title, def.table, rows, note, user.name);
    ctx.audit(user, 'export', def.table, null, `${rows.length} rows (${format})`, req.ip);
    res.setHeader('Content-Type', format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.send(body);
  };
  router.get('/:res/export.xlsx', exportList('xlsx'));
  router.get('/:res/export.pdf', exportList('pdf'));

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
