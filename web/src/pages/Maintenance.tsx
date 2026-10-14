import { MaintenanceTable } from '../components/FinanceTables';
import { useGet } from '../lib/hooks';
import { Page } from '../ui/Page';
import { Kpis } from '../ui/primitives';
import {} from './common';

export default function Maintenance() {
  const a = useGet<{ maintenance: { open: number; hours_30d: number } }>('/analytics/delivery');
  return (
    <Page title="Maintenance" sub="Fixes, updates and support for sites you have already delivered.">
      {a.data && <Kpis items={[{ label: 'Open items', value: a.data.maintenance.open }, { label: 'Hours, last 30 days', value: a.data.maintenance.hours_30d }]} />}
      <MaintenanceTable />
    </Page>
  );
}
