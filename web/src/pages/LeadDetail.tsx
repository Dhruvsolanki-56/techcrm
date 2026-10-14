import { CLOSED_STAGES, LEAD_STAGES, daysUntil, labelOf } from '@crm/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DocsPanel } from '../components/Docs';
import { QuotesTable } from '../components/FinanceTables';
import { LogContactModal, ConvertModal } from '../components/LeadModals';
import { HistoryPanel } from '../components/HistoryPanel';
import { Notes } from '../components/Notes';
import { Highlights, Hl, Meta, Prop, PropsSec, Record, RecHead } from '../components/record';
import { TaskModal } from '../components/TaskModal';
import { useEditor } from '../forms/RecordEditor';
import { api, type Row } from '../lib/api';
import { fmtDate, money, plural } from '../lib/format';
import { useAct, useParam, useRecord } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { useDialogs } from '../ui/Modal';
import { Page } from '../ui/Page';
import { Badge, Crumb, ErrorBox, ExtLink, Heat, Skeleton, Tabs, Who } from '../ui/primitives';
import { TaskBoard } from './Tasks';
import { FOLLOWUP_ROUNDS } from '@crm/shared';

export default function LeadDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isFounder, user } = useSession();
  const editor = useEditor();
  const dialogs = useDialogs();
  const q = useRecord('leads', id);
  const [tab, setTab] = useParam('tab', 'activity');
  const [log, setLog] = useState(false);
  const [convert, setConvert] = useState(false);
  const [openTask, setOpenTask] = useState<number | null>(null);
  const setStage = useAct((body: { stage: string; lost_reason?: string }) => api.put(`/leads/${id}`, body), 'Stage updated');

  if (q.isPending) return <div id="page"><Skeleton kind="record" /></div>;
  if (q.isError) return <div id="page"><ErrorBox error={q.error} retry={() => void q.refetch()} /></div>;
  const l = q.data as Row;
  const lid = Number(l.id);
  const closed = (CLOSED_STAGES as readonly string[]).includes(String(l.stage));
  const days = Math.max(0, Math.round((Date.now() - new Date(String(l.created_at).replace(' ', 'T') + 'Z').getTime()) / 86_400_000));
  const fuDays = l.next_followup ? daysUntil(String(l.next_followup)) : null;
  const wa = l.phone ? String(l.phone).replace(/\D/g, '') : '';
  const tabs = [{ key: 'activity', label: 'Activity' }, { key: 'tasks', label: 'Tasks' }, { key: 'files', label: 'Files' }, ...(isFounder ? [{ key: 'quotes', label: 'Quotations' }] : []), { key: 'history', label: 'History' }];

  const changeStage = async (stage: string) => {
    let reason: string | undefined;
    if (stage === 'lost' || stage === 'closed') {
      const r = await dialogs.prompt(stage === 'lost' ? 'Mark as lost' : 'Close this lead', 'What was the reason? It helps spot patterns later.', '');
      if (r === null) return;
      reason = r || undefined;
    }
    setStage.mutate({ stage, lost_reason: reason });
  };

  return (
    <Page title={String(l.company || l.name)} crumbs={<><Crumb to="/leads">Pipeline</Crumb><b>{String(l.company || l.name)}</b></>}
      actions={<>
        {!closed && <button type="button" className="btn" onClick={() => setLog(true)}><Icon name="phone" />Log contact</button>}
        {isFounder && !['lost', 'closed', 'won'].includes(String(l.stage)) && <button type="button" className="btn accent" onClick={() => setConvert(true)}><Icon name="check" />{l.client_id ? 'Start the work' : 'Convert to client'}</button>}
        {isFounder && <button type="button" className="btn" onClick={() => nav(`/quotes/new?lead=${lid}`)}>New quotation</button>}
        <button type="button" className="btn" onClick={() => editor.open({ resource: 'leads', record: l, onDone: (r) => { if (!r) nav('/leads'); } })}><Icon name="edit" />Edit</button>
      </>}>
      <Record
        main={<>
          <RecHead name={String(l.company || l.name)} refId={l.ref}
            meta={<><Badge value={l.stage} /><Heat value={l.priority} />{l.company && l.company !== l.name ? <Meta>{String(l.name)}</Meta> : null}
              {l.department ? <Meta>{String(l.department)}{l.business_side ? ` · ${String(l.business_side)}` : ''}</Meta> : null}
              {l.client_id ? <Link to={`/clients/${l.client_id}`}>{l.stage === 'won' ? 'Now a client →' : `Existing client: ${String(l.client_name ?? '')} →`}</Link> : null}</>} />
          <Highlights>
            <Hl label="Deal value" value={Number(l.value) ? money(l.value) : '—'} sub={`Probability ${l.probability ?? 0}% · weighted ${money((Number(l.value) * Number(l.probability || 0)) / 100)}`} />
            <Hl label="Next follow-up" value={l.next_followup && !closed ? fmtDate(l.next_followup).replace(/ \d{4}$/, '') : '—'}
              sub={closed ? 'Deal ended' : `${String(l.followup_status ?? '')}${fuDays !== null ? (fuDays < 0 ? ` · ${-fuDays} days late` : fuDays === 0 ? ' · today' : ` · in ${fuDays} days`) : ''}`}
              tone={fuDays !== null && fuDays < 0 && !closed ? 'bad' : ''} />
            <Hl label="Follow-up round" value={labelOf(FOLLOWUP_ROUNDS, String(l.followup_round)) || '—'} sub={l.last_contact ? `Last contact ${fmtDate(l.last_contact)}` : 'No contact logged'} />
            <Hl label={closed ? 'Closed on' : 'Added'} value={closed ? (l.closed_on ? fmtDate(l.closed_on) : '—') : fmtDate(l.created_at)} sub={closed ? '' : `${plural(days, 'day')} in the pipeline`} />
          </Highlights>
          {l.next_action && !closed ? <div className="callout info next-act"><b>Next action:</b> {String(l.next_action)}</div> : null}
          <Tabs tabs={tabs} active={tabs.some((t) => t.key === tab) ? tab : 'activity'} onChange={setTab} />
          <div style={{ marginTop: 18 }}>
            {tab === 'activity' && <Notes type="lead" id={lid} />}
            {tab === 'tasks' && (
              <div className="stack">
                <div><button type="button" className="btn" onClick={() => editor.open({ resource: 'tasks', defaults: { lead_id: lid, assignee_id: user.id } })}><Icon name="plus" />Task</button></div>
                <TaskBoard query={{ lead_id: lid }} onOpen={setOpenTask} />
              </div>
            )}
            {tab === 'files' && <DocsPanel entityType="lead" entityId={lid} canUpload={isFounder} />}
            {tab === 'quotes' && isFounder && <QuotesTable query={{ lead_id: lid }} compact noAdd />}
            {tab === 'history' && <HistoryPanel resource="leads" id={lid} />}
          </div>
        </>}
        side={<>
          <PropsSec title="Deal">
            <Prop label="Lead ID"><span className="tnum">{String(l.ref)}</span></Prop>
            <Prop label="Sales stage">
              <select aria-label="Sales stage" value={String(l.stage)} onChange={(e) => void changeStage(e.target.value)}>{LEAD_STAGES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
            </Prop>
            <Prop label="Priority"><Heat value={l.priority} /></Prop>
            <Prop label="Department">{l.department ? String(l.department) : null}</Prop>
            <Prop label="Category">{l.category ? String(l.category) : null}</Prop>
            <Prop label="Lead source">{l.source ? String(l.source) : null}</Prop>
            <Prop label="Assigned to">{l.owner_id ? <Who name={l.owner_name} /> : l.owner_name ? <>{String(l.owner_name)} <span className="faint small">(not a team member yet)</span></> : null}</Prop>
            <Prop label="Meeting / demo">{l.meeting_date ? fmtDate(l.meeting_date) : null}</Prop>
            <Prop label="Proposal">{l.proposal_date ? fmtDate(l.proposal_date) : null}</Prop>
            {l.lost_reason ? <Prop label="Reason">{String(l.lost_reason)}</Prop> : null}
          </PropsSec>
          <PropsSec title="Contact">
            {l.name && l.name !== l.company ? <Prop label="Contact person">{String(l.name)}</Prop> : null}
            <Prop label="Phone">{l.phone ? <><a href={`tel:${String(l.phone)}`}>{String(l.phone)}</a>{wa.length >= 10 ? <> · <a href={`https://wa.me/${wa.length === 10 ? `91${wa}` : wa}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></> : null}</> : null}</Prop>
            <Prop label="Email">{l.email ? <a href={`mailto:${String(l.email)}`}>{String(l.email)}</a> : null}</Prop>
            <Prop label="City">{l.city ? String(l.city) : null}</Prop>
            <Prop label="Country">{l.country ? String(l.country) : null}</Prop>
            <Prop label="Market">{l.market ? String(l.market) : null}</Prop>
            <Prop label="Website">{l.website ? <ExtLink url={l.website} /> : null}</Prop>
          </PropsSec>
          <PropsSec title="Requirement / interested in"><div className="doc-text pre">{l.requirement ? String(l.requirement) : <span className="faint">Nothing written yet.</span>}</div></PropsSec>
          <PropsSec title="Specification">
            <div className="doc-text pre">{l.specs ? String(l.specs) : <span className="faint">Write what the client wants built — pages, features, integrations. It becomes the project’s specification when the lead is converted.</span>}</div>
          </PropsSec>
          {l.notes ? <PropsSec title="Notes"><div className="doc-text pre">{String(l.notes)}</div></PropsSec> : null}
        </>} />
      {log && <LogContactModal lead={l} onClose={() => setLog(false)} />}
      {convert && <ConvertModal lead={l} onClose={() => setConvert(false)} />}
      {openTask && <TaskModal taskId={openTask} onClose={() => setOpenTask(null)} />}
    </Page>
  );
}
