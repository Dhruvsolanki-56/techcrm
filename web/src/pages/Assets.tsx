import { useSession, settingList } from '../lib/session';
import { fmtDate } from '../lib/format';
import { DataTable, type Column } from '../ui/DataTable';
import { Page } from '../ui/Page';
import { TextStatus, Who } from '../ui/primitives';
import { AddBtn, Amount, Cell2, editCol } from './common';

export default function Assets() {
  const { lookups } = useSession();
  const cols: Column[] = [
    { key: 'asset_type', label: 'Asset', sort: 'asset_type', render: (r) => <Cell2 top={String(r.asset_type)} sub={[r.make_model, r.serial_number].filter(Boolean).join(' · ')} /> },
    { key: 'assigned_to_name', label: 'Assigned to', render: (r) => <Who name={r.assigned_to_name} /> },
    { key: 'status', label: 'Status', render: (r) => <TextStatus value={r.status} /> },
    { key: 'purchase_date', label: 'Bought', cls: 'nowrap opt', sort: 'purchase_date', render: (r) => fmtDate(r.purchase_date) },
    { key: 'purchase_value', label: 'Cost', num: true, sort: 'purchase_value', render: (r) => <Amount v={r.purchase_value} dash /> },
    { key: 'current_value', label: 'Value now', num: true, render: (r) => <Amount v={r.current_value} dash /> },
    editCol('assets', true),
  ];
  return (
    <Page title="Assets" sub="Laptops, phones and other devices the company owns." actions={<><AddBtn resource="assets" label="New asset" /></>}>
      <DataTable resource="assets" columns={cols} searchPlaceholder="Search assets…" noun="asset"
        filters={[{ key: 'asset_type', label: 'All types', options: settingList(lookups, 'asset_types') }, { key: 'assigned_to', label: 'Anyone', lookup: 'users' }]}
        empty={{ title: 'No assets yet', text: 'Add the devices your team uses.' }} />
    </Page>
  );
}
