import { Link } from 'react-router-dom';
import { SalesAnalytics } from '../components/SalesAnalytics';
import { useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { ExportBtn } from './common';

export default function SalesReport() {
  const { isFounder } = useSession();
  return (
    <Page title="Sales report" sub="Dashboard, Monthly, Department and Source analytics from your sheet — always up to date."
      actions={<><Link className="btn" to="/followups"><Icon name="phone" />Follow-ups</Link>{isFounder && <ExportBtn resource="leads" />}</>}>
      <SalesAnalytics />
    </Page>
  );
}
