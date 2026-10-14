import { daysUntil, TASK_STATUSES } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEditor } from '../forms/RecordEditor';
import { api, qs, type Row } from '../lib/api';
import { fmtDate, plural } from '../lib/format';
import { useAct } from '../lib/hooks';
import { useSession } from '../lib/session';
import { ago } from '../shell/Bell';
import { Icon } from '../ui/Icon';
import { Modal, useDialogs } from '../ui/Modal';
import { Avatar, AvatarStack, Badge, Due, Priority, pretty, Who } from '../ui/primitives';
import { useToast } from '../ui/Toasts';
import { DocsPanel } from './Docs';
import { Prop } from './record';

export const taskKey = (id: unknown): string => `T-${id}`;
interface Person { id: number; name: string; title?: string | null; role?: string }
interface Collab { checklist: Row[]; watchers: Person[]; watching: boolean; people: Person[]; can_edit: boolean }
interface Note extends Row { kind: string; body: string; user_id: number; user_name: string; created_at: string; edited_at: string | null; mentions: string | null }

function Checklist({ taskId, people, canEdit, collab }: { taskId: number; people: Person[]; canEdit: boolean; collab: Collab }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [who, setWho] = useState('');
  const list = collab.checklist;
  const done = list.filter((c) => c.done).length;
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); await qc.invalidateQueries({ queryKey: ['collab', taskId] }); await qc.invalidateQueries({ queryKey: ['list'] }); } catch (e) { toast.fail(e); } };
  return (
    <div>
      {list.length > 0 && <div className="ck-bar" role="progressbar" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={done} aria-label="Checklist progress"><i style={{ width: `${Math.round((100 * done) / list.length)}%` }} /></div>}
      <div className="ck-list">
        {list.map((c) => (
          <div key={c.id} className={`ck ${c.done ? 'done' : ''}`}>
            <button type="button" className="ck-box" disabled={!canEdit} aria-pressed={!!c.done} aria-label={`${c.done ? 'Mark not done' : 'Mark done'}: ${String(c.text)}`}
              onClick={() => void run(() => api.put(`/tasks/${taskId}/checklist/${c.id}`, { done: !c.done }))}><Icon name="check" /></button>
            <div className="ck-main"><span className="ck-t">{String(c.text)}</span>{c.done && c.done_by_name ? <span className="ck-by">{String(c.done_by_name)} · {ago(c.done_at)}</span> : null}</div>
            {canEdit && people.length ? (
              <select className="ck-who" aria-label="Who does this" value={String(c.assignee_id ?? '')} onChange={(e) => void run(() => api.put(`/tasks/${taskId}/checklist/${c.id}`, { assignee_id: e.target.value || null }))}>
                <option value="">Anyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : c.assignee_name ? <Who name={c.assignee_name} /> : null}
            {canEdit && <button type="button" className="btn ghost sm icon" aria-label="Remove item" onClick={() => void run(() => api.del(`/tasks/${taskId}/checklist/${c.id}`))}><Icon name="x" /></button>}
          </div>
        ))}
      </div>
      {!list.length && !canEdit && <div className="faint small">No checklist for this task.</div>}
      {canEdit && (
        <form className="ck-add" noValidate onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; void run(async () => { await api.post(`/tasks/${taskId}/checklist`, { text: text.trim(), assignee_id: who || null }); setText(''); }); }}>
          <input maxLength={300} value={text} onChange={(e) => setText(e.target.value)} aria-label="New checklist item" placeholder={list.length ? 'Add another item…' : 'Break the work into steps, e.g. “Build the login screen”'} />
          {people.length > 1 && <select aria-label="Who does this" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Anyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          <button className="btn sm" type="submit"><Icon name="plus" />Add</button>
        </form>
      )}
    </div>
  );
}

