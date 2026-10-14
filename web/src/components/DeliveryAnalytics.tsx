import { CR_PHASES, CR_STATUSES, PROJECT_STATUSES, TASK_STATUSES, labelOf } from '@crm/shared';
import { Link } from 'react-router-dom';
import { fmtDate, fmtMonth, money } from '../lib/format';
import { useGet } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Columns, Donut, HBars, Legend, PALETTE } from '../ui/charts';
import { Badge, Due, ErrorBox, Kpis, Panel, Who } from '../ui/primitives';
import type { Row } from '../lib/api';

interface Kn { k: string; n: number }
interface Delivery {
  projects: { by_status: Kn[]; total: number; deadlines: Row[]; at_risk: Row[]; progress: { id: number; name: string; status: string; total: number; done: number }[] };
  change_requests: { open: number; by_status: Kn[]; by_phase: Kn[]; by_kind: Kn[]; monthly: { month: string; requested: number }[]; avg_days_to_approval: number | null; money?: Record<string, number>; needs_action: Row[] };
  tasks: { by_status: Kn[]; overdue: number; due_this_week: number; weekly: { week: string; done: number; created: number }[] };
  maintenance: { open: number; hours_30d: number; by_type: Kn[] };
  team: { id: number; name: string; role: string; open_tasks: number; overdue_tasks: number; done_week: number; projects_led: number }[];
}

const STATUS_COLOR: Record<string, string> = { planning: 'var(--amber)', active: 'var(--accent)', review: 'var(--blue)', on_hold: '#8a8780', at_risk: 'var(--red)', completed: 'var(--green)', maintenance: 'var(--plum)', cancelled: 'var(--faint)' };

