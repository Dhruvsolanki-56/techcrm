import { LEAD_STAGES, compact, labelOf } from '@crm/shared';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fmtMonth, money } from '../lib/format';
import { useGet, useParam } from '../lib/hooks';
import { Funnel, LineChart, Legend } from '../ui/charts';
import { ErrorBox, Kpis, Panel } from '../ui/primitives';

interface Block { name: string; side?: string | null; leads: number; open: number; converted: number; lost: number; conversion: number; hot: number; hot_all: number; india: number; foreign: number; pipeline: number; weighted: number; won_value: number; overdue: number; due_today: number; no_date: number; next_7: number }
interface Monthly { month: string; added: number; converted: number; lost: number; india_converted: number; foreign_converted: number; conversion: number; value_added: number; won_value: number; followups_scheduled: number; overdue: number }
interface Sales {
  total: Block; by_market: Block[]; by_side: Block[]; by_department: Block[]; by_category: Block[]; by_source: Block[]; by_owner: Block[]; by_stage: Block[]; by_priority: Block[];
  monthly: Monthly[]; year: string | null; years: string[]; funnel: { stage: string; count: number; value: number }[]; sales_cycle_days: number | null; open_quotes: { n: number; v: number };
}
const pct = (n: number): string => `${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
const dash = (n: number, f: (x: number) => ReactNode = (x) => x): ReactNode => (n ? f(n) : '—');

type Col = [heading: string, value: (r: Block) => ReactNode];
const C: Record<string, Col> = {
  leads: ['Total Leads', (r) => r.leads], open: ['Open Leads', (r) => r.open], hotOpen: ['Hot Open', (r) => dash(r.hot)], hot: ['Hot Leads', (r) => dash(r.hot_all)],
  conv: ['Converted', (r) => dash(r.converted)], lost: ['Closed / Lost', (r) => dash(r.lost)], rate: ['Conversion', (r) => pct(r.conversion)],
  pipe: ['Open Pipeline', (r) => dash(r.pipeline, money)], wpipe: ['Weighted', (r) => dash(r.weighted, money)], india: ['India', (r) => dash(r.india)], foreign: ['Foreign', (r) => dash(r.foreign)],
  overdue: ['Overdue', (r) => (r.overdue ? <span className="neg">{r.overdue}</span> : '—')],
};

function RepTable({ rows, first, cols, side, link }: { rows: Block[]; first: string; cols: Col[]; side?: boolean; link?(r: Block): string }) {
  const nav = useNavigate();
  if (!rows.length) return <div className="empty mini">No leads yet.</div>;
  return (
    <div className="tbl-scroll" tabIndex={0}>
      <table className="t rep">
        <thead><tr><th>{first}</th>{side && <th>Side</th>}{cols.map((c) => <th className="num" key={c[0]}>{c[0]}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className={link ? 'click' : ''} onClick={link ? () => nav(link(r)) : undefined}>
              <td><b>{r.name}</b></td>{side && <td className="muted">{r.side ?? '—'}</td>}
              {cols.map((c) => <td className="num" key={c[0]}>{c[1](r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The sheet's Dashboard, Dept, Source, Owner and Monthly analytics. `showTables` turns the detail tables off for a compact dashboard tab. */
export function SalesAnalytics({ showTables = true }: { showTables?: boolean }) {
  const [year, setYear] = useParam('year', '');
  const q = useGet<Sales>('/analytics/sales', year ? { year } : undefined);
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <div className="tbl"><div className="empty">Loading…</div></div>;
  const a = q.data;
  const T = a.total;
  const stageOrder = LEAD_STAGES.map(([v]) => v as string);
  const stages = [...a.by_stage].sort((x, y) => stageOrder.indexOf(x.name) - stageOrder.indexOf(y.name));
  const india = a.by_market.find((m) => m.name === 'India');
  const foreign = a.by_market.find((m) => m.name === 'Foreign');
  const mon = (m: string) => fmtMonth(m);
  const DEPT = [C.leads, C.open, C.hotOpen, C.conv, C.lost, C.rate, C.pipe, C.wpipe, C.overdue] as Col[];
  const SRC = [C.leads, C.open, C.conv, C.rate, C.pipe, C.wpipe, C.hot, C.india, C.foreign, C.overdue] as Col[];
  return (
    <div className="stack">
      <Kpis items={[
        { label: 'Total leads', value: T.leads }, { label: 'Open leads', value: T.open }, { label: 'Converted', value: T.converted, tone: 'good', sub: `${money(T.won_value)} won` }, { label: 'Conversion', value: pct(T.conversion), sub: a.sales_cycle_days != null ? `Avg. ${a.sales_cycle_days} days to close` : '' },
      ]} />
      <Kpis items={[
        { label: 'Open pipeline', value: money(T.pipeline) }, { label: 'Weighted pipeline', value: money(T.weighted) }, { label: 'Due today', value: T.due_today, tone: T.due_today ? 'warn' : undefined },
        { label: 'Overdue', value: T.overdue, sub: `${T.no_date} with no date`, tone: T.overdue ? 'bad' : undefined, to: '/followups?show=overdue' },
        { label: 'Quotations out', value: a.open_quotes.n, sub: money(a.open_quotes.v) },
      ]} />
      <div className="dash-row">
        <Panel title="Funnel by stage" bodyClass="funnel">
          <Funnel rows={stages.map((s) => ({ key: s.name, label: labelOf(LEAD_STAGES, s.name), n: s.leads, v: s.pipeline, to: `/leads?view=list` }))} />
        </Panel>
        <Panel title="India vs Foreign">
          <div className="split2">
            {[['India', india], ['Foreign', foreign]].map(([n, b]) => (
              <div key={n as string}><div className="l">{n as string}</div><div className="v">{(b as Block | undefined)?.leads ?? 0}</div>
                <div className="s">{(b as Block | undefined)?.converted ?? 0} converted · {pct((b as Block | undefined)?.conversion ?? 0)}</div><div className="s">{money((b as Block | undefined)?.pipeline ?? 0)} open</div></div>
            ))}
          </div>
          {a.by_side.filter((s) => s.name !== 'Not set').length > 0 && (
            <div className="split2" style={{ marginTop: 14 }}>
              {a.by_side.filter((s) => s.name !== 'Not set').map((s) => <div key={s.name}><div className="l">{s.name}s</div><div className="v">{s.leads}</div><div className="s">{s.converted} converted · {pct(s.conversion)}</div></div>)}
            </div>
          )}
        </Panel>
      </div>
      <Panel title={a.year ? `New leads vs converted — ${a.year}` : 'New leads vs converted — last 12 months'}
        actions={<><Legend items={[{ name: 'New leads', color: 'var(--accent)' }, { name: 'Converted', color: 'var(--green)' }, { name: 'Lost / closed', color: 'var(--red)' }]} />
          <label className="inline-sel"><span className="muted small">Year</span>
            <select aria-label="Analysis year" value={year} onChange={(e) => setYear(e.target.value)}><option value="">Last 12 months</option>{[...new Set([...a.years, String(new Date().getFullYear())])].sort().reverse().map((y) => <option key={y}>{y}</option>)}</select></label></>}>
        <LineChart labels={a.monthly.map((m) => mon(m.month))} fmt={(n) => String(Math.round(n))} tipFmt={(n) => String(n)} series={[
          { name: 'New leads', values: a.monthly.map((m) => m.added), color: 'var(--accent)', fill: true },
          { name: 'Converted', values: a.monthly.map((m) => m.converted), color: 'var(--green)' },
          { name: 'Lost / closed', values: a.monthly.map((m) => m.lost), color: 'var(--red)', dash: true },
        ]} />
      </Panel>
      {showTables && (
        <>
          <Panel title="Department & product analytics" bodyClass="flush"><RepTable rows={a.by_department} first="Department / Product" cols={DEPT} side link={(r) => (r.name === 'Not set' ? '/leads?view=list' : `/leads?view=list&department=${encodeURIComponent(r.name)}`)} /></Panel>
          <Panel title="Lead source analytics" bodyClass="flush"><RepTable rows={a.by_source} first="Lead source" cols={SRC} link={(r) => (r.name === 'Not set' ? '/leads' : `/leads?source=${encodeURIComponent(r.name)}`)} /></Panel>
          <div className="dash-row">
            <Panel title="By assigned to" bodyClass="flush"><RepTable rows={a.by_owner} first="Assigned to" cols={[C.leads, C.open, C.conv, C.rate, C.overdue] as Col[]} /></Panel>
            <Panel title="By category" bodyClass="flush"><RepTable rows={a.by_category} first="Category" cols={[C.leads, C.open, C.conv, C.rate, C.pipe] as Col[]} /></Panel>
          </div>
          <Panel title="Monthly analytics" bodyClass="flush">
            <div className="tbl-scroll" tabIndex={0}>
              <table className="t rep">
                <thead><tr><th>Month</th><th className="num">New leads</th><th className="num">Converted</th><th className="num">India conv.</th><th className="num">Foreign conv.</th><th className="num">Conversion</th><th className="num">New pipeline</th><th className="num">Won value</th><th className="num">Follow-ups set</th><th className="num">Overdue now</th></tr></thead>
                <tbody>
                  {(a.year ? a.monthly : [...a.monthly].reverse()).map((m) => (
                    <tr key={m.month}><td>{mon(m.month)}</td><td className="num">{m.added || '—'}</td><td className="num">{m.converted || '—'}</td><td className="num">{m.india_converted || '—'}</td><td className="num">{m.foreign_converted || '—'}</td>
                      <td className="num">{m.added ? pct(m.conversion) : '—'}</td><td className="num">{dash(m.value_added, money)}</td><td className="num">{dash(m.won_value, money)}</td><td className="num">{m.followups_scheduled || '—'}</td><td className="num">{m.overdue ? <span className="neg">{m.overdue}</span> : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
      <p className="small muted">Weighted pipeline uses the stage guide: New 10%, Contacted 20%, Qualified 35%, Demo/Meeting 50%, Proposal 65%, Negotiation 80%. <Link to="/followups">Open follow-ups →</Link> · {compact(T.pipeline)} in play.</p>
    </div>
  );
}
