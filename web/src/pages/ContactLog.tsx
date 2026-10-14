import { CONTACT_KINDS, FOLLOWUP_ROUNDS, labelOf, today } from '@crm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs, type Row } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useSession } from '../lib/session';
import { useDebounced } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { Who } from '../ui/primitives';

const PAGE = 50;

function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+@\t\r]|^-(?!\d)/.test(s)) s = `'${s}`; // never let a cell run as a spreadsheet formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ContactLog() {
  const { lookups } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', kind: '', user_id: '', from: '', to: '' });
  const [page, setPage] = useState(0);
  const dq = useDebounced(f.q.trim());
  const params = { ...f, q: dq, limit: PAGE, offset: page * PAGE };
  const res = useQuery({ queryKey: ['contact-log', params], queryFn: () => api.page<Row>(`/contact-log${qs(params)}`) });
  const rows = res.data?.rows ?? [];
  const total = res.data?.total ?? 0;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF((x) => ({ ...x, [k]: e.target.value })); setPage(0); };

  const download = async () => {
    const all = await api.get<Row[]>(`/contact-log${qs({ ...f, q: dq, limit: 500 })}`);
    const head = ['Activity ID', 'Contact Date', 'Lead ID', 'Company / Person', 'Contact Type', 'Follow-Up Round', 'Outcome', 'Next Follow-Up Date', 'Assigned To'];
    const lines = [head, ...all.map((r) => [r.id, r.contact_date, r.lead_id, r.company, labelOf(CONTACT_KINDS, String(r.kind)), labelOf(FOLLOWUP_ROUNDS, String(r.followup_round)), r.body, r.next_followup ?? '', r.user_name ?? ''])];
    const blob = new Blob([`\uFEFF${lines.map((r) => r.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `contact-log-${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <Page title="Contact Log" sub="Every contact with every lead — logged from a lead’s page or Follow-ups with “Log contact”."
      actions={<><Link className="btn" to="/followups"><Icon name="phone" />Follow-ups</Link><button type="button" className="btn" onClick={() => void download()}><Icon name="download" />CSV</button></>}>
      <div className="toolbar">
        <input type="search" placeholder="Search outcome or company…" aria-label="Search" value={f.q} onChange={set('q')} />
        <select aria-label="Contact Type" value={f.kind} onChange={set('kind')}><option value="">Any contact type</option>{CONTACT_KINDS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
        <select aria-label="Assigned To" value={f.user_id} onChange={set('user_id')}><option value="">Anyone</option>{lookups.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <label className="inline-sel"><span className="muted small">From</span><input type="date" value={f.from} onChange={set('from')} /></label>
        <label className="inline-sel"><span className="muted small">To</span><input type="date" value={f.to} onChange={set('to')} /></label>
      </div>
      <div className="tbl">
        {!rows.length ? <div className="empty"><b>{res.isPending ? 'Loading…' : 'No contacts logged yet'}</b>{res.isPending ? '' : 'Use “Log contact” on a lead or on Follow-ups after each call, WhatsApp or meeting.'}</div> : (
          <div className="tbl-scroll" tabIndex={0}>
            <table className="t">
              <thead><tr><th className="opt num">ID</th><th>Date</th><th>Company / Person</th><th>Type</th><th className="opt">Round</th><th>Outcome</th><th className="opt">Next follow-up</th><th className="opt">By</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="click" onClick={() => nav(`/leads/${r.lead_id}`)}>
                    <td className="opt num muted tnum">{String(r.id)}</td>
                    <td className="nowrap">{fmtDate(r.contact_date).replace(/ \d{4}$/, '')}</td>
                    <td><b>{String(r.company ?? '—')}</b></td>
                    <td>{labelOf(CONTACT_KINDS, String(r.kind))}</td>
                    <td className="opt nowrap">{labelOf(FOLLOWUP_ROUNDS, String(r.followup_round)) || '—'}</td>
                    <td><div className="clamp2">{String(r.body)}</div></td>
                    <td className="opt nowrap">{r.next_followup ? fmtDate(r.next_followup).replace(/ \d{4}$/, '') : <span className="faint">—</span>}</td>
                    <td className="opt"><Who name={r.user_name} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE && (
          <div className="tbl-foot">
            <span>{page * PAGE + 1}–{page * PAGE + rows.length} of {total}</span>
            <span className="row">
              <button type="button" className="btn sm icon" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><Icon name="arrowL" /></button>
              <span className="small muted">Page {page + 1} of {Math.ceil(total / PAGE)}</span>
              <button type="button" className="btn sm icon" aria-label="Next page" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}><Icon name="arrowR" /></button>
            </span>
          </div>
        )}
      </div>
    </Page>
  );
}
