import { INTERN_FLAGS } from '@crm/shared';
import { useState } from 'react';
import { api, type Row } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useAct, useGet } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Modal, useDialogs } from '../ui/Modal';
import { Page } from '../ui/Page';
import { Avatar, Badge, LoadFailed } from '../ui/primitives';

const FLAG_LABEL: Record<string, [string, string]> = {
  leads: ['Sales leads', 'Pipeline, follow-ups, contact log and sales reports'],
  clients: ['All clients', 'Every client, not only those on their projects'],
  all_projects: ['All projects', 'See every project, not only ones they are on'],
  maintenance: ['Maintenance', 'The maintenance work log'],
};

function UserForm({ rec, onClose }: { rec: Row | null; onClose(): void }) {
  const { user: me } = useSession();
  const [v, setV] = useState({
    name: String(rec?.name ?? ''), email: String(rec?.email ?? ''), role: String(rec?.role ?? 'intern'), title: String(rec?.title ?? ''), phone: String(rec?.phone ?? ''),
    password: '', keep_password: false, active: rec ? !!rec.active : true, reset_2fa: false,
  });
  const [mods, setMods] = useState<string[]>((rec?.modules as string[] | undefined) ?? []);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const save = useAct(() => {
    const body: Record<string, unknown> = { ...v, modules: mods };
    if (!v.password) { delete body.password; delete body.keep_password; }
    return rec ? api.put(`/users/${rec.id}`, body) : api.post('/users', body);
  }, rec ? 'Saved' : 'Person added', onClose);
  const self = rec?.id === me.id;
  return (
    <Modal title={rec ? 'Edit person' : 'Add person'} sub={rec ? String(rec.email) : 'They will be asked to choose their own password the first time they sign in, unless you tick the box.'} dirty onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className={`btn primary ${save.isPending ? 'busy' : ''}`} onClick={() => { setErr(''); save.mutate(undefined, { onError: (e) => setErr(e.message) }); }}>{rec ? 'Save changes' : 'Add person'}</button></>}>
      <div className="form-grid">
        <label className="f"><span>Name <i>*</i></span><input value={v.name} onChange={set('name')} /></label>
        <label className="f"><span>Email <i>*</i></span><input type="email" value={v.email} onChange={set('email')} /></label>
        <label className="f"><span>Role</span><select value={v.role} onChange={set('role')} disabled={self}><option value="founder">Founder — sees everything</option><option value="intern">Intern — own work only</option></select></label>
        <label className="f"><span>Job title</span><input value={v.title} onChange={set('title')} placeholder="e.g. Developer" /></label>
        <label className="f"><span>Phone</span><input type="tel" value={v.phone} onChange={set('phone')} /></label>
        <label className="f"><span>{rec ? 'New password (optional)' : 'Temporary password'}{!rec && <i> *</i>}</span><input type="password" autoComplete="new-password" value={v.password} onChange={set('password')} /><div className="hint">10+ characters with letters and numbers.</div></label>
        {v.password && <label className="check full"><input type="checkbox" checked={v.keep_password} onChange={set('keep_password')} /><span>Let them keep this password (do not ask them to change it)</span></label>}
        {v.role === 'intern' && (
          <div className="f full" role="group" aria-label="Extra access">
            <span>Extra access for this intern</span>
            {INTERN_FLAGS.map((f) => (
              <label className="check" key={f} style={{ padding: '6px 0' }}>
                <input type="checkbox" checked={mods.includes(f)} onChange={(e) => setMods((x) => (e.target.checked ? [...x, f] : x.filter((m) => m !== f)))} />
                <span>{FLAG_LABEL[f]?.[0] ?? f}<div className="hint">{FLAG_LABEL[f]?.[1]}</div></span>
              </label>
            ))}
            <div className="hint">Finance, invoices, quotations, renewals, credentials, team and settings are always founder-only.</div>
          </div>
        )}
        {rec && !self && <label className="check full"><input type="checkbox" checked={v.active} onChange={set('active')} /><span>Active — can sign in</span></label>}
        {rec?.two_factor ? <label className="check full"><input type="checkbox" checked={v.reset_2fa} onChange={set('reset_2fa')} /><span>Turn off their two-step login (lost phone)</span></label> : null}
      </div>
      {err && <div className="callout err" role="alert" style={{ marginTop: 16 }}>{err}</div>}
    </Modal>
  );
}

export default function Team() {
  const { user: me } = useSession();
  const dialogs = useDialogs();
  const q = useGet<Row[]>('/users');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const remove = useAct((id: number) => api.del(`/users/${id}`), 'Person removed');
  const people = q.data ?? [];
  return (
    <Page title="Team & access" sub="Founders see everything. Interns see their own work, plus anything you switch on for them."
      actions={<button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />Add person</button>}>
      <LoadFailed q={q} />
      <div className="tbl">
        <div className="tbl-scroll" tabIndex={0}>
          <table className="t">
            <thead><tr><th>Person</th><th>Role</th><th className="opt">Access</th><th className="opt">Two-step</th><th className="opt">Last sign-in</th><th /></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} style={!p.active ? { opacity: 0.55 } : undefined}>
                  <td><div className="who"><Avatar name={p.name} /><div><div className="t1">{String(p.name)}{p.id === me.id && <span className="faint"> (you)</span>}</div><div className="t2">{String(p.email)}{p.title ? ` · ${String(p.title)}` : ''}</div></div></div></td>
                  <td><Badge value={p.role === 'founder' ? 'active' : 'review'} label={p.role === 'founder' ? 'Founder' : 'Intern'} />{!p.active && <span className="tag" style={{ marginLeft: 6 }}>Inactive</span>}{p.must_change_password ? <span className="tag amber" style={{ marginLeft: 6 }} title="Has not chosen their own password yet">Temp password</span> : null}</td>
                  <td className="opt small">{p.role === 'founder' ? 'Everything' : ((p.modules as string[]).length ? (p.modules as string[]).map((m) => FLAG_LABEL[m]?.[0] ?? m).join(', ') : 'Own work only')}</td>
                  <td className="opt">{p.two_factor ? <span className="tag green">On</span> : <span className="faint">Off</span>}</td>
                  <td className="opt small muted">{p.last_login ? fmtDateTime(p.last_login) : 'Never'}</td>
                  <td className="nowrap right">
                    <button type="button" className="btn sm icon ghost" aria-label={`Edit ${String(p.name)}`} onClick={() => setEditing(p)}><Icon name="edit" /></button>
                    {p.id !== me.id && (
                      <button type="button" className="btn sm icon ghost" aria-label={`Remove ${String(p.name)}`} onClick={async () => {
                        if (await dialogs.confirm(`Remove ${String(p.name)} completely? Their tasks, notes and records stay, but lose the name. To keep them listed, edit and untick Active instead.`, { danger: true, okLabel: 'Remove' })) remove.mutate(Number(p.id));
                      }}><Icon name="trash" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <UserForm rec={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}
