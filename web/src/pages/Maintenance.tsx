import { MaintenanceTable } from '../components/FinanceTables';
import { useGet } from '../lib/hooks';
import { money } from '../lib/format';
import { useSession } from '../lib/session';
import { Page, SectionH } from '../ui/Page';
import { Kpis } from '../ui/primitives';
import { PlansTable } from './Renewals';

export default function Maintenance() {
  const { isFounder } = useSession();
  const a = useGet<{ maintenance: { open: number; hours_30d: number } }>('/analytics/delivery');
  const fin = useGet<{ recurring: { mrr: number } }>(isFounder ? '/analytics/finance' : null);
  return (
    <Page title="Maintenance" sub="Fixes, updates and support for sites you have already delivered, and the plans clients pay for.">
      {a.data && (
        <Kpis items={[
          { label: 'Open items', value: a.data.maintenance.open },
          { label: 'Hours, last 30 days', value: a.data.maintenance.hours_30d },
          ...(isFounder ? [{ label: 'Plan income / month', value: money(fin.data?.recurring.mrr ?? 0), tone: 'good' as const, sub: 'From active maintenance plans' }] : []),
        ]} />
      )}
      <MaintenanceTable />
      {isFounder && (
        <>
          <SectionH title="Maintenance plans clients pay for" />
          <PlansTable />
        </>
      )}
    </Page>
  );
}