function renderBody(n: Note, meId: number) {
  let mentions: Person[] = [];
  try { mentions = (JSON.parse(n.mentions ?? '[]') as Person[]) ?? []; } catch { mentions = []; }
  if (!mentions.length) return n.body;
  const names = mentions.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = n.body.split(new RegExp(`(@(?:${names.join('|')}))`, 'g'));
  return parts.map((p, i) => {
    const m = mentions.find((x) => `@${x.name}` === p);
    return m ? <span key={i} className={`mention${m.id === meId ? ' me' : ''}`}>{p}</span> : p;
  });
}

function Thread({ taskId, people }: { taskId: number; people: Person[] }) {
  const { user, isFounder } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'comments' | 'history' | 'all'>('comments');
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [pop, setPop] = useState<{ q: string; sel: number } | null>(null);
  const picked = useRef(new Map<string, number>());
  const ta = useRef<HTMLTextAreaElement>(null);
  const notes = useQuery({ queryKey: ['task-notes', taskId], queryFn: () => api.get<Note[]>(`/notes${qs({ entity_type: 'task', entity_id: taskId })}`) });
  const reload = () => qc.invalidateQueries({ queryKey: ['task-notes', taskId] });
  const isLog = (n: Note) => n.kind === 'history' || n.kind === 'system';
  const shown = [...(notes.data ?? [])].reverse().filter((n) => (tab === 'all' ? true : tab === 'history' ? isLog(n) : !isLog(n)));

  const hits = pop ? people.filter((p) => p.id !== user.id && (!pop.q || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(pop.q)))).slice(0, 6) : [];
  const detect = (el: HTMLTextAreaElement) => {
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(el.value.slice(0, el.selectionStart));
    setPop(m ? { q: (m[2] ?? '').toLowerCase(), sel: 0 } : null);
  };
  const choose = (p: Person) => {
    const el = ta.current;
    if (!el) return;
    const pos = el.selectionStart;
    const before = el.value.slice(0, pos).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    setBody(before + el.value.slice(pos));
    picked.current.set(p.name, p.id);
    setPop(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };
  const post = useAct(async () => {
    const text = body.trim();
    const mentions = [...picked.current].filter(([name]) => text.includes(`@${name}`)).map(([, id]) => id);
    await api.post('/notes', { entity_type: 'task', entity_id: taskId, body: text, kind: 'note', mentions });
    return mentions.length;
  }, (n) => (n ? `Sent — ${plural(n, 'person was', 'people were')} notified` : ''), () => { setBody(''); picked.current.clear(); setTab('comments'); });

  return (
    <div>
      <div className="sec-h">
        <h3>Discussion</h3>
        <div className="seg sm" role="tablist">
          {(['comments', 'history', 'all'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{pretty(t)}</button>)}
        </div>
      </div>
      <div aria-busy={notes.isPending}>
        {shown.length ? (
          <div className="th">
            {shown.map((n) => (isLog(n) ? (
              <div className="th-log" key={n.id}><Icon name="activity" /><span>{n.kind === 'history' && <b>{n.user_name} </b>}{n.body}</span><span className="faint">· {ago(n.created_at)}</span></div>
            ) : (
              <div className="th-c" key={n.id}>
                <Avatar name={n.user_name} />
                <div className="th-b">
                  <div className="th-meta"><b>{n.user_name}</b><span className="faint">{ago(n.created_at)}{n.edited_at ? ' · edited' : ''}</span><span className="grow" />
                    {n.user_id === user.id && <button type="button" className="btn ghost sm" onClick={() => setEditing({ id: n.id, text: n.body })}>Edit</button>}
                    {(n.user_id === user.id || isFounder) && (
                      <button type="button" className="btn ghost sm icon" aria-label="Delete comment" onClick={async () => {
                        if (!(await dialogs.confirm('Delete this comment?', { danger: true, okLabel: 'Delete' }))) return;
                        try { await api.del(`/notes/${n.id}`); await reload(); } catch (e) { toast.fail(e); }
                      }}><Icon name="x" /></button>
                    )}
                  </div>
                  {editing?.id === n.id ? (
                    <div className="th-editing">
                      <textarea rows={3} aria-label="Edit comment" value={editing.text} onChange={(e) => setEditing({ id: n.id, text: e.target.value })} autoFocus />
                      <div className="bar2"><span className="grow" /><button type="button" className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
                        <button type="button" className="btn sm primary" onClick={async () => { if (!editing.text.trim()) return; try { await api.put(`/notes/${n.id}`, { body: editing.text }); setEditing(null); await reload(); } catch (e) { toast.fail(e); } }}>Save</button></div>
                    </div>
                  ) : <div className="th-text pre">{renderBody(n, user.id)}</div>}
                </div>
              </div>
            )))}
          </div>
        ) : <div className="empty mini">{tab === 'history' ? 'No changes recorded yet.' : 'No comments yet. Ask a question, share progress, or @mention someone to pull them in.'}</div>}
      </div>
      <div className="composer th-compose">
        <div className="mention-wrap">
          <textarea ref={ta} rows={2} value={body} placeholder="Write a comment… type @ to mention someone" aria-label="New comment"
            onChange={(e) => { setBody(e.target.value); detect(e.target); }} onClick={(e) => detect(e.currentTarget)} onBlur={() => setTimeout(() => setPop(null), 150)}
            onKeyDown={(e) => {
              if (pop && hits.length) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setPop({ ...pop, sel: (pop.sel + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length }); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const p = hits[pop.sel]; if (p) choose(p); return; }
              }
              if (e.key === 'Escape' && pop) { e.preventDefault(); e.stopPropagation(); setPop(null); return; }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim()) { e.preventDefault(); post.mutate(); }
            }} />
          {pop && (
            <div className="mention-pop" role="listbox" aria-label="People">
              {hits.length ? hits.map((p, i) => (
                <button key={p.id} type="button" role="option" aria-selected={i === pop.sel} className={`mp-i ${i === pop.sel ? 'on' : ''}`} onMouseDown={(e) => { e.preventDefault(); choose(p); }}>
                  <Avatar name={p.name} size="sm" /><span>{p.name}</span><span className="faint small">{p.title || pretty(p.role)}</span>
                </button>
              )) : <div className="mp-none">Nobody on this task by that name</div>}
            </div>
          )}
        </div>
        <div className="bar2">
          <button type="button" className="btn ghost sm" aria-label="Mention someone" onClick={() => { setBody((b) => `${b}${b && !/\s$/.test(b) ? ' ' : ''}@`); ta.current?.focus(); setPop({ q: '', sel: 0 }); }}><Icon name="at" />Mention</button>
          <span className="grow faint small">Ctrl + Enter to send</span>
          <button type="button" className={`btn primary sm ${post.isPending ? 'busy' : ''}`} disabled={!body.trim() || post.isPending} onClick={() => post.mutate()}>Comment</button>
        </div>
      </div>
    </div>
  );
}

