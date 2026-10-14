import { InvoicesTable } from '../components/FinanceTables';
import { useGet } from '../lib/hooks';
import { money } from '../lib/format';
import { Page } from '../ui/Page';
import { Kpis } from '../ui/primitives';
import {} from './common';

interface Summary { receivables: number; aging: { current: number; d30: number; d60: number; d90: number; d90p: number } }
interface Status { k: string; n: number; total: number; open: number }

export default function Invoices() {
  const fin = useGet<Summary>('/finance/summary');
  const a = useGet<{ invoice_status: Status[] }>('/analytics/finance');
  const st = (k: string) => a.data?.invoice_status.find((x) => x.k === k);
  const late = fin.data ? fin.data.aging.d30 + fin.data.aging.d60 + fin.data.aging.d90 + fin.data.aging.d90p : 0;
  return (
    <Page title="Invoices" sub="Bills sent to clients, with payment status.">
      <Kpis items={[
        { label: 'Invoiced, unpaid', value: money(fin.data?.receivables ?? 0), sub: 'Sent, part-paid and overdue' },
        { label: 'Overdue', value: money(late), tone: late ? 'bad' : undefined, sub: `${st('overdue')?.n ?? 0} invoices` },
        { label: 'Drafts', value: st('draft')?.n ?? 0, sub: 'Not sent yet' },
        { label: 'Paid', value: money(st('paid')?.total ?? 0), tone: 'good', sub: `${st('paid')?.n ?? 0} invoices` },
      ]} />
      <InvoicesTable />
    </Page>
  );
}
