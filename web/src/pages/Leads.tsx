import { addDays, today, CLOSED_STAGES, FOLLOWUP_ROUNDS, FOLLOWUP_STATUSES, LEAD_PRIORITIES, LEAD_STAGES, MARKETS, STAGE_PROB, compact, labelOf } from '@crm/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEditor } from '../forms/RecordEditor';
import { api, qs, type Row } from '../lib/api';
import { fmtDate, money, plural } from '../lib/format';
import { useAct, useGet, useParam } from '../lib/hooks';
import { settingList, useSession } from '../lib/session';
import { useDialogs } from '../ui/Modal';
import { DataTable, type Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Kanban } from '../ui/Kanban';
import { Page } from '../ui/Page';
import { LogContactModal } from '../components/LeadModals';
import { Popover } from '../ui/Popover';
import { useRef, useState } from 'react';
import { Badge, Due, ErrorBox, FollowupStatus, Heat, LogoSq, Seg, Who } from '../ui/primitives';
import { ExportMenu } from '../ui/ExportMenu';
import { Link } from 'react-router-dom';
import { LinkTo } from './common';

const STAGE_TONE: Record<string, string> = { new: 'var(--faint)', contacted: 'var(--blue)', qualified: '#4f8fb8', meeting: '#5b7fd6', proposal: 'var(--accent)', negotiation: 'var(--plum)', accepted: '#2f9e6f', won: 'var(--green)', closed: 'var(--muted)', lost: 'var(--red)', nurture: '#c47f17' };
const FILTERS = ['department', 'category', 'priority', 'market', 'owner_id', 'source', 'followup_status'] as const;

export function LeadCard({ l, menu }: { l: Row; menu?: (anchor: HTMLElement, l: Row) => void }) {
  const ended = (CLOSED_STAGES as readonly string[]).includes(String(l.stage));
  return (
    <>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="t">{String(l.company || l.name)}</div>
          <div className="s">{[l.company && l.company !== l.name ? l.name : '', l.department].filter(Boolean).join(' · ') || String(l.city ?? '')}</div>
        </div>
        {menu && <button type="button" className="btn ghost sm icon" aria-label={`Actions for ${String(l.company || l.name)}`} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); menu(e.currentTarget, l); }}><Icon name="chevDown" /></button>}
      </div>
      {l.client_id && !ended ? <div className="s" style={{ marginTop: 3 }}><span className="tag blue">Existing client</span></div> : null}
      <div className="f">
        <Heat value={l.priority} />
        {Number(l.value) > 0 && <b className="tnum">{money(l.value)}</b>}
        <span className="grow" />
        {!ended && l.next_followup ? <Due date={l.next_followup} /> : !ended ? <span className="faint small" title="No follow-up date">no date</span> : null}
        {l.owner_name ? <Who name={String(l.owner_name).split(' ')[0]} /> : null}
      </div>
    </>
  );
}

