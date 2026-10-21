import { addDays, FOLLOWUP_ROUNDS, LEAD_PRIORITIES, labelOf, today } from '@crm/shared';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LogContactModal } from '../components/LeadModals';
import { useEditor } from '../forms/RecordEditor';
import type { Row } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useRows } from '../lib/hooks';
import { settingList, useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { Avatar, Badge, Due, Empty, Heat } from '../ui/primitives';

const waLink = (phone: unknown): string => {
  const d = String(phone ?? '').replace(/\D/g, '');
  return d.length >= 10 ? `https://wa.me/${d.length === 10 ? `91${d}` : d}` : '';
};

export default function Followups() {
  const { isFounder, user, lookups } = useSession();
  const editor = useEditor();
  const [sp, setSp] = useSearchParams();
  const [logging, setLogging] = useState<Row | null>(null);
  const [more, setMore] = useState<Record<string, number>>({});
  const who = sp.get('who') ?? (isFounder ? 'all' : 'mine');
  const department = sp.get('department') ?? '';
  const priority = sp.get('priority') ?? '';
  const t = today();
  const in7 = addDays(t, 7);
  const q = useRows('leads', { open: 1, owner_id: who === 'mine' ? user.id : undefined, department: department || undefined, priority: priority || undefined, limit: 500 });
  const open = q.data?.rows ?? [];

  const rank: Record<string, number> = { hot: 0, medium: 1, cold: 2 };
  const by = (a: Row, b: Row) => String(a.next_followup ?? '9999').localeCompare(String(b.next_followup ?? '9999')) || (rank[String(a.priority)] ?? 1) - (rank[String(b.priority)] ?? 1);
  const groups: [string, string, Row[], string][] = [
    ['overdue', 'Overdue', open.filter((l) => l.next_followup && String(l.next_followup) < t), 'bad'],
    ['today', 'Due Today', open.filter((l) => l.next_followup === t), 'warn'],
    ['week', 'Next 7 Days', open.filter((l) => l.next_followup && String(l.next_followup) > t && String(l.next_followup) <= in7), ''],
    ['later', 'Later', open.filter((l) => l.next_followup && String(l.next_followup) > in7), ''],
    ['nodate', 'No Date', open.filter((l) => !l.next_followup), ''],
  ];
  const dueNow = (groups[0]?.[2].length ?? 0) + (groups[1]?.[2].length ?? 0);
  const sel = sp.get('show') ?? (dueNow ? 'due' : 'all');
  const set = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const shown = groups.filter(([k, , list]) => list.length && (sel === 'all' || (sel === 'due' ? ['overdue', 'today'].includes(k) : sel === k)));
  const kpiOrder = ['today', 'overdue', 'week', 'nodate', 'later'];

  return (
    <Page title="Follow-ups" sub="Open this every morning: who to call today, who is overdue, and what to say next."
      actions={<>
        <Link className="btn" to="/contact-log"><Icon name="note" />Contact Log</Link>
        <button type="button" className="btn primary" onClick={() => editor.open({ resource: 'leads', defaults: { owner_id: user.id } })}><Icon name="plus" />New lead</button>
      </>}>
      <div className="kpis fu-kpis">
        {kpiOrder.map((k) => groups.find((g) => g[0] === k) as [string, string, Row[], string]).map(([k, label, list, cls]) => (
          <a key={k} href="#" className={`kpi ${cls && list.length ? cls : ''} ${sel === k ? 'on' : ''}`} onClick={(e) => { e.preventDefault(); set('show', k); }}>
            <div className="l">{label}</div><div className="v">{list.length}</div>
          </a>
        ))}
      </div>
      <div className="toolbar">
        <div className="seg"><button type="button" className={who === 'mine' ? 'on' : ''} onClick={() => set('who', 'mine')}>Mine</button><button type="button" className={who === 'all' ? 'on' : ''} onClick={() => set('who', 'all')}>Everyone</button></div>
        <div className="seg"><button type="button" className={sel === 'due' ? 'on' : ''} onClick={() => set('show', 'due')}>Due now</button><button type="button" className={sel === 'all' ? 'on' : ''} onClick={() => set('show', 'all')}>All open</button></div>
        <select aria-label="Department / Product" value={department} onChange={(e) => set('department', e.target.value)}>
          <option value="">All departments / products</option>
          {[...settingList(lookups, 'lead_services'), ...settingList(lookups, 'lead_products')].map((d) => <option key={d}>{d}</option>)}
        </select>
        <select aria-label="Priority" value={priority} onChange={(e) => set('priority', e.target.value)}><option value="">Any priority</option>{LEAD_PRIORITIES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
      </div>
      {shown.length ? shown.map(([k, label, list]) => (
        <section key={k} className={`panel fu-group fu-${k}`}>
          <div className="panel-h"><h2>{label}</h2><span className="muted small">{list.length}</span></div>
          <div className="fu-list">
            {[...list].sort(by).slice(0, 15 + (more[k] ?? 0)).map((l) => {
              const wa = waLink(l.phone);
              return (
                <div className="fu-row" key={l.id}>
                  <div className="fu-main">
                    <div className="t1"><Link to={`/leads/${l.id}`}>{String(l.company || l.name)}</Link> <Heat value={l.priority} /></div>
                    <div className="t2">{[l.company && l.company !== l.name ? l.name : '', l.department, l.city].filter(Boolean).join(' · ')}</div>
                    {l.next_action ? <div className="fu-next"><Icon name="arrowR" />{String(l.next_action)}</div> : null}
                  </div>
                  <div className="fu-meta"><Badge value={l.stage} /><span className="small muted">{labelOf(FOLLOWUP_ROUNDS, String(l.followup_round))}</span></div>
                  <div className="fu-when">{l.next_followup ? <Due date={l.next_followup} /> : <span className="faint small">No date</span>}<div className="small muted">{l.last_contact ? `last contact ${fmtDate(l.last_contact)}` : 'never contacted'}</div></div>
                  <div className="fu-act">
                    {l.phone ? <a className="btn sm icon" href={`tel:${String(l.phone)}`} title={`Call ${String(l.phone)}`} aria-label="Call"><Icon name="phone" /></a> : null}
                    {wa ? <a className="btn sm icon" href={wa} target="_blank" rel="noopener noreferrer" title="WhatsApp" aria-label="WhatsApp"><Icon name="chat" /></a> : null}
                    <button type="button" className="btn sm" onClick={() => setLogging(l)}>Log contact</button>
                    {l.owner_name ? <Avatar name={l.owner_name} size="sm" /> : null}
                  </div>
                </div>
              );
            })}
            {list.length > 15 + (more[k] ?? 0) && (
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
                <button type="button" className="btn sm" onClick={() => setMore((m) => ({ ...m, [k]: (m[k] ?? 0) + 25 }))}>Show {Math.min(25, list.length - 15 - (more[k] ?? 0))} more of {list.length - 15 - (more[k] ?? 0)} left</button>
              </div>
            )}
          </div>
        </section>
      )) : (
        <div className="panel"><Empty mini icon="check" title={sel === 'due' ? 'Nothing due right now' : 'No open leads here'}>{sel === 'due' ? <a className="btn sm" href="#" onClick={(e) => { e.preventDefault(); set('show', 'all'); }}>See all open leads</a> : null}</Empty></div>
      )}
      {logging && <LogContactModal lead={logging} onClose={() => setLogging(null)} />}
    </Page>
  );
}
