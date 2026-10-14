import { addDays, compact, today } from '@crm/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Row } from '../lib/api';
import { fmtDate, fmtMonth, money } from '../lib/format';
import { useGet } from '../lib/hooks';
import { Columns, Donut, HBars, PALETTE } from '../ui/charts';
import { Badge, ErrorBox, Kpis, Panel } from '../ui/primitives';

const Loading = () => <div className="tbl"><div className="empty">Loading…</div></div>;

/* =============================== received vs pending =============================== */
interface Rec {
  totals: { value: number; invoiced: number; received: number; cash: number; tds: number; pending: number; overdue: number; unbilled: number; to_get: number };
  clients: Row[]; projects: Row[]; aging: Record<string, number>; upcoming: Row[]; other_income: { v: number };
}
export function ReceivablesAnalytics() {
  const nav = useNavigate();
  const q = useGet<Rec>('/analytics/receivables');
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Loading />;
  const d = q.data;
  const t = d.totals;
  return (
    <div className="stack">
      <Kpis items={[
        { label: 'Agreed with clients', value: money(t.value), sub: 'Project values + approved change requests' },
        { label: 'Received', value: money(t.received), tone: 'good', sub: 'Cash in the bank' },
        { label: 'Still to get', value: money(t.to_get), tone: t.to_get ? 'warn' : 'good', sub: t.to_get ? [t.pending ? `${money(t.pending)} invoiced, unpaid` : '', t.unbilled ? `${money(t.unbilled)} not invoiced yet` : ''].filter(Boolean).join(' · ') : 'Everything is paid' },
        { label: 'Overdue', value: money(t.overdue), tone: t.overdue ? 'bad' : undefined, sub: 'Past the due date' },
      ]} />
      <div className="dash-row">
        <Panel title="Who still owes us" bodyClass="flush">
          {d.clients.some((c) => Number(c.to_get) >= 1)
            ? <div className="list">{d.clients.filter((c) => Number(c.to_get) >= 1).map((c) => (
              <Link key={String(c.client_id)} to={`/clients/${c.client_id}?tab=billing`} className="li"><div className="grow"><div className="t">{String(c.client_name)}</div>
                <div className="s">{[Number(c.pending) ? `${money(c.pending)} invoiced, unpaid` : '', Number(c.unbilled) ? `${money(c.unbilled)} not invoiced yet` : ''].filter(Boolean).join(' · ')}</div></div><b className="tnum">{money(c.to_get)}</b></Link>))}</div>
            : <div className="empty mini">Nothing left to get. Every agreed rupee has been received.</div>}
        </Panel>
        <Panel title="Invoiced and unpaid, by age">
          <Donut rows={[
            { k: 'Not yet due', v: d.aging.current ?? 0, color: 'var(--green)' }, { k: '1–30 days late', v: d.aging.d30 ?? 0, color: '#d99312' }, { k: '31–60 days', v: d.aging.d60 ?? 0, color: '#c47f17' },
            { k: '61–90 days', v: d.aging.d90 ?? 0, color: 'var(--red)' }, { k: 'Over 90 days', v: d.aging.d90p ?? 0, color: '#7a1f12' },
          ].filter((x) => x.v > 0)} center={money(t.pending)} />
        </Panel>
      </div>
      <Panel title="By client" bodyClass="flush">
        <div className="tbl-scroll" tabIndex={0}><table className="t rep">
          <thead><tr><th>Client</th><th className="num">Agreed</th><th className="num">Received</th><th className="num">Invoiced, unpaid</th><th className="num">Not invoiced</th><th className="num">Still to get</th></tr></thead>
          <tbody>{d.clients.map((c) => (
            <tr key={String(c.client_id)} className="click" onClick={() => c.client_id && nav(`/clients/${c.client_id}?tab=billing`)}>
              <td><b>{String(c.client_name)}</b></td><td className="num">{money(c.value)}</td><td className="num">{money(c.received)}</td>
              <td className={`num ${Number(c.pending) ? 'neg' : ''}`}>{money(c.pending)}</td><td className="num">{money(c.unbilled)}</td><td className="num"><b>{money(c.to_get)}</b></td>
            </tr>
          ))}</tbody>
          <tfoot><tr className="tot"><td>Total</td><td className="num">{money(t.value)}</td><td className="num">{money(t.received)}</td><td className="num">{money(t.pending)}</td><td className="num">{money(t.unbilled)}</td><td className="num">{money(t.to_get)}</td></tr></tfoot>
        </table></div>
      </Panel>
      <Panel title="By project" bodyClass="flush">
        <div className="tbl-scroll" tabIndex={0}><table className="t rep">
          <thead><tr><th>Project</th><th>Status</th><th className="num">Agreed</th><th className="num">Received</th><th className="num">Invoiced, unpaid</th><th className="num">Not invoiced</th><th className="num">Still to get</th></tr></thead>
          <tbody>{d.projects.map((p) => (
            <tr key={`${String(p.id)}-${String(p.client_id)}`} className="click" onClick={() => nav(p.id ? `/projects/${p.id}?tab=finance` : `/clients/${p.client_id}?tab=billing`)}>
              <td><b>{String(p.name)}</b><div className="t2">{String(p.client_name ?? '')}</div></td><td><Badge value={p.status} /></td><td className="num">{p.id ? money(p.value) : '—'}</td><td className="num">{money(p.received)}</td>
              <td className={`num ${Number(p.pending) ? 'neg' : ''}`}>{money(p.pending)}</td><td className="num">{Number(p.unbilled) ? money(p.unbilled) : '—'}</td><td className="num"><b>{Number(p.to_get) ? money(p.to_get) : '—'}</b></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
      <p className="small muted">“Still to get” is the money that has to come from the client: invoiced and unpaid, plus what is not invoiced yet. TDS a client deducts is never collected from them — it comes back when you file your return (see the TDS tab), so it is left out of these figures.</p>
      {d.other_income.v > 0 && <p className="small muted">Plus {money(d.other_income.v)} of other income not tied to a client project (grants, prizes, interest, founders’ contribution). See Income.</p>}
    </div>
  );
}

/* =============================== spending / income with filters =============================== */
interface Grp { key: string | number; label: string; amount: number; count: number; share: number; tds?: number }
interface Money { by: string; total: number; count: number; average?: number; tds?: number; rows: Grp[]; months: { month: string; amount: number }[]; top?: Row[]; pending?: { v: number; n: number }; options?: { categories: string[]; vendors: string[] } }

const PERIODS: [string, string][] = [['all', 'All time'], ['month', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This quarter'], ['fy', 'This financial year'], ['last12', 'Last 12 months'], ['last90', 'Last 90 days']];
export function periodRange(key: string): { from?: string; to?: string } {
  const n = new Date();
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (key === 'month') return { from: `${today().slice(0, 7)}-01`, to: today() };
  if (key === 'lastmonth') return { from: f(new Date(n.getFullYear(), n.getMonth() - 1, 1)), to: f(new Date(n.getFullYear(), n.getMonth(), 0)) };
  if (key === 'quarter') { const m = Math.floor(n.getMonth() / 3) * 3; return { from: f(new Date(n.getFullYear(), m, 1)), to: f(new Date(n.getFullYear(), m + 3, 0)) }; }
  if (key === 'fy') { const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; return { from: `${y}-04-01`, to: `${y + 1}-03-31` }; }
  if (key === 'last12') return { from: addDays(today(), -365), to: today() };
  if (key === 'last90') return { from: addDays(today(), -90), to: today() };
  return {};
}

const SPEND_BY: [string, string][] = [['category', 'Category'], ['vendor', 'Vendor / who we paid'], ['project', 'Project'], ['client', 'Client'], ['grant', 'Grant vs company money'], ['account', 'Account'], ['paid_by', 'Who paid'], ['recurring', 'Recurring item'], ['mode', 'Payment mode'], ['month', 'Month']];
const INCOME_BY: [string, string][] = [['client', 'Client'], ['project', 'Project'], ['category', 'Category'], ['account', 'Account'], ['mode', 'Payment mode'], ['grant', 'Grant'], ['month', 'Month']];
const FILTER_KEY: Record<string, string> = { category: 'category', vendor: 'vendor', project: 'project_id', client: 'client_id', grant: 'grant_id', account: 'account_id', paid_by: 'paid_by_id' };

function MoneyExplorer({ kind }: { kind: 'spending' | 'income' }) {
  const [period, setPeriod] = useState('all');
  const [by, setBy] = useState(kind === 'spending' ? 'category' : 'client');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [grant, setGrant] = useState('');
  const params = { by, ...periodRange(period), ...filters, grant: grant || undefined };
  const q = useGet<Money>(`/analytics/${kind}`, params);
  const d = q.data;
  const isSpend = kind === 'spending';
  const drill = (g: Grp) => {
    const k = FILTER_KEY[by];
    if (!k || String(g.key) === '0') return;
    setFilters((f) => ({ ...f, [k]: String(g.key) }));
    setBy(isSpend ? 'category' : 'project');
  };
  const chips = Object.entries(filters);
  return (
    <div className="stack">
      <div className="toolbar">
        <select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label className="inline-sel"><span className="muted small">Group by</span>
          <select aria-label="Group by" value={by} onChange={(e) => setBy(e.target.value)}>{(isSpend ? SPEND_BY : INCOME_BY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {isSpend && (
          <>
            <select aria-label="Category" value={filters.category ?? ''} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}><option value="">Any category</option>{(d?.options?.categories ?? []).map((c) => <option key={c}>{c}</option>)}</select>
            <select aria-label="Vendor" value={filters.vendor ?? ''} onChange={(e) => setFilters((f) => ({ ...f, vendor: e.target.value }))}><option value="">Any vendor</option>{(d?.options?.vendors ?? []).map((c) => <option key={c}>{c}</option>)}</select>
            <select aria-label="Grant money" value={grant} onChange={(e) => setGrant(e.target.value)}><option value="">Grant and company money</option><option value="any">Grant money only</option><option value="none">Company money only</option></select>
          </>
        )}
        {chips.length > 0 && <button type="button" className="btn sm" onClick={() => setFilters({})}>Clear {chips.length} filter{chips.length > 1 ? 's' : ''}</button>}
      </div>
      {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
      {!d ? <Loading /> : (
        <>
          <Kpis items={isSpend
            ? [{ label: 'Spent', value: money(d.total), sub: `${d.count} expenses` }, { label: 'Average expense', value: money(d.average ?? 0) }, { label: 'Biggest group', value: d.rows[0]?.label ?? '—', sub: d.rows[0] ? `${money(d.rows[0].amount)} · ${d.rows[0].share}%` : '' },
              { label: 'Bills still to confirm', value: d.pending?.n ?? 0, sub: money(d.pending?.v ?? 0), tone: d.pending?.n ? 'warn' : undefined }]
            : [{ label: 'Received', value: money(d.total), tone: 'good', sub: `${d.count} payments` }, { label: 'TDS deducted by clients', value: money(d.tds ?? 0), sub: 'Claimable in your tax return' }, { label: 'Biggest source', value: d.rows[0]?.label ?? '—', sub: d.rows[0] ? `${money(d.rows[0].amount)} · ${d.rows[0].share}%` : '' }]} />
          <div className="dash-row">
            <Panel title={`${isSpend ? 'Spent' : 'Received'} by ${(isSpend ? SPEND_BY : INCOME_BY).find(([k]) => k === by)?.[1].toLowerCase()}`} actions={<span className="small muted">Click a row to filter</span>} bodyClass="flush">
              {d.rows.length ? (
                <div className="tbl-scroll" tabIndex={0}><table className="t rep">
                  <thead><tr><th>{by === 'month' ? 'Month' : 'Group'}</th><th className="num">Amount</th><th className="num">Share</th><th className="num">Count</th></tr></thead>
                  <tbody>{d.rows.map((g) => (
                    <tr key={String(g.key)} className={FILTER_KEY[by] && String(g.key) !== '0' ? 'click' : ''} onClick={() => drill(g)}>
                      <td><b>{by === 'month' ? fmtMonth(String(g.label)) : g.label}</b><div className="bar" style={{ marginTop: 4 }}><i style={{ width: `${Math.max(2, g.share)}%` }} /></div></td>
                      <td className="num">{money(g.amount)}</td><td className="num">{g.share}%</td><td className="num">{g.count}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <div className="empty mini">Nothing matches these filters.</div>}
            </Panel>
            <Panel title="By month"><Columns labels={d.months.map((m) => fmtMonth(m.month))} fmt={compact} series={[{ name: isSpend ? 'Spent' : 'Received', values: d.months.map((m) => m.amount), color: isSpend ? '#c47f17' : 'var(--accent)' }]} /></Panel>
          </div>
          {isSpend && d.top && d.top.length > 0 && (
            <Panel title="Ten biggest expenses" bodyClass="flush">
              <div className="list">{d.top.map((r) => <Link key={String(r.id)} to="/finance?tab=expenses" className="li"><div className="grow"><div className="t">{String(r.vendor ?? r.description ?? '—')}</div><div className="s">{String(r.category ?? '')} · {fmtDate(r.date)}</div></div><b className="tnum">{money(r.amount)}</b></Link>)}</div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
export const SpendingAnalytics = () => <MoneyExplorer kind="spending" />;
export const IncomeAnalytics = () => <MoneyExplorer kind="income" />;

/* =============================== grants =============================== */
interface GrantUse extends Row {
  requested: number; received: number; used: number; remaining: number; to_come: number; utilisation: number; overspent: boolean; missing_receipts: number; expense_count: number;
  by_category: Grp[]; by_vendor: Grp[]; by_project: Grp[]; by_month: { month: string; amount: number }[]; receipts: Row[];
}
export function GrantCard({ g, detail }: { g: GrantUse; detail?: boolean }) {
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>{detail ? 'Where this grant went' : <Link to={`/grants/${g.id}`}>{String(g.name)}</Link>}</h2>
        <div className="row"><Badge value={g.status} /><span className="small muted">{String(g.funder ?? '')}</span></div>
      </div>
      <div className="panel-b">
        <div className="kpis" style={{ marginBottom: 14 }}>
          <div className="kpi"><div className="l">Requested</div><div className="v">{money(g.requested)}</div><div className="s">{g.to_come ? `${money(g.to_come)} still to come` : 'Fully received'}</div></div>
          <div className="kpi"><div className="l">Received</div><div className="v">{money(g.received)}</div></div>
          <div className={`kpi ${g.overspent ? 'bad' : ''}`}><div className="l">Used</div><div className="v">{money(g.used)}</div><div className="s">{g.expense_count} expenses · {g.utilisation}% of received</div></div>
          <div className={`kpi ${g.remaining < 0 ? 'bad' : 'good'}`}><div className="l">Left to use</div><div className="v">{money(g.remaining)}</div><div className="s">{g.overspent ? 'More spent than received' : ''}</div></div>
        </div>
        <div className="progress" role="progressbar" aria-label="Grant used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(g.utilisation))}><i style={{ width: `${Math.min(100, g.utilisation)}%`, background: g.overspent ? 'var(--red)' : undefined }} /></div>
        {g.missing_receipts > 0 && <div className="callout" style={{ marginTop: 12 }}>{g.missing_receipts} expense{g.missing_receipts > 1 ? 's' : ''} paid from this grant {g.missing_receipts > 1 ? 'have' : 'has'} no receipt attached. Funders usually ask for them — open the expense and add the file under Files.</div>}
        {g.used > 0 ? (
          <div className="dash-row" style={{ marginTop: 16 }}>
            <div><div className="small muted" style={{ marginBottom: 6 }}>By category</div><HBars rows={g.by_category.map((x) => ({ k: x.label, v: x.amount }))} accent /></div>
            <div><div className="small muted" style={{ marginBottom: 6 }}>By vendor</div><HBars rows={g.by_vendor.map((x) => ({ k: x.label, v: x.amount }))} /></div>
          </div>
        ) : <div className="empty mini">No expense has been marked “Paid from grant” yet.</div>}
        {detail && g.used > 0 && (
          <div className="dash-row" style={{ marginTop: 16 }}>
            <div><div className="small muted" style={{ marginBottom: 6 }}>By project</div><HBars rows={g.by_project.map((x) => ({ k: x.label, v: x.amount }))} /></div>
            <div><div className="small muted" style={{ marginBottom: 6 }}>By month</div><Columns labels={g.by_month.map((m) => fmtMonth(m.month))} fmt={compact} series={[{ name: 'Used', values: g.by_month.map((m) => m.amount), color: 'var(--accent)' }]} h={150} /></div>
          </div>
        )}
      </div>
    </section>
  );
}
export function GrantsAnalytics() {
  const q = useGet<{ grants: GrantUse[]; totals: { requested: number; received: number; used: number } }>('/analytics/grants');
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Loading />;
  const t = q.data.totals;
  return (
    <div className="stack">
      <Kpis items={[{ label: 'Requested', value: money(t.requested) }, { label: 'Received', value: money(t.received), tone: 'good' }, { label: 'Used', value: money(t.used) }, { label: 'Left to use', value: money(t.received - t.used), tone: t.received - t.used < 0 ? 'bad' : undefined }]} />
      {q.data.grants.length ? q.data.grants.map((g) => <GrantCard key={g.id} g={g} />) : <div className="empty">No grants yet.</div>}
    </div>
  );
}

/* =============================== subscriptions =============================== */
interface Subs {
  items: Row[]; monthly_total: number; company_monthly: number; personal_monthly: number; by_kind: { label: string; amount: number }[]; by_owner: { label: string; amount: number }[];
  next_30: { id: number; name: string; date: string; amount: number; scope: string; auto: boolean }[];
  history: { id: number; name: string; scope: string; cost: number; varies: boolean; next_amount: number | null; min: number | null; max: number | null; months: { month: string; amount: number; estimate: boolean; pending: boolean }[] }[];
}
export function SubscriptionsAnalytics() {
  const q = useGet<Subs>('/analytics/subscriptions');
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Loading />;
  const d = q.data;
  return (
    <div className="stack">
      <Kpis items={[
        { label: 'Running cost / month', value: money(d.monthly_total) }, { label: 'Company pays', value: money(d.company_monthly), sub: 'Debited automatically' },
        { label: 'People pay', value: money(d.personal_monthly), sub: 'Tracked, not deducted' }, { label: 'Yearly', value: money(d.monthly_total * 12) },
      ]} />
      <div className="dash-row">
        <Panel title="By kind"><HBars rows={d.by_kind.map((x) => ({ k: x.label, v: x.amount }))} accent /></Panel>
        <Panel title="By owner"><HBars rows={d.by_owner.map((x) => ({ k: x.label, v: x.amount }))} /></Panel>
      </div>
      <Panel title="Coming up in the next 30 days" bodyClass="flush">
        {d.next_30.length ? <div className="list">{d.next_30.map((r) => <Link key={r.id} to="/renewals" className="li"><div className="grow"><div className="t">{r.name}</div><div className="s">{r.scope === 'personal' ? 'Person · not deducted' : r.auto ? 'Company · automatic' : 'Company · manual'}</div></div><span className="small muted">{fmtDate(r.date)}</span><b className="tnum">{money(r.amount)}</b></Link>)}</div> : <div className="empty mini">Nothing in the next 30 days.</div>}
      </Panel>
      <Panel title="Price over the last 12 months" bodyClass="flush">
        <div className="tbl-scroll" tabIndex={0}><table className="t rep">
          <thead><tr><th>Item</th><th className="num">Normal</th><th className="num">Lowest</th><th className="num">Highest</th><th>Months</th></tr></thead>
          <tbody>{d.history.map((h) => (
            <tr key={h.id}>
              <td><b>{h.name}</b><div className="t2">{h.scope === 'personal' ? 'Person' : 'Company'}{h.varies ? ' · amount changes' : ''}</div></td>
              <td className="num">{money(h.cost)}{h.next_amount != null ? <div className="t2 warn">next: {money(h.next_amount)}</div> : null}</td>
              <td className="num">{h.min != null ? money(h.min) : '—'}</td><td className="num">{h.max != null ? money(h.max) : '—'}</td>
              <td><div className="row wrap" style={{ gap: 4 }}>{h.months.map((m, i) => <span key={i} className={`tag ${m.pending ? 'amber' : m.amount !== h.cost ? 'blue' : ''}`} title={`${fmtMonth(m.month)}${m.estimate ? ' (estimate)' : ''}`}>{fmtMonth(m.month).split(' ')[0]} {compact(m.amount)}</span>)}</div></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
    </div>
  );
}
void PALETTE;
