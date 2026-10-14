import { LEAD_STAGES, compact, daysUntil } from '@crm/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AttentionRow, useAttention } from '../components/Attention';
import { TaskModal } from '../components/TaskModal';
import { useEditor } from '../forms/RecordEditor';
import { api, type Row } from '../lib/api';
import { fmtMonth, money, plural } from '../lib/format';
import { useAct, useGet } from '../lib/hooks';
import { useSession } from '../lib/session';
import { ago } from '../shell/Bell';
import { HBars, Legend, LineChart } from '../ui/charts';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { Avatar, Badge, Due, ErrorBox, Kpis, LogoSq, Panel, Priority, Skeleton, pretty } from '../ui/primitives';

interface Dash {
  today: string; role: string; my_tasks: Row[]; deadlines: Row[]; my_projects: Row[]; tasks_overdue: number; followups?: Row[];
  renewals?: Row[]; kpi?: {
    open_leads: { n: number; v: number }; active_projects: number; receivables: number; overdue: { v: number; n: number }; month_income: number; month_expense: number; mrr: number; recurring_cost: number;
    quotes_pending: { n: number; v: number }; unbilled?: { amount: number; projects: number; pending: number; overdue: number; to_get: number; clients: number }; tds?: { deducted: number; claimed: number; to_claim: number }; open_change_requests: { n: number; v: number }; cash: number;
  };
  overdue_invoices?: Row[]; activity?: Row[]; overdue_tasks?: Row[]; pipeline?: Record<string, { n: number; v: number }>; trend?: { month: string; income: number; expense: number }[];
  team_load?: Row[]; by_client?: { k: string; v: number }[]; spend_by_category?: { k: string; v: number }[]; auto_debits?: Row[]; pending_estimates?: { n: number; v: number };
  work?: { clients: { n: number; active: number }; projects: { k: string; n: number }[]; invoices: { n: number; total: number; open: number } }; change_requests?: Row[];
}


function TaskLine({ t, onOpen, onDone }: { t: Row; onOpen(id: number): void; onDone(id: number): void }) {
  return (
    <div className="li" style={{ cursor: 'pointer' }} onClick={() => onOpen(t.id)}>
      <button type="button" className="check-btn" title="Mark as done" aria-label={`Mark ${String(t.title)} as done`} onClick={(e) => { e.stopPropagation(); onDone(t.id); }} />
      <div className="grow"><div className="t">{String(t.title)}</div><div className="s">{String(t.project_name ?? 'No project')}{Number(t.comment_count) ? ` · ${t.comment_count} comment${t.comment_count === 1 ? '' : 's'}` : ''}</div></div>
      {['high', 'urgent'].includes(String(t.priority)) ? <Priority value={t.priority} /> : null}<Due date={t.due_date} />
    </div>
  );
}

