import { MILESTONE_KINDS, SCHEDULE_TEMPLATES, labelOf, today } from '@crm/shared';
import { useNavigate, Link } from 'react-router-dom';
import { useEditor } from '../forms/RecordEditor';
import { api, type Row } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { useAct, useGet } from '../lib/hooks';
import { LoadFailed } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { useDialogs } from '../ui/Modal';

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
  const template = useAct((t: string) => api.post(`/projects/${project.id}/schedule`, { template: t }), 'Payment schedule set');
  const reach = useAct((id: number) => api.put(`/milestones/${id}`, { reached_on: today() }), 'Marked as finished — it is ready to invoice');
  const invoice = useAct((id: number) => api.post<{ invoice_id: number }>(`/milestones/${id}/invoice`), 'Draft invoice created', (r) => nav(`/invoices/${r.invoice_id}`));
  const locked = rows.some((r) => r.invoice_id);

  return (
    <section className="panel">
      <LoadFailed q={q} />
      <div className="panel-h">
        <h2>Payment schedule</h2>
        <div className="row">
          {!locked && value > 0 && (
            <select aria-label="Set a payment schedule" value="" onChange={async (e) => {
              const t = e.target.value;
              if (!t) return;
              if (rows.length && !(await dialogs.confirm('Replace the current schedule?', { okLabel: 'Replace', danger: true }))) return;
              template.mutate(t);
            }}>
              <option value="">{rows.length ? 'Change schedule…' : 'Use a ready-made schedule…'}</option>
              {Object.entries(SCHEDULE_TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          )}
          <button type="button" className="btn sm" onClick={() => editor.open({ resource: 'milestones', defaults: { project_id: project.id } })}><Icon name="plus" />Add payment</button>
        </div>
      </div>
      {!value && <div className="callout" style={{ margin: 16 }}>Set the project’s agreed value (Edit → Agreed value) to split it into payments.</div>}
      {rows.length ? (
        <div className="tbl-scroll" tabIndex={0}>
          <table className="t">
            <thead><tr><th>Payment</th><th>Status</th><th>Bill on</th><th className="num">Amount</th><th>Invoice</th><th /></tr></thead>
            <tbody>
              {rows.map((m) => {
                const st = STATE[String(m.state)] ?? ['—', ''];
                return (
                  <tr key={m.id}>
                    <td><div className="t1">{String(m.title)}</div><div className="t2">{labelOf(MILESTONE_KINDS, String(m.kind))}{m.percent ? ` · ${m.percent}%` : ''} · <span className="ref">{String(m.ref)}</span></div></td>
                    <td><span className={`tag ${st[1]}`}>{st[0]}</span>{m.reached_on && !m.invoice_id ? <div className="t2">Finished {fmtDate(m.reached_on)}</div> : null}</td>
                    <td className="nowrap">{m.due_date ? fmtDate(m.due_date) : <span className="faint">When finished</span>}</td>
                    <td className="num tnum">{money(m.amount)}</td>
                    <td>{m.invoice_id ? <Link className="ln" to={`/invoices/${m.invoice_id}`}>{String(m.invoice_number)}</Link> : <span className="faint">—</span>}</td>
                    <td className="nowrap right">
                      {!m.invoice_id && !m.reached_on && <button type="button" className="btn sm" onClick={() => reach.mutate(Number(m.id))}>Mark finished</button>}{' '}
                      {!m.invoice_id && <button type="button" className="btn sm primary" onClick={() => invoice.mutate(Number(m.id))}>Raise invoice</button>}{' '}
                      <button type="button" className="btn sm icon ghost" aria-label="Edit payment" onClick={() => editor.open({ resource: 'milestones', record: m, canDelete: !m.invoice_id })}><Icon name="edit" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr className="tot"><td colSpan={3}>Scheduled</td><td className="num tnum">{money(scheduled)}</td><td colSpan={2} className="small muted">{value ? (Math.abs(value - scheduled) < 1 ? 'Matches the agreed value' : `${money(value - scheduled)} not scheduled yet`) : ''}</td></tr></tfoot>
          </table>
        </div>
      ) : value ? <div className="empty mini">No payment schedule yet. Pick a ready-made one above, or add payments one by one.</div> : null}
    </section>
  );
}
