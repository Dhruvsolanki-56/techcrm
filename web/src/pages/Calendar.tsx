import { addDays, today } from '@crm/shared';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useEditor } from '../forms/RecordEditor';
import { api, type Row } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useGet } from '../lib/hooks';
import { LoadFailed } from '../ui/primitives';
import { useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';

interface Item { date: string; type: string; title: string; sub?: string | null; link: string | null; event_id?: number }
const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function Entry({ i, onEvent }: { i: Item; onEvent(id: number): void }) {
  const body = (
    <>
      <span className={`ev c-${i.type}`} style={{ margin: '3px 0 0', padding: 0 }} />
      <div className="grow"><div className="t" style={{ whiteSpace: 'normal' }}>{i.title}</div><div className="s">{i.sub}</div></div>
      <span className="small muted nowrap">{fmtDate(i.date).replace(/ \d{4}$/, '')}</span>
    </>
  );
  return i.link
    ? <Link to={i.link} className="li" style={{ alignItems: 'flex-start' }}>{body}</Link>
    : <div className="li" style={{ alignItems: 'flex-start', cursor: i.event_id ? 'pointer' : undefined }} onClick={() => i.event_id && onEvent(i.event_id)}>{body}</div>;
}

export default function Calendar() {
  const { isFounder } = useSession();
  const editor = useEditor();
  const [sp, setSp] = useSearchParams();
  const now = new Date();
  const m = sp.get('m') && /^\d{4}-\d{2}$/.test(sp.get('m') as string) ? (sp.get('m') as string) : ym(now);
  const [Y, M] = m.split('-').map(Number) as [number, number];
  const first = new Date(Y, M - 1, 1);
  const gridStart = new Date(Y, M - 1, 1 - ((first.getDay() + 6) % 7));
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 41);
  const [sel, setSel] = useState<string | null>(null);
  const q = useGet<{ items: Item[] }>('/calendar', { from: f(gridStart), to: f(gridEnd) });
  const items = q.data?.items ?? [];
  const by: Record<string, Item[]> = {};
  for (const i of items) (by[i.date] ??= []).push(i);
  const go = (d: Date) => setSp({ m: ym(d) });
  const t = today();
  const upcoming = items.filter((i) => i.date >= t).slice(0, 14);
  const selected = sel ? by[sel] ?? [] : null;
  const openEvent = async (id: number) => { const rec = await api.get<Row>(`/events/${id}`); editor.open({ resource: 'events', record: rec, canDelete: true }); };
  const addEvent = (date: string) => editor.open({ resource: 'events', defaults: { date, kind: 'Reminder' } });

  return (
    <Page title="Calendar" crumbs={<b>Calendar</b>}
      actions={<>
        <button type="button" className="btn icon" title="Previous month" aria-label="Previous month" onClick={() => go(new Date(Y, M - 2, 1))}><Icon name="arrowL" /></button>
        <button type="button" className="btn" onClick={() => setSp({})}>Today</button>
        <button type="button" className="btn icon" title="Next month" aria-label="Next month" onClick={() => go(new Date(Y, M, 1))}><Icon name="arrowR" /></button>
        {isFounder && <button type="button" className="btn primary" onClick={() => addEvent(t)}><Icon name="plus" />Reminder</button>}
      </>}>
      <LoadFailed q={q} />
      <div className="pt">
        <div><h1>{first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h1><div className="sub">Deadlines, due dates, renewals and follow-ups in one view.</div></div>
        <div className="legend">
          <span className="c-project">Project deadline</span><span className="c-task">Task</span><span className="c-invoice">Invoice due</span><span className="c-renewal">Renewal / quote</span><span className="c-followup">Follow-up</span>
          {isFounder && <><span className="c-grant">Grant report</span><span className="c-document">Document expiry</span></>}
        </div>
      </div>
      <div className="grid g-main" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
        <div className="cal" aria-busy={q.isFetching}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div className="cal-h" key={d}>{d}</div>)}
          {Array.from({ length: 42 }, (_, i) => {
            const d = new Date(gridStart);
            d.setDate(d.getDate() + i);
            const k = f(d);
            const list = by[k] ?? [];
            return (
              <div key={k} className={`cal-d${d.getMonth() !== M - 1 ? ' out' : ''}${k === t ? ' today' : ''}${sel === k ? ' sel' : ''}`} onClick={() => setSel(k)} role="button" tabIndex={0} aria-label={`${fmtDate(k)}, ${list.length} items`}
                onKeyDown={(e) => { if (e.key === 'Enter') setSel(k); }}>
                <span className="n">{d.getDate()}</span>
                {list.slice(0, 3).map((x, n) => <div key={n} className={`ev c-${x.type}`} title={x.title}><span>{x.title.replace(/^(Task|Deadline|Renewal|Auto-debit|Follow up|Invoice due|Quote expires): /, '')}</span></div>)}
                {list.length > 3 && <div className="small faint" style={{ padding: '1px 4px' }}>+{list.length - 3} more</div>}
              </div>
            );
          })}
        </div>
        <section className="panel" style={{ alignSelf: 'start' }}>
          <div className="panel-h"><h2>{sel ? fmtDate(sel) : 'Coming up'}</h2></div>
          <div>
            {(selected ?? upcoming).length ? <div className="list">{(selected ?? upcoming).map((i, n) => <Entry key={n} i={i} onEvent={(id) => void openEvent(id)} />)}</div> : <div className="empty mini">Nothing on this day.</div>}
            {isFounder && sel && <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }}><button type="button" className="btn sm" onClick={() => addEvent(sel)}><Icon name="plus" />Reminder on this day</button></div>}
          </div>
        </section>
      </div>
    </Page>
  );
}
void addDays;
