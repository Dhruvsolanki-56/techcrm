import { CONTACT_KINDS, FOLLOWUP_ROUNDS, labelOf, } from '@crm/shared';
import { useQuery } from '@tanstack/react-query';
import { DateInput } from '../ui/DateInput';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs, type Row } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useSession } from '../lib/session';
import { useDebounced } from '../ui/DataTable';
import { ExportMenu } from '../ui/ExportMenu';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { Badge, ErrorBox, Who } from '../ui/primitives';
import { LogContactModal } from '../components/LeadModals';
import { Modal } from '../ui/Modal';

const PAGE = 50;

export default function ContactLog() {
  const { lookups } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', kind: '', user_id: '', lead_id: '', from: '', to: '' });
  const [pick, setPick] = useState(false);
  const [lead, setLead] = useState<Row | null>(null);
  const [leadId, setLeadId] = useState('');
  const [page, setPage] = useState(0);
  const dq = useDebounced(f.q.trim());
  const params = { ...f, q: dq, limit: PAGE, offset: page * PAGE };
  const res = useQuery({ queryKey: ['contact-log', params], queryFn: () => api.page<Row>(`/contact-log${qs(params)}`) });
  const rows = res.data?.rows ?? [];
  const total = res.data?.total ?? 0;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF((x) => ({ ...x, [k]: e.target.value })); setPage(0); };

  return (
    <Page title="Contact Log" sub="Every contact with every lead — logged from a lead’s page or Follow-ups with “Log contact”."
      actions={<><button type="button" className="btn primary" onClick={() => setPick(true)}><Icon name="plus" />Log contact</button><Link className="btn" to="/followups"><Icon name="phone" />Follow-ups</Link><ExportMenu path="/contact-log/export" params={{ ...f, q: dq }} /></>}>
      <div className="toolbar">
        <input type="search" placeholder="Search outcome or company…" aria-label="Search" value={f.q} onChange={set('q')} />
        <select aria-label="Contact Type" value={f.kind} onChange={set('kind')}><option value="">Any contact type</option>{CONTACT_KINDS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
        <select aria-label="Assigned To" value={f.user_id} onChange={set('user_id')}><option value="">Anyone</option>{lookups.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select aria-label="Lead" value={f.lead_id} onChange={set('lead_id')}><option value="">Any lead</option>{lookups.leads.map((l) => <option key={l.id} value={l.id}>{String(l.company || l.name)}</option>)}</select>
        <label className="inline-sel"><span className="muted small">From</span><DateInput value={f.from} onChange={set('from')} /></label>
        <label className="inline-sel"><span className="muted small">To</span><DateInput value={f.to} onChange={set('to')} /></label>
      </div>
      <div className="tbl">
        {res.isError ? <ErrorBox error={res.error} retry={() => void res.refetch()} /> : !rows.length ? <div className="empty"><b>{res.isPending ? 'Loading…' : 'No contacts logged yet'}</b>{res.isPending ? '' : 'Use “Log contact” on a lead or on Follow-ups after each call, WhatsApp or meeting.'}</div> : (
          <div className="tbl-scroll" tabIndex={0}>
            <table className="t">
              <thead><tr><th className="opt num">ID</th><th>Date</th><th>Lead</th><th>Type</th><th className="opt">Round</th><th>Outcome</th><th className="opt">Next follow-up</th><th className="opt">By</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="click" onClick={() => nav(`/leads/${r.lead_id}`)}>
                    <td className="opt num muted tnum">{String(r.id)}</td>
                    <td className="nowrap">{fmtDate(r.contact_date)}</td>
                    <td><Link className="ln" to={`/leads/${r.lead_id}`} onClick={(e) => e.stopPropagation()}><b>{String(r.company ?? '—')}</b></Link><div className="t2">{r.person && r.person !== r.company ? `${String(r.person)} · ` : ''}<Badge value={r.lead_stage} /></div></td>
                    <td>{labelOf(CONTACT_KINDS, String(r.kind))}</td>
                    <td className="opt nowrap">{labelOf(FOLLOWUP_ROUNDS, String(r.followup_round)) || '—'}</td>
                    <td><div className="clamp2">{String(r.body)}</div></td>
                    <td className="opt nowrap">{r.next_followup ? fmtDate(r.next_followup) : <span className="faint">—</span>}</td>
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
      {pick && !lead && (
        <Modal title="Log a contact" sub="Which lead did you speak to?" size="sm" onClose={() => setPick(false)}
          footer={<><button type="button" className="btn" onClick={() => setPick(false)}>Cancel</button><button type="button" className="btn primary" disabled={!leadId} onClick={async () => { setLead(await api.get<Row>(`/leads/${leadId}`)); }}>Next</button></>}>
          <label className="f"><span>Lead</span><select value={leadId} onChange={(e) => setLeadId(e.target.value)} aria-label="Choose the lead"><option value="">— choose —</option>{lookups.leads.map((l) => <option key={l.id} value={l.id}>{String(l.company || l.name)} · {String(l.name)}</option>)}</select></label>
          <div className="hint">New person? Add them as a lead first (Pipeline → New lead); every contact belongs to a lead.</div>
        </Modal>
      )}
      {lead && <LogContactModal lead={lead} onClose={() => { setLead(null); setPick(false); setLeadId(''); }} />}
    </Page>
  );
}
