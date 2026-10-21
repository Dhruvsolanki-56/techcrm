import { MATCH_STATUSES, TRANSFER_KINDS, addDays, labelOf, today } from '@crm/shared';
import { Link } from 'react-router-dom';
import { ExpensesTable, PaymentsTable } from '../components/FinanceTables';
import { useEditor } from '../forms/RecordEditor';
import { api, type Row } from '../lib/api';
import { fmtDate, fmtMonth, money, plural } from '../lib/format';
import { useAct, useGet, useParam } from '../lib/hooks';
import { DataTable, type Column } from '../ui/DataTable';
import { Donut, HBars, Legend, LineChart, PALETTE } from '../ui/charts';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { Badge, ErrorBox, Kpis, Panel, Tabs, Who } from '../ui/primitives';
import { AddBtn, Amount, Cell2, ClientLink, editCol} from './common';

interface Summary {
  tds?: { deducted: number; claimed: number; to_claim: number; awaiting_certificate: number };
  still_to_get?: { to_get: number; pending: number; amount: number; overdue: number };
  from: string; to: string; income: { cash: number; tds: number; n: number }; expenses: { v: number; n: number }; invoiced: { total: number; n: number };
  profit: number; receivables: number; aging: Record<string, number>; trend: { month: string; income: number; expense: number }[]; expense_by_category: { k: string; v: number }[];
  income_by_client: { k: string; v: number; id?: number | null }[]; projects: Row[]; accounts: Row[]; cash: number; founders: Row[];
  pending_expenses: { v: number; n: number }; mrr: number; all_time: { revenue: number; expenses: number }; burn: number; grants: { requested: number; received: number };
}

