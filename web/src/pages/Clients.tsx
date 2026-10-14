import { CLIENT_STATUSES } from '@crm/shared';
import { useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '../ui/DataTable';
import { Page } from '../ui/Page';
import { Badge, LogoSq, Who } from '../ui/primitives';
import { useSession } from '../lib/session';
import { fmtDate } from '../lib/format';
import { AddBtn, Amount, editCol, ExportBtn } from './common';

export default function Clients() {
  const { isFounder } = useSession();
  const nav = useNavigate();
  const cols: Column[] = [
    {
      key: 'company', label: 'Client', sort: 'company',
      render: (r) => <div className="who"><LogoSq name={r.company} size="sm" /><div style={{ minWidth: 0 }}><div className="t1 ellipsis">{String(r.company)}</div><div className="t2 ellipsis">{[r.industry, r.city].filter(Boolean).join(' · ')}</div></div></div>,
    },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <Badge value={r.status} /> },
    { key: 'contact_name', label: 'Main contact', cls: 'opt', render: (r) => <div><div className="t1">{String(r.contact_name ?? '—')}</div><div className="t2">{String(r.contact_phone ?? r.contact_email ?? '')}</div></div> },
    { key: 'manager_name', label: 'Manager', cls: 'opt', render: (r) => <Who name={r.manager_name} /> },
    { key: 'project_count', label: 'Projects', num: true, sort: 'project_count', render: (r) => <>{String(r.project_count)}{Number(r.active_projects) ? <span className="faint small"> ({String(r.active_projects)} active)</span> : null}</> },
    ...(isFounder ? [
      { key: 'lifetime_received', label: 'Received', num: true, sort: 'lifetime_received', render: (r: Record<string, unknown>) => <Amount v={r.lifetime_received} dash /> } as Column,
      { key: 'outstanding', label: 'Outstanding', num: true, sort: 'outstanding', render: (r: Record<string, unknown>) => <Amount v={r.outstanding} neg={Number(r.outstanding) > 0} dash /> } as Column,
    ] : []),
    { key: 'created_at', label: 'Since', cls: 'nowrap opt', sort: 'created_at', render: (r) => fmtDate(r.created_at) },
    ...(isFounder ? [editCol('clients', true)] : []),
  ];
  return (
    <Page title="Clients" sub="Everyone you work for, with their projects and money."
      actions={isFounder ? <><ExportBtn resource="clients" /><AddBtn resource="clients" label="New client" /></> : undefined}>
      <DataTable resource="clients" columns={cols} defaultSort="company:asc" searchPlaceholder="Search clients, contacts, GSTIN…" noun="client" onRow={(r) => nav(`/clients/${r.id}`)}
        filters={[{ key: 'status', label: 'All statuses', options: CLIENT_STATUSES }, { key: 'account_manager_id', label: 'Any manager', lookup: 'users' }]}
        empty={{ title: 'No clients yet', text: 'Convert a lead, or add a client directly.' }} />
    </Page>
  );
}