export default function Leads() {
  const { lookups, isFounder, user } = useSession();
  const editor = useEditor();
  const nav = useNavigate();
  const dialogs = useDialogs();
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useParam('view', 'list');
  const [showFilters, setShowFilters] = useState(false);
  const f: Record<string, string> = {};
  for (const k of FILTERS) { const v = sp.get(k); if (v) f[k] = v; }
  const q = sp.get('q') ?? '';
  const showClosed = sp.get('closed') === '1';
  const setParam = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const stats = useGet<{ total: { open: number; pipeline: number; weighted: number; conversion: number; due_today: number; overdue: number; no_date: number }; by_department: { name: string; leads: number }[] }>('/analytics/sales');
  const params = { ...f, q: q || undefined };
  const board = useQuery({ queryKey: ['rows', 'leads-board', params], queryFn: () => api.page<Row>(`/leads${qs({ ...params, limit: 500 })}`), enabled: view === 'board' });
  const move = useAct(({ id, stage, lost_reason }: { id: number; stage: string; lost_reason?: string }) => api.put(`/leads/${id}`, { stage, ...(lost_reason ? { lost_reason } : {}) }), 'Stage updated');
  const t = stats.data?.total;
  const [menu, setMenu] = useState<{ anchor: HTMLElement; lead: Row } | null>(null);
  const [logging, setLogging] = useState<Row | null>(null);
  const setDate = useAct(({ id, next_followup }: { id: number; next_followup: string }) => api.put(`/leads/${id}`, { next_followup }), 'Follow-up scheduled');
  void useRef;

  const depts = [...new Set([...settingList(lookups, 'lead_services'), ...settingList(lookups, 'lead_products'), ...(stats.data?.by_department ?? []).map((d) => d.name).filter((n) => n !== 'Not set')])];
  const count = (d: string) => stats.data?.by_department.find((x) => x.name === d)?.leads ?? 0;
  const totalAll = stats.data?.by_department.reduce((s, d) => s + d.leads, 0) ?? 0;

  const onMove = async (l: Row, stage: string) => {
    let reason: string | undefined;
    if (stage === 'lost' || stage === 'closed') {
      const r = await dialogs.prompt(stage === 'lost' ? 'Mark as lost' : 'Close this lead', 'What was the reason? It helps spot patterns later.', '');
      if (r === null) return;
      reason = r || undefined;
    }
    move.mutate({ id: l.id, stage, lost_reason: reason });
  };

  const selects: [string, string, readonly (readonly [string, string] | string)[]][] = [
    ['category', 'Category', settingList(lookups, 'lead_categories')],
    ['priority', 'Priority', LEAD_PRIORITIES],
    ['market', 'Market', MARKETS],
    ['owner_id', 'Assigned To', lookups.users.map((u): readonly [string, string] => [String(u.id), u.name])],
    ['source', 'Lead Source', settingList(lookups, 'lead_sources')],
    ['followup_status', 'Follow-Up Status', [...FOLLOWUP_STATUSES]],
  ];

  const cols: Column[] = [
    { key: 'created_at', label: 'Added', cls: 'opt nowrap', sort: 'created_at', render: (r) => fmtDate(r.created_at) },
    {
      key: 'company', label: 'Company / Person', sort: 'company',
      render: (r) => <div className="who"><LogoSq name={r.company || r.name} size="sm" /><div style={{ minWidth: 0 }}><div className="t1 ellipsis"><LinkTo to={`/leads/${String(r.id)}`}>{String(r.company || r.name)}</LinkTo></div><div className="t2 ellipsis">{[r.company && r.company !== r.name ? r.name : '', r.phone].filter(Boolean).join(' · ')}</div></div></div>,
    },
    { key: 'market', label: 'Market', cls: 'opt', render: (r) => String(r.market ?? '—') },
    { key: 'department', label: 'Department / Product', render: (r) => <>{String(r.department ?? '—')}<div className="t2">{String(r.business_side ?? '')}</div></> },
    { key: 'source', label: 'Source', cls: 'opt', render: (r) => <span className="muted">{String(r.source ?? '—')}</span> },
    { key: 'owner_name', label: 'Assigned To', sort: 'owner_name', render: (r) => (r.owner_id ? <Who name={r.owner_name} /> : r.owner_name ? <span className="muted" title="Not a team member yet">{String(r.owner_name)}</span> : <span className="faint">—</span>) },
    { key: 'priority', label: 'Priority', sort: 'priority', render: (r) => <Heat value={r.priority} /> },
    { key: 'stage', label: 'Stage', sort: 'stage', render: (r) => <Badge value={r.stage} /> },
    { key: 'followup_round', label: 'Round', cls: 'opt nowrap', render: (r) => labelOf(FOLLOWUP_ROUNDS, String(r.followup_round)) },
    { key: 'last_contact', label: 'Last contact', cls: 'opt nowrap', sort: 'last_contact', render: (r) => (r.last_contact ? <Due date={r.last_contact} done /> : <span className="faint">—</span>) },
    { key: 'next_followup', label: 'Next follow-up', cls: 'nowrap', sort: 'next_followup', render: (r) => ((CLOSED_STAGES as readonly string[]).includes(String(r.stage)) || !r.next_followup ? <span className="faint">—</span> : <Due date={r.next_followup} />) },
    { key: 'followup_status', label: 'Follow-up status', cls: 'opt', render: (r) => <FollowupStatus value={r.followup_status} /> },
    { key: 'value', label: 'Deal value', num: true, sort: 'value', render: (r) => (Number(r.value) ? money(r.value) : <span className="faint">—</span>) },
    { key: 'probability', label: 'Prob.', num: true, cls: 'opt', render: (r) => `${r.probability ?? 0}%` },
  ];

  const stageCols = LEAD_STAGES.filter(([v]) => showClosed || !['closed', 'lost'].includes(v));
  return (
    <Page title="Pipeline" crumbs={<b>Pipeline</b>}
      actions={<>
        <Seg value={view as 'board' | 'list'} onChange={setView} options={[['list', 'List'], ['board', 'Board']]} />
        {isFounder && <ExportMenu path="/leads/export" params={{ ...f, q }} />}
        <button type="button" className="btn primary" onClick={() => editor.open({ resource: 'leads', defaults: { owner_id: user.id, department: f.department ?? '', category: f.category ?? '' } })}><Icon name="plus" />New lead</button>
      </>}>
      <div className="pt"><div>
        <h1>Pipeline</h1>
        <div className="sub">
          {t ? <>{plural(t.open, 'open lead')} · {t.pipeline ? <>pipeline <b style={{ color: 'var(--ink)' }}>{money(t.pipeline)}</b> · weighted {money(t.weighted)}</> : 'no deal values entered yet'} · {t.conversion}% converted · <Link to="/followups">{plural(t.due_today + t.overdue, 'follow-up')} due</Link>{t.no_date ? <> · <Link to="/followups?show=nodate">{t.no_date} with no follow-up date</Link></> : null}</> : ' '}
        </div>
      </div></div>
      <nav className="dept-tabs" aria-label="Department / Product">
        {[['', 'All leads', totalAll] as const, ...depts.map((d) => [d, d, count(d)] as const).filter(([d, , n]) => n || d === f.department)].map(([d, label, n]) => (
          <a key={d || 'all'} href="#" className={(f.department ?? '') === d ? 'on' : ''} onClick={(e) => { e.preventDefault(); setParam('department', d); }}>{label} <span>{n}</span></a>
        ))}
      </nav>
      <div className="toolbar lead-tb">
        <input type="search" placeholder="Search company, person, phone…" aria-label="Search leads" value={q} onChange={(e) => setParam('q', e.target.value)} />
        <button type="button" className={`btn tb-filter-btn${selects.some(([k]) => f[k]) ? ' on' : ''}`} aria-expanded={showFilters} onClick={() => setShowFilters((o) => !o)}><Icon name="list" />Filters{selects.filter(([k]) => f[k]).length ? <span className="tb-count">{selects.filter(([k]) => f[k]).length}</span> : null}</button>
        <div className={`tb-filters${showFilters ? ' open' : ''}`}>
        {selects.map(([k, label, opts]) => (
          <select key={k} aria-label={label} value={f[k] ?? ''} onChange={(e) => setParam(k, e.target.value)}>
            <option value="">{label}</option>
            {opts.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o[0]} value={o[0]}>{o[1]}</option>))}
          </select>
        ))}
        </div>
        {view === 'board' && <label className="check" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={showClosed} onChange={(e) => setParam('closed', e.target.checked ? '1' : '')} /><span>Show closed &amp; lost</span></label>}
      </div>
      {view === 'list' ? (
        <DataTable resource="leads" query={params} exportable={false} filtersOpen={showFilters} columns={cols} noSearch defaultSort="created_at:desc" noun="lead" onRow={(r) => nav(`/leads/${r.id}`)}
          filters={[{ key: 'stage', label: 'All stages', options: LEAD_STAGES }, { key: 'followup_round', label: 'Any round', options: FOLLOWUP_ROUNDS }]}
          empty={{ title: 'No leads match', text: 'Clear a filter to see more, or add a new lead.' }} />
      ) : board.isError ? <ErrorBox error={board.error} retry={() => void board.refetch()} /> : board.isPending ? <div className="tbl"><div className="empty">Loading…</div></div> : (
        <Kanban cols={stageCols.map(([v, l]) => ({ v, l, c: STAGE_TONE[v] }))} items={board.data?.rows ?? []} group={(l) => String(l.stage)} card={(l) => <LeadCard l={l} menu={(anchor, lead) => setMenu({ anchor, lead })} />}
          head={(list) => (list.length ? compact(list.reduce((s, l) => s + Number(l.value || 0), 0)) : '')} onOpen={(l) => nav(`/leads/${l.id}`)} onMove={(l, stage) => void onMove(l, stage)} colMin={176} />
      )}
      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} className="narrow" placement="below-end">
          <div className="menu-i" role="menuitem" tabIndex={0} onClick={() => { nav(`/leads/${menu.lead.id}`); setMenu(null); }}><Icon name="arrowUpRight" />Open lead</div>
          {!(CLOSED_STAGES as readonly string[]).includes(String(menu.lead.stage)) && <div className="menu-i" role="menuitem" tabIndex={0} onClick={() => { setLogging(menu.lead); setMenu(null); }}><Icon name="phone" />Log contact</div>}
          {!(CLOSED_STAGES as readonly string[]).includes(String(menu.lead.stage)) && [['Follow up tomorrow', 1], ['Follow up in 3 days', 3], ['Follow up next week', 7]].map(([label, days]) => (
            <div key={String(label)} className="menu-i" role="menuitem" tabIndex={0} onClick={() => { setDate.mutate({ id: menu.lead.id, next_followup: addDays(today(), Number(days)) }); setMenu(null); }}><Icon name="calendar" />{String(label)}</div>
          ))}
          <div className="small faint" style={{ padding: "6px 14px" }}>Move to</div>
          {LEAD_STAGES.filter(([v]) => v !== menu.lead.stage).map(([v, l2]) => <div key={v} className="menu-i" role="menuitem" tabIndex={0} onClick={() => { void onMove(menu.lead, v); setMenu(null); }}>{l2}</div>)}
        </Popover>
      )}
      {logging && <LogContactModal lead={logging} onClose={() => setLogging(null)} />}
      <p className="small muted">Weighted pipeline uses the stage guide: {Object.entries(STAGE_PROB).filter(([k]) => !['won', 'closed', 'lost', 'nurture'].includes(k)).map(([k, v]) => `${labelOf(LEAD_STAGES, k)} ${v}%`).join(', ')}.</p>
    </Page>
  );
}
