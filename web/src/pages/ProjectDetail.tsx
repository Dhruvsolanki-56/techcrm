import { daysUntil } from '@crm/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CRTable } from '../components/ChangeRequests';
import { CredentialsPanel } from '../components/Credentials';
import { DocsPanel } from '../components/Docs';
import { ExpensesTable, InvoicesTable, MaintenanceTable, PaymentsTable, QuotesTable } from '../components/FinanceTables';
import { HistoryPanel } from '../components/HistoryPanel';
import { PaymentSchedule } from '../components/PaymentSchedule';
import { Notes } from '../components/Notes';
import { Highlights, Hl, Meta, Prop, PropsSec, Record, RecHead } from '../components/record';
import { TaskModal } from '../components/TaskModal';
import { useEditor } from '../forms/RecordEditor';
import { api, type Row } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { useAct, useGet, useParam, useRecord } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Page, SectionH } from '../ui/Page';
import { Avatar, Badge, Crumb, ErrorBox, ExtLink, Kpis, Priority, Skeleton, Tabs, Who, pretty } from '../ui/primitives';
import { TaskBoard } from './Tasks';
import { pctDone } from './Projects';

interface Member { id: number; name: string; title: string | null; role: string }

function TeamModal({ projectId, members, onClose }: { projectId: number; members: Member[]; onClose(): void }) {
  const { lookups } = useSession();
  const [ids, setIds] = useState<number[]>(members.map((m) => m.id));
  const save = useAct(() => api.put(`/projects/${projectId}/members`, { user_ids: ids }), 'Team updated', onClose);
  return (
    <Modal title="Project team" sub="Interns only see projects they are part of." onClose={onClose} dirty
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={() => save.mutate()}>Save team</button></>}>
      <div className="list">
        {lookups.users.map((u) => (
          <label className="check" key={u.id} style={{ padding: '9px 0', alignItems: 'center' }}>
            <input type="checkbox" checked={ids.includes(u.id)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, u.id] : x.filter((i) => i !== u.id)))} />
            <Avatar name={u.name} size="sm" /><span>{u.name} <span className="muted small">· {u.title || pretty(u.role)}</span></span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isFounder, can, user } = useSession();
  const editor = useEditor();
  const q = useRecord('projects', id);
  const members = useGet<Member[]>(id ? `/projects/${id}/members` : null);
  const [tab, setTab] = useParam('tab', 'overview');
  const [team, setTeam] = useState(false);
  const [openTask, setOpenTask] = useState<number | null>(null);

  if (q.isPending) return <div id="page"><Skeleton kind="record" /></div>;
  if (q.isError) return <div id="page"><ErrorBox error={q.error} retry={() => void q.refetch()} /></div>;
  const p = q.data as Row;
  const pid = Number(p.id);
  const mem = members.data ?? [];
  const days = p.deadline ? daysUntil(String(p.deadline)) : null;
  const closed = ['completed', 'cancelled'].includes(String(p.status));
  const crOpen = Number(p.cr_open);

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'changes', label: 'Change requests', count: Number(p.cr_count) || null },
    { key: 'files', label: 'Files' },
    { key: 'activity', label: 'Activity' },
    ...(isFounder ? [{ key: 'vault', label: 'Credentials' }, { key: 'finance', label: 'Finance' }] : []),
    ...(can('maintenance') || p.status === 'maintenance' ? [{ key: 'care', label: 'Maintenance' }] : []),
    { key: 'history', label: 'History' },
  ];

  return (
    <Page title={String(p.name)} crumbs={<><Crumb to="/projects">Projects</Crumb><b>{String(p.name)}</b></>}
      actions={<>
        <button type="button" className="btn" onClick={() => editor.open({ resource: 'tasks', defaults: { project_id: pid, assignee_id: user.id }, onDone: () => setTab('tasks') })}><Icon name="plus" />Task</button>
        {isFounder && <button type="button" className="btn" onClick={() => editor.open({ resource: 'change_requests', defaults: { project_id: pid }, onDone: () => setTab('changes') })}><Icon name="plus" />Change request</button>}
        {isFounder && <button type="button" className="btn" onClick={() => editor.open({ resource: 'projects', record: p, onDone: (r) => { if (!r) nav('/projects'); } })}><Icon name="edit" />Edit</button>}
      </>}>
      <Record
        main={<>
          <RecHead name={String(p.name)} refId={p.ref ?? p.code} meta={<><Badge value={p.status} />{p.client_id ? <Link to={`/clients/${p.client_id}`}>{String(p.client_name ?? '')}</Link> : null}<Meta><span className="mono">{String(p.code ?? '')}</span></Meta></>} />
          <Highlights>
            <Hl label="Progress" value={`${pctDone(p)}%`} sub={`${p.tasks_done} of ${p.task_count} tasks done`} />
            <Hl label="Deadline" value={p.deadline ? fmtDate(p.deadline).replace(/ \d{4}$/, '') : '—'}
              sub={days === null || closed ? (p.completed_on ? `Completed ${fmtDate(p.completed_on)}` : '') : days < 0 ? <span className="neg">{-days} days late</span> : `${days} days left`}
              tone={!closed && days !== null && days < 0 && !['maintenance', 'on_hold'].includes(String(p.status)) ? 'bad' : ''} />
            {isFounder && <Hl label="Project value" value={p.budget || p.cr_value ? money(p.revised_value) : '—'} sub={Number(p.cr_value) ? `${money(p.budget)} + ${money(p.cr_value)} change requests` : ''} />}
            <Hl label="Open tasks" value={Number(p.task_count) - Number(p.tasks_done)} sub={crOpen ? `${crOpen} open change request${crOpen > 1 ? 's' : ''}` : ''} />
          </Highlights>
          <Tabs tabs={tabs} active={tabs.some((t) => t.key === tab) ? tab : 'overview'} onChange={setTab} />
          <div style={{ marginTop: 18 }}>
            {tab === 'overview' && (
              <div className="stack">
                {p.description ? <p className="doc-text" style={{ fontSize: 14 }}>{String(p.description)}</p> : null}
                <section className="panel"><div className="panel-h"><h2>Scope &amp; specification</h2></div>
                  <div className="panel-b doc-text pre">{p.specs ? String(p.specs) : <span className="faint">No specification yet.{isFounder ? ' Use Edit to write the scope: pages, features, integrations, hosting and what is out of scope.' : ''}</span>}</div></section>
              </div>
            )}
            {tab === 'tasks' && <TaskBoard query={{ project_id: pid }} onOpen={setOpenTask} />}
            {tab === 'changes' && <CRTable projectId={pid} />}
            {tab === 'files' && <DocsPanel entityType="project" entityId={pid} />}
            {tab === 'history' && <HistoryPanel resource="projects" id={pid} />}
            {tab === 'activity' && <Notes type="project" id={pid} placeholder="Decisions, client feedback, blockers…" />}
            {tab === 'vault' && isFounder && <CredentialsPanel project_id={pid} client_id={Number(p.client_id) || undefined} />}
            {tab === 'finance' && isFounder && (
              <div className="stack">
                <Kpis items={[
                  { label: 'Invoiced', value: money(p.total_billed), sub: Number(p.revised_value) ? `of ${money(p.revised_value)} agreed` : '' },
                  { label: 'Received', value: money(p.total_received) },
                  { label: 'Still to get', value: money(p.to_get), tone: Number(p.to_get) > 0 ? 'warn' : 'good', sub: Number(p.to_get) > 0 ? [Number(p.pending_amount) > 0 ? `${money(p.pending_amount)} invoiced, unpaid` : '', Number(p.to_invoice) > 0 ? `${money(p.to_invoice)} not invoiced yet` : ''].filter(Boolean).join(' · ') : 'Everything is paid' },
                  { label: 'Expenses', value: money(p.total_expenses) },
                  { label: 'Profit so far', value: money(Number(p.total_received) - Number(p.total_expenses)), sub: 'Received − expenses', tone: Number(p.total_received) - Number(p.total_expenses) < 0 ? 'bad' : 'good' },
                ]} />
                <PaymentSchedule project={p} />
                <div><SectionH title="Quotations" /><QuotesTable query={{ project_id: pid }} compact /></div>
                <div><SectionH title="Invoices" /><InvoicesTable query={{ project_id: pid }} projectId={pid} clientId={Number(p.client_id)} compact /></div>
                <div><SectionH title="Payments" /><PaymentsTable query={{ project_id: pid }} compact defaults={{ client_id: p.client_id, project_id: pid }} /></div>
                <div><SectionH title="Expenses" /><ExpensesTable query={{ project_id: pid }} compact defaults={{ project_id: pid }} /></div>
              </div>
            )}
            {tab === 'care' && <MaintenanceTable query={{ project_id: pid }} compact defaults={{ project_id: pid, client_id: p.client_id }} />}
          </div>
        </>}
        side={<>
          <PropsSec title="Properties">
            <Prop label="Status"><Badge value={p.status} /></Prop>
            <Prop label="Priority"><Priority value={p.priority} /></Prop>
            <Prop label="Lead">{p.manager_name ? <Who name={p.manager_name} /> : null}</Prop>
            <Prop label="Client">{p.client_id ? <Link to={`/clients/${p.client_id}`}>{String(p.client_name ?? '')}</Link> : null}</Prop>
            <Prop label="Type">{p.type ? String(p.type) : null}</Prop>
            <Prop label="Start">{p.start_date ? fmtDate(p.start_date) : null}</Prop>
            <Prop label="Deadline">{p.deadline ? fmtDate(p.deadline) : null}</Prop>
            <Prop label="Tech stack">{p.tech_stack ? String(p.tech_stack) : null}</Prop>
          </PropsSec>
          <PropsSec title="Links">
            <Prop label="Live"><ExtLink url={p.live_url} /></Prop>
            <Prop label="Staging"><ExtLink url={p.staging_url} /></Prop>
            <Prop label="Repository"><ExtLink url={p.repo_url} /></Prop>
            <Prop label="Design"><ExtLink url={p.design_url} /></Prop>
          </PropsSec>
          <PropsSec title={`Team · ${mem.length}`} action={isFounder ? <button type="button" className="btn sm ghost" onClick={() => setTeam(true)}>Manage</button> : null}>
            {mem.length ? mem.map((m) => <div className="person" key={m.id}><Avatar name={m.name} size="lg" /><div><div className="n">{m.name}</div><div className="r">{m.title || pretty(m.role)}</div></div></div>) : <div className="faint small">Nobody assigned yet.</div>}
          </PropsSec>
        </>} />
      {team && <TeamModal projectId={pid} members={mem} onClose={() => setTeam(false)} />}
      {openTask && <TaskModal taskId={openTask} onClose={() => setOpenTask(null)} />}
    </Page>
  );
}
