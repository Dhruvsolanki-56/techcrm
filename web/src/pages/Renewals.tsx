import { CYCLES, labelOf, RENEWAL_KINDS, RENEWAL_STATUSES } from '@crm/shared';
import { api, type Row } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { useAct, useGet } from '../lib/hooks';
import { useEditor } from '../forms/RecordEditor';
import { useSession } from '../lib/session';
import { DataTable, type Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { Badge, Due, Kpis, Who } from '../ui/primitives';
import { Amount, Cell2, editCol} from './common';

interface FinA { recurring: { monthly_cost: number; mrr: number; items: Row[] }; pending_estimates: Row[] }

export function RenewalsTable({ query, compact, defaults }: { query?: Record<string, unknown>; compact?: boolean; defaults?: Record<string, unknown> }) {
  const editor = useEditor();
  const renew = useAct((id: number) => api.post<{ renewal_date: string }>(`/renewals/${id}/renew`), (r) => `Renewed — next date ${fmtDate(r.renewal_date)}`);
  const cols: Column[] = [
    {
      key: 'name', label: 'Software / service', sort: 'name',
      render: (r) => <Cell2 top={<>{String(r.name)}{r.amount_varies ? <span className="tag amber" style={{ marginLeft: 6 }} title="The amount changes each cycle">Varies</span> : null}</>} sub={[labelOf(RENEWAL_KINDS, String(r.kind)), compact ? '' : r.client_name ?? r.category, r.vendor].filter(Boolean).join(' · ')} />,
    },
    { key: 'renewal_date', label: 'Next date', cls: 'nowrap', sort: 'renewal_date', render: (r) => <Due date={r.renewal_date} done={r.status !== 'active'} /> },
    { key: 'cycle', label: 'Cycle', cls: 'opt', render: (r) => labelOf(CYCLES, String(r.cycle)) },
    { key: 'our_cost', label: 'Cost', num: true, sort: 'our_cost', render: (r) => <><Amount v={r.our_cost} dash />{r.next_amount != null && r.next_amount !== '' ? <div className="t2 warn" title="Used once for the next debit, then the normal cost applies again">next: {money(r.next_amount)}</div> : Number(r.monthly_cost) && r.cycle !== 'monthly' ? <div className="t2">{money(r.monthly_cost)}/mo</div> : null}</> },
    { key: 'client_price', label: 'Client pays', num: true, cls: 'opt', render: (r) => <Amount v={r.client_price} dash /> },
    { key: 'auto', label: 'Paid by', cls: 'opt', render: (r) => (r.scope === 'personal' ? <span className="tag" title="Tracked only: nothing is deducted from company money">Person · not deducted</span> : r.auto_debit ? <span className="tag green" title={`From ${r.pay_account_name ?? 'the main account'}`}>Company · automatic</span> : <span className="faint">Company · manual</span>) },
    { key: 'owner_name', label: 'Owner', cls: 'opt', render: (r) => <Who name={r.owner_name} /> },
    { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
    {
      key: '_renew', label: '', cls: 'nowrap right',
      render: (r) => (!r.auto_debit && r.status === 'active' && r.cycle !== 'one-time'
        ? <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); renew.mutate(Number(r.id)); }} title="Move the date forward by one cycle"><Icon name="refresh" />Renewed</button> : null),
    },
    editCol('renewals', true),
  ];
  return (
    <DataTable resource="renewals" query={query} columns={cols} compact={compact} noRef={compact} defaultSort="renewal_date:asc" searchPlaceholder="Search subscriptions, domains, plans…" noun="item"
      filters={compact ? [] : [{ key: 'kind', label: 'All kinds', options: RENEWAL_KINDS }, { key: 'scope', label: 'Company or person', options: [['company', 'Company'], ['personal', 'Person']] }, { key: 'status', label: 'Any status', options: RENEWAL_STATUSES }, { key: 'auto_debit', label: 'Any debit', options: [['1', 'Automatic'], ['0', 'Manual']] }]}
      toolbar={<button type="button" className="btn primary" onClick={() => editor.open({ resource: 'renewals', defaults })}><Icon name="plus" />New item</button>}
      empty={{ title: 'Nothing recurring yet', text: 'Add maintenance plans, domains, hosting, subscriptions and bills.' }} />
  );
}

export default function Renewals() {
  const { isFounder } = useSession();
  const fin = useGet<FinA>('/analytics/finance');
  const due = useGet<Row[]>('/renewals', { limit: 100, status: 'active' });
  const soon = (due.data ?? []).filter((r) => r.renewal_date && String(r.renewal_date) <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  const rec = fin.data?.recurring;
  const est = fin.data?.pending_estimates ?? [];
  void isFounder;
  return (
    <Page title="Subscriptions & renewals" sub="Plans you sell, and what you pay for. Items set to debit automatically record their own expense on the date.">
      <Kpis items={[
        { label: 'Maintenance income / month', value: money(rec?.mrr ?? 0), tone: 'good', sub: 'From active maintenance plans' },
        { label: 'Running cost / month', value: money(rec?.monthly_cost ?? 0), sub: 'Subscriptions, domains, hosting, bills' },
        { label: 'Due in 30 days', value: soon.length, sub: soon.length ? money(soon.reduce((s, r) => s + Number(r.our_cost || 0), 0)) : 'Nothing due' },
        { label: 'Bills to confirm', value: est.length, sub: est.length ? money(est.reduce((s, r) => s + Number(r.amount || 0), 0)) + ' estimated' : 'None', tone: est.length ? 'warn' : undefined },
      ]} />
      {est.length > 0 && (
        <div className="callout">{est.length === 1 ? 'One bill was recorded as an estimate' : `${est.length} bills were recorded as estimates`} because the amount changes every month.
          Open Finance → Expenses and edit the amount when the real bill arrives.</div>
      )}
      <RenewalsTable />
    </Page>
  );
}
