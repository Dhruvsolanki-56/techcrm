import { SCHEDULE_TEMPLATES, round2, splitByPercent, tdsOf } from '@crm/shared';
import { useState } from 'react';
import { api, type Row } from '../lib/api';
import { money } from '../lib/format';
import { useAct } from '../lib/hooks';
import { Modal } from '../ui/Modal';

/** Plan how the agreed value is paid: your own percentages (advance first, final last) and the TDS the client deducts, with a live preview. */
export function ScheduleModal({ project, onClose }: { project: Row; onClose(): void }) {
  const value = Number(project.budget) || 0;
  const [text, setText] = useState('30, 30, 40');
  const [tds, setTds] = useState(String(Number(project.tds_percent) || 0));
  const [err, setErr] = useState('');
  const parts = text.split(/[,\s/+-]+/).filter(Boolean).map(Number);
  const sum = round2(parts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0));
  const valid = parts.length > 0 && parts.every((p) => Number.isFinite(p) && p > 0 && p <= 100) && Math.abs(sum - 100) < 0.01;
  const pct = Math.min(100, Math.max(0, Number(tds) || 0));
  const amounts = valid ? splitByPercent(value, parts) : [];
  const save = useAct(() => api.post(`/projects/${project.id}/schedule`, { percents: parts, tds_percent: pct }), 'Payment schedule set', onClose);
  return (
    <Modal title="Plan the payments" sub={`${String(project.name)} · agreed value ${money(value)}`} size="wide" dirty={false} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className={`btn primary ${save.isPending ? 'busy' : ''}`} disabled={!valid} onClick={() => { setErr(''); save.mutate(undefined, { onError: (e) => setErr(e.message) }); }}>Save schedule</button></>}>
      <div className="form-grid">
        <label className="f full"><span>Parts of the value, in percent</span>
          <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" placeholder="e.g. 30, 30, 40" aria-label="Percentages" />
          <div className="hint">The first part is the advance, the last is the final payment. {valid ? `Adds up to ${sum}%.` : <b className="neg">They add up to {sum}%; they must add up to 100%.</b>}</div></label>
        <label className="f"><span>Quick fill</span>
          <select value="" aria-label="Quick fill" onChange={(e) => { const t = SCHEDULE_TEMPLATES[e.target.value]; if (t) setText(t.items.map((i) => i[2]).join(', ')); }}>
            <option value="">Choose a common split…</option>{Object.entries(SCHEDULE_TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select></label>
        <label className="f"><span>TDS the client deducts (%)</span>
          <input type="number" min={0} max={100} step="0.1" value={tds} onChange={(e) => setTds(e.target.value)} aria-label="TDS percent" />
          <div className="hint">Every payment on this project — change requests too — follows this ratio. The invoice is only for what you will receive; the TDS is tracked for your ITR.</div></label>
      </div>
      {valid && (
        <div className="tbl-scroll" style={{ marginTop: 14 }} tabIndex={0}>
          <table className="t">
            <thead><tr><th>Payment</th><th className="num">Share</th><th className="num">TDS</th><th className="num">You receive</th></tr></thead>
            <tbody>{amounts.map((a, i) => (
              <tr key={i}><td>{parts.length === 1 ? 'Full payment' : i === parts.length - 1 ? 'Final payment' : i === 0 ? 'Advance' : `Milestone ${i}`} · {parts[i]}%</td>
                <td className="num">{money(a)}</td><td className="num">{pct ? money(tdsOf(a, pct)) : '—'}</td><td className="num"><b>{money(round2(a - tdsOf(a, pct)))}</b></td></tr>))}</tbody>
            <tfoot><tr className="tot"><td>Total</td><td className="num">{money(value)}</td><td className="num">{pct ? money(tdsOf(value, pct)) : '—'}</td><td className="num">{money(round2(value - tdsOf(value, pct)))}</td></tr></tfoot>
          </table>
        </div>
      )}
      {err && <div className="callout err" role="alert" style={{ marginTop: 14 }}>{err}</div>}
    </Modal>
  );
}
