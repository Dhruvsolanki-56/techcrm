import { DeliveryAnalytics } from '../components/DeliveryAnalytics';
import { FinanceAnalytics } from '../components/FinanceAnalytics';
import { GrantsAnalytics, IncomeAnalytics, ReceivablesAnalytics, SpendingAnalytics, SubscriptionsAnalytics } from '../components/MoneyAnalytics';
import { SalesAnalytics } from '../components/SalesAnalytics';
import { TdsAnalytics } from '../components/TdsAnalytics';
import { useParam } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Page } from '../ui/Page';
import { Tabs } from '../ui/primitives';

/** Every kind of analytics in one place, so nothing is split across screens. */
export default function Analytics() {
  const { isFounder, can } = useSession();
  const tabs = [
    ...(can('leads') ? [{ key: 'sales', label: 'Sales' }] : []),
    { key: 'delivery', label: 'Delivery' },
    ...(isFounder ? [
      { key: 'receivables', label: 'Received & pending' }, { key: 'income', label: 'Income' }, { key: 'tds', label: 'TDS' }, { key: 'spending', label: 'Spending' },
      { key: 'grants', label: 'Grants' }, { key: 'subscriptions', label: 'Subscriptions' }, { key: 'trends', label: 'Profit & trends' },
    ] : []),
  ];
  const [tab, setTab] = useParam('tab', tabs[0]?.key ?? 'delivery');
  const active = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key ?? 'delivery');
  return (
    <Page title="Analytics" sub="Sales, delivery and every rupee: what came in, what is pending, where it went.">
      <Tabs tabs={tabs} active={active} onChange={setTab} />
      <div style={{ marginTop: 18 }}>
        {active === 'sales' && <SalesAnalytics />}
        {active === 'delivery' && <DeliveryAnalytics />}
        {active === 'receivables' && isFounder && <ReceivablesAnalytics />}
        {active === 'income' && isFounder && <IncomeAnalytics />}
        {active === 'tds' && isFounder && <TdsAnalytics />}
        {active === 'spending' && isFounder && <SpendingAnalytics />}
        {active === 'grants' && isFounder && <GrantsAnalytics />}
        {active === 'subscriptions' && isFounder && <SubscriptionsAnalytics />}
        {active === 'trends' && isFounder && <FinanceAnalytics />}
      </div>
    </Page>
  );
}
