import { PROJECT_STATUSES } from '@crm/shared';
import { useNavigate } from 'react-router-dom';
import { useEditor } from '../forms/RecordEditor';
import { fmtDate } from '../lib/format';
import { useSession } from '../lib/session';
import { DataTable, type Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { Badge, Due, LogoSq, Priority, Who } from '../ui/primitives';
import { Amount, editCol, ExportBtn } from './common';

export const pctDone = (p: Record<string, unknown>): number => (Number(p.task_count) ? Math.round((100 * Number(p.tasks_done)) / Number(p.task_count)) : 0);

/** The projects list, reused on the client page (`clientId` narrows it). */
export function ProjectsTable({ clientId }: { clientId?: number }) {
  const { isFounder, user } = useSession();
  const nav = useNavigate();
  const editor = useEditor();
  const cols: Column[] = [
    {
      key: 'name', label: 'Project', sort: 'name',
      render: (r) => <div className="who"><LogoSq name={r.name} size="sm" /><div style={{ minWidth: 0 }}><div className="t1 ellipsis">{String(r.name)}</div><div className="t2 ellipsis">{[r.code, clientId ? r.type : r.client_name].filter(Boolean).join(' · ')}</div></div></div>,
    },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <Badge value={r.status} /> },
    { key: 'priority', label: 'Priority', cls: 'opt', render: (r) => <Priority value={r.priority} /> },
    { key: 'progress', label: 'Progress', render: (r) => (Number(r.task_count) ? <div className="prog"><div className="bar"><i style={{ width: `${pctDone(r)}%` }} /></div>{pctDone(r)}%</div> : <span className="faint small">No tasks</span>) },
    {
      key: 'deadline', label: 'End date', sort: 'deadline',
      render: (r) => (['completed', 'cancelled'].includes(String(r.status)) ? <span className="muted">{fmtDate(r.completed_on || r.deadline)}</span> : ['maintenance', 'on_hold'].includes(String(r.status)) ? <span className="faint">—</span> : <Due date={r.deadline} />),
    },
    { key: 'manager_display', label: 'Manager', cls: 'opt', render: (r) => (r.manager_id ? <Who name={r.manager_display} /> : r.manager_display ? <span className="muted">{String(r.manager_display)}</span> : <span className="faint">—</span>) },
    ...(isFounder ? [
      { key: 'budget', label: 'Value', num: true, cls: 'opt', sort: 'budget', render: (r: Record<string, unknown>) => (Number(r.cr_value) ? <span title={`Agreed value plus change requests`}><Amount v={r.revised_value} /></span> : <Amount v={r.budget} dash />) } as Column,
      { key: 'total_received', label: 'Received', num: true, render: (r: Record<string, unknown>) => <Amount v={r.total_received} dash /> } as Column,
      { key: 'cr_open', label: 'Open CRs', num: true, cls: 'opt', render: (r: Record<string, unknown>) => (Number(r.cr_open) ? <span className="tag amber">{String(r.cr_open)}</span> : <span className="faint">—</span>) } as Column,
      editCol('projects', true),
    ] : []),
  ];
  return (
    <DataTable resource="projects" query={clientId ? { client_id: clientId } : undefined} columns={cols} compact={!!clientId} defaultSort={clientId ? undefined : undefined}
      searchPlaceholder="Search projects…" noun="project" onRow={(r) => nav(`/projects/${r.id}`)}
      filters={clientId ? [] : [{ key: 'status', label: 'All statuses', options: PROJECT_STATUSES }, { key: 'client_id', label: 'Any client', lookup: 'clients' }, { key: 'manager_id', label: 'Any manager', lookup: 'users' }]}
      toolbar={isFounder ? <button type="button" className="btn primary" onClick={() => editor.open({ resource: 'projects', defaults: { manager_id: user.id, client_id: clientId }, onDone: (p) => p && nav(`/projects/${p.id}`) })}><Icon name="plus" />New project</button> : null}
      empty={{ title: 'No projects', text: isFounder ? 'Create a project to keep its tasks, files, logins and money together.' : 'You have not been added to any project yet.' }} />
  );
}

export default function Projects() {
  const { isFounder } = useSession();
  return (
    <Page title="Projects" sub="Everything being built and looked after." actions={isFounder ? <ExportBtn resource="projects" /> : undefined}>
      <ProjectsTable />
    </Page>
  );
}
