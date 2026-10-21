import { MILESTONE_KINDS, labelOf, tdsOf, today } from '@crm/shared';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useEditor } from '../forms/RecordEditor';
import { api, type Row } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { useAct, useGet } from '../lib/hooks';
import { LoadFailed } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { useDialogs } from '../ui/Modal';
import { useToast } from '../ui/Toasts';
import { useEffect, useState } from 'react';
import { ScheduleModal } from './ScheduleModal';

const STATE: Record<string, [string, string]> = {
  planned: ['Planned', ''], late: ['Date passed', 'amber'], ready: ['Ready to invoice', 'blue'], invoiced: ['Invoiced', 'blue'], overdue: ['Payment overdue', 'red'], paid: ['Paid', 'green'],
};

/** How a project's agreed value is billed: advance → milestones → final, each turned into an invoice when its work is done. */
export function PaymentSchedule({ project }: { project: Row }) {
  const nav = useNavigate();
  const editor = useEditor();
  const dialogs = useDialogs();
  const q = useGet<Row[]>('/milestones', { project_id: project.id, limit: 100 });
  const rows = q.data ?? [];
  const value = Number(project.budget) || 0;
  const scheduled = rows.reduce((s, r) => s + Number(r.amount), 0);
  const reach = useAct((id: number) => api.put(`/milestones/${id}`, { reached_on: today() }), 'Marked as finished — it is ready to invoice');
  const invoice = useAct(({ id, tds }: { id: number; tds?: number }) => api.post<{ invoice_id: number }>(`/milestones/${id}/invoice`, tds === undefined ? {} : { tds_percent: tds }), 'Draft invoice created', (r) => nav(`/invoices/${r.invoice_id}`));
  const liveInvoice = (m: Row): boolean => !!m.invoice_id && m.invoice_status !== 'cancelled'; // a cancelled invoice frees its payment to be invoiced again
  const [plan, setPlan] = useState(false);
  const [sp, setSp] = useSearchParams();
  // arriving from an accepted quotation (?plan=1) opens the planner straight away
  useEffect(() => { if (sp.get('plan') && value > 0 && q.isSuccess && !rows.length) setPlan(true); }, [sp, value, q.isSuccess, rows.length]);
  // TDS is optional and can differ per payment: when the project has TDS, ask once whether this payment has it too
  const raise = async (m: Row) => {
    const own = m.tds_percent === null || m.tds_percent === undefined ? pctOf : Number(m.tds_percent);
    if (!(pctOf > 0) && !(own > 0)) { invoice.mutate({ id: Number(m.id) }); return; }
    const a = await dialogs.prompt('TDS on this payment', 'TDS % the client deducts (0 = none for this payment)', String(own), { required: true });
    if (a === null) return;
    const n = Number(a);
    if (!Number.isFinite(n) || n < 0 || n > 100) { toastErr('TDS must be between 0 and 100.'); return; }
    invoice.mutate({ id: Number(m.id), tds: n });
  };
  const pct = Number(project.tds_percent) || 0;
  const pctOf = pct;
  const toast = useToast();
  const toastErr = (t: string): void => toast.fail(new Error(t));
  const advanceUnpaid = project.advance_state === 'unpaid' && ['active', 'review'].includes(String(project.status)) && !!project.advance_required;

  return (
    <section className="panel">
      <LoadFailed q={q} />
      <div className="panel-h">
        <h2>Payment schedule</h2>
        <div className="row">
          {value > 0 && <button type="button" className="btn sm primary" onClick={() => setPlan(true)}>{rows.length ? 'Change the plan' : 'Plan the payments'}</button>}
        </div>
      </div>
      {plan && <ScheduleModal project={project} onClose={() => { setPlan(false); if (sp.get('plan')) setSp((p) => { const n = new URLSearchParams(p); n.delete('plan'); return n; }, { replace: true }); }} />}
      {advanceUnpaid && <div className="callout err" role="alert" style={{ margin: 16 }}>Work has started, but the advance of {money(project.advance_amount)} is not paid yet. Collect it before doing more work (or switch “advance before work” off on the project if this one is different).</div>}
      {pct > 0 && <div className="callout info" style={{ margin: 16 }}>The client deducts {pct}% TDS. Each invoice is raised for what you will receive; the TDS is tracked for your ITR and every payment follows the same ratio.</div>}
      {!value && <div className="callout" style={{ margin: 16 }}>Set the project’s agreed value (Edit → Agreed value) to split it into payments.</div>}
      {rows.length ? (
        <div className="tbl-scroll" tabIndex={0}>
          <table className="t">
            <thead><tr><th>Payment</th><th>Status</th><th>Bill on</th><th className="num">{pct > 0 ? 'Share / you receive' : 'Amount'}</th><th>Invoice</th><th /></tr></thead>
            <tbody>
              {rows.map((m) => {
                const st = STATE[String(m.state)] ?? ['—', ''];
                return (
                  <tr key={m.id}>
                    <td><div className="t1">{String(m.title)}</div><div className="t2">{labelOf(MILESTONE_KINDS, String(m.kind))}{m.percent ? ` · ${m.percent}%` : ''} · <span className="ref">{String(m.ref)}</span></div></td>
                    <td><span className={`tag ${st[1]}`}>{st[0]}</span>{m.reached_on && !liveInvoice(m) ? <div className="t2">Finished {fmtDate(m.reached_on)}</div> : null}</td>
                    <td className="nowrap">{m.due_date ? fmtDate(m.due_date) : <span className="faint">When finished</span>}</td>
                    <td className="num tnum">{money(m.amount)}{pct > 0 && <div className="t2">receive {money(Number(m.amount) - tdsOf(Number(m.amount), pct))}</div>}</td>
                    <td>{m.invoice_id ? <Link className="ln" to={`/invoices/${m.invoice_id}`}>{String(m.invoice_number)}</Link> : <span className="faint">—</span>}</td>
                    <td className="nowrap right">
                      {!liveInvoice(m) && !m.reached_on && <button type="button" className="btn sm" onClick={() => reach.mutate(Number(m.id))}>Mark finished</button>}{' '}
                      {!liveInvoice(m) && <button type="button" className="btn sm primary" onClick={() => void raise(m)}>Raise invoice</button>}{' '}
                      <button type="button" className="btn sm icon ghost" aria-label="Edit payment" onClick={() => editor.open({ resource: 'milestones', record: m, canDelete: !liveInvoice(m) })}><Icon name="edit" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr className="tot"><td colSpan={3}>Scheduled</td><td className="num tnum">{money(scheduled)}</td><td colSpan={2} className="small muted">{value ? (Math.abs(value - scheduled) < 1 ? 'Matches the agreed value' : `${money(value - scheduled)} not scheduled yet`) : ''}</td></tr></tfoot>
          </table>
        </div>
      ) : value ? <div className="empty mini">No payment plan yet. Press “Plan the payments”: choose the parts (advance, milestones, final) and whether the client deducts TDS.</div> : null}
      {rows.length > 0 && <div style={{ padding: '10px 16px' }}><button type="button" className="btn sm ghost" onClick={() => editor.open({ resource: 'milestones', defaults: { project_id: project.id } })}><Icon name="plus" />Add one more payment by hand</button><span className="small muted" style={{ marginLeft: 10 }}>e.g. an extra part that is not in the plan</span></div>}
    </section>
  );
}
