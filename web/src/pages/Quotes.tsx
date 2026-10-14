import { QuotesTable } from '../components/FinanceTables';
import { useGet } from '../lib/hooks';
import { money } from '../lib/format';
import { Page } from '../ui/Page';
import { Kpis } from '../ui/primitives';
import {} from './common';

interface Sales { open_quotes: { n: number; v: number } }

export default function Quotes() {
  const s = useGet<Sales>('/analytics/sales');
  return (
    <Page title="Quotations" sub="Offers sent before work starts — to a lead, or for a change request. Nothing is owed until a quotation is accepted; then it starts a project or becomes an invoice.">
      {s.data && <Kpis items={[{ label: 'Quotations to leads, still open', value: s.data.open_quotes.n, sub: money(s.data.open_quotes.v) }]} />}
      <QuotesTable />
    </Page>
  );
}
