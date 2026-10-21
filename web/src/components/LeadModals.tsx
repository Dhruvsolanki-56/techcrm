import { addDays, CLOSED_STAGES, CONTACT_KINDS, FOLLOWUP_ROUNDS, LEAD_STAGES, today } from '@crm/shared';
import { useState } from 'react';
import { DateInput } from '../ui/DateInput';
import { useNavigate } from 'react-router-dom';
import { api, type Row } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { useAct, useGet } from '../lib/hooks';
import { Modal } from '../ui/Modal';

const NEXT_ROUND: Record<string, string> = { not_started: 'initial', initial: 'first', first: 'second', second: 'third', third: 'complete', complete: 'complete' };

/** One contact with a lead: what happened and the next step, saved together. */
export function LogContactModal({ lead, onClose }: { lead: Row; onClose(): void }) {
  const [v, setV] = useState({
    kind: 'call', stage: String(lead.stage), body: '', followup_round: NEXT_ROUND[String(lead.followup_round)] ?? 'initial', next_followup: addDays(today(), 3), next_action: '',
  });
  const [err, setErr] = useState('');
  const ended = (CLOSED_STAGES as readonly string[]).includes(v.stage);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const save = useAct(() => api.post(`/leads/${lead.id}/contact`, { ...v, followup_round: ended ? 'complete' : v.followup_round, next_followup: ended ? null : v.next_followup || null, next_action: ended ? null : v.next_action || null }),
    ended ? 'Saved — lead closed' : v.next_followup ? `Saved — next follow-up ${fmtDate(v.next_followup)}` : 'Saved', onClose);
  const submit = () => {
    if (!v.body.trim()) { setErr('Outcome is required.'); return; }
    setErr('');
    save.mutate(undefined, { onError: (e) => setErr(e.message) });
  };
  return (
    <Modal title="Log contact" sub={`${String(lead.company || lead.name)}${lead.phone ? ` · ${String(lead.phone)}` : ''}`} dirty={!!v.body} onClose={onClose}
      footer={<><span className="kbd-hint">Ctrl + Enter to save</span><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className={`btn primary ${save.isPending ? 'busy' : ''}`} onClick={submit}>Save</button></>}>
      {lead.next_action ? <div className="form-intro">Planned next action: <b>{String(lead.next_action)}</b></div> : null}
      <div className="form-grid" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}>
        <label className="f"><span>Contact Type <i>*</i></span><select value={v.kind} onChange={set('kind')}>{CONTACT_KINDS.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></label>
        <label className="f"><span>Sales Stage <i>*</i></span><select value={v.stage} onChange={set('stage')}>{LEAD_STAGES.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></label>
        <label className="f full"><span>Outcome <i>*</i></span><textarea rows={3} value={v.body} onChange={set('body')} placeholder="e.g. Spoke to the owner — wants a demo next week, budget around ₹1L" /></label>
        {!ended && (
          <>
            <label className="f"><span>Follow-Up Round</span><select value={v.followup_round} onChange={set('followup_round')}>{FOLLOWUP_ROUNDS.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></label>
            <label className="f"><span>Next Follow-Up Date</span><DateInput value={v.next_followup} onChange={set('next_followup')} /></label>
            <label className="f full"><span>Next Action</span><input value={v.next_action} onChange={set('next_action')} placeholder="e.g. Send demo video and pricing" /></label>
          </>
        )}
      </div>
      {err && <div className="callout err" role="alert" style={{ marginTop: 16 }}>{err}</div>}
    </Modal>
  );
}

/** Lead → client, optionally with a project built from one of the lead's quotations. */
export function ConvertModal({ lead, onClose }: { lead: Row; onClose(): void }) {
  const nav = useNavigate();
  const quotes = useGet<Row[]>('/quotes', { lead_id: lead.id, limit: 50 });
  const [createProject, setCreateProject] = useState(true);
  const [quoteId, setQuoteId] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const go = useAct(() => api.post<{ client_id: number; project_id: number | null }>(`/leads/${lead.id}/convert`, { create_project: createProject, quote_id: quoteId || undefined, project_name: name || undefined }),
    'Converted to a client', (r) => { onClose(); nav(r.project_id ? `/projects/${r.project_id}` : `/clients/${r.client_id}`); });
  const usable = (quotes.data ?? []).filter((q) => q.status !== 'rejected' && q.status !== 'expired');
  return (
    <Modal title="Convert to client" sub={String(lead.company || lead.name)} size="sm" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className={`btn accent ${go.isPending ? 'busy' : ''}`} onClick={() => { setErr(''); go.mutate(undefined, { onError: (e) => setErr(e.message) }); }}>Convert</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>{lead.client_id ? `This lead is for an existing client (${String(lead.client_name ?? '')}), so no new client is created: it is marked Converted and the work starts under that client.` : 'This creates the client and a main contact, moves the notes and files across and marks the lead as Converted.'}</p>
      <div className="form-grid">
        <label className="check full"><input type="checkbox" checked={createProject} onChange={(e) => setCreateProject(e.target.checked)} /><span>Also create the project</span></label>
        {createProject && (
          <>
            <label className="f full"><span>Project name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${String(lead.company || lead.name)} — ${String(lead.department || 'Project')}`} /></label>
            {usable.length > 0 && (
              <label className="f full"><span>Start from a quotation</span>
                <select value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
                  <option value="">— No, use the deal value —</option>
                  {usable.map((q) => <option key={q.id} value={q.id}>{String(q.number)} · {money(Number(q.subtotal) - Number(q.discount))} · {String(q.status)}</option>)}
                </select>
                <div className="hint">The quotation becomes accepted and its value becomes the project’s agreed value.</div></label>
            )}
          </>
        )}
      </div>
      {err && <div className="callout err" role="alert" style={{ marginTop: 14 }}>{err}</div>}
    </Modal>
  );
}
