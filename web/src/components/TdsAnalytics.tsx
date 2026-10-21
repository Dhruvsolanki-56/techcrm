import { TDS_STATUSES } from '@crm/shared';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { ClientLink, InvoiceLink, ProjectLink } from '../pages/common';
import { useAct, useGet, useParam } from '../lib/hooks';
import { ExportMenu } from '../ui/ExportMenu';
import { useDialogs } from '../ui/Modal';
import { ErrorBox, Kpis, Panel } from '../ui/primitives';

interface Group { key: string; label: string; deducted: number; claimed: number; certificate: number; count: number; gross: number; to_claim: number; ay?: string; ended?: boolean }
interface Entry { id: number; date: string; amount: number; tds: number; gross: number; rate: number; tds_status: string; tds_section: string | null; tds_claimed_on: string | null; client_id: number | null; client_name: string | null; project_id: number | null; project_name: string | null; invoice_id: number | null; invoice_number: string | null; fy: string }
interface Report {
  fy: string | null; status: string | null;
  totals: { deducted: number; claimed: number; certificate: number; awaiting_certificate: number; to_claim: number; count: number };
  years: Group[]; clients: Group[]; entries: Entry[]; options: { years: string[] };
}

/** TDS clients deducted: a tax credit (not cash) that moves from deducted → certificate received → claimed in the ITR. */
export function TdsAnalytics() {
  const dialogs = useDialogs();
  const [fy, setFy] = useParam('fy');
  const [status, setStatus] = useParam('status');
  const params = { fy: fy || undefined, status: status || undefined };
  const q = useGet<Report>('/analytics/tds', params);
  const set = useAct(({ id, tds_status }: { id: number; tds_status: string }) => api.put(`/payments/${id}`, { tds_status }), 'TDS status updated');
  const bulk = useAct(async ({ ids, tds_status }: { ids: number[]; tds_status: string }) => { for (const id of ids) await api.put(`/payments/${id}`, { tds_status }); return ids.length; }, (n) => `${n} deduction${n === 1 ? '' : 's'} updated`);
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <div className="tbl"><div className="empty">Loading…</div></div>;
  const d = q.data;
  const t = d.totals;
  const open = d.entries.filter((e) => e.tds_status !== 'claimed');
  const markAll = async () => {
    if (!open.length) return;
    if (await dialogs.confirm(`Mark ${open.length} deduction${open.length === 1 ? '' : 's'} (${money(open.reduce((s, e) => s + e.tds, 0))}) as claimed in your ITR${fy ? ` for FY ${fy}` : ''}? You can change any of them back afterwards.`, { title: 'Mark as claimed', okLabel: 'Mark claimed' })) bulk.mutate({ ids: open.map((e) => e.id), tds_status: 'claimed' });
  };
  return (
    <div className="stack">
      <div className="callout info">
        TDS is tax your client paid to the government on your behalf, so it is <b>not cash in the bank</b>. It is <b>not part of the invoice</b> and not counted as received: invoices are only for what you actually get. You get this back as a credit when you file your income-tax return (shown in Form 26AS / AIS).
        Record the deduction on the payment, tick it off here when the certificate (Form 16A) arrives, and mark it claimed once it is in your ITR.
      </div>
      <div className="toolbar">
        <select aria-label="Financial year" value={fy} onChange={(e) => setFy(e.target.value)}><option value="">All financial years</option>{d.options.years.map((y) => <option key={y} value={y}>FY {y}</option>)}</select>
        <select aria-label="TDS status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{TDS_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="grow" />
        {open.length > 0 && <button type="button" className="btn" onClick={() => void markAll()}>Mark {open.length} as claimed</button>}
        <ExportMenu path="/analytics/tds/export" params={params} />
      </div>
      <Kpis items={[
        { label: 'TDS deducted', value: money(t.deducted), sub: `${t.count} payment${t.count === 1 ? '' : 's'}` },
        { label: 'Certificate awaited', value: money(t.awaiting_certificate), sub: 'Ask the client for Form 16A', tone: t.awaiting_certificate ? 'warn' : undefined },
        { label: 'Certificate received', value: money(t.certificate), sub: 'Ready to claim' },
        { label: 'Claimed in ITR', value: money(t.claimed), tone: 'good' },
        { label: 'Still to claim', value: money(t.to_claim), sub: 'Deducted − claimed', tone: t.to_claim ? 'warn' : undefined },
      ]} />
      <div className="dash-row">
        <Panel title="By financial year" bodyClass="flush">
          {d.years.length ? (
            <div className="tbl-scroll" tabIndex={0}><table className="t rep">
              <thead><tr><th>Year</th><th className="num">Deducted</th><th className="num">Claimed</th><th className="num">To claim</th></tr></thead>
              <tbody>{d.years.map((y) => (
                <tr key={y.key} className="click" onClick={() => setFy(fy === y.key ? '' : y.key)}>
                  <td><b>FY {y.label}</b><div className="t2">{y.ended ? `Return for AY ${y.ay}` : 'Year in progress'}</div></td>
                  <td className="num">{money(y.deducted)}</td><td className="num">{money(y.claimed)}</td><td className={`num ${y.to_claim && y.ended ? 'neg' : ''}`}>{money(y.to_claim)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <div className="empty mini">No TDS recorded yet. Enter it on a payment when a client deducts it.</div>}
        </Panel>
        <Panel title="By client" bodyClass="flush">
          {d.clients.length ? (
            <div className="tbl-scroll" tabIndex={0}><table className="t rep">
              <thead><tr><th>Client</th><th className="num">Cash + TDS</th><th className="num">TDS</th><th className="num">To claim</th></tr></thead>
              <tbody>{d.clients.map((c) => (
                <tr key={c.key}><td><b>{c.label}</b></td><td className="num">{money(c.gross)}</td><td className="num">{money(c.deducted)}</td><td className="num">{money(c.to_claim)}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <div className="empty mini">Nothing yet.</div>}
        </Panel>
      </div>
      <Panel title="Every deduction" bodyClass="flush">
        {d.entries.length ? (
          <div className="tbl-scroll" tabIndex={0}><table className="t">
            <thead><tr><th>Date</th><th>Client</th><th className="num">Received</th><th className="num">TDS</th><th className="num opt">Rate</th><th>Status</th></tr></thead>
            <tbody>{d.entries.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{fmtDate(e.date)}<div className="t2">FY {e.fy}</div></td>
                <td><b><ClientLink id={e.client_id} name={e.client_name ?? '—'} tab="billing" /></b><div className="t2">{e.invoice_number ? <InvoiceLink id={e.invoice_id} number={e.invoice_number} /> : null}{e.invoice_number && e.project_name ? ' · ' : ''}{e.project_name ? <ProjectLink id={e.project_id} name={e.project_name} tab="finance" /> : null}{e.tds_section ? ` · Sec ${e.tds_section}` : ''}</div></td>
                <td className="num">{money(e.amount)}</td><td className="num">{money(e.tds)}</td><td className={`num opt ${e.rate > 20 ? "neg" : ""}`} title={e.rate > 20 ? "Unusually high for TDS — check the amounts" : undefined}>{e.rate}%</td>
                <td>
                  <select aria-label={`TDS status for ${e.client_name ?? 'payment'} on ${fmtDate(e.date)}`} value={e.tds_status} onChange={(ev) => set.mutate({ id: e.id, tds_status: ev.target.value })}>
                    {TDS_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  {e.tds_claimed_on && <div className="t2">Claimed {fmtDate(e.tds_claimed_on)}</div>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="empty mini">No deductions match these filters.</div>}
        <div className="small muted" style={{ padding: '10px 16px' }}>To correct an amount or the section, edit the payment in <Link to="/finance?tab=payments">Finance → Income</Link>.</div>
      </Panel>
    </div>
  );
}