const RANGES: [string, string][] = [['month', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This quarter'], ['fy', 'This financial year'], ['last12', 'Last 12 months'], ['all', 'All time']];
function rangeFor(key: string): { from: string; to: string } {
  const n = new Date();
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (key === 'lastmonth') return { from: f(new Date(n.getFullYear(), n.getMonth() - 1, 1)), to: f(new Date(n.getFullYear(), n.getMonth(), 0)) };
  if (key === 'quarter') { const q = Math.floor(n.getMonth() / 3) * 3; return { from: f(new Date(n.getFullYear(), q, 1)), to: f(new Date(n.getFullYear(), q + 3, 0)) }; }
  if (key === 'fy') { const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; return { from: `${y}-04-01`, to: `${y + 1}-03-31` }; }
  if (key === 'last12') return { from: addDays(today(), -365), to: today() };
  if (key === 'all') return { from: '2000-01-01', to: today() };
  return { from: `${today().slice(0, 7)}-01`, to: today() };
}

function Overview() {
  const [range, setRange] = useParam('range', 'month');
  const r = rangeFor(range);
  const s = useGet<Summary>('/finance/summary', r);
  if (s.isError) return <ErrorBox error={s.error} retry={() => void s.refetch()} />;
  if (!s.data) return <div className="tbl"><div className="empty">Loading…</div></div>;
  const d = s.data;
  const gross = d.income.cash; // what really reached the bank; TDS is a separate tax credit
  return (
    <div className="stack">
      <div className="toolbar">
        <select aria-label="Period" value={range} onChange={(e) => setRange(e.target.value)}>{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="muted small">{fmtDate(d.from)} – {fmtDate(d.to)}</span>
      </div>
      <Kpis items={[
        { label: 'Money in', value: money(gross), sub: plural(d.income.n, 'payment'), tone: 'good' },
        { label: 'Money out', value: money(d.expenses.v), sub: plural(d.expenses.n, 'expense') },
        { label: 'Profit', value: money(d.profit), tone: d.profit < 0 ? 'bad' : 'good', sub: gross ? `${Math.round((100 * d.profit) / gross)}% margin` : '' },
        { label: 'Invoiced', value: money(d.invoiced.total), sub: plural(d.invoiced.n, 'invoice') },
        { label: 'Still to get', value: money(d.still_to_get?.to_get ?? d.receivables), sub: d.still_to_get ? [d.still_to_get.pending ? `${money(d.still_to_get.pending)} invoiced, unpaid` : '', d.still_to_get.amount ? `${money(d.still_to_get.amount)} not invoiced yet` : ''].filter(Boolean).join(' · ') || 'Everything is paid' : 'All unpaid invoices', tone: (d.still_to_get?.to_get ?? d.receivables) ? 'warn' : 'good', to: '/analytics?tab=receivables' },
        ...(d.tds?.deducted ? [{ label: 'TDS to claim', value: money(d.tds.to_claim), sub: `${money(d.tds.claimed)} claimed so far · in your ITR`, tone: d.tds.to_claim ? 'warn' as const : undefined, to: '/analytics?tab=tds' }] : []),
      ]} />
      <Kpis items={[
        { label: 'Cash in accounts', value: money(d.cash), sub: plural(d.accounts.length, 'account') },
        { label: 'Monthly burn', value: money(d.burn), sub: 'Average of the last 6 months' },
        { label: 'Maintenance income / month', value: money(d.mrr) },
        { label: 'Bills to confirm', value: d.pending_expenses.n, sub: money(d.pending_expenses.v), tone: d.pending_expenses.n ? 'warn' : undefined },
        { label: 'Grants received', value: money(d.grants.received), sub: `of ${money(d.grants.requested)} requested` },
      ]} />
      <Panel title="Income vs expenses — last 12 months" actions={<Legend items={[{ name: 'Collected', color: 'var(--accent)' }, { name: 'Spent', color: '#c47f17' }]} />}>
        <LineChart labels={d.trend.map((t) => fmtMonth(t.month))} h={220} net series={[{ name: 'Collected', values: d.trend.map((t) => t.income), color: 'var(--accent)', fill: true }, { name: 'Spent', values: d.trend.map((t) => t.expense), color: '#c47f17', dash: true }]} />
      </Panel>
      <div className="dash-row">
        <Panel title="Where the money went"><HBars rows={d.expense_by_category} accent /></Panel>
        <Panel title="Who paid us"><HBars rows={d.income_by_client.map((c) => ({ ...c, to: c.id ? `/clients/${c.id}` : undefined }))} /></Panel>
      </div>
      <div className="dash-row">
        <Panel title="Receivables ageing">
          <Donut rows={[
            { k: 'Not yet due', v: d.aging.current ?? 0, color: 'var(--green)' }, { k: '1–30 days late', v: d.aging.d30 ?? 0, color: '#d99312' }, { k: '31–60 days', v: d.aging.d60 ?? 0, color: '#c47f17' },
            { k: '61–90 days', v: d.aging.d90 ?? 0, color: 'var(--red)' }, { k: 'Over 90 days', v: d.aging.d90p ?? 0, color: '#7a1f12' },
          ].filter((x) => x.v > 0)} center={money(d.receivables).replace('₹', '₹')} />
        </Panel>
        <Panel title="TDS credit (all time)" actions={d.tds?.deducted ? <Link to="/analytics?tab=tds">Open</Link> : undefined}>
          {d.tds?.deducted ? (
            <div className="split2">
              <div><div className="l">Deducted by clients</div><div className="v">{money(d.tds.deducted)}</div><div className="s">{money(d.tds.claimed)} claimed in ITR</div></div>
              <div><div className="l">Still to claim</div><div className="v">{money(d.tds.to_claim)}</div><div className="s">{money(d.tds.awaiting_certificate)} waiting for the certificate</div></div>
            </div>
          ) : <div className="empty mini">No TDS has been deducted by any client.</div>}
        </Panel>
      </div>
      <Panel title="Project profitability" bodyClass="flush">
        <div className="tbl-scroll" tabIndex={0}>
          <table className="t rep">
            <thead><tr><th>Project</th><th>Status</th><th className="num">Value</th><th className="num">Invoiced</th><th className="num">Received</th><th className="num">Costs</th><th className="num">Profit</th></tr></thead>
            <tbody>
              {d.projects.map((p) => (
                <tr key={p.id}><td><Link to={`/projects/${p.id}`}><b>{String(p.name)}</b></Link><div className="t2"><ClientLink id={p.client_id} name={p.client_name} /></div></td><td><Badge value={p.status} /></td>
                  <td className="num">{money(p.budget)}</td><td className="num">{money(p.invoiced)}</td><td className="num">{money(p.received)}</td><td className="num">{money(p.cost)}</td>
                  <td className={`num ${Number(p.received) - Number(p.cost) < 0 ? 'neg' : ''}`}>{money(Number(p.received) - Number(p.cost))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Accounts() {
  const editor = useEditor();
  const fin = useGet<Summary>('/finance/summary');
  const acols: Column[] = [
    { key: 'name', label: 'Account', sort: 'name', render: (r) => <Cell2 top={String(r.name)} sub={labelOf([['bank', 'Bank account'], ['upi', 'UPI / Wallet'], ['cash', 'Cash'], ['card', 'Credit card']], String(r.type))} /> },
    { key: 'opening_balance', label: 'Opening', num: true, render: (r) => <Amount v={r.opening_balance} dash /> },
    { key: 'balance', label: 'Balance now', num: true, render: (r) => <b><Amount v={r.balance} neg={Number(r.balance) < 0} /></b> },
    { key: 'active', label: 'In use', render: (r) => (r.active ? <span className="tag green">Active</span> : <span className="tag">Closed</span>) },
    editCol('accounts', true),
  ];
  const tcols: Column[] = [
    { key: 'date', label: 'Date', cls: 'nowrap', sort: 'date', render: (r) => fmtDate(r.date) },
    { key: 'kind', label: 'Type', sort: 'kind', render: (r) => labelOf(TRANSFER_KINDS, String(r.kind)) },
    { key: 'user_name', label: 'Founder', render: (r) => <Who name={r.user_name} /> },
    { key: 'account_name', label: 'Account', render: (r) => <>{String(r.account_name ?? '—')}{r.to_account_name ? <> → {String(r.to_account_name)}</> : null}</> },
    { key: 'amount', label: 'Amount', num: true, sort: 'amount', render: (r) => <Amount v={r.amount} /> },
    editCol('transfers', true),
  ];
  return (
    <div className="stack">
      <Panel title="Founders — money in and out of the company" bodyClass="flush">
        <div className="tbl-scroll" tabIndex={0}><table className="t rep">
          <thead><tr><th>Founder</th><th className="num">Capital put in</th><th className="num">Withdrawn</th><th className="num">Paid personally</th><th className="num">Reimbursed</th><th className="num">Company owes</th></tr></thead>
          <tbody>{(fin.data?.founders ?? []).map((f) => (
            <tr key={f.id}><td><Who name={f.name} /></td><td className="num">{money(f.capital)}</td><td className="num">{money(f.withdrawals)}</td><td className="num">{money(f.paid_personally)}</td><td className="num">{money(f.reimbursed)}</td>
              <td className={`num ${Number(f.company_owes) > 0 ? 'neg' : ''}`}>{money(f.company_owes)}</td></tr>
          ))}</tbody></table></div>
      </Panel>
      <div><div className="section-h"><h2>Accounts</h2><AddBtn resource="accounts" label="New account" quiet /></div>
        <DataTable resource="accounts" columns={acols} compact noRef noSearch pageSize={50} empty={{ title: 'No accounts yet', text: 'Add your bank account, UPI and cash box to see balances.' }} /></div>
      <div><div className="section-h"><h2>Founder money &amp; transfers</h2><button type="button" className="btn" onClick={() => editor.open({ resource: 'transfers' })}><Icon name="plus" />New</button></div>
        <DataTable resource="transfers" columns={tcols} compact noRef defaultSort="date:desc" filters={[{ key: 'kind', label: 'All types', options: TRANSFER_KINDS }, { key: 'user_id', label: 'Any founder', lookup: 'users' }]} noun="entry" /></div>
    </div>
  );
}

function Bank() {
  const match = useAct(() => api.post<{ matched: number; unmatched: number }>('/bank-match'), (r) => `Matched ${r.matched} lines · ${r.unmatched} still unmatched`);
  const cols: Column[] = [
    { key: 'date', label: 'Date', cls: 'nowrap', sort: 'date', render: (r) => fmtDate(r.date) },
    { key: 'description', label: 'Description', render: (r) => <Cell2 top={String(r.description ?? '—')} sub={[r.type, r.reference, r.match_note].filter(Boolean).join(' · ')} /> },
    { key: 'account_name', label: 'Account', cls: 'opt', render: (r) => String(r.account_name ?? '—') },
    { key: 'withdrawal', label: 'Withdrawal', num: true, sort: 'withdrawal', render: (r) => <Amount v={r.withdrawal} dash /> },
    { key: 'deposit', label: 'Deposit', num: true, sort: 'deposit', render: (r) => <Amount v={r.deposit} dash /> },
    { key: 'balance', label: 'Balance', num: true, cls: 'opt', render: (r) => <Amount v={r.balance} dash /> },
    { key: 'matched_status', label: 'Matched', render: (r) => <Badge value={String(r.matched_status).toLowerCase()} label={String(r.matched_status)} /> },
    editCol('bank_transactions', true),
  ];
  return (
    <DataTable resource="bank_transactions" columns={cols} defaultSort="date:desc" noRef searchPlaceholder="Search statement lines…" noun="line"
      filters={[{ key: 'matched_status', label: 'Any match status', options: MATCH_STATUSES }, { key: 'account_id', label: 'Any account', lookup: 'accounts' }]}
      toolbar={<><button type="button" className={`btn ${match.isPending ? 'busy' : ''}`} onClick={() => match.mutate()} title="Match lines to income and expenses with the same amount within 5 days"><Icon name="refresh" />Auto-match</button><AddBtn resource="bank_transactions" label="Add line" /></>}
      empty={{ title: 'No statement lines', text: 'Add lines from your bank statement to reconcile them with income and expenses.' }} />
  );
}

export default function Finance() {
  const [tab, setTab] = useParam('tab', 'overview');
  const tabs = [{ key: 'overview', label: 'Overview' }, { key: 'payments', label: 'Income' }, { key: 'expenses', label: 'Expenses' }, { key: 'bank', label: 'Bank transactions' }, { key: 'accounts', label: 'Accounts & founders' }];
  return (
    <Page title="Finance" sub="Money in, money out, and what is left.">
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'overview' && <Overview />}
      {tab === 'payments' && <PaymentsTable />}
      {tab === 'expenses' && <ExpensesTable />}
      {tab === 'bank' && <Bank />}
      {tab === 'accounts' && <Accounts />}
    </Page>
  );
}

void PALETTE;
