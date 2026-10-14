import { CR_KINDS, CR_PHASES, CR_STATUSES, CR_TRANSITIONS, labelOf } from '@crm/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEditor } from '../forms/RecordEditor';
import { api, type Row } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { useAct, useGet } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Amount, editCol } from '../pages/common';
import { DataTable, type Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Kanban } from '../ui/Kanban';
import { Modal } from '../ui/Modal';
import { Badge, RefChip } from '../ui/primitives';
import { Notes } from './Notes';
import { Prop } from './record';

export const crRef = (id: unknown): string => `CR-${String(id).padStart(4, '0')}`;
const STATUS_TONE: Record<string, string> = { requested: 'var(--amber)', estimated: '#d99312', quoted: 'var(--blue)', approved: 'var(--accent)', in_progress: 'var(--plum)', delivered: 'var(--green)', rejected: 'var(--red)', cancelled: 'var(--faint)' };
const BILLING: Record<string, [string, string]> = { not_quoted: ['Not quoted', ''], quoted: ['Quoted', 'blue'], invoiced: ['Invoiced', 'amber'], paid: ['Paid', 'green'], not_billable: ['Not billable', ''] };

export function BillingBadge({ value }: { value: unknown }) {
  const b = BILLING[String(value)];
  return b ? <span className={`tag ${b[1]}`}>{b[0]}</span> : null;
}
export const PhaseTag = ({ value }: { value: unknown }) => <span className={`tag ${value === 'after_delivery' ? 'plum' : ''}`}>{labelOf(CR_PHASES, String(value))}</span>;

/** Everything about one change request: the chain from request to money, its tasks and its history. */
export function CRModal({ id, onClose }: { id: number; onClose(): void }) {
  const { isFounder } = useSession();
  const editor = useEditor();
  const nav = useNavigate();
  const q = useGet<Row>(`/change_requests/${id}`);
  const cr = q.data;
  const tasks = useGet<Row[]>(cr ? '/tasks' : null, { change_request_id: id, limit: 50 });
  const move = useAct((status: string) => api.put(`/change_requests/${id}`, { status }), 'Status updated');
  const toQuote = useAct(() => api.post<{ quote_id: number; number: string }>(`/change-requests/${id}/quote`), (r) => `Quotation ${r.number} created`, (r) => { onClose(); nav(`/quotes/${r.quote_id}`); });
  const toInvoice = useAct(() => api.post<{ invoice_id: number }>(`/quotes/${cr?.quote_id}/to-invoice`), 'Invoice created', (r) => { onClose(); nav(`/invoices/${r.invoice_id}`); });

  if (!cr) return <Modal title="Change request" size="xl" onClose={onClose}><div className="empty">{q.isError ? (q.error as Error).message : 'Loading…'}</div></Modal>;
  const next = (CR_TRANSITIONS[String(cr.status)] ?? []).filter((s) => isFounder || ['in_progress', 'delivered'].includes(s));
  const quoteOpen = cr.quote_id && ['draft', 'sent', 'accepted'].includes(String(cr.quote_status));
  return (
    <Modal title={String(cr.title)} sub={`${crRef(cr.id)} · ${String(cr.project_name)} · ${String(cr.client_name ?? '')}`} size="xl" onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={() => { onClose(); editor.open({ resource: 'change_requests', record: cr }); }}><Icon name="edit" />Edit</button>
        <button type="button" className="btn" onClick={() => { onClose(); editor.open({ resource: 'tasks', defaults: { project_id: cr.project_id, change_request_id: cr.id } }); }}><Icon name="plus" />Add task</button>
      </>}>
      <div className="pop-split">
        <div className="pop-main">
          {cr.description ? <div className="doc-text pre">{String(cr.description)}</div> : <div className="faint">No details written.</div>}
          {isFounder && (
            <div className="pop-sec">
              <div className="sec-h"><h3>Billing</h3><BillingBadge value={cr.billing_status} /></div>
              <div className="list panel">
                <div className="li"><div className="grow"><div className="t">Estimate</div><div className="s">{cr.estimate_hours ? `${cr.estimate_hours} h` : 'No hours'} · {Number(cr.estimate_amount) ? money(cr.estimate_amount) : 'No amount yet'}</div></div></div>
                <div className="li"><div className="grow"><div className="t">Quotation</div><div className="s">{cr.quote_number ? <><Link to={`/quotes/${cr.quote_id}`} onClick={onClose}>{String(cr.quote_number)}</Link> · {money(cr.quote_total)} · {String(cr.quote_status)}</> : 'Not quoted yet'}</div></div>
                  {!cr.quote_id || !quoteOpen ? <button type="button" className="btn sm primary" disabled={!cr.billable || !Number(cr.estimate_amount) || toQuote.isPending} onClick={() => toQuote.mutate()} title={!Number(cr.estimate_amount) ? 'Enter the estimated amount first' : ''}>Create quotation</button> : null}
                  {cr.quote_id && cr.quote_status === 'accepted' && !cr.invoice_id ? <button type="button" className="btn sm accent" disabled={toInvoice.isPending} onClick={() => toInvoice.mutate()}>Create invoice</button> : null}</div>
                <div className="li"><div className="grow"><div className="t">Invoice</div><div className="s">{cr.invoice_number ? <><Link to={`/invoices/${cr.invoice_id}`} onClick={onClose}>{String(cr.invoice_number)}</Link> · {money(cr.invoice_total)} · paid {money(cr.invoice_paid)}</> : 'Not invoiced yet'}</div></div></div>
              </div>
            </div>
          )}
          <div className="pop-sec"><div className="sec-h"><h3>Tasks</h3></div>
            {tasks.data?.length ? <div className="list panel">{tasks.data.map((t) => <div className="li" key={t.id}><div className="grow"><div className="t">{String(t.title)}</div><div className="s">T-{String(t.id)} · {String(t.assignee_name ?? 'Unassigned')}</div></div><Badge value={t.status} /></div>)}</div> : <div className="faint small">No tasks yet. Add tasks for the work this change request needs.</div>}
          </div>
          <div className="pop-sec"><div className="sec-h"><h3>History</h3></div><Notes type="change_request" id={id} kinds={false} placeholder="Client feedback, scope decisions, approvals…" /></div>
        </div>
        <aside className="pop-side">
          <Prop label="Status"><Badge value={cr.status} /></Prop>
          {next.length > 0 && (
            <Prop label="Move to">
              <div className="row wrap" style={{ gap: 6 }}>{next.map((s) => <button type="button" key={s} className="btn sm" onClick={() => move.mutate(s)}>{labelOf(CR_STATUSES, s)}</button>)}</div>
            </Prop>
          )}
          <Prop label="When"><PhaseTag value={cr.phase} /></Prop>
          <Prop label="Kind">{labelOf(CR_KINDS, String(cr.kind))}</Prop>
          <Prop label="Priority"><Badge value={cr.priority} /></Prop>
          <Prop label="Project"><Link to={`/projects/${cr.project_id}`} onClick={onClose}>{String(cr.project_name)}</Link></Prop>
          <Prop label="Requested">{fmtDate(cr.requested_on)}{cr.requested_by ? <div className="faint small">by {String(cr.requested_by)}</div> : null}</Prop>
          <Prop label="Approved">{cr.approved_on ? fmtDate(cr.approved_on) : null}</Prop>
          <Prop label="Delivered">{cr.delivered_on ? fmtDate(cr.delivered_on) : null}</Prop>
          <Prop label="ID"><RefChip value={cr.ref ?? crRef(cr.id)} /></Prop>
        </aside>
      </div>
    </Modal>
  );
}

