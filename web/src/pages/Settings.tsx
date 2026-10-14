import { TAX_TYPES, check } from '@crm/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAct, useGet } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { ErrorBox, Panel } from '../ui/primitives';
import { useToast } from '../ui/Toasts';

type S = Record<string, string>;
const LISTS: [string, string, string][] = [
  ['lead_services', 'Services', 'Department / Product choices on leads (Service side)'], ['lead_products', 'Products', 'Department / Product choices on leads (Product side)'],
  ['lead_categories', 'Lead categories', 'Industry or kind of customer'], ['lead_sources', 'Lead sources', 'Where leads come from'],
  ['income_categories', 'Income categories', 'On payments received'], ['expense_categories', 'Expense categories', 'On expenses'],
  ['payment_modes', 'Payment modes', 'Bank transfer, UPI, cash…'], ['statuses', 'Statuses', 'For documents and assets'], ['asset_types', 'Asset types', 'Laptop, phone…'],
];
const RULES: Record<string, [string, string]> = {
  company_email: ['email', 'Email'], company_phone: ['phone', 'Phone'], company_website: ['url', 'Website'], gstin: ['gstin', 'GSTIN'], pan: ['pan', 'PAN'], state: ['place', 'State'],
  bank_account_name: ['person', 'Account holder'], bank_ifsc: ['ifsc', 'IFSC'], upi_id: ['upi', 'UPI ID'], bank_account_no: ['digitsText', 'Account number'], default_tax_rate: ['percent', 'Default tax rate'],
};

export default function Settings() {
  const toast = useToast();
  const { refreshLookups } = useSession();
  const q = useGet<S>('/settings');
  const [v, setV] = useState<S>({});
  useEffect(() => { if (q.data) setV(q.data); }, [q.data]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const [err, setErr] = useState('');
  const save = useAct(() => api.put('/settings', v), 'Settings saved', () => void refreshLookups());
  const submit = () => {
    for (const [k, [kind, label]] of Object.entries(RULES)) {
      const m = v[k] ? check(kind, v[k]) : '';
      if (m) { setErr(`${label} ${m}.`); return; }
    }
    setErr('');
    save.mutate(undefined, { onError: (e) => setErr(e.message) });
  };
  const onLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 600_000) { toast.err('Logo must be under 600 KB.'); return; }
    const r = new FileReader();
    r.onload = () => setV((x) => ({ ...x, logo: String(r.result) }));
    r.readAsDataURL(file);
  };
  if (q.isError) return <Page title="Settings"><ErrorBox error={q.error} retry={() => void q.refetch()} /></Page>;
  if (!q.data) return <Page title="Settings"><div className="tbl"><div className="empty">Loading…</div></div></Page>;
  const field = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, help?: string) => (
    <label className="f"><span>{label}</span><input value={v[k] ?? ''} onChange={set(k)} {...props} />{help && <div className="hint">{help}</div>}</label>
  );
  return (
    <Page title="Settings" sub="Company details printed on documents, tax defaults, and the dropdown lists used across the CRM."
      actions={<button type="button" className={`btn primary ${save.isPending ? 'busy' : ''}`} onClick={submit}>Save settings</button>}>
      {err && <div className="callout err" role="alert">{err}</div>}
      <Panel title="Company">
        <div className="form-grid">
          {field('company_name', 'Company name')}{field('company_email', 'Email', { type: 'email' })}{field('company_phone', 'Phone', { type: 'tel' })}{field('company_website', 'Website')}
          <label className="f full"><span>Address</span><textarea rows={2} value={v.company_address ?? ''} onChange={set('company_address')} /></label>
          {field('gstin', 'GSTIN', { style: { textTransform: 'uppercase' }, maxLength: 15 }, 'Leave empty if you are not GST registered — invoices then default to no tax.')}{field('pan', 'PAN', { style: { textTransform: 'uppercase' }, maxLength: 10 })}{field('state', 'State')}
          <div className="f"><span>Logo</span>
            <div className="row" style={{ gap: 12 }}>{v.logo ? <img src={v.logo} alt="Logo" style={{ maxHeight: 40, maxWidth: 120 }} /> : <span className="faint">No logo</span>}
              <label className="btn sm"><Icon name="upload" />Choose<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onLogo(e.target.files?.[0])} /></label>
              {v.logo ? <button type="button" className="btn sm ghost" onClick={() => setV((x) => ({ ...x, logo: '' }))}>Remove</button> : null}</div></div>
        </div>
      </Panel>
      <Panel title="Payment details printed on invoices">
        <div className="form-grid">{field('bank_name', 'Bank name')}{field('bank_account_name', 'Account holder')}{field('bank_account_no', 'Account number')}{field('bank_ifsc', 'IFSC', { style: { textTransform: 'uppercase' }, maxLength: 11 })}{field('upi_id', 'UPI ID', { placeholder: 'name@bank' })}</div>
      </Panel>
      <Panel title="Numbering, tax and terms">
        <div className="form-grid">
          {field('invoice_prefix', 'Invoice number prefix', {}, 'Numbers look like INV/2026-27/0001 and restart each financial year.')}{field('quote_prefix', 'Quotation number prefix')}
          <label className="f"><span>Default tax</span><select value={v.default_tax_type ?? 'none'} onChange={set('default_tax_type')}>{TAX_TYPES.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></label>
          {field('default_tax_rate', 'Default tax rate %', { type: 'number', min: 0, max: 100, step: 'any' })}
          <label className="f"><span>Financial year starts</span><select value={v.fy_start_month ?? '4'} onChange={set('fy_start_month')}><option value="4">April</option><option value="1">January</option><option value="7">July</option><option value="10">October</option></select></label>
          <label className="f full"><span>Invoice terms</span><textarea rows={3} value={v.terms_invoice ?? ''} onChange={set('terms_invoice')} /></label>
          <label className="f full"><span>Quotation terms</span><textarea rows={3} value={v.terms_quote ?? ''} onChange={set('terms_quote')} /></label>
        </div>
      </Panel>
      <Panel title="Dropdown lists" actions={<span className="muted small">One value per line</span>}>
        <div className="form-grid lists-grid">
          {LISTS.map(([k, label, help]) => (
            <label className="f" key={k}><span>{label}</span><textarea rows={7} value={v[k] ?? ''} onChange={set(k)} /><div className="hint">{help}</div></label>
          ))}
        </div>
      </Panel>
      <Panel title="Backup">
        <p className="muted" style={{ marginTop: 0 }}>The server also saves a copy of the database every day and keeps the newest ones. Download one yourself any time.</p>
        <a className="btn" href="/api/backup" download><Icon name="download" />Download a backup</a>
      </Panel>
    </Page>
  );
}
