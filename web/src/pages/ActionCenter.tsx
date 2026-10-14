import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AREA_HELP, AttentionRow, useAttention, type AttentionItem } from '../components/Attention';
import { money } from '../lib/format';
import { useGet } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { Badge, Empty, ErrorBox, Kpis, Panel, Seg } from '../ui/primitives';

const AREAS = ['Money', 'Sales', 'Delivery', 'Support', 'Admin'];
const SHOW = 5;
interface Rec { totals: { to_get: number; pending: number; overdue: number; unbilled: number }; projects: { id: number; name: string; client_id: number | null; client_name: string | null; status: string; pending: number; overdue: number; unbilled: number; to_get: number }[] }

/** What a person should do next: the money still to collect first, then everything else grouped by area. */
export default function ActionCenter() {
  const { isFounder } = useSession();
  const nav = useNavigate();
  const q = useAttention();
  const money$ = useGet<Rec>(isFounder ? '/analytics/receivables' : null);
  const [area, setArea] = useState('all');
  const [openAll, setOpenAll] = useState<Record<string, boolean>>({});
  if (q.isError) return <Page title="Action center"><ErrorBox error={q.error} retry={() => void q.refetch()} /></Page>;
  const d = q.data;
  const all = (d?.items ?? []).filter((i) => !(isFounder && i.panel)); // those are in the money table above
  const countOf = (a: string): number => all.filter((i) => i.area === a).length;
  const shown = area === 'all' ? AREAS : [area];
  const rec = money$.data;
  const owing = (rec?.projects ?? []).filter((p) => p.to_get >= 1).sort((a, b) => b.to_get - a.to_get);
  const now = (d?.counts.critical ?? 0) + (d?.counts.high ?? 0);

  return (
    <Page title="Action center" sub="What to do next, most important first. It is rebuilt from your live data every time you open it.">
      <Kpis items={[
        ...(isFounder ? [{ label: 'Still to get', value: money(rec?.totals.to_get ?? 0), tone: rec?.totals.to_get ? 'warn' as const : 'good' as const, sub: rec?.totals.to_get ? [rec.totals.pending ? `${money(rec.totals.pending)} invoiced, unpaid` : '', rec.totals.unbilled ? `${money(rec.totals.unbilled)} not invoiced yet` : ''].filter(Boolean).join(' · ') : 'Everything is paid' }] : []),
        { label: 'Needs you now', value: now, tone: d?.counts.critical ? 'bad' as const : now ? 'warn' as const : 'good' as const, sub: `${d?.counts.critical ?? 0} urgent · ${d?.counts.high ?? 0} this week` },
        { label: 'Tidy-ups', value: d?.counts.normal ?? 0, sub: 'Nothing is late, but worth doing' },
      ]} />

      {isFounder && owing.length > 0 && (area === 'all' || area === 'Money') && (
        <Panel title="Money still to get" actions={<Link to="/analytics?tab=receivables">Full breakdown</Link>} bodyClass="flush" className="ac-money">
          <div className="tbl-scroll" tabIndex={0}>
            <table className="t">
              <thead><tr><th>Client and project</th><th>What is left</th><th className="num">Still to get</th></tr></thead>
              <tbody>{owing.map((p) => (
                <tr key={`${p.id}-${p.client_id}`} className="click" onClick={() => nav(p.id ? `/projects/${p.id}?tab=finance` : `/clients/${p.client_id}?tab=billing`)}>
                  <td><b>{p.client_name ?? p.name}</b><div className="t2">{p.name} {p.id ? <Badge value={p.status} /> : null}</div></td>
                  <td>
                    {p.overdue > 0 && <div className="neg">{money(p.overdue)} overdue</div>}
                    {p.pending - p.overdue > 0.5 && <div>{money(p.pending - p.overdue)} invoiced, waiting for payment</div>}
                    {p.unbilled > 0.5 && <div>{money(p.unbilled)} not invoiced yet <span className="muted small">— raise the invoice</span></div>}
                  </td>
                  <td className="num"><b>{money(p.to_get)}</b></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="toolbar">
        <Seg value={area} onChange={setArea} options={[['all', `Everything ${all.length}`], ...AREAS.filter((a) => countOf(a)).map((a): [string, string] => [a, `${a} ${countOf(a)}`])]} />
      </div>

      {q.isPending ? <div className="empty mini">Checking…</div> : all.length === 0 ? <Empty mini icon="check" title="All clear">Nothing needs you right now.</Empty> : (
        shown.map((a) => {
          const list: AttentionItem[] = all.filter((i) => i.area === a);
          if (!list.length) return null;
          const expanded = openAll[a] || list.length <= SHOW + 1;
          const visible = expanded ? list : list.slice(0, SHOW);
          return (
            <section key={a} className="panel ac-group" aria-label={a}>
              <div className="panel-h"><h2>{a} <span className="count">{list.length}</span></h2><span className="small muted">{AREA_HELP[a]}</span></div>
              <div className="panel-b flush">
                <div className="list">{visible.map((i) => <AttentionRow key={i.key} i={i} pill />)}</div>
                {!expanded && <button type="button" className="ac-more" onClick={() => setOpenAll((o) => ({ ...o, [a]: true }))}>Show {list.length - SHOW} more <Icon name="chevDown" /></button>}
              </div>
            </section>
          );
        })
      )}
    </Page>
  );
}
