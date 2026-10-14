import { CRED_KINDS } from '@crm/shared';
import { useState } from 'react';
import { api, type Row } from '../lib/api';
import { useAct, useGet } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Modal, useDialogs } from '../ui/Modal';
import { Empty } from '../ui/primitives';
import { useToast } from '../ui/Toasts';
import { ExtLink } from '../ui/primitives';

interface Cred extends Row { label: string; kind: string | null; url: string | null; username: string | null; notes: string | null; has_password: boolean; has_secret: boolean; client_name: string | null; project_name: string | null; client_id: number | null; project_id: number | null }

function CredForm({ rec, scope, onClose }: { rec: Cred | null; scope: { client_id?: number; project_id?: number }; onClose(): void }) {
  const { lookups } = useSession();
  const [v, setV] = useState({
    label: rec?.label ?? '', kind: rec?.kind ?? '', url: rec?.url ?? '', username: rec?.username ?? '', password: '', secret: '', notes: rec?.notes ?? '',
    client_id: String(rec?.client_id ?? scope.client_id ?? ''), project_id: String(rec?.project_id ?? scope.project_id ?? ''),
  });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const save = useAct(async () => {
    const body: Record<string, unknown> = { ...v, client_id: v.client_id || null, project_id: v.project_id || null };
    // leaving a secret field empty on edit keeps what is stored
    if (rec && !v.password) delete body.password;
    if (rec && !v.secret) delete body.secret;
    return rec ? api.put(`/credentials/${rec.id}`, body) : api.post('/credentials', body);
  }, 'Saved', onClose);
  return (
    <Modal title={rec ? 'Edit credential' : 'New credential'} sub="Passwords are encrypted. Every time one is revealed it is written to the activity log." dirty size="wide" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className={`btn primary ${save.isPending ? 'busy' : ''}`} onClick={() => { setErr(''); save.mutate(undefined, { onError: (e) => setErr(e.message) }); }}>Save</button></>}>
      <div className="form-grid">
        <label className="f full"><span>Label <i>*</i></span><input value={v.label} onChange={set('label')} placeholder="e.g. cPanel — acmecorp.com" /></label>
        <label className="f"><span>Kind</span><select value={v.kind} onChange={set('kind')}><option value="">—</option>{CRED_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <label className="f"><span>URL / host</span><input value={v.url} onChange={set('url')} /></label>
        <label className="f"><span>Username</span><input value={v.username} onChange={set('username')} autoComplete="off" /></label>
        <label className="f"><span>Password</span><input type="password" value={v.password} onChange={set('password')} autoComplete="new-password" placeholder={rec?.has_password ? 'Stored — leave empty to keep' : ''} /></label>
        <label className="f full"><span>API key / secret / recovery codes</span><textarea rows={2} value={v.secret} onChange={set('secret')} placeholder={rec?.has_secret ? 'Stored — leave empty to keep' : ''} /></label>
        <label className="f"><span>Client</span><select value={v.client_id} onChange={set('client_id')}><option value="">—</option>{lookups.clients.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}</select></label>
        <label className="f"><span>Project</span><select value={v.project_id} onChange={set('project_id')}><option value="">—</option>{lookups.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="f full"><span>Notes</span><textarea rows={2} value={v.notes} onChange={set('notes')} /></label>
      </div>
      {err && <div className="callout err" role="alert" style={{ marginTop: 14 }}>{err}</div>}
    </Modal>
  );
}

export function CredentialsPanel({ client_id, project_id, q }: { client_id?: number; project_id?: number; q?: string }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const list = useGet<Cred[]>('/credentials', { client_id, project_id, q });
  const [editing, setEditing] = useState<Cred | 'new' | null>(null);
  const [shown, setShown] = useState<Record<number, { password: string; secret: string }>>({});
  const del = useAct((id: number) => api.del(`/credentials/${id}`), 'Deleted');

  const reveal = async (c: Cred) => {
    if (shown[c.id]) { setShown((s) => { const { [c.id]: _x, ...rest } = s; return rest; }); return; }
    try { const r = await api.post<{ password: string; secret: string }>(`/credentials/${c.id}/reveal`); setShown((s) => ({ ...s, [c.id]: r })); setTimeout(() => setShown((s) => { const { [c.id]: _x, ...rest } = s; return rest; }), 30_000); } catch (e) { toast.fail(e); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.ok('Copied to clipboard'); } catch { toast.err('Copy failed — select and copy manually.'); } };

  return (
    <div>
      <div className="toolbar"><span className="grow" /><button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />Add credential</button></div>
      {list.data?.length ? (
        <div className="panel"><div className="list">
          {list.data.map((c) => (
            <div className="li" key={c.id} style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="t"><b>{c.label}</b> {c.kind && <span className="tag">{c.kind}</span>}</div>
                <div className="s">{[c.client_name, c.project_name].filter(Boolean).join(' · ')}</div>
                <div className="small" style={{ marginTop: 4, display: 'grid', gap: 2 }}>
                  {c.url && <div><ExtLink url={c.url} /></div>}
                  {c.username && <div>User: <span className="mono">{c.username}</span> <button type="button" className="btn ghost sm icon" aria-label="Copy username" onClick={() => void copy(c.username as string)}><Icon name="copy" /></button></div>}
                  {c.has_password && (
                    <div>Password: <span className="mono">{shown[c.id] ? shown[c.id]?.password : '••••••••••'}</span>{' '}
                      <button type="button" className="btn ghost sm icon" aria-label={shown[c.id] ? 'Hide password' : 'Reveal password'} onClick={() => void reveal(c)}><Icon name="eye" /></button>
                      {shown[c.id] && <button type="button" className="btn ghost sm icon" aria-label="Copy password" onClick={() => void copy(shown[c.id]?.password ?? '')}><Icon name="copy" /></button>}</div>
                  )}
                  {shown[c.id]?.secret && <div>Secret: <span className="mono pre">{shown[c.id]?.secret}</span></div>}
                  {c.notes && <div className="muted pre">{c.notes}</div>}
                </div>
              </div>
              <div className="row">
                <button type="button" className="btn sm icon ghost" aria-label="Edit" onClick={() => setEditing(c)}><Icon name="edit" /></button>
                <button type="button" className="btn sm icon ghost" aria-label="Delete" onClick={async () => { if (await dialogs.confirm(`Delete "${c.label}"? This cannot be undone.`, { danger: true, okLabel: 'Delete' })) del.mutate(c.id); }}><Icon name="trash" /></button>
              </div>
            </div>
          ))}
        </div></div>
      ) : list.isPending ? null : <Empty title="No credentials yet" icon="lock">Hosting, server, database and admin logins live here, encrypted.</Empty>}
      {editing && <CredForm rec={editing === 'new' ? null : editing} scope={{ client_id, project_id }} onClose={() => setEditing(null)} />}
    </div>
  );
}