/** The list of change requests, for a project or for everyone. */
export function CRTable({ projectId, open: initialOpen }: { projectId?: number; open?: boolean }) {
  const { isFounder } = useSession();
  const [view, setView] = useState<number | null>(null);
  const editor = useEditor();
  const cols: Column[] = [
    { key: 'title', label: 'Change request', sort: 'title', render: (r) => <div><div className="t1">{String(r.title)}</div><div className="t2">{!projectId && <>{String(r.project_name)} · </>}{String(r.client_name ?? '')}</div></div> },
    { key: 'phase', label: 'When', render: (r) => <PhaseTag value={r.phase} /> },
    { key: 'kind', label: 'Kind', cls: 'opt', render: (r) => labelOf(CR_KINDS, String(r.kind)) },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <Badge value={r.status} /> },
    { key: 'requested_on', label: 'Requested', cls: 'nowrap opt', sort: 'requested_on', render: (r) => fmtDate(r.requested_on) },
    ...(isFounder ? [
      { key: 'estimate_amount', label: 'Estimate', num: true, sort: 'estimate_amount', render: (r: Row) => <Amount v={r.estimate_amount} dash /> } as Column,
      { key: 'billing_status', label: 'Billing', render: (r: Row) => <BillingBadge value={r.billing_status} /> } as Column,
      editCol('change_requests', true),
    ] : []),
  ];
  return (
    <>
      <DataTable resource="change_requests" query={{ project_id: projectId, open: initialOpen ? 1 : undefined }} columns={cols} noRef={!!projectId} compact={!!projectId} onRow={(r) => setView(r.id)}
        searchPlaceholder="Search change requests…" noun="change request"
        filters={[{ key: 'status', label: 'All statuses', options: CR_STATUSES }, ...(projectId ? [] : [{ key: 'phase', label: 'Before / after delivery', options: CR_PHASES }])]}
        toolbar={<button type="button" className="btn primary" onClick={() => editor.open({ resource: 'change_requests', defaults: { project_id: projectId } })}><Icon name="plus" />New change request</button>}
        empty={{ title: 'No change requests', text: 'When a client asks for something different or new — before or after delivery — record it here, estimate it, quote it and bill it.' }} />
      {view && <CRModal id={view} onClose={() => setView(null)} />}
    </>
  );
}

/** Board by status. */
export function CRBoard({ projectId }: { projectId?: number }) {
  const q = useGet<Row[]>('/change_requests', { project_id: projectId, limit: 500 });
  const [view, setView] = useState<number | null>(null);
  const move = useAct(({ id, status }: { id: number; status: string }) => api.put(`/change_requests/${id}`, { status }), 'Status updated');
  const items = q.data ?? [];
  return (
    <>
      <Kanban cols={CR_STATUSES.map(([v, l]) => ({ v, l, c: STATUS_TONE[v] }))} items={items} group={(i) => String(i.status)}
        onOpen={(i) => setView(i.id)} onMove={(i, status) => move.mutate({ id: i.id, status })}
        head={(list) => { const sum = list.reduce((s, i) => s + Number(i.estimate_amount || 0), 0); return sum ? money(sum) : ''; }}
        card={(i) => (
          <>
            <div className="t">{String(i.title)}</div>
            <div className="s"><span className="tkey">{crRef(i.id)}</span> {String(i.project_name)}</div>
            <div className="f"><PhaseTag value={i.phase} /><span className="grow" />{Number(i.estimate_amount) ? <b className="tnum">{money(i.estimate_amount)}</b> : null}</div>
          </>
        )} />
      {view && <CRModal id={view} onClose={() => setView(null)} />}
    </>
  );
}