export function TaskModal({ taskId, onClose }: { taskId: number; onClose(): void }) {
  const { user, isFounder } = useSession();
  const editor = useEditor();
  const toast = useToast();
  const qc = useQueryClient();
  const taskQ = useQuery({ queryKey: ['record', 'tasks', taskId], queryFn: () => api.get<Row>(`/tasks/${taskId}`) });
  const collabQ = useQuery({ queryKey: ['collab', taskId], queryFn: () => api.get<Collab>(`/tasks/${taskId}/collab`) });
  const t = taskQ.data;
  const collab = collabQ.data ?? { checklist: [], watchers: [], watching: false, people: [], can_edit: false };
  const assignees = ((t?.assignees as Person[] | undefined) ?? []);
  const canEdit = !!t && (isFounder || t.created_by === user.id || assignees.some((a) => a.id === user.id));
  const setStatus = useAct((status: string) => api.put(`/tasks/${taskId}`, { status }), 'Status updated');
  const watch = useAct((on: boolean) => api.post<{ watching: boolean }>(`/tasks/${taskId}/watch`, { on }), (r) => (r.watching ? 'You are watching this task' : 'You stopped watching this task'));
  void toast; void qc;

  if (!t) return <Modal title="Task" size="xl" onClose={onClose}><div className="empty">{taskQ.isError ? (taskQ.error as Error).message : 'Loading…'}</div></Modal>;
  const days = t.due_date ? daysUntil(String(t.due_date)) : null;
  return (
    <Modal title={String(t.title)} sub={[taskKey(t.id), t.project_name || 'No project', t.client_name].filter(Boolean).join(' · ')} size="xl" onClose={onClose}
      footer={canEdit ? (
        <>
          <button type="button" className="btn" onClick={() => { onClose(); editor.open({ resource: 'tasks', record: t }); }}><Icon name="edit" />Edit task</button>
          {t.status !== 'done' && <button type="button" className="btn accent" onClick={() => setStatus.mutate('done', { onSuccess: onClose })}><Icon name="check" />Mark done</button>}
        </>
      ) : <button type="button" className="btn" onClick={onClose}>Close</button>}>
      <div className="pop-split">
        <div className="pop-main">
          {t.description ? <div className="doc-text pre">{String(t.description)}</div> : <div className="faint">No details written for this task.</div>}
          <div className="pop-sec"><div className="sec-h"><h3>Checklist</h3><span className="faint small">{collab.checklist.length ? `${collab.checklist.filter((c) => c.done).length} of ${collab.checklist.length} done` : ''}</span></div>
            <Checklist taskId={taskId} people={assignees} canEdit={canEdit} collab={collab} /></div>
          <div className="pop-sec"><Thread taskId={taskId} people={collab.people} /></div>
          <div className="pop-sec"><h3>Files</h3><DocsPanel entityType="task" entityId={taskId} /></div>
        </div>
        <aside className="pop-side">
          <Prop label="Status">
            {canEdit
              ? <select aria-label="Status" value={String(t.status)} onChange={(e) => setStatus.mutate(e.target.value)}>{TASK_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              : <Badge value={t.status} />}
          </Prop>
          <Prop label="Priority"><Priority value={t.priority} /></Prop>
          <Prop label={`People${assignees.length > 1 ? ` · ${assignees.length}` : ''}`}>
            {assignees.length ? <div className="people-list">{assignees.map((a) => <div className="who" key={a.id}><Avatar name={a.name} size="sm" /><span className="ellipsis">{a.name}{a.id === user.id && <span className="faint"> (you)</span>}</span></div>)}</div> : <span className="faint">Nobody yet</span>}
          </Prop>
          <Prop label="Watching">
            <div className="watch-row"><AvatarStack names={collab.watchers.map((w) => w.name)} max={4} /><span className="small muted">{collab.watchers.length ? plural(collab.watchers.length, 'person', 'people') : 'Nobody'}</span></div>
            <button type="button" className={`btn sm ${collab.watching ? '' : 'ghost'}`} aria-pressed={collab.watching} onClick={() => watch.mutate(!collab.watching)}><Icon name="eye" />{collab.watching ? 'Watching' : 'Watch'}</button>
            <div className="hint">{collab.watching ? 'You get a notification for new comments and status changes.' : 'Watch to get notified about comments and status changes.'}</div>
          </Prop>
          <Prop label="Project">{t.project_id ? <Link to={`/projects/${t.project_id}`} onClick={onClose}>{String(t.project_name)}</Link> : null}</Prop>
          {t.change_request_id ? <Prop label="Change request"><Link to={`/projects/${t.project_id}?tab=changes`} onClick={onClose}>{String(t.change_request_title)}</Link></Prop> : null}
          <Prop label="Due">
            {t.due_date ? <><Due date={t.due_date} done={t.status === 'done'} />{t.status !== 'done' && days !== null && Math.abs(days) > 1 ? <div className="faint small">{days < 0 ? `${plural(-days, 'day')} late` : `in ${plural(days, 'day')}`}</div> : null}</> : null}
          </Prop>
          <Prop label="Created by">{String(t.creator_name ?? '—')}<div className="faint small">{fmtDate(t.created_at)}</div></Prop>
        </aside>
      </div>
    </Modal>
  );
}
