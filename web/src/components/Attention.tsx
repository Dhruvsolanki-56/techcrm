import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { Icon } from '../ui/Icon';

export type Severity = 'critical' | 'high' | 'normal';
export interface AttentionChild { title: string; detail?: string; link: string }
export interface AttentionItem { key: string; severity: Severity; area: string; title: string; detail: string; link: string; date?: string | null; amount?: number; count?: number; children?: AttentionChild[]; panel?: boolean }
export interface AttentionData { items: AttentionItem[]; counts: Record<Severity, number>; total: number }

export const useAttention = () => useQuery({ queryKey: ['attention'], queryFn: () => api.get<AttentionData>('/attention'), refetchInterval: 120_000, staleTime: 30_000 });

/** Plain words for how soon something needs you. */
export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Urgent', high: 'This week', normal: 'Tidy-up' };
const AREA_ICON: Record<string, string> = { Money: 'receipt', Sales: 'target', Delivery: 'briefcase', Support: 'tool', Admin: 'settings' };
export const AREA_HELP: Record<string, string> = {
  Money: 'Invoices to send or chase, accepted quotations, TDS',
  Sales: 'Leads to call, quotations waiting for an answer',
  Delivery: 'Deadlines, tasks and change requests',
  Support: 'Open maintenance items',
  Admin: 'Renewals, documents, grant reports',
};

export function SeverityDot({ s }: { s: Severity }) {
  return <span className={`sev sev-${s}`} title={SEVERITY_LABEL[s]} aria-label={SEVERITY_LABEL[s]} />;
}
export const SeverityPill = ({ s }: { s: Severity }) => <span className={`sev-pill sev-pill-${s}`}>{SEVERITY_LABEL[s]}</span>;

/** One thing to act on. A rolled-up item ("5 hot leads not contacted") opens to show the individual records. */
export function AttentionRow({ i, pill }: { i: AttentionItem; pill?: boolean }) {
  const [open, setOpen] = useState(false);
  const head = (
    <>
      {pill ? <SeverityPill s={i.severity} /> : <SeverityDot s={i.severity} />}
      {!pill && <span className="att-area"><Icon name={AREA_ICON[i.area] ?? 'alert'} />{i.area}</span>}
      <div className="grow"><div className="t">{i.title}</div><div className="s">{i.detail}</div></div>
      {i.amount ? <b className="tnum small">{money(i.amount)}</b> : null}
      {i.date ? <span className="small muted nowrap">{fmtDate(i.date)}</span> : null}
    </>
  );
  if (!i.children?.length) return <Link to={i.link} className="li att-row">{head}<Icon name="arrowR" /></Link>;
  return (
    <div className="att-grp">
      <button type="button" className="li att-row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{head}<span className={`att-chev${open ? ' open' : ''}`}><Icon name="chevDown" /></span></button>
      {open && (
        <div className="att-kids">
          {i.children.map((c) => <Link key={c.link + c.title} to={c.link} className="att-kid"><b>{c.title}</b>{c.detail ? <span className="muted small">{c.detail}</span> : null}<Icon name="arrowR" /></Link>)}
          <Link to={i.link} className="att-all">Open the full list →</Link>
        </div>
      )}
    </div>
  );
}
