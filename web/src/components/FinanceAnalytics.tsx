import { compact } from '@crm/shared';
import { Link } from 'react-router-dom';
import type { Row } from '../lib/api';
import { fmtDate, fmtMonth, money } from '../lib/format';
import { useGet } from '../lib/hooks';
import { Columns, Donut, HBars, Legend, LineChart, PALETTE } from '../ui/charts';
import { Badge, Due, ErrorBox, Kpis, Panel } from '../ui/primitives';

interface FA {
  series: { month: string; income: number; expense: number; net: number; invoiced: number; margin: number | null; cumulative: number }[];
  totals: { income: number; expense: number; net: number; margin: number | null };
  top_clients: { id: number; name: string; received: number; projects: number }[];
  expense_by_category: { k: string; v: number }[];
  invoice_status: { k: string; n: number; total: number; open: number }[];
  receivable_clients: { id: number; name: string; owed: number; oldest_due: string | null }[];
  project_profit: (Row & { value: number; received: number; cost: number; margin: number })[];
  grants: (Row & { requested: number; received: number; used: number; remaining: number; pending: number })[];
  recurring: { monthly_cost: number; mrr: number; items: Row[] };
  forecast_60d: { inflow: Row[]; outflow: Row[]; expected_in: number; expected_out: number };
  pending_estimates: Row[];
}

