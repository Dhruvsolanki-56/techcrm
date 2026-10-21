import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DateInput } from './DateInput';
import { api, qs, type Row } from '../lib/api';
import { plural } from '../lib/format';
import { lookupOptions } from '../forms/Fields';
import type { LookupName, OptionList } from '../forms/schema';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { ExportMenu } from './ExportMenu';
import { Ref } from './primitives';

export interface Column<T = Row> {
  key: string;
  label: string;
  render?(r: T): ReactNode;
  /** Server sort key (must be in the resource's sortable list). Omit for an unsortable column. */
  sort?: string;
  num?: boolean;
  cls?: string;
  width?: string;
}
export interface FilterDef { key: string; label: string; options?: OptionList; lookup?: LookupName }

interface Props<T> {
  resource: string;
  /** Fixed query parameters (e.g. client_id of the page you are on). */
  query?: Record<string, unknown>;
  columns: Column<T>[];
  filters?: FilterDef[];
  searchPlaceholder?: string;
  noSearch?: boolean;
  /** The page already has a Filters button: it decides when this table's filters show on a phone. */
  filtersOpen?: boolean;
  pageSize?: number;
  defaultSort?: string;
  onRow?(r: T): void;
  toolbar?: ReactNode;
  empty?: { title: string; text?: string };
  noun?: string;
  /** Hide the leading system-ID column. */
  noRef?: boolean;
  compact?: boolean;
  /** Called with the rows of the current page (for page-level numbers). */
  onRows?(rows: T[], total: number): void;
  footer?(rows: T[]): ReactNode;
  initialFilters?: Record<string, string>;
  /** Set false for lists that have no Excel / PDF export. */
  exportable?: boolean;
  /** Show From / To date inputs (filters on the resource's main date). */
  dates?: boolean;
}