function Overview() {
  const nav = useNavigate();
  const { isFounder, user } = useSession();
  const editor = useEditor();
  const q = useGet<Dash>('/dashboard');
  const attn = useAttention();
  const [openTask, setOpenTask] = useState<number | null>(null);
  const done = useAct((id: number) => api.put(`/tasks/${id}`, { status: 'done' }), 'Nice — task marked as done');
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton kind="dash" />;
  const d = q.data;
  const k = d.kpi;
    const now = new Date();
  const greet = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const stages = LEAD_STAGES.filter(([v]) => !['won', 'closed', 'lost'].includes(v));
  const byValue = stages.some(([v]) => (d.pipeline?.[v]?.v ?? 0) > 0);
  const pmax = Math.max(1, ...stages.map(([v]) => (byValue ? d.pipeline?.[v]?.v : d.pipeline?.[v]?.n) ?? 0));
  const tr = d.trend ?? [];

  const attention = (
    <Panel title="Needs attention" actions={<Link to="/actions">{attn.data ? `See all ${attn.data.total}` : 'See all'}</Link>} bodyClass="flush">
      {attn.data?.items.length ? <div className="list">{attn.data.items.slice(0, 8).map((i) => <AttentionRow key={i.key} i={i} />)}</div>
        : <div className="empty mini iconic"><span className="em-i"><Icon name="check" /></span><span>Nothing is overdue or waiting on you. Good place to be.</span></div>}
    </Panel>
  );
  const myTasks = (
    <Panel title="My tasks" actions={<Link to="/tasks">My work</Link>} bodyClass="flush">
      {d.my_tasks.length ? <div className="list">{d.my_tasks.slice(0, isFounder ? 5 : 12).map((x) => <TaskLine key={x.id} t={x} onOpen={setOpenTask} onDone={(id) => done.mutate(id)} />)}</div>
        : <div className="empty mini iconic"><span className="em-i"><Icon name="check" /></span><span>Nothing assigned to you. Enjoy the quiet.</span><Link className="btn sm" to="/tasks?scope=all">See the team board</Link></div>}
    </Panel>
  );

  if (!isFounder || !k) {
    const week = d.my_tasks.filter((x) => x.due_date && daysUntil(String(x.due_date)) <= 7).length;
    return (
      <>
        <Kpis items={[{ label: 'Open tasks', value: d.my_tasks.length }, { label: 'Due this week', value: week }, { label: 'Overdue', value: d.tasks_overdue, tone: d.tasks_overdue ? 'bad' : undefined }, { label: 'My projects', value: d.my_projects.length }]} />
        <div className="dash">
          <div className="dash-row">
            {myTasks}
            <Panel title="Upcoming deadlines" bodyClass="flush">
              {d.deadlines.length ? <div className="list">{d.deadlines.map((p) => <Link key={p.id} to={`/projects/${p.id}`} className="li"><LogoSq name={p.name} size="sm" /><div className="grow"><div className="t">{String(p.name)}</div><div className="s">{String(p.client_name ?? '')}</div></div><Due date={p.deadline} /></Link>)}</div> : <div className="empty mini">No deadlines in the next 3 weeks.</div>}
            </Panel>
          </div>
          <div className="dash-row">
            <Panel title="My projects" bodyClass="flush">
              {d.my_projects.length ? <div className="list">{d.my_projects.map((p) => <Link key={p.id} to={`/projects/${p.id}`} className="li"><LogoSq name={p.name} size="sm" /><div className="grow"><div className="t">{String(p.name)}</div><div className="s">{String(p.client_name ?? '')}</div></div><Badge value={p.status} /></Link>)}</div> : <div className="empty mini">You have not been added to a project yet.</div>}
            </Panel>
            {attention}
          </div>
        </div>
        {openTask && <TaskModal taskId={openTask} onClose={() => setOpenTask(null)} />}
      </>
    );
  }

  const net = k.month_income - k.month_expense;
  return (
    <>
      <div className="hello"><h1>{greet}, {user.name.split(' ')[0]}</h1>
        <div className="sub">{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · {attn.data?.total ? `${plural(attn.data.total, 'thing')} need${attn.data.total === 1 ? 's' : ''} attention` : 'all clear'}</div></div>
      <Kpis items={[
        { label: 'Collected this month', value: money(k.month_income), sub: `Spent ${money(k.month_expense)}` },
        { label: 'Net this month', value: money(net), tone: net < 0 ? 'bad' : undefined, sub: 'Collected − spent' },
        { label: 'Still to get', value: money(k.unbilled?.to_get ?? 0), tone: k.unbilled?.to_get ? 'warn' : 'good', sub: k.unbilled?.overdue ? <span className="neg">{money(k.unbilled.overdue)} overdue</span> : k.unbilled?.to_get ? `From ${plural(k.unbilled.clients, 'client')}` : 'Everything is paid', to: '/analytics?tab=receivables' },
        { label: 'Open pipeline', value: money(k.open_leads.v), sub: plural(k.open_leads.n, 'open deal'), to: '/leads' },
        { label: 'Cash in bank', value: money(k.cash), sub: `${money(k.mrr)}/mo maintenance income`, to: '/finance?tab=accounts' },
      ]} />
      <Kpis items={[
        { label: 'Projects in flight', value: k.active_projects, to: '/projects' },
        { label: 'Open change requests', value: k.open_change_requests.n, sub: `${money(k.open_change_requests.v)} estimated`, to: '/change-requests' },
        { label: 'Quotations out', value: k.quotes_pending.n, sub: money(k.quotes_pending.v), to: '/quotes' },
        { label: 'Running cost / month', value: money(k.recurring_cost), to: '/renewals' },
        { label: 'Bills to confirm', value: d.pending_estimates?.n ?? 0, sub: d.pending_estimates?.n ? `${money(d.pending_estimates.v)} estimated` : 'None', tone: d.pending_estimates?.n ? 'warn' : undefined, to: '/finance?tab=expenses' },
      ]} />
      <div className="dash">
        <div className="dash-row">
          <Panel title="Cash flow" actions={<Legend items={[{ name: 'Collected', color: 'var(--accent)' }, { name: 'Spent', color: '#c47f17' }]} />}>
            <LineChart labels={tr.map((x) => fmtMonth(x.month))} h={220} net series={[{ name: 'Collected', values: tr.map((x) => x.income), color: 'var(--accent)', fill: true }, { name: 'Spent', values: tr.map((x) => x.expense), color: '#c47f17', dash: true }]} />
          </Panel>
          <Panel title="Pipeline" actions={<Link to="/leads">Open pipeline</Link>} bodyClass="funnel">
            {stages.map(([v, l]) => { const s = d.pipeline?.[v] ?? { n: 0, v: 0 }; return <div className="r" key={v}><span className="muted">{l}</span><div className="tr"><i style={{ width: `${Math.max(8, (100 * (byValue ? s.v : s.n)) / pmax)}%` }}>{s.n}</i></div><span className="right tnum">{s.v ? compact(s.v) : ''}</span></div>; })}
          </Panel>
        </div>
        <div className="dash-row">{attention}{myTasks}</div>
        <div className="dash-row">
          <Panel title="Projects in flight" actions={<Link to="/projects">All projects</Link>} bodyClass="flush">
            {d.my_projects.length ? (
              <div className="tbl-scroll" tabIndex={0}><table className="t"><tbody>
                {d.my_projects.map((p) => (
                  <tr key={p.id} className="click" onClick={() => nav(`/projects/${p.id}`)}>
                    <td><div className="who"><LogoSq name={p.name} size="sm" /><div style={{ minWidth: 0 }}><div className="t1 ellipsis">{String(p.name)}</div><div className="t2 ellipsis">{String(p.client_name ?? '')}</div></div></div></td>
                    <td><Badge value={p.status} /></td>
                    <td><div className="prog"><div className="bar"><i style={{ width: `${Number(p.task_count) ? Math.round((100 * Number(p.tasks_done)) / Number(p.task_count)) : 0}%` }} /></div>{Number(p.task_count) ? `${Math.round((100 * Number(p.tasks_done)) / Number(p.task_count))}%` : '—'}</div></td>
                    <td className="num">{Number(p.cr_open) ? <span className="tag amber" title="Open change requests">{String(p.cr_open)} CR</span> : null}</td>
                    <td className="num"><Due date={p.deadline} /></td>
                    <td style={{ width: 40 }}>{p.manager_name ? <Avatar name={p.manager_name} size="sm" /> : null}</td>
                  </tr>
                ))}
              </tbody></table></div>
            ) : <div className="empty mini">No active projects.</div>}
          </Panel>
          <Panel title="Team" bodyClass="flush">
            <div className="list">{(d.team_load ?? []).map((u) => (
              <Link key={u.id} className="li" to={`/tasks?scope=all&assignee=${u.id}`}><Avatar name={u.name} /><div className="grow"><div className="t">{String(u.name)}</div><div className="s">{String(u.open_tasks)} open{Number(u.overdue_tasks) ? <> · <span className="neg">{String(u.overdue_tasks)} overdue</span></> : null}</div></div><span className="small muted">{String(u.done_week)} done this week</span></Link>
            ))}</div>
          </Panel>
        </div>
        <div className="dash-row">
          <Panel title="Revenue by client" actions={<Link to="/clients">All clients</Link>}><HBars rows={d.by_client ?? []} fmt={compact} /></Panel>
          <Panel title="Where the money goes" actions={<Link to="/finance">Finance</Link>}><HBars rows={d.spend_by_category ?? []} fmt={compact} accent /></Panel>
        </div>
        <div className="dash-row">
          <Panel title="Clients, projects &amp; invoices" actions={<Link to="/projects">Projects</Link>}>
            {d.work && (
              <>
                <div className="kv-row"><b className="tnum" style={{ fontSize: 22 }}>{d.work.clients.n}</b> <span className="muted">clients · {d.work.clients.active || 0} active</span></div>
                <div style={{ margin: '10px 0 4px' }}>{d.work.projects.map((p) => <span key={p.k} className="tag" style={{ margin: '0 6px 6px 0' }}>{p.n} {pretty(p.k)}</span>)}</div>
                <div className="muted small" style={{ marginTop: 8 }}>{plural(d.work.invoices.n, 'invoice')} · {money(d.work.invoices.total)} billed · {d.work.invoices.open ? <span className="neg">{money(d.work.invoices.open)} unpaid</span> : 'all paid'}</div>
              </>
            )}
          </Panel>
          <Panel title="Debits itself soon" actions={<Link to="/renewals">Manage</Link>} bodyClass="flush">
            {d.auto_debits?.length ? <div className="list">{d.auto_debits.map((r) => <Link key={r.id} className="li" to="/renewals"><div className="grow"><div className="t">{String(r.name)}{r.amount_varies ? <span className="tag amber" style={{ marginLeft: 6 }}>varies</span> : null}</div><div className="s">{String(r.vendor ?? '')} · {money(r.our_cost)} · {pretty(r.cycle)}</div></div><Due date={r.renewal_date} /></Link>)}</div>
              : <div className="empty mini iconic"><span className="em-i"><Icon name="refresh" /></span><span>No automatic debits in the next 45 days.</span></div>}
          </Panel>
        </div>
        <Panel title="Recent activity" actions={<Link to="/audit">Full log</Link>} bodyClass="flush">
          {d.activity?.length ? (
            <div className="list act-grid">{d.activity.slice(0, 8).map((a) => (
              <div className="act" key={a.id}><Avatar name={a.user_name ?? '?'} size="sm" /><div className="grow ellipsis" title={String(a.detail ?? '')}><b>{String(a.user_name ?? 'System').split(' ')[0]}</b> <span className="x">{a.action === 'create' ? 'added' : a.action === 'update' ? 'updated' : a.action === 'delete' ? 'deleted' : String(a.action)} {String(a.entity ?? '').replace(/_/g, ' ').replace(/s$/, '')}</span> {String(a.detail ?? '')}</div><span className="w">{ago(a.at)}</span></div>
            ))}</div>
          ) : <div className="empty mini">Nothing yet.</div>}
        </Panel>
      </div>
      {openTask && <TaskModal taskId={openTask} onClose={() => setOpenTask(null)} />}
      <button type="button" hidden onClick={() => editor.open({ resource: 'leads' })} />
    </>
  );
}

export default function Dashboard() {
  const { isFounder, user } = useSession();
  const editor = useEditor();
  const nav = useNavigate();
  return (
    <Page title="Home" crumbs={<b>Home</b>}
      actions={isFounder ? (
        <>
          <Link className="btn" to="/analytics"><Icon name="activity" />Analytics</Link>
          <button type="button" className="btn" onClick={() => editor.open({ resource: 'leads', defaults: { owner_id: user.id }, onDone: (l) => l && nav(`/leads/${l.id}`) })}><Icon name="plus" />Lead</button>
          <Link className="btn primary" to="/invoices/new"><Icon name="plus" />Invoice</Link>
        </>
      ) : <Link className="btn primary" to="/tasks">Open my work</Link>}>
      <Overview />
    </Page>
  );
}
