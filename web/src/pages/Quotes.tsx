import { QuotesTable } from '../components/FinanceTables';
import { useGet } from '../lib/hooks';
import { money } from '../lib/format';
import { Page } from '../ui/Page';
import { Kpis } from '../ui/primitives';
import { ExportBtn } from './common';

interface Sales { open_quotes: { n: number; v: number } }

export default function Quotes() {
  const s = useGet<Sales>('/analytics/sales');
  return (
    <Page title="Quotations" sub="Proposals for leads and estimates for change requests. An accepted quotation becomes an invoice." actions={<ExportBtn resource="quotes" />}>
      {s.data && <Kpis items={[{ label: 'Quotations to leads, still open', value: s.data.open_quotes.n, sub: money(s.data.open_quotes.v) }]} />}
      <QuotesTable />
    </Page>
  );
}
