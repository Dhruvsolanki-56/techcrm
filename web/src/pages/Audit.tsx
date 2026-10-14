import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qs, type Row } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useSession } from '../lib/session';
import { useDebounced } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { pretty } from '../ui/primitives';

const PAGE = 100;
const ACTIONS = ['create', 'update', 'delete', 'login', 'login_failed', 'password_change', 'password_reset', 'upload', 'download', 'export', 'convert', 'renew', 'vault_reveal', 'backup', '2fa_on', '2fa_reset'];

export default function Audit() {
  const { lookups } = useSession();
  const [f, setF] = useState({ q: '', action: '', user_id: '' });
  const [page, setPage] = useState(0);
  const dq = useDebounced(f.q.trim());
  const params = { ...f, q: dq, limit: PAGE, offset: page * PAGE };
  const res = useQuery({ queryKey: ['audit', params], queryFn: () => api.page<Row>(`/audit${qs(params)}`) });
  const rows = res.data?.rows ?? [];
  const total = res.data?.total ?? 0;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF((x) => ({ ...x, [k]: e.target.value })); setPage(0); };
  return (
    <Page title="Activity log" sub="Who did what, and when. Sign-ins, changes, exports and every time a stored password was revealed.">
      <div className="toolbar">
        <input type="search" placeholder="Search details or names…" aria-label="Search" value={f.q} onChange={set('q')} />
        <select aria-label="Action" value={f.action} onChange={set('action')}><option value="">Any action</option>{ACTIONS.map((a) => <option key={a} value={a}>{pretty(a)}</option>)}</select>
        <select aria-label="Person" value={f.user_id} onChange={set('user_id')}><option value="">Anyone</option>{lookups.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
      </div>
      <div className="tbl">
        {!rows.length ? <div className="empty"><b>{res.isPending ? 'Loading…' : 'Nothing logged'}</b></div> : (
          <div className="tbl-scroll" tabIndex={0}>
            <table className="t">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th className="opt">From</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap muted">{fmtDateTime(r.at ?? r.created_at)}</td>
                  <td>{String(r.user_name ?? 'System')}</td>
                  <td><span className={`tag ${['delete', 'login_failed', 'vault_reveal'].includes(String(r.action)) ? 'red' : ''}`}>{pretty(r.action)}</span></td>
                  <td><div className="t1">{pretty(r.entity)}{r.entity_id ? ` #${String(r.entity_id)}` : ''}</div><div className="t2 ellipsis" style={{ maxWidth: 520 }}>{String(r.detail ?? '')}</div></td>
                  <td className="opt muted small">{String(r.ip ?? '')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {total > PAGE && (
          <div className="tbl-foot">
            <span>{page * PAGE + 1}–{page * PAGE + rows.length} of {total}</span>
            <span className="row">
              <button type="button" className="btn sm icon" aria-label="Newer" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><Icon name="arrowL" /></button>
              <span className="small muted">Page {page + 1} of {Math.ceil(total / PAGE)}</span>
              <button type="button" className="btn sm icon" aria-label="Older" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}><Icon name="arrowR" /></button>
            </span>
          </div>
        )}
      </div>
    </Page>
  );
}
