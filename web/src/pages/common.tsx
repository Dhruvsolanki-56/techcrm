import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useEditor } from '../forms/RecordEditor';
import { ExportMenu } from '../ui/ExportMenu';
import type { Row } from '../lib/api';
import { money } from '../lib/format';
import type { Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';

/** The pencil at the end of a row; opens the standard edit form for the resource. */
export function EditBtn({ resource, row, canDelete }: { resource: string; row: Row; canDelete?: boolean }) {
  const editor = useEditor();
  return (
    <button type="button" className="btn sm icon ghost" aria-label={`Edit ${String(row.ref ?? '')}`} title="Edit" onClick={(e) => { e.stopPropagation(); editor.open({ resource, record: row, canDelete }); }}>
      <Icon name="edit" />
    </button>
  );
}

export const editCol = (resource: string, canDelete?: boolean): Column => ({
  key: '_edit', label: '', cls: 'nowrap right', width: '40px',
  render: (r) => <EditBtn resource={resource} row={r} canDelete={canDelete} />,
});

export function AddBtn({ resource, label, defaults, quiet }: { resource: string; label: string; defaults?: Record<string, unknown>; quiet?: boolean }) {
  const editor = useEditor();
  return <button type="button" className={`btn ${quiet ? '' : 'primary'}`} onClick={() => editor.open({ resource, defaults })}><Icon name="plus" />{label}</button>;
}

export const ExportBtn = ({ resource, params }: { resource: string; params?: Record<string, unknown> }) => <ExportMenu path={`/${resource}/export`} params={params} />;

export const Amount = ({ v, neg, dash }: { v: unknown; neg?: boolean; dash?: boolean }) => (
  dash && !Number(v) ? <span className="faint">—</span> : <span className={`tnum ${neg ? 'neg' : ''}`}>{money(v)}</span>
);

export const Cell2 = ({ top, sub }: { top: ReactNode; sub?: ReactNode }) => <div><div className="t1 ellipsis">{top}</div>{sub ? <div className="t2 ellipsis">{sub}</div> : null}</div>;

export const LinkTo = ({ to, children }: { to: string; children: ReactNode }) => <Link className="ln" to={to} onClick={(e) => e.stopPropagation()}>{children}</Link>;

/** A client / project / invoice / lead name that is always a real link when we know which record it is. */
export const ClientLink = ({ id, name, tab }: { id?: unknown; name?: unknown; tab?: string }) => (id ? <LinkTo to={`/clients/${String(id)}${tab ? `?tab=${tab}` : ''}`}>{String(name ?? '—')}</LinkTo> : <>{String(name ?? '')}</>);
export const ProjectLink = ({ id, name, tab }: { id?: unknown; name?: unknown; tab?: string }) => (id ? <LinkTo to={`/projects/${String(id)}${tab ? `?tab=${tab}` : ''}`}>{String(name ?? '—')}</LinkTo> : <>{String(name ?? '')}</>);
export const InvoiceLink = ({ id, number }: { id?: unknown; number?: unknown }) => (id ? <LinkTo to={`/invoices/${String(id)}`}>{String(number ?? '—')}</LinkTo> : <>{String(number ?? '')}</>);

export const dash = (v: unknown): ReactNode => (v == null || v === '' ? <span className="faint">—</span> : String(v));
