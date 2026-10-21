import { LinkTo, ProjectLink } from './common';
import { PRIORITIES, TASK_STATUSES } from '@crm/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TaskModal, taskKey } from '../components/TaskModal';
import { useEditor } from '../forms/RecordEditor';
import { api, qs, type Row } from '../lib/api';
import { plural } from '../lib/format';
import { useAct, useParam } from '../lib/hooks';
import { useSession } from '../lib/session';
import { DataTable, type Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Kanban } from '../ui/Kanban';
import { Page } from '../ui/Page';
import { AvatarStack, Badge, Due, Priority, Seg, Who } from '../ui/primitives';

const TASK_TONE: Record<string, string> = { todo: 'var(--faint)', in_progress: 'var(--blue)', review: '#d99312', done: 'var(--green)' };
interface Person { id: number; name: string }

export function TaskCard({ t, here }: { t: Row; here?: boolean }) {
  const assignees = (t.assignees as Person[] | undefined) ?? [];
  return (
    <>
      <div className="t">{String(t.title)}</div>
      <div className="s"><span className="tkey">{taskKey(t.id)}</span> {t.project_id ? (here ? String(t.project_name) : <ProjectLink id={t.project_id} name={t.project_name} tab="tasks" />) : 'No project'}</div>
      <div className="f">
        <Priority value={t.priority} />
        {Number(t.check_total) > 0 && <span className={`meta-i ${t.check_done === t.check_total ? 'ok' : ''}`} title={`Checklist: ${t.check_done} of ${t.check_total} done`}><Icon name="check" />{String(t.check_done)}/{String(t.check_total)}</span>}
        {Number(t.comment_count) > 0 && <span className="meta-i" title={plural(Number(t.comment_count), 'comment')}><Icon name="chat" />{String(t.comment_count)}</span>}
        <span className="grow" />
        {t.due_date ? <Due date={t.due_date} done={t.status === 'done'} /> : null}
        <AvatarStack names={assignees.map((a) => a.name)} max={3} />
      </div>
    </>
  );
}

/** Kanban of tasks for a filter (used on My work and inside a project). */
export function TaskBoard({ query, onOpen }: { query: Record<string, unknown>; onOpen(id: number): void }) {
  const q = useQuery({ queryKey: ['rows', 'tasks-board', query], queryFn: () => api.page<Row>(`/tasks${qs({ ...query, limit: 500 })}`) });
  const move = useAct(({ id, status }: { id: number; status: string }) => api.put(`/tasks/${id}`, { status }));
  const tasks = q.data?.rows ?? [];
  const doneAll = tasks.filter((t) => t.status === 'done');
  const shown = [...tasks.filter((t) => t.status !== 'done'), ...doneAll.slice(-20)];
  return (
    <Kanban cols={TASK_STATUSES.map(([v, l]) => ({ v, l, c: TASK_TONE[v] }))} items={shown} group={(t) => String(t.status)} card={(t) => <TaskCard t={t} here={Boolean(query.project_id)} />}
      head={(list, c) => (c.v === 'done' && doneAll.length > list.length ? `latest ${list.length}` : '')} onOpen={(t) => onOpen(t.id)} onMove={(t, status) => move.mutate({ id: t.id, status })} />
  );
}

export default function Tasks() {
  const { isFounder, user, lookups } = useSession();
  const editor = useEditor();
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useParam('view', 'list');
  const scope = sp.get('scope') ?? 'mine';
  const assignee = sp.get('assignee') ?? '';
  const project = sp.get('project') ?? '';
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const o = sp.get('open');
    if (o && Number(o)) { setOpen(Number(o)); setSp((p) => { const n = new URLSearchParams(p); n.delete('open'); return n; }, { replace: true }); }
  }, [sp, setSp]);

  const q: Record<string, unknown> = {};
  if (scope === 'mine' && !assignee) q.assignee_id = user.id;
  if (assignee) q.assignee_id = assignee;
  if (project) q.project_id = project;
  const set = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); if (k === 'assignee' && v) n.set('scope', 'all'); return n; }, { replace: true });

  const cols: Column[] = [
    { key: 'title', label: 'Task', sort: 'title', render: (r) => <><div className="t1">{String(r.title)}</div><div className="t2">{taskKey(r.id)} · {r.project_id ? <LinkTo to={`/projects/${String(r.project_id)}?tab=tasks`}>{String(r.project_name)}</LinkTo> : 'No project'}{Number(r.check_total) ? ` · ${r.check_done}/${r.check_total} steps` : ''}{Number(r.comment_count) ? ` · ${r.comment_count} comments` : ''}</div></> },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <Badge value={r.status} /> },
    { key: 'priority', label: 'Priority', sort: 'priority', render: (r) => <Priority value={r.priority} /> },
    { key: 'people', label: 'People', render: (r) => { const a = (r.assignees as Person[] | undefined) ?? []; return a.length > 1 ? <span className="who"><AvatarStack names={a.map((x) => x.name)} /><span className="ellipsis">{a.map((x) => x.name.split(' ')[0]).join(', ')}</span></span> : <Who name={r.assignee_name} />; } },
    { key: 'due_date', label: 'Due', sort: 'due_date', render: (r) => <Due date={r.due_date} done={r.status === 'done'} /> },
  ];

  return (
    <Page title="My work" crumbs={<b>{scope === 'mine' && !assignee ? 'My work' : 'Tasks'}</b>}
      actions={<>
        <Seg value={view as 'board' | 'list'} onChange={setView} options={[['list', 'List'], ['board', 'Board']]} />
        <button type="button" className="btn primary" onClick={() => editor.open({ resource: 'tasks', defaults: { assignee_id: user.id, project_id: project } })}><Icon name="plus" />New task</button>
      </>}>
      <div className="toolbar">
        <div className="seg">
          <button type="button" className={scope === 'mine' && !assignee ? 'on' : ''} onClick={() => setSp((p) => { const n = new URLSearchParams(p); n.set('scope', 'mine'); n.delete('assignee'); return n; })}>Assigned to me</button>
          <button type="button" className={scope === 'all' || assignee ? 'on' : ''} onClick={() => setSp((p) => { const n = new URLSearchParams(p); n.set('scope', 'all'); return n; })}>{isFounder ? 'Everyone' : 'My projects'}</button>
        </div>
        {isFounder && <select aria-label="Person" value={assignee} onChange={(e) => set('assignee', e.target.value)}><option value="">Anyone</option>{lookups.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
        <select aria-label="Project" value={project} onChange={(e) => set('project', e.target.value)}><option value="">All projects</option>{lookups.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      {view === 'board'
        ? <TaskBoard query={q} onOpen={setOpen} />
        : <DataTable resource="tasks" query={q} columns={cols} noRef searchPlaceholder="Search tasks…" noun="task" onRow={(r) => setOpen(r.id)}
            filters={[{ key: 'status', label: 'Status', options: TASK_STATUSES }, { key: 'priority', label: 'Priority', options: PRIORITIES }]}
            empty={{ title: 'No tasks', text: 'Create a task and assign it to someone.' }} />}
      {open && <TaskModal taskId={open} onClose={() => setOpen(null)} />}
    </Page>
  );
}
