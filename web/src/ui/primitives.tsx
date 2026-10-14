import { daysUntil } from '@crm/shared';
import type { CSSProperties, ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { fmtDate, initials } from '../lib/format';
import { Bell } from '../shell/Bell';
import { Icon } from './Icon';

/* ---------- soft, deterministic colour per name ---------- */
const TONES: [string, string][] = [['#e7f0ea', '#2c6a49'], ['#ebeef8', '#3a4d87'], ['#f6ebe2', '#8a4a20'], ['#f3eaf3', '#7b3f80'], ['#e6f0f3', '#2b6175'], ['#f4efdf', '#7a5d17'], ['#f0e9e7', '#704a3d'], ['#eaefe6', '#4c6833']];
export function tone(s: unknown): [string, string] {
  let h = 0;
  for (const c of String(s ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length] as [string, string];
}
const toneStyle = (name: unknown): CSSProperties => { const [b, f] = tone(name); return { ['--a-bg' as string]: b, ['--a-fg' as string]: f }; };

export function Avatar({ name, size }: { name: unknown; size?: 'sm' | 'lg' }) {
  return <span className={`av ${size ?? ''}`} style={toneStyle(name)} title={String(name ?? '')}>{initials(name)}</span>;
}
export function LogoSq({ name, size }: { name: unknown; size?: string }) {
  return <span className={`logo-sq ${size ?? ''}`} style={toneStyle(name)}>{initials(name)}</span>;
}
export function Who({ name, sub }: { name?: unknown; sub?: string }) {
  if (!name) return <span className="faint">—</span>;
  return <span className="who"><Avatar name={name} size="sm" /><span className="ellipsis">{String(name)}{sub && <div className="t2">{sub}</div>}</span></span>;
}
export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  return (
    <span className="av-stack">
      {names.slice(0, max).map((n) => <Avatar key={n} name={n} size="sm" />)}
      {names.length > max && <span className="av sm more">+{names.length - max}</span>}
    </span>
  );
}

/* ---------- status badges ---------- */
const STATUS_TONE: Record<string, string[]> = {
  green: ['active', 'won', 'paid', 'done', 'completed', 'accepted', 'resolved', 'approved', 'disbursed', 'past', 'delivered', 'matched'],
  red: ['overdue', 'lost', 'rejected', 'cancelled', 'lapsed', 'ended', 'failed', 'at_risk', 'archived'],
  amber: ['pending', 'partial', 'review', 'on_hold', 'expired', 'paused', 'nurture', 'planning', 'prospect', 'estimated', 'requested', 'unmatched'],
  blue: ['sent', 'in_progress', 'contacted', 'meeting', 'open', 'qualified', 'applied', 'quoted'],
  plum: ['maintenance', 'negotiation', 'proforma'],
  accent: ['proposal'],
};
const STATUS_LABEL: Record<string, string> = {
  won: 'Converted', qualified: 'Qualified', nurture: 'Nurture', closed: 'Closed', active: 'Active', in_progress: 'In progress', on_hold: 'On Hold', at_risk: 'At Risk', todo: 'To do',
  review: 'In Review', meeting: 'Demo/Meeting', proposal: 'Proposal Sent', partial: 'Part-paid', planning: 'Pending', prospect: 'Pending', past: 'Completed', archived: 'Cancelled',
};
export const pretty = (s: unknown): string => (s ? String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');

const PRIORITY: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 4 };
export function Priority({ value }: { value: unknown }) {
  const v = String(value ?? '');
  const n = PRIORITY[v] ?? 0;
  return <span className="nowrap"><span className={`pri p${n}`}><i /><i /><i /></span>{pretty(v)}</span>;
}
export function Badge({ value, label }: { value: unknown; label?: string }) {
  if (value == null || value === '') return <span className="faint">—</span>;
  const v = String(value);
  if (PRIORITY[v]) return <Priority value={v} />;
  const k = Object.keys(STATUS_TONE).find((c) => (STATUS_TONE[c] as string[]).includes(v)) ?? '';
  return <span className={`st ${k}`}>{label ?? STATUS_LABEL[v] ?? pretty(v)}</span>;
}
/** A status typed as free text in the sheets ("On Hold", "Completed") → same colours. */
export const TextStatus = ({ value }: { value: unknown }) => (value ? <Badge value={String(value).toLowerCase().replace(/\s+/g, '_')} label={String(value)} /> : <span className="faint">—</span>);
export const Heat = ({ value }: { value: unknown }) => (value ? <span className={`heat h-${String(value)}`}>{pretty(value)}</span> : null);
const FU_TONE: Record<string, string> = { Overdue: 'red', 'Due Today': 'amber', Scheduled: 'blue', Completed: 'green' };
export const FollowupStatus = ({ value }: { value: unknown }) => (value ? <span className={`st ${FU_TONE[String(value)] ?? ''}`}>{String(value)}</span> : null);

export function Due({ date, done }: { date: unknown; done?: boolean }) {
  if (!date) return <span className="faint">—</span>;
  const n = daysUntil(String(date).slice(0, 10));
  const cls = done ? '' : n < 0 ? 'late' : n <= 2 ? 'soon' : '';
  const rel = done ? '' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : '';
  return <span className={`due ${cls}`} title={fmtDate(date)}>{rel || fmtDate(date).replace(/ \d{4}$/, '')}</span>;
}

export const Ref = ({ value }: { value: unknown }) => (value ? <span className="ref">{String(value)}</span> : null);
export const RefChip = ({ value }: { value: unknown }) => (value ? <span className="ref-chip" title="System-generated ID">{String(value)}</span> : null);

export function ExtLink({ url }: { url?: unknown }) {
  if (!url) return <span className="faint">—</span>;
  const u = String(url);
  return <a className="ln" href={/^https?:\/\//.test(u) ? u : `https://${u}`} target="_blank" rel="noopener noreferrer">{u.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>;
}

/* ---------- layout pieces ---------- */
export function PageHeader({ crumbs, actions }: { crumbs: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ph">
      <div className="crumbs">{crumbs}</div>
      <div className="actions">{actions}{actions ? <span className="bell-sep" aria-hidden="true" /> : null}<Bell /></div>
    </header>
  );
}
export const Crumb = ({ to, children }: { to: string; children: ReactNode }) => <><Link to={to}>{children}</Link><span className="sep">/</span></>;

export function Panel({ title, actions, children, bodyClass = '', className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; bodyClass?: string; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {title !== undefined && <div className="panel-h"><h2>{title}</h2><div className="row">{actions}</div></div>}
      <div className={`panel-b ${bodyClass}`}>{children}</div>
    </section>
  );
}

export interface KpiDef { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn'; to?: string; on?: boolean }
export function Kpis({ items, className = '' }: { items: KpiDef[]; className?: string }) {
  return (
    <div className={`kpis ${className}`}>
      {items.map((k) => {
        const inner = <><div className="l">{k.label}</div><div className="v">{k.value}</div>{k.sub != null && <div className="s">{k.sub}</div>}</>;
        const cls = `kpi ${k.tone ?? ''} ${k.on ? 'on' : ''}`;
        return k.to ? <Link key={k.label} className={cls} to={k.to}>{inner}</Link> : <div key={k.label} className={cls}>{inner}</div>;
      })}
    </div>
  );
}

export function Empty({ title, children, icon = 'inbox', mini }: { title?: string; children?: ReactNode; icon?: string; mini?: boolean }) {
  return (
    <div className={`empty ${mini ? 'mini iconic' : ''}`}>
      {mini && <span className="em-i"><Icon name={icon} /></span>}
      {title && <b>{title}</b>}
      {children}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?(): void }) {
  return (
    <div className="empty iconic-lg" style={{ marginTop: 60 }}>
      <span className="em-i"><Icon name="alert" /></span>
      <b>This did not load</b>{error instanceof Error ? error.message : String(error)}
      {retry && <div className="row" style={{ marginTop: 14, justifyContent: 'center' }}><button type="button" className="btn primary" onClick={retry}><Icon name="refresh" />Try again</button></div>}
    </div>
  );
}

/** A small "this part did not load" notice with a retry, for panels whose siblings still work. */
export function LoadFailed({ q }: { q: { isError: boolean; error: unknown; refetch(): unknown } }) {
  if (!q.isError) return null;
  return (
    <div className="callout err" role="alert" style={{ marginBottom: 12 }}>
      This did not load: {q.error instanceof Error ? q.error.message : 'please try again'}.{' '}
      <button type="button" className="btn sm" onClick={() => void q.refetch()}>Try again</button>
    </div>
  );
}

export function Skeleton({ kind = 'list' }: { kind?: 'list' | 'dash' | 'record' }) {
  const bar = (w: string, h = 10) => <span className="sk" style={{ width: w, height: h }} />;
  const rows = (n: number) => Array.from({ length: n }, (_, i) => (
    <div className="sk-row" key={i}><span className="sk" style={{ width: 26, height: 26, borderRadius: 6 }} />
      <div style={{ flex: 1, display: 'grid', gap: 7 }}>{bar(`${40 + ((i * 17) % 35)}%`)}{bar(`${20 + ((i * 11) % 20)}%`, 8)}</div>{bar('70px')}</div>
  ));
  return (
    <div className="sk-page" aria-busy="true" aria-label="Loading">
      <div className="sk-ph">{bar('120px', 12)}{bar('110px', 28)}</div>
      {kind === 'dash' ? (
        <>
          <div className="sk-kpis">{Array.from({ length: 5 }, (_, i) => <div key={i}>{bar('60%', 9)}{bar('75%', 20)}{bar('50%', 8)}</div>)}</div>
          <div className="dash-row"><div className="sk-panel"><div style={{ padding: 18 }}><span className="sk" style={{ height: 180 }} /></div></div><div className="sk-panel">{rows(4)}</div></div>
        </>
      ) : kind === 'record' ? (
        <div className="dash-row"><div className="sk-panel">{rows(6)}</div><div className="sk-panel">{rows(5)}</div></div>
      ) : <div className="sk-panel" style={{ marginInline: 32 }}>{rows(8)}</div>}
    </div>
  );
}

export interface TabDef { key: string; label: ReactNode; count?: number | null }
export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange(k: string): void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key} className={active === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>
          {t.label}{t.count != null && <span className="n">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function Seg<T extends string>({ options, value, onChange, small }: { options: [T, ReactNode][]; value: T; onChange(v: T): void; small?: boolean }) {
  return (
    <div className={`seg ${small ? 'sm' : ''}`} role="group">
      {options.map(([k, l]) => <button key={k} type="button" className={value === k ? 'on' : ''} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

export const SideLink = ({ to, icon, children }: { to: string; icon: string; children: ReactNode }) => (
  <NavLink to={to} className={({ isActive }) => (isActive ? 'on' : '')}><Icon name={icon} /><span>{children}</span></NavLink>
);

export function Button({ busy, children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button type="button" {...rest} className={`btn ${className} ${busy ? 'busy' : ''}`} disabled={rest.disabled || busy}>{children}</button>;
}
