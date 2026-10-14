import { GRANT_STATUSES } from '@crm/shared';
import { useGet } from '../lib/hooks';
import { fmtDate } from '../lib/format';
import { useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '../ui/DataTable';
import { Page } from '../ui/Page';
import { Badge, Kpis, Due } from '../ui/primitives';
import { AddBtn, Amount, Cell2, editCol} from './common';
import { money } from '../lib/format';

interface Fin { grants: { requested: number; received: number; n: number }; all_time: { expenses: number } }

export default function Grants() {
  const nav = useNavigate();
  const fin = useGet<Fin>('/finance/summary');
  const g = fin.data?.grants;
  const cols: Column[] = [
    { key: 'name', label: 'Grant', sort: 'name', render: (r) => <Cell2 top={String(r.name)} sub={String(r.funder ?? '')} /> },
    { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
    { key: 'applied_on', label: 'Applied', cls: 'nowrap opt', render: (r) => fmtDate(r.applied_on) },
    { key: 'requested', label: 'Requested', num: true, sort: 'requested', render: (r) => <Amount v={r.requested} dash /> },
    { key: 'received', label: 'Received', num: true, sort: 'received', render: (r) => <Amount v={r.received} dash /> },
    { key: 'used', label: 'Used', num: true, render: (r) => <Amount v={r.used} dash /> },
    { key: 'left', label: 'Left to use', num: true, render: (r) => <Amount v={Number(r.received) - Number(r.used)} neg={Number(r.received) - Number(r.used) < 0} dash /> },
    { key: 'next_report_date', label: 'Next report', cls: 'nowrap', render: (r) => <Due date={r.next_report_date} /> },
    editCol('grants', true),
  ];
  return (
    <Page title="Grants" sub="Funding applied for, received, and how much of it has been spent. Open a grant to see where every rupee went." actions={<AddBtn resource="grants" label="New grant" />}>
      {g && <Kpis items={[
        { label: 'Grants', value: g.n },
        { label: 'Requested', value: money(g.requested) },
        { label: 'Received', value: money(g.received), tone: 'good' },
        { label: 'Still to come', value: money(Math.max(0, g.requested - g.received)) },
      ]} />}
      <DataTable resource="grants" columns={cols} filters={[{ key: 'status', label: 'All statuses', options: GRANT_STATUSES }]} searchPlaceholder="Search grants…" noun="grant" onRow={(r) => nav(`/grants/${r.id}`)}
        empty={{ title: 'No grants yet', text: 'Add a grant you applied for or received.' }} />
    </Page>
  );
}
