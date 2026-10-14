import { useState } from 'react';
import { api, qs, type Row } from '../lib/api';
import { useGet, useAct } from '../lib/hooks';
import { LoadFailed } from '../ui/primitives';
import { useSession } from '../lib/session';
import { ago } from '../shell/Bell';
import { Icon } from '../ui/Icon';
import { useDialogs } from '../ui/Modal';

const NOTE_ICON: Record<string, string> = { note: 'note', call: 'phone', meeting: 'meeting', email: 'mail', whatsapp: 'chat', visit: 'building', demo: 'meeting', proposal: 'file', system: 'gear' };
const NOTE_VERB: Record<string, string> = { note: 'added a note', call: 'logged a call', meeting: 'logged a meeting', email: 'logged an email', whatsapp: 'logged a WhatsApp chat', visit: 'logged a visit', demo: 'gave a demo', proposal: 'sent a proposal', system: '' };

/** Notes / activity timeline for a lead, client, project, … with a composer. */
export function Notes({ type, id, canWrite = true, kinds = true, placeholder }: { type: string; id: number; canWrite?: boolean; kinds?: boolean; placeholder?: string }) {
  const { user, isFounder } = useSession();
  const dialogs = useDialogs();
  const notes = useGet<Row[]>('/notes', { entity_type: type, entity_id: id });
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('note');
  const post = useAct(() => api.post('/notes', { entity_type: type, entity_id: id, body, kind: kinds ? kind : 'note' }), undefined, () => setBody(''));
  const del = useAct((nid: number) => api.del(`/notes/${nid}`));
  return (
    <div>
      <LoadFailed q={notes} />
      {canWrite && (
        <div className="composer">
          <textarea rows={2} value={body} placeholder={placeholder ?? 'Write a note, call summary, decision or WhatsApp gist…'} aria-label="New note"
            onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim()) post.mutate(); }} />
          <div className="bar2">
            {kinds && (
              <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
                {['note', 'call', 'whatsapp', 'email', 'meeting', 'demo', 'proposal', 'visit'].map((k) => <option key={k} value={k}>{k === 'whatsapp' ? 'WhatsApp' : k[0]?.toUpperCase() + k.slice(1)}</option>)}
              </select>
            )}
            <span className="grow faint small">Ctrl + Enter to post</span>
            <button type="button" className="btn primary sm" disabled={!body.trim() || post.isPending} onClick={() => post.mutate()}>Post</button>
          </div>
        </div>
      )}
      <div className="tl" aria-busy={notes.isFetching}>
        {notes.data?.length ? notes.data.map((n) => (
          <div key={n.id} className={`tl-item ${n.kind === 'system' ? 'sys' : ''}`}>
            <div className="tl-ico"><Icon name={NOTE_ICON[String(n.kind)] ?? 'note'} /></div>
            <div style={{ minWidth: 0 }}>
              <div className="tl-meta">
                {n.kind === 'system' ? null : <><b>{String(n.user_name ?? 'Someone')}</b> {NOTE_VERB[String(n.kind)] ?? ''} ·</>} <span>{ago(n.created_at)}</span>
                {n.kind !== 'system' && (isFounder || n.user_id === user.id) && (
                  <button type="button" className="btn ghost sm icon" title="Delete" aria-label="Delete note"
                    onClick={async () => { if (await dialogs.confirm('Delete this note?', { danger: true, okLabel: 'Delete' })) del.mutate(Number(n.id)); }}><Icon name="x" /></button>
                )}
              </div>
              <div className="tl-body pre">{String(n.body)}</div>
            </div>
          </div>
        )) : notes.isPending ? null : <div className="empty mini">No activity yet. Notes, calls and decisions you log will appear here.</div>}
      </div>
    </div>
  );
}

export { qs };
