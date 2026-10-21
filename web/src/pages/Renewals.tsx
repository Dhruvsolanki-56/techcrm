import { CYCLES, labelOf, RENEWAL_KINDS, RENEWAL_STATUSES } from '@crm/shared';
import { api, type Row } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { useAct, useGet } from '../lib/hooks';
import { useEditor } from '../forms/RecordEditor';
import { DataTable, type Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { Badge, Due, Kpis } from '../ui/primitives';
import { Amount, Cell2, ClientLink, editCol, ProjectLink } from './common';

interface FinA { recurring: { monthly_cost: number; mrr: number; items: Row[] }; pending_estimates: Row[] }

/** What the company (or someone else) pays for: subscriptions, domains, hosting, bills. Plans that a client pays US for are in PlansTable. */
export function RenewalsTable({ query, compact, defaults }: { query?: Record<string, unknown>; compact?: boolean; defaults?: Record<string, unknown> }) {
  const editor = useEditor();
  const renew = useAct((id: number) => api.post<{ renewal_date: string }>(`/renewals/${id}/renew`), (r) => `Marked renewed — next date ${fmtDate(r.renewal_date)}`);
  const cols: Column[] = [
    { key: 'name', label: 'Software / service', sort: 'name', render: (r) => <Cell2 top={String(r.name)} sub={[labelOf(RENEWAL_KINDS, String(r.kind)), compact ? '' : r.vendor].filter(Boolean).join(' · ')} /> },
    { key: 'renewal_date', label: 'Next date', cls: 'nowrap', sort: 'renewal_date', render: (r) => <Due date={r.renewal_date} done={r.status !== 'active'} /> },
    { key: 'cycle', label: 'Repeats', cls: 'opt', render: (r) => labelOf(CYCLES, String(r.cycle)) },
    { key: 'our_cost', label: 'Cost', num: true, sort: 'our_cost', render: (r) => <Amount v={r.our_cost} dash /> },
    {
      key: 'auto', label: 'Paid by', sort: 'scope',
      render: (r) => (r.scope === 'personal'
        ? <div><span className="tag">{String(r.owner_name ?? 'Someone else')}</span><div className="t2">only listed, not company money</div></div>
        : <div><span className="tag green">Company</span><div className="t2">added to Expenses on its date</div></div>),
    },
    { key: 'status', label: 'Status', cls: 'opt', render: (r) => <Badge value={r.status} /> },
    {
      key: '_renew', label: '', cls: 'nowrap right',
      render: (r) => (r.scope === 'personal' && r.status === 'active' && r.cycle !== 'one-time'
        ? <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); renew.mutate(Number(r.id)); }} title="Move the date forward by one cycle"><Icon name="refresh" />Renewed</button> : null),
    },
    editCol('renewals', true),
  ];
  return (
    <DataTable resource="renewals" query={{ group: 'pay', ...query }} columns={cols} compact={compact} noRef={compact} defaultSort="renewal_date:asc" searchPlaceholder="Search subscriptions, domains, bills…" noun="item"
      filters={compact ? [] : [{ key: 'kind', label: 'All kinds', options: RENEWAL_KINDS.filter(([k]) => k !== 'amc') }, { key: 'scope', label: 'Who pays', options: [['company', 'Company'], ['personal', 'Someone else']] }, { key: 'status', label: 'Any status', options: RENEWAL_STATUSES }]}
      toolbar={<button type="button" className="btn primary" onClick={() => editor.open({ resource: 'renewals', defaults })}><Icon name="plus" />New subscription</button>}
      empty={{ title: 'Nothing recurring yet', text: 'Add what the company pays for: subscriptions, domains, hosting, bills.' }} />
  );
}

/** Maintenance plans: what a client pays US every month or year to keep their site running. */
export function PlansTable({ query, compact, defaults }: { query?: Record<string, unknown>; compact?: boolean; defaults?: Record<string, unknown> }) {
  const editor = useEditor();
  const cols: Column[] = [
    { key: 'name', label: 'Plan', sort: 'name', render: (r) => <Cell2 top={String(r.name)} sub={<>{compact ? null : <ClientLink id={r.client_id} name={r.client_name} />}{!compact && r.client_name && r.project_name ? ' · ' : ''}{r.project_name ? <ProjectLink id={r.project_id} name={r.project_name} /> : null}</>} /> },
    { key: 'renewal_date', label: 'Ends / renews', cls: 'nowrap', sort: 'renewal_date', render: (r) => <Due date={r.renewal_date} done={r.status !== 'active'} /> },
    { key: 'cycle', label: 'Repeats', cls: 'opt', render: (r) => labelOf(CYCLES, String(r.cycle)) },
    { key: 'client_price', label: 'Client pays', num: true, render: (r) => <Amount v={r.client_price} dash /> },
    { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
    editCol('renewals', true),
  ];
  return (
    <DataTable resource="renewals" query={{ group: 'sell', ...query }} columns={cols} compact={compact} noRef defaultSort="renewal_date:asc" searchPlaceholder="Search maintenance plans…" noun="plan"
      toolbar={<button type="button" className="btn primary" onClick={() => editor.open({ resource: 'renewals', defaults: { kind: 'amc', ...defaults } })}><Icon name="plus" />New maintenance plan</button>}
      empty={{ title: 'No maintenance plans', text: 'When a client pays you to look after their site, add the plan here: you are reminded before it ends.' }} />
  );
}

export default function Renewals() {
  const fin = useGet<FinA>('/analytics/finance');
  const rec = fin.data?.recurring;
  const est = fin.data?.pending_estimates ?? [];
  const sub = useGet<{ company_monthly: number; personal_monthly: number; next_30: Row[] }>('/analytics/subscriptions');
  const soon = (sub.data?.next_30 ?? []).filter((r) => r.scope === 'company');
  return (
    <Page title="Subscriptions" sub="What the company pays for. Each one is added to Expenses on its date; things someone else pays are only listed here so we remember them. Maintenance plans that clients pay you for are under Maintenance.">
      <Kpis items={[
        { label: 'Company pays / month', value: money(rec?.monthly_cost ?? 0), sub: 'Subscriptions, domains, hosting, bills' },
        { label: 'Paid by someone else / month', value: money(sub.data?.personal_monthly ?? 0), sub: 'Listed only, not company money' },
        { label: 'Company debits in 30 days', value: soon.length, sub: soon.length ? money(soon.reduce((s, r) => s + Number(r.amount || 0), 0)) : 'Nothing due' },
        ...(est.length ? [{ label: 'Bills to confirm', value: est.length, sub: `${money(est.reduce((s, r) => s + Number(r.amount || 0), 0))} estimated`, tone: 'warn' as const }] : []),
      ]} />
      <RenewalsTable />
    </Page>
  );
}