/** Margins, who pays, project profit, grants, recurring costs and the next 60 days. */
export function FinanceAnalytics() {
  const q = useGet<FA>('/analytics/finance', { months: 12 });
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <div className="tbl"><div className="empty">Loading…</div></div>;
  const d = q.data;
  const labels = d.series.map((s) => fmtMonth(s.month));
  const f = d.forecast_60d;
  return (
    <div className="stack">
      <Kpis items={[
        { label: 'Income, 12 months', value: money(d.totals.income), tone: 'good' },
        { label: 'Expenses, 12 months', value: money(d.totals.expense) },
        { label: 'Net', value: money(d.totals.net), tone: d.totals.net < 0 ? 'bad' : 'good', sub: d.totals.margin != null ? `${d.totals.margin}% margin` : '' },
        { label: 'Maintenance income / month', value: money(d.recurring.mrr) },
        { label: 'Running cost / month', value: money(d.recurring.monthly_cost), sub: 'Subscriptions, domains, bills' },
      ]} />
      <Panel title="Income, expenses and cumulative profit" actions={<Legend items={[{ name: 'Income', color: 'var(--accent)' }, { name: 'Expenses', color: '#c47f17' }, { name: 'Cumulative', color: 'var(--ink-2)' }]} />}>
        <LineChart labels={labels} h={230} series={[
          { name: 'Income', values: d.series.map((s) => s.income), color: 'var(--accent)', fill: true },
          { name: 'Expenses', values: d.series.map((s) => s.expense), color: '#c47f17', dash: true },
          { name: 'Cumulative', values: d.series.map((s) => Math.max(0, s.cumulative)), color: 'var(--ink-2)' },
        ]} />
      </Panel>
      <div className="dash-row">
        <Panel title="Invoiced vs collected"><Columns labels={labels} fmt={compact} series={[{ name: 'Invoiced', values: d.series.map((s) => s.invoiced), color: 'var(--blue)' }, { name: 'Collected', values: d.series.map((s) => s.income), color: 'var(--accent)' }]} /></Panel>
        <Panel title="Margin by month" bodyClass="flush">
          <div className="tbl-scroll" tabIndex={0}><table className="t rep"><thead><tr><th>Month</th><th className="num">Net</th><th className="num">Margin</th></tr></thead>
            <tbody>{[...d.series].reverse().slice(0, 8).map((s) => <tr key={s.month}><td>{fmtMonth(s.month)}</td><td className={`num ${s.net < 0 ? 'neg' : ''}`}>{money(s.net)}</td><td className="num">{s.margin == null ? '—' : `${s.margin}%`}</td></tr>)}</tbody></table></div>
        </Panel>
      </div>
      <div className="dash-row">
        <Panel title="Where the money goes"><HBars rows={d.expense_by_category.slice(0, 8)} accent /></Panel>
        <Panel title="Who pays us"><HBars rows={d.top_clients.map((c) => ({ k: c.name, v: c.received, to: `/clients/${c.id}` }))} /></Panel>
      </div>
      <div className="dash-row">
        <Panel title="Invoices by status">
          <Donut rows={d.invoice_status.map((s, i) => ({ k: `${s.k} (${s.n})`, v: s.total, color: ({ paid: 'var(--green)', overdue: 'var(--red)', sent: 'var(--blue)', partial: '#d99312', draft: 'var(--faint)', cancelled: '#c9c7bf' } as Record<string, string>)[s.k] ?? PALETTE[i % PALETTE.length] as string }))} center={`${d.invoice_status.reduce((s, x) => s + x.n, 0)} invoices`} />
        </Panel>
        <Panel title="Who owes us" bodyClass="flush">
          {d.receivable_clients.length ? <div className="list">{d.receivable_clients.map((c) => <Link key={c.id} to={`/clients/${c.id}?tab=billing`} className="li"><div className="grow"><div className="t">{c.name}</div><div className="s">{c.oldest_due ? `oldest due ${fmtDate(c.oldest_due)}` : ''}</div></div><b className="tnum">{money(c.owed)}</b></Link>)}</div> : <div className="empty mini">Nobody owes you anything.</div>}
        </Panel>
      </div>
      <Panel title="Project profitability" bodyClass="flush">
        <div className="tbl-scroll" tabIndex={0}><table className="t rep">
          <thead><tr><th>Project</th><th>Status</th><th className="num">Value incl. changes</th><th className="num">Received</th><th className="num">Costs</th><th className="num">Profit</th></tr></thead>
          <tbody>{d.project_profit.map((p) => <tr key={p.id}><td><Link to={`/projects/${p.id}`}><b>{String(p.name)}</b></Link><div className="t2">{String(p.client_name ?? '')}</div></td><td><Badge value={p.status} /></td><td className="num">{money(p.value)}</td><td className="num">{money(p.received)}</td><td className="num">{money(p.cost)}</td><td className={`num ${p.margin < 0 ? 'neg' : ''}`}>{money(p.margin)}</td></tr>)}</tbody></table></div>
      </Panel>
      {d.grants.length > 0 && (
        <Panel title="Grants" actions={<Link to="/grants" className="small">Open →</Link>} bodyClass="flush">
          <div className="tbl-scroll" tabIndex={0}><table className="t rep"><thead><tr><th>Grant</th><th>Status</th><th className="num">Requested</th><th className="num">Received</th><th className="num">Used</th><th className="num">Left to use</th></tr></thead>
            <tbody>{d.grants.map((g) => <tr key={g.id}><td><b>{String(g.name)}</b><div className="t2">{String(g.funder ?? '')}</div></td><td><Badge value={g.status} /></td><td className="num">{money(g.requested)}</td><td className="num">{money(g.received)}</td><td className="num">{money(g.used)}</td><td className={`num ${g.remaining < 0 ? 'neg' : ''}`}>{money(g.remaining)}</td></tr>)}</tbody></table></div>
        </Panel>
      )}
      <div className="dash-row">
        <Panel title={`Next 60 days — expected in ${money(f.expected_in)}`} bodyClass="flush">
          {f.inflow.length ? <div className="list">{f.inflow.slice(0, 8).map((r) => <Link key={r.id} to={`/invoices/${r.id}`} className="li"><div className="grow"><div className="t">{String(r.company)}</div><div className="s">{String(r.number)}</div></div><Due date={r.due_date} /><b className="tnum">{money(r.amount)}</b></Link>)}</div> : <div className="empty mini">No unpaid invoices.</div>}
        </Panel>
        <Panel title={`Next 60 days — going out ${money(f.expected_out)}`} bodyClass="flush">
          {f.outflow.length ? <div className="list">{f.outflow.slice(0, 8).map((r) => <Link key={r.id} to="/renewals" className="li"><div className="grow"><div className="t">{String(r.name)}</div><div className="s">{r.auto_debit ? 'Debits itself' : 'Pay manually'}{r.amount_varies ? ' · amount varies' : ''}</div></div><Due date={r.renewal_date} /><b className="tnum">{money(r.amount)}</b></Link>)}</div> : <div className="empty mini">Nothing due.</div>}
        </Panel>
      </div>
      {d.pending_estimates.length > 0 && <div className="callout">{d.pending_estimates.length} bill{d.pending_estimates.length > 1 ? 's were' : ' was'} recorded as an estimate. <Link to="/finance?tab=expenses">Open expenses</Link> and enter the real amount when the bill arrives.</div>}
    </div>
  );
}
