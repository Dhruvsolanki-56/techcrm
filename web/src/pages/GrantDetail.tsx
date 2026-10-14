import { useParams } from 'react-router-dom';
import { DocsPanel } from '../components/Docs';
import { HistoryPanel } from '../components/HistoryPanel';
import { ExpensesTable } from '../components/FinanceTables';
import { GrantCard } from '../components/MoneyAnalytics';
import { useEditor } from '../forms/RecordEditor';
import type { Row } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { useGet, useParam } from '../lib/hooks';
import { Icon } from '../ui/Icon';
import { Page, SectionH } from '../ui/Page';
import { Crumb, ErrorBox, Skeleton, Tabs } from '../ui/primitives';

export default function GrantDetail() {
  const { id } = useParams();
  const editor = useEditor();
  const q = useGet<Row & { receipts: Row[] }>(`/analytics/grants/${id}`);
  const [tab, setTab] = useParam('tab', 'spent');
  if (q.isPending) return <div id="page"><Skeleton kind="record" /></div>;
  if (q.isError) return <div id="page"><ErrorBox error={q.error} retry={() => void q.refetch()} /></div>;
  const g = q.data as never as Row & { receipts: Row[] };
  const gid = Number(g.id);
  const tabs = [{ key: 'spent', label: 'Spent from this grant' }, { key: 'received', label: 'Money received' }, { key: 'files', label: 'Reports & files' }, { key: 'history', label: 'History' }];
  return (
    <Page title={String(g.name)} crumbs={<><Crumb to="/grants">Grants</Crumb><b>{String(g.name)}</b></>}
      actions={<button type="button" className="btn" onClick={() => editor.open({ resource: 'grants', record: g, canDelete: true })}><Icon name="edit" />Edit</button>}>
      <GrantCard g={g as never} detail />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div style={{ marginTop: 18 }}>
        {tab === 'spent' && <ExpensesTable query={{ grant_id: gid }} compact defaults={{ grant_id: gid }} />}
        {tab === 'received' && (
          <div className="list panel">
            {g.receipts.length ? g.receipts.map((r, i) => <div className="li" key={i}><div className="grow"><div className="t">{fmtDate(r.date)}</div><div className="s">{String(r.reference ?? r.notes ?? '')}</div></div><b className="tnum">{money(r.amount)}</b></div>) : <div className="empty mini">No instalment recorded yet. Add a payment with category “Grant” and pick this grant.</div>}
          </div>
        )}
        {tab === 'files' && <><SectionH title="Utilisation reports, sanction letters, receipts" /><DocsPanel entityType="grant" entityId={gid} /></>}
        {tab === 'history' && <HistoryPanel resource="grants" id={gid} />}
      </div>
    </Page>
  );
}