const NO_EXPORT = new Set(['tasks', 'contacts', 'events']);

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** A server-paginated, searchable, sortable list of any resource. */
export function DataTable<T extends Row = Row>({
  resource, query, columns, filters = [], searchPlaceholder = 'Search…', noSearch, filtersOpen, pageSize = 25, defaultSort, onRow, toolbar, empty, noun = 'record', noRef, compact, onRows, footer, initialFilters, exportable = true, dates,
}: Props<T>) {
  const { lookups, isFounder } = useSession();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const [filt, setFilt] = useState<Record<string, string>>(initialFilters ?? {});
  const [sort, setSort] = useState<string | null>(defaultSort ?? null);
  const [page, setPage] = useState(0);

  useEffect(() => setPage(0), [dq, filt, sort, JSON.stringify(query)]);

  const params = { ...query, ...filt, q: dq || (query?.q as string | undefined), sort: sort ?? undefined, limit: pageSize, offset: page * pageSize };
  const res = useQuery({
    queryKey: ['list', resource, params],
    queryFn: () => api.page<T>(`/${resource}${qs(params)}`),
    placeholderData: keepPreviousData,
  });
  const rows = res.data?.rows ?? [];
  const total = res.data?.total ?? 0;
  useEffect(() => { if (res.data) onRows?.(res.data.rows, res.data.total); }, [res.data]);

  const showRef = !noRef && !compact && rows.length > 0 && rows[0] && (rows[0] as Row).ref != null && !columns.some((c) => c.key === 'ref');
  const cols = useMemo<Column<T>[]>(() => (showRef ? [{ key: 'ref', label: 'ID', cls: 'opt nowrap', sort: 'id', render: (r: T) => <Ref value={r.ref} /> }, ...columns] : columns), [showRef, columns]);
  const [sk, sdir] = (sort ?? '').split(':');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = !!dq || Object.values(filt).some(Boolean);

  const toggleSort = (c: Column<T>) => {
    if (!c.sort) return;
    setSort(sk === c.sort ? (sdir === 'desc' ? `${c.sort}:asc` : `${c.sort}:desc`) : `${c.sort}:asc`);
  };
  const [ownFilters, setShowFilters] = useState(false);
  const showFilters = filtersOpen ?? ownFilters;
  const mainKey = columns.find((c) => !(c.cls ?? '').includes('opt') && c.label)?.key;
  const filterCount = Object.entries(filt).filter(([, v]) => v).length;
  const fopts = (f: FilterDef) => (f.lookup ? lookupOptions(lookups, f.lookup).map((o) => ({ v: String(o.v), l: o.l })) : (f.options ?? []).map((o) => (typeof o === 'string' ? { v: o, l: o } : { v: o[0], l: o[1] })));

  return (
    <>
      <div className="toolbar">
        {!noSearch && !compact && <input type="search" placeholder={searchPlaceholder} aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />}
        {(filters.length > 0 || (dates && !compact)) && !compact && filtersOpen === undefined && (
          <button type="button" className={`btn tb-filter-btn${filterCount ? ' on' : ''}`} aria-expanded={showFilters} onClick={() => setShowFilters((o) => !o)}>
            <Icon name="list" />Filters{filterCount ? <span className="tb-count">{filterCount}</span> : null}
          </button>
        )}
        <div className={`tb-filters${showFilters ? ' open' : ''}`}>
        {filters.map((f) => (
          <select key={f.key} aria-label={f.label} value={filt[f.key] ?? ''} onChange={(e) => setFilt((x) => ({ ...x, [f.key]: e.target.value }))}>
            <option value="">{f.label}</option>
            {fopts(f).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        ))}
        {dates && !compact && (
          <>
            <label className="inline-sel"><span className="muted small">From</span><DateInput aria-label="From date" value={filt.from ?? ''} onChange={(e) => setFilt((x) => ({ ...x, from: e.target.value }))} /></label>
            <label className="inline-sel"><span className="muted small">To</span><DateInput aria-label="To date" value={filt.to ?? ''} onChange={(e) => setFilt((x) => ({ ...x, to: e.target.value }))} /></label>
          </>
        )}
        </div>
        <span className="grow" />
        {isFounder && exportable && !compact && !NO_EXPORT.has(resource) && <ExportMenu path={`/${resource}/export`} params={params} />}
        {toolbar}
      </div>
      <div className="tbl" aria-busy={res.isFetching}>
        {res.isError ? (
          <div className="empty"><b>Could not load</b>{(res.error as Error).message}</div>
        ) : res.isPending ? (
          <div>{Array.from({ length: 6 }, (_, i) => <div className="sk-row" key={i}><span className="sk" style={{ width: '40%', height: 10 }} /><span className="sk" style={{ width: '20%', height: 10 }} /></div>)}</div>
        ) : !rows.length ? (
          <div className="empty"><b>{filtered ? 'No matches' : (empty?.title ?? 'Nothing here yet')}</b>{filtered ? 'Try a different search or clear the filters.' : empty?.text}</div>
        ) : (
          <>
            <div className="tbl-scroll" tabIndex={0} style={{ opacity: res.isPlaceholderData ? 0.6 : 1, transition: 'opacity .15s' }}>
              <table className="t cards">
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c.key} className={`${c.num ? 'num' : ''} ${c.cls ?? ''} ${c.sort ? 'sortable' : ''}`} style={c.width ? { width: c.width } : undefined}
                        aria-sort={c.sort && sk === c.sort ? (sdir === 'desc' ? 'descending' : 'ascending') : undefined}
                        onClick={() => toggleSort(c)}>
                        {c.label}{c.sort && sk === c.sort && <span className="arr">{sdir === 'desc' ? '↓' : '↑'}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={onRow ? 'click' : ''} onClick={(e) => { if (onRow && !(e.target as HTMLElement).closest('a, button, input, select')) onRow(r); }}>
                      {cols.map((c) => <td key={c.key} data-label={c.label} className={`${c.num ? 'num' : ''} ${c.cls ?? ''}${c.key === mainKey ? ' main' : ''}`}>{c.render ? c.render(r) : String(r[c.key] ?? '—')}</td>)}
                    </tr>
                  ))}
                </tbody>
                {footer && <tfoot>{footer(rows)}</tfoot>}
              </table>
            </div>
            {(!compact || total > pageSize) && (
              <div className="tbl-foot">
                <span>{total > pageSize ? `${page * pageSize + 1}–${page * pageSize + rows.length} of ${total}` : plural(total, noun)}</span>
                {total > pageSize && (
                  <span className="row">
                    <button type="button" className="btn sm icon" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><Icon name="arrowL" /></button>
                    <span className="small muted">Page {page + 1} of {pages}</span>
                    <button type="button" className="btn sm icon" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}><Icon name="arrowR" /></button>
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
