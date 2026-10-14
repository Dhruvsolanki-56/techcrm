import { CRBoard, CRTable } from '../components/ChangeRequests';
import { useGet, useParam } from '../lib/hooks';
import { money } from '../lib/format';
import { useSession } from '../lib/session';
import { Page } from '../ui/Page';
import { Kpis, Seg } from '../ui/primitives';

interface Delivery { change_requests: { open: number; avg_days_to_approval: number | null; money?: Record<string, number>; by_phase: { k: string; n: number }[] } }

export default function ChangeRequests() {
  const { isFounder } = useSession();
  const [view, setView] = useParam('view', 'board');
  const a = useGet<Delivery>('/analytics/delivery');
  const cr = a.data?.change_requests;
  const m = cr?.money;
  return (
    <Page title="Change requests" sub="Anything a client asks to change or add — before or after delivery — from request to quotation to invoice."
      actions={<Seg value={view as 'board' | 'list'} onChange={setView} options={[['board', 'Board'], ['list', 'List']]} />}>
      {cr && (
        <Kpis items={[
          { label: 'Open', value: cr.open, sub: 'Not yet delivered or closed' },
          { label: 'After delivery', value: cr.by_phase.find((p) => p.k === 'after_delivery')?.n ?? 0, sub: 'On live projects' },
          { label: 'Avg. days to approval', value: cr.avg_days_to_approval ?? '—' },
          ...(isFounder && m ? [
            { label: 'Awaiting a quote', value: money(m.awaiting_quote ?? 0) },
            { label: 'Quoted, not approved', value: money(m.quoted ?? 0) },
            { label: 'Approved work', value: money(m.approved ?? 0), sub: `${money(m.collected ?? 0)} collected` },
          ] : []),
        ]} />
      )}
      {view === 'board' ? <CRBoard /> : <CRTable />}
    </Page>
  );
}
