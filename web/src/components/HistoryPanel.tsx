import { fmtDate, money, fmtDateTime } from '../lib/format';
import { useGet } from '../lib/hooks';
import { Icon } from '../ui/Icon';
import { pretty } from '../ui/primitives';

interface Change { field: string; from?: unknown; to?: unknown }
interface Entry { id: number; action: string; user_name: string | null; created_at: string; changes: Change[] }

const MONEY_FIELDS = /(amount|value|budget|cost|price|total|received|requested|discount|rate|tds|withdrawal|deposit|balance)/;
function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'number' && MONEY_FIELDS.test(field) && !/percent|tax_rate/.test(field)) return money(v);
  if (field === 'items' && typeof v === 'string') {
    try {
      const lines = JSON.parse(v) as { description?: string; qty?: number; rate?: number }[];
      return lines.map((l) => `${l.description || 'Item'} × ${l.qty ?? 1} @ ${money(Number(l.rate ?? 0))}`).join('; ') || 'no lines';
    } catch { /* not JSON: shown as text below */ }
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDate(s);
  if (s === '1' && /^(is_|auto_|billable|active|amount_varies)/.test(field)) return 'yes';
  if (s === '0' && /^(is_|auto_|billable|active|amount_varies)/.test(field)) return 'no';
  return s.length > 90 ? `${s.slice(0, 90)}…` : pretty(s) === s ? s : s;
}
const label = (f: string): string => pretty(f.replace(/_id$/, ''));

/** Every change ever made to one record: who, when, which field, from what to what. */
export function HistoryPanel({ resource, id }: { resource: string; id: number }) {
  const q = useGet<Entry[]>('/history', { entity: resource, entity_id: id });
  const rows = q.data ?? [];
  if (q.isPending) return <div className="empty mini">Loading…</div>;
  if (!rows.length) return <div className="empty mini">No changes recorded yet. From now on every edit to this record is kept here.</div>;
  return (
    <div className="tl">
      {rows.map((h) => (
        <div className="tl-item" key={h.id}>
          <div className="tl-ico"><Icon name={h.action === 'create' ? 'plus' : h.action === 'delete' ? 'trash' : 'edit'} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="tl-meta"><b>{h.user_name ?? 'Someone'}</b> {h.action === 'create' ? 'created this' : h.action === 'delete' ? 'deleted this' : 'changed'} · <span>{fmtDateTime(h.created_at)}</span></div>
            {h.action === 'update' && h.changes.length > 0 && ( // a new record shows only who made it and when — never a dump of every field
              <ul className="hist-changes">
                {h.changes.map((c) => (
                  <li key={c.field}>
                    <span className="muted">{label(c.field)}</span>{' '}
                    {h.action === 'update' ? <><s className="faint">{show(c.field, c.from)}</s> <Icon name="arrowR" className="i hist-arrow" /> <b>{show(c.field, c.to)}</b></> : <b>{show(c.field, c.to)}</b>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