/** Projects, change requests, tasks, support and team load. */
export function DeliveryAnalytics() {
  const { isFounder } = useSession();
  const q = useGet<Delivery>('/analytics/delivery');
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <div className="tbl"><div className="empty">Loading…</div></div>;
  const { projects: p, change_requests: c, tasks: t, maintenance: m, team } = q.data;
  const doneAll = t.by_status.find((x) => x.k === 'done')?.n ?? 0;
  const totalTasks = t.by_status.reduce((s, x) => s + x.n, 0);
  const running = p.by_status.filter((x) => ['planning', 'active', 'review', 'at_risk'].includes(x.k)).reduce((s, x) => s + x.n, 0);
  return (
    <div className="stack">
      <Kpis items={[
        { label: 'Projects', value: p.total, sub: `${running} in flight`, to: '/projects' },
        { label: 'Tasks done', value: `${totalTasks ? Math.round((100 * doneAll) / totalTasks) : 0}%`, sub: `${doneAll} of ${totalTasks}` },
        { label: 'Tasks overdue', value: t.overdue, tone: t.overdue ? 'bad' : undefined, sub: `${t.due_this_week} due this week`, to: '/tasks?scope=all' },
        { label: 'Open change requests', value: c.open, sub: c.avg_days_to_approval != null ? `Approved in ~${c.avg_days_to_approval} days` : 'None approved yet', to: '/change-requests', tone: c.open ? 'warn' : undefined },
        { label: 'Support items open', value: m.open, sub: `${m.hours_30d} h in 30 days` },
      ]} />
      <div className="dash-row">
        <Panel title="Projects by status">
          <Donut rows={p.by_status.map((s, i) => ({ k: labelOf(PROJECT_STATUSES, s.k), v: s.n, color: STATUS_COLOR[s.k] ?? PALETTE[i % PALETTE.length] as string }))} center={String(p.total)} fmt={(n) => String(n)} />
        </Panel>
        <Panel title="Tasks completed per week" actions={<Legend items={[{ name: 'Done', color: 'var(--green)' }, { name: 'Created', color: 'var(--accent)' }]} />}>
          <Columns labels={t.weekly.map((w) => fmtDate(w.week).replace(/ \d{4}$/, ''))} series={[{ name: 'Created', values: t.weekly.map((w) => w.created), color: 'var(--accent)' }, { name: 'Done', values: t.weekly.map((w) => w.done), color: 'var(--green)' }]} />
        </Panel>
      </div>
      <Panel title="Change requests" actions={<Link to="/change-requests" className="small">Open board →</Link>}>
        <div className="dash-row" style={{ alignItems: 'start' }}>
          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>By status</div>
            <HBars rows={c.by_status.map((s) => ({ k: labelOf(CR_STATUSES, s.k), v: s.n }))} fmt={(n) => String(n)} accent />
            <div className="small muted" style={{ margin: '14px 0 6px' }}>Before vs after delivery</div>
            <HBars rows={c.by_phase.map((s) => ({ k: labelOf(CR_PHASES, s.k), v: s.n }))} fmt={(n) => String(n)} />
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>Requested per month</div>
            <Columns labels={c.monthly.map((x) => fmtMonth(x.month))} series={[{ name: 'Requested', values: c.monthly.map((x) => x.requested), color: 'var(--plum)' }]} h={150} />
            {isFounder && c.money && (
              <div className="split2" style={{ marginTop: 14 }}>
                <div><div className="l">Awaiting a quote</div><div className="v">{money(c.money.awaiting_quote)}</div><div className="s">Quoted, not yet approved {money(c.money.quoted)}</div></div>
                <div><div className="l">Approved work</div><div className="v">{money(c.money.approved)}</div><div className="s">{money(c.money.collected)} collected</div></div>
              </div>
            )}
          </div>
        </div>
        {c.needs_action.length > 0 && (
          <div className="list" style={{ marginTop: 14, borderTop: '1px solid var(--line)' }}>
            <div className="sub-h">Waiting for an estimate or quote</div>
            {c.needs_action.map((r) => <Link key={r.id} className="li" to={`/projects/${r.project_id ?? ''}?tab=changes`}><div className="grow"><div className="t">{String(r.title)}</div><div className="s">{String(r.project_name)} · asked {fmtDate(r.requested_on)}</div></div><Badge value={r.status} /></Link>)}
          </div>
        )}
      </Panel>
      <div className="dash-row">
        <Panel title="Project progress" bodyClass="flush">
          {p.progress.length ? <div className="list">{p.progress.map((x) => (
            <Link key={x.id} to={`/projects/${x.id}`} className="li"><div className="grow"><div className="t">{x.name}</div><div className="s">{labelOf(PROJECT_STATUSES, x.status)} · {x.done}/{x.total} tasks</div></div>
              <div className="prog"><div className="bar"><i style={{ width: `${x.total ? Math.round((100 * x.done) / x.total) : 0}%` }} /></div>{x.total ? Math.round((100 * x.done) / x.total) : 0}%</div></Link>
          ))}</div> : <div className="empty mini">No projects in flight.</div>}
        </Panel>
        <Panel title="Deadlines &amp; risks" bodyClass="flush">
          {p.at_risk.length + p.deadlines.length ? (
            <div className="list">
              {p.at_risk.map((x) => <Link key={`r${x.id}`} to={`/projects/${x.id}`} className="li"><div className="grow"><div className="t">{String(x.name)}</div><div className="s neg">At risk or past deadline</div></div><Due date={x.deadline} /></Link>)}
              {p.deadlines.filter((d) => !p.at_risk.some((r) => r.id === d.id)).map((x) => <Link key={`d${x.id}`} to={`/projects/${x.id}`} className="li"><div className="grow"><div className="t">{String(x.name)}</div><div className="s">{String(x.client_name ?? '')}</div></div><Due date={x.deadline} /></Link>)}
            </div>
          ) : <div className="empty mini">Nothing due in the next 30 days.</div>}
        </Panel>
      </div>
      <div className="dash-row">
        <Panel title="Task pipeline"><HBars rows={t.by_status.map((s) => ({ k: labelOf(TASK_STATUSES, s.k), v: s.n }))} fmt={(n) => String(n)} accent /></Panel>
        <Panel title="Support work by type"><HBars rows={m.by_type.map((s) => ({ k: s.k, v: s.n }))} fmt={(n) => String(n)} /></Panel>
      </div>
      <Panel title="Team workload" bodyClass="flush">
        <div className="tbl-scroll" tabIndex={0}><table className="t rep">
          <thead><tr><th>Person</th><th className="num">Open tasks</th><th className="num">Overdue</th><th className="num">Done this week</th><th className="num">Projects led</th></tr></thead>
          <tbody>{team.map((u) => <tr key={u.id}><td><Who name={u.name} /></td><td className="num">{u.open_tasks}</td><td className={`num ${u.overdue_tasks ? 'neg' : ''}`}>{u.overdue_tasks || '—'}</td><td className="num">{u.done_week || '—'}</td><td className="num">{u.projects_led || '—'}</td></tr>)}</tbody>
        </table></div>
      </Panel>
    </div>
  );
}
