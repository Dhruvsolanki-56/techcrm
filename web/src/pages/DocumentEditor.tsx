import { addDays, check, checkDates, computeTotals, daysUntil, inWords, TAX_TYPES, today, type LineItem } from '@crm/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DocsPanel } from '../components/Docs';
import { PaymentsTable } from '../components/FinanceTables';
import { HistoryPanel } from '../components/HistoryPanel';
import { Notes } from '../components/Notes';
import { useEditor } from '../forms/RecordEditor';
import { api, type Row } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useAct, useGet, useRecord } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Modal, useDialogs } from '../ui/Modal';
import { Page, SectionH } from '../ui/Page';
import { Badge, Crumb, ErrorBox, Kpis, Skeleton } from '../ui/primitives';
import { useToast } from '../ui/Toasts';
import { money2 } from '@crm/shared';

type Kind = 'quotes' | 'invoices';
interface Item { description: string; hsn?: string; qty: number | string; rate: number | string }
interface Settings extends Record<string, string | number | null> { company_name: string; company_address: string; company_email: string; company_phone: string; gstin: string; pan: string; logo: string | null }

/* ============================ editor ============================ */
function EditorModal({ kind, doc, defaults, s, onClose, onSaved }: { kind: Kind; doc: Row | null; defaults: Record<string, string>; s: Settings; onClose(): void; onSaved(r: Row): void }) {
  const { lookups, isFounder } = useSession();
  const isInvoice = kind === 'invoices';
  const label = isInvoice ? 'invoice' : 'quotation';
  const lead = defaults.lead ? lookups.leads.find((l) => String(l.id) === defaults.lead) : undefined;
  const [v, setV] = useState<Record<string, string>>(() => ({
    lead_id: String(doc?.lead_id ?? defaults.lead ?? ''), client_id: String(doc?.client_id ?? defaults.client ?? ''), project_id: String(doc?.project_id ?? defaults.project ?? ''),
    change_request_id: String(doc?.change_request_id ?? defaults.cr ?? ''),
    kind: String(doc?.kind ?? 'invoice'), title: String(doc?.title ?? (lead ? `Proposal for ${lead.company || lead.name}` : '')), issue_date: String(doc?.issue_date ?? today()),
    due_date: String(doc?.due_date ?? addDays(today(), 15)), valid_until: String(doc?.valid_until ?? addDays(today(), 30)), number: String(doc?.number ?? ''),
    tax_type: String(doc?.tax_type ?? (s.gstin ? s.default_tax_type : 'none') ?? 'none'), tax_rate: String(doc?.tax_rate ?? s.default_tax_rate ?? 18), discount: String(doc?.discount ?? 0),
    terms: String(doc?.terms ?? (isInvoice ? s.terms_invoice : s.terms_quote) ?? ''), notes: String(doc?.notes ?? ''),
  }));
  const [items, setItems] = useState<Item[]>(() => ((doc?.items as Item[] | undefined)?.length ? (doc?.items as Item[]).map((i) => ({ ...i })) : [{ description: '', hsn: '', qty: 1, rate: '' }]));
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const initial = useState(() => JSON.stringify([v, items]))[0];
  const dirty = !saved && JSON.stringify([v, items]) !== initial;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.value, ...(k === 'client_id' ? { project_id: '', change_request_id: '' } : {}), ...(k === 'project_id' ? { change_request_id: '' } : {}) }));

  const lines: LineItem[] = items.map((i) => ({ description: i.description, qty: Number(i.qty) || 0, rate: Number(i.rate) || 0 }));
  const t = computeTotals(lines, Number(v.discount) || 0, Number(v.tax_rate) || 0, v.tax_type);
  const rate = v.tax_type === 'none' ? 0 : Number(v.tax_rate) || 0;
  const projects = lookups.projects.filter((p) => !v.client_id || String(p.client_id) === v.client_id);
  const crs = useGet<Row[]>(v.project_id ? '/change_requests' : null, { project_id: v.project_id, limit: 100 }).data ?? [];

  const save = useAct(async (markSent: boolean) => {
    const data: Record<string, unknown> = { ...v, items: items.filter((i) => i.description || i.rate).map((i) => ({ ...i, qty: Number(i.qty), rate: Number(i.rate) })) };
    for (const k of ['client_id', 'lead_id', 'project_id', 'change_request_id']) if (!data[k]) data[k] = null;
    if (!isInvoice) { delete data.kind; delete data.due_date; } else { delete data.valid_until; delete data.lead_id; }
    if (!doc) delete data.number;
    if (markSent) data.status = 'sent';
    return doc ? api.put<Row>(`/${kind}/${doc.id}`, data) : api.post<Row>(`/${kind}`, data);
  }, (_r) => 'Saved', (r) => { setSaved(true); onSaved(r); });

  const submit = (markSent: boolean) => {
    setErr('');
    const real = items.filter((i) => i.description || i.rate);
    if (isInvoice && !v.client_id) return setErr('Choose the client to bill.');
    if (!real.length) return setErr('Add at least one line item with a rate.');
    for (const [i, it] of real.entries()) {
      if (!String(it.description).trim()) return setErr(`Line ${i + 1}: add a description.`);
      if (!(Number(it.qty) > 0)) return setErr(`Line ${i + 1}: quantity must be more than 0.`);
      const m = check('money', it.rate);
      if (m || it.rate === '') return setErr(`Line ${i + 1}: rate ${m || 'is required'}.`);
    }
    const pm = check('percent', v.tax_rate) || (check('money', v.discount) && `Discount ${check('money', v.discount)}`);
    if (pm) return setErr(String(pm).startsWith('Discount') ? `${pm}.` : `Tax rate ${pm}.`);
    const dm = checkDates(kind, { issue_date: v.issue_date, due_date: v.due_date, valid_until: v.valid_until });
    if (dm) return setErr(dm);
    save.mutate(markSent, { onError: (e) => setErr(e.message) });
  };
  const upd = (i: number, k: keyof Item, val: string) => setItems((x) => x.map((it, n) => (n === i ? { ...it, [k]: val } : it)));
  const canSend = !doc || doc.status === 'draft';

  return (
    <Modal title={doc ? `Edit ${label} ${String(doc.number)}` : `New ${label}`} size="xl" dirty={dirty} onClose={onClose}
      sub={doc ? String(doc.client_name ?? doc.lead_name ?? '') : isInvoice ? 'A bill. Once sent it counts as money owed to you (and as GST). Saved as a draft until you send it.' : 'An offer. Nothing is owed until the client accepts; then start the project or raise the invoice.'}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        {canSend ? (
          <>
            <button type="button" className={`btn ${save.isPending ? 'busy' : ''}`} onClick={() => submit(false)}>{doc ? 'Save draft' : 'Save as draft'}</button>
            <button type="button" className={`btn primary ${save.isPending ? 'busy' : ''}`} onClick={() => submit(true)}>Save &amp; mark as sent</button>
          </>
        ) : <button type="button" className={`btn primary ${save.isPending ? 'busy' : ''}`} onClick={() => submit(false)}>Save changes</button>}
      </>}>
      <div className="doc-ed" style={{ padding: '4px 4px 0' }}>
        <div className="fsec"><b>{isInvoice ? 'Bill to' : 'For'}</b></div>
        <div className="form-grid cols3">
          {!isInvoice && <label className="f"><span>Lead</span><select value={v.lead_id} onChange={set('lead_id')}><option value="">— none —</option>{lookups.leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` — ${l.company}` : ''}</option>)}</select></label>}
          <label className="f"><span>Client{isInvoice && <i> *</i>}</span><select value={v.client_id} onChange={set('client_id')} className={err.startsWith('Choose the client') ? 'invalid' : ''}><option value="">— choose —</option>{lookups.clients.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}</select></label>
          <label className="f"><span>Project</span><select value={v.project_id} onChange={set('project_id')}><option value="">— none —</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {v.project_id && (
            <label className="f"><span>For change request</span><select value={v.change_request_id} onChange={set('change_request_id')}><option value="">— none —</option>{crs.map((c) => <option key={c.id} value={c.id}>{String(c.ref)} · {String(c.title)}</option>)}</select></label>
          )}
          {isInvoice && <label className="f"><span>Type <i>*</i></span><select value={v.kind} onChange={set('kind')}><option value="invoice">Tax invoice</option><option value="proforma">Proforma invoice</option></select></label>}
          <label className="f full"><span>What it is for</span><input value={v.title} onChange={set('title')} placeholder="e.g. Website development — Phase 1" /></label>
          <label className="f"><span>Issue date</span><input type="date" value={v.issue_date} onChange={set('issue_date')} /></label>
          {isInvoice ? <label className="f"><span>Due date</span><input type="date" value={v.due_date} onChange={set('due_date')} /></label> : <label className="f"><span>Valid until</span><input type="date" value={v.valid_until} onChange={set('valid_until')} /></label>}
          {doc && isFounder && <label className="f"><span>Number</span><input value={v.number} onChange={set('number')} /><div className="hint">Change only to match a manual number.</div></label>}
        </div>
        <div className="fsec"><b>Line items</b><span>HSN/SAC is optional.</span></div>
        <div className="items">
          <div className="item-row item-head"><span>Description</span><span>HSN/SAC</span><span className="right">Qty</span><span className="right">Rate (₹)</span><span className="right">Amount</span><span /></div>
          {items.map((it, i) => (
            <div className="item-row" key={i}>
              <textarea rows={1} value={it.description} placeholder="Describe the work or product" aria-label="Description" onChange={(e) => { upd(i, 'description', e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight + 2}px`; }} />
              <input value={it.hsn ?? ''} placeholder="998314" aria-label="HSN/SAC" onChange={(e) => upd(i, 'hsn', e.target.value)} />
              <input type="number" step="any" min="0" className="right" aria-label="Quantity" value={it.qty} onChange={(e) => upd(i, 'qty', e.target.value)} />
              <input type="number" step="any" min="0" className="right" aria-label="Rate" placeholder="0.00" value={it.rate} onChange={(e) => upd(i, 'rate', e.target.value)} />
              <div className="right tnum amt">{money2((Number(it.qty) || 0) * (Number(it.rate) || 0))}</div>
              <button type="button" className="btn ghost sm icon" title="Remove line" aria-label="Remove line" disabled={items.length < 2} onClick={() => setItems((x) => x.filter((_, n) => n !== i))}><Icon name="x" /></button>
            </div>
          ))}
          <button type="button" className="btn sm ghost add-line" onClick={() => setItems((x) => [...x, { description: '', hsn: '', qty: 1, rate: '' }])}><Icon name="plus" />Add line</button>
        </div>
        <div className="ed-bottom">
          <div className="stack" style={{ gap: 14 }}>
            <div className="form-grid cols3">
              <label className="f"><span>Tax <i>*</i></span><select value={v.tax_type} onChange={set('tax_type')}>{TAX_TYPES.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></label>
              <label className="f"><span>Rate %</span><input type="number" step="any" min="0" value={v.tax_rate} onChange={set('tax_rate')} /></label>
              <label className="f"><span>Discount (₹)</span><input type="number" step="0.01" min="0" value={v.discount} onChange={set('discount')} /></label>
            </div>
            <label className="f"><span>Terms &amp; conditions</span><textarea rows={3} value={v.terms} onChange={set('terms')} /></label>
            <label className="f"><span>Note printed on the document</span><textarea rows={2} value={v.notes} onChange={set('notes')} /></label>
          </div>
          <div className="totbox">
            <div className="row spread"><span className="muted">Subtotal</span><span className="tnum">{money2(t.subtotal)}</span></div>
            {t.discount > 0 && <div className="row spread"><span className="muted">Discount</span><span className="tnum">− {money2(t.discount)}</span></div>}
            {v.tax_type === 'cgst_sgst' && <><div className="row spread"><span className="muted">CGST {rate / 2}%</span><span className="tnum">{money2(t.tax_amount / 2)}</span></div><div className="row spread"><span className="muted">SGST {rate / 2}%</span><span className="tnum">{money2(t.tax_amount / 2)}</span></div></>}
            {v.tax_type === 'igst' && <div className="row spread"><span className="muted">IGST {rate}%</span><span className="tnum">{money2(t.tax_amount)}</span></div>}
            <div className="row spread grand"><span>Total</span><span className="tnum">{money2(t.total)}</span></div>
            <div className="faint small" style={{ marginTop: 6 }}>{inWords(t.total)}</div>
          </div>
        </div>
        {err && <div className="callout err" role="alert" style={{ marginTop: 16 }}>{err}</div>}
      </div>
    </Modal>
  );
}

/* ============================ payment reminder ============================ */
function ReminderModal({ d, s, balance, onClose }: { d: Row; s: Settings; balance: number; onClose(): void }) {
  const contacts = useGet<Row[]>(d.client_id ? '/contacts' : null, { client_id: d.client_id, limit: 5 }).data ?? [];
  const c = contacts[0] ?? {};
  const toast = useToast();
  const late = d.due_date && daysUntil(String(d.due_date)) < 0;
  const pay = [s.bank_account_no && `Bank transfer: ${String(s.bank_account_name || s.company_name)}, A/c ${String(s.bank_account_no)}${s.bank_ifsc ? `, IFSC ${String(s.bank_ifsc)}` : ''}`, s.upi_id && `UPI: ${String(s.upi_id)}`].filter(Boolean);
  const initial = `Hi ${String(c.name ?? '').split(' ')[0] || 'there'},\n\nThis is a friendly reminder that invoice ${String(d.number)}${d.title ? ` (${String(d.title)})` : ''} has ${money2(balance)} outstanding, ${late ? `which was due on ${fmtDate(d.due_date)}` : `due on ${fmtDate(d.due_date)}`}.\n${pay.length ? `\nYou can pay by:\n${pay.map((p) => `• ${String(p)}`).join('\n')}\n` : ''}\nPlease ignore this if it has already been paid. Thank you!\n\n${s.company_name}`;
  const [text, setText] = useState(initial);
  const phone = String(c.whatsapp || c.phone || '').replace(/\D/g, '');
  const wa = phone ? `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}` : '';
  const mail = c.email ? `mailto:${encodeURIComponent(String(c.email))}?subject=${encodeURIComponent(`Payment reminder — ${String(d.number)}`)}&body=${encodeURIComponent(text)}` : '';
  const logIt = (kind: 'whatsapp' | 'email') => { void api.post('/notes', { entity_type: 'invoice', entity_id: d.id, kind, body: `Payment reminder sent ${kind === 'whatsapp' ? 'on WhatsApp' : 'by email'}.` }).catch(() => undefined); };
  return (
    <Modal title="Payment reminder" size="wide" sub={c.name ? `To ${String(c.name)} · edit if needed, then send it from WhatsApp or email.` : 'Add a contact to the client to send it directly.'} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); toast.ok('Copied to clipboard'); } catch { toast.err('Copy failed — select and copy manually.'); } }}><Icon name="copy" />Copy</button>
        {mail && <a className="btn" href={mail} onClick={() => logIt('email')}><Icon name="mail" />Email</a>}
        {wa && <a className="btn primary" href={wa} target="_blank" rel="noopener noreferrer" onClick={() => logIt('whatsapp')}><Icon name="chat" />WhatsApp</a>}
      </>}>
      <textarea rows={12} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Reminder message" />
    </Modal>
  );
}

/* ============================ printable view ============================ */
function DocumentView({ kind, d, onEdit }: { kind: Kind; d: Row; onEdit(): void }) {
  const nav = useNavigate();
  const dialogs = useDialogs();
  const editor = useEditor();
  const isInvoice = kind === 'invoices';
  const s = useGet<Settings>('/settings').data;
  const client = useGet<Row>(d.client_id ? `/clients/${d.client_id}` : null).data;
  const lead = useGet<Row>(d.lead_id && !d.client_id ? `/leads/${d.lead_id}` : null).data;
  const pays = useGet<Row[]>(isInvoice ? '/payments' : null, { invoice_id: d.id, limit: 100 }).data ?? [];
  const [reminder, setReminder] = useState(false);
  const setStatus = useAct((status: string) => api.put(`/${kind}/${d.id}`, { status }), 'Updated');
  const toInvoice = useAct(() => api.post<{ invoice_id: number }>(`/quotes/${d.id}/to-invoice`), 'Draft invoice created', (r) => nav(`/invoices/${r.invoice_id}`));
  const dup = useAct(() => api.post<Row>(`/${kind}`, { client_id: d.client_id, lead_id: d.lead_id, project_id: d.project_id, title: d.title, items: d.items, discount: d.discount, tax_type: d.tax_type, tax_rate: d.tax_rate, terms: d.terms, notes: d.notes, kind: d.kind }),
    'Duplicated as a new draft', (r) => nav(`/${kind}/${r.id}?edit=1`));
  const startProject = useAct(() => api.post<{ project_id: number }>(`/quotes/${d.id}/start-project`), 'Project created from the quotation', (r) => nav(`/projects/${r.project_id}?tab=finance`));
  if (!s) return <Skeleton kind="record" />;

  const items = (d.items as Item[]) ?? [];
  const title = !isInvoice ? 'QUOTATION' : d.kind === 'proforma' ? 'PROFORMA INVOICE' : s.gstin ? 'TAX INVOICE' : 'INVOICE';
  const half = Number(d.tax_rate) / 2;
  const balance = Math.max(0, Number(d.total) - Number(d.paid_amount || 0));
  const credit = Math.max(0, Number(d.paid_amount || 0) - Number(d.total));
  const stamp = isInvoice && d.status === 'paid' ? <span className="stamp" style={{ color: '#12805c' }}>PAID</span> : d.status === 'cancelled' ? <span className="stamp" style={{ color: '#c8352f' }}>CANCELLED</span> : null;
  const who = client ? String(client.company) : lead ? String(lead.company || lead.name) : '—';
  const st = String(d.status);

  return (
    <>
      <div className="pt no-print"><div>
        <div className="row" style={{ gap: 10 }}><h1>{who}</h1><Badge value={d.status} />{d.kind === 'proforma' && <span className="tag">Proforma</span>}</div>
        <div className="sub">{String(d.title ?? '')}{d.quote_number ? <> · from quotation <Link className="ln" to={`/quotes/${d.quote_id}`}>{String(d.quote_number)}</Link></> : null}
          {d.change_request_title ? <> · change request: {String(d.change_request_title)}</> : null}</div>
        <div className="small muted" style={{ marginTop: 4 }}>{isInvoice ? 'Invoice — a bill for work done or agreed. It is counted as money owed until payments are recorded against it.' : 'Quotation — an offer before any work. It owes nothing and can be changed, rejected or expire; accepting it starts a project or becomes an invoice.'}</div>
      </div></div>
      <div className="no-print row wrap" style={{ gap: 8 }}>
        <button type="button" className="btn" onClick={onEdit}><Icon name="edit" />Edit</button>
        <button type="button" className="btn" onClick={() => dup.mutate()}><Icon name="copy" />Duplicate</button>
        <button type="button" className="btn" onClick={() => { document.title = String(d.number); window.print(); }}><Icon name="print" />Print / PDF</button>
        {st === 'draft' && <button type="button" className="btn primary" onClick={() => setStatus.mutate('sent')}>Mark as sent</button>}
        {isInvoice && !['draft', 'cancelled', 'paid'].includes(st) && (
          <>
            <button type="button" className="btn" onClick={() => setReminder(true)}><Icon name="chat" />Payment reminder</button>
            <button type="button" className="btn primary" onClick={() => editor.open({ resource: 'payments', defaults: { invoice_id: d.id, client_id: d.client_id, project_id: d.project_id, amount: balance.toFixed(2) } })}>Record payment</button>
          </>
        )}
        {isInvoice && !['cancelled', 'paid'].includes(st) && !pays.length && (
          <button type="button" className="btn danger" onClick={async () => { if (await dialogs.confirm('Cancel this invoice? It will no longer count as money owed.', { danger: true, okLabel: 'Cancel invoice' })) setStatus.mutate('cancelled'); }}>Cancel invoice</button>
        )}
        {!isInvoice && ['sent', 'draft', 'expired'].includes(st) && (
          <>
            <button type="button" className="btn" onClick={() => setStatus.mutate('accepted')}>Accepted</button>
            <button type="button" className="btn" onClick={() => setStatus.mutate('rejected')}>Rejected</button>
          </>
        )}
        {!isInvoice && d.client_id && !d.project_id && !d.change_request_id ? <button type="button" className="btn primary" onClick={() => startProject.mutate()}>Accept &amp; start project</button> : null}
        {!isInvoice && d.client_id ? <button type="button" className="btn" onClick={() => toInvoice.mutate()}>Convert to invoice</button> : null}
      </div>
      <Kpis className="no-print" items={[
        { label: 'Total', value: money2(d.total), sub: d.tax_type === 'none' ? 'No tax' : `incl. ${d.tax_type === 'igst' ? 'IGST' : 'GST'} ${money2(d.tax_amount)}` },
        ...(isInvoice
          ? [{ label: 'Received', value: money2(d.paid_amount || 0), sub: `${pays.length} payment${pays.length === 1 ? '' : 's'}` },
            { label: 'Balance due', value: money2(balance), sub: credit > 0 ? `Overpaid by ${money2(credit)} — refund or adjust` : st === 'paid' ? 'Settled' : d.due_date ? `Due ${fmtDate(d.due_date)}` : '', tone: balance > 0 && st === 'overdue' ? 'bad' as const : undefined }]
          : [{ label: 'Valid until', value: fmtDate(d.valid_until), sub: st === 'sent' && d.valid_until ? (daysUntil(String(d.valid_until)) < 0 ? 'Expired' : `${daysUntil(String(d.valid_until))} days left`) : '' }]),
        { label: 'Issued', value: fmtDate(d.issue_date), sub: String(d.project_name ?? '') },
      ]} />
      <div className="paper-wrap">
        <div className="sheet" tabIndex={0} role="region" aria-label="Document preview">
          <div className="row spread" style={{ alignItems: 'flex-start' }}>
            <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
              {s.logo ? <img src={s.logo} alt="" style={{ maxHeight: 56, maxWidth: 150 }} /> : null}
              <div>
                <h2 style={{ fontSize: 17 }}>{s.company_name}</h2>
                <div className="muted pre small" style={{ marginTop: 3 }}>{s.company_address}</div>
                <div className="muted small">{[s.company_email, s.company_phone].filter(Boolean).join(' · ')}</div>
                {s.gstin ? <div className="small" style={{ marginTop: 2 }}>GSTIN {s.gstin}{s.pan ? ` · PAN ${s.pan}` : ''}</div> : null}
              </div>
            </div>
            <div className="right"><h1>{title}</h1><div className="mono" style={{ marginTop: 4 }}>{String(d.number)}</div>{stamp}</div>
          </div>
          <div className="cols">
            <div>
              <div className="lbl">{isInvoice ? 'Billed to' : 'Prepared for'}</div>
              {client ? <><div style={{ fontWeight: 600, fontSize: 14 }}>{String(client.company)}</div><div className="pre small muted">{[client.address, client.city, client.state].filter(Boolean).join(', ')}</div>{client.gstin ? <div className="small">GSTIN {String(client.gstin)}</div> : null}</>
                : lead ? <><div style={{ fontWeight: 600, fontSize: 14 }}>{String(lead.company || lead.name)}</div><div className="small muted">Attn: {String(lead.name)}</div></> : '—'}
            </div>
            <div className="right small">
              <div className="lbl">Details</div>
              <div>Date: <b>{fmtDate(d.issue_date)}</b></div>
              {isInvoice ? <div>Due: <b>{fmtDate(d.due_date)}</b></div> : <div>Valid until: <b>{fmtDate(d.valid_until)}</b></div>}
              {d.project_name ? <div>Project: <b>{String(d.project_name)}</b></div> : null}
            </div>
          </div>
          {d.title ? <div style={{ marginTop: 28, fontWeight: 600, fontSize: 14 }}>{String(d.title)}</div> : null}
          <table>
            <thead><tr><th style={{ width: 34 }}>#</th><th>Description</th><th>HSN/SAC</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
            <tbody>{items.map((it, i) => <tr key={i}><td className="muted">{i + 1}</td><td className="pre">{it.description}</td><td className="muted">{it.hsn}</td><td className="num">{it.qty}</td><td className="num">{money2(it.rate)}</td><td className="num">{money2(Number(it.qty) * Number(it.rate))}</td></tr>)}</tbody>
          </table>
          <div className="totals">
            <div><span className="muted">Subtotal</span><span>{money2(d.subtotal)}</span></div>
            {Number(d.discount) > 0 && <div><span className="muted">Discount</span><span>− {money2(d.discount)}</span></div>}
            {d.tax_type === 'cgst_sgst' && <><div><span className="muted">CGST @ {half}%</span><span>{money2(Number(d.tax_amount) / 2)}</span></div><div><span className="muted">SGST @ {half}%</span><span>{money2(Number(d.tax_amount) / 2)}</span></div></>}
            {d.tax_type === 'igst' && <div><span className="muted">IGST @ {String(d.tax_rate)}%</span><span>{money2(d.tax_amount)}</span></div>}
            <div className="grand"><span>Total</span><span>{money2(d.total)}</span></div>
            {isInvoice && Number(d.paid_amount) > 0 && <><div><span className="muted">Paid</span><span>− {money2(d.paid_amount)}</span></div><div style={{ fontWeight: 650 }}><span>Balance due</span><span>{money2(balance)}</span></div></>}
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>Amount in words: {inWords(Number(d.total))}</div>
          <div className="cols">
            {isInvoice && (s.bank_account_no || s.upi_id) ? (
              <div className="small"><div className="lbl">Payment details</div><div>{String(s.bank_account_name || s.company_name)}</div>{s.bank_name ? <div>{String(s.bank_name)}</div> : null}
                {s.bank_account_no ? <div>A/c <b>{String(s.bank_account_no)}</b>{s.bank_ifsc ? <> · IFSC <b>{String(s.bank_ifsc)}</b></> : null}</div> : null}{s.upi_id ? <div>UPI <b>{String(s.upi_id)}</b></div> : null}</div>
            ) : <div />}
            <div className="right small" style={{ paddingTop: 30 }}>For <b>{s.company_name}</b><div style={{ marginTop: 38 }}><span style={{ borderTop: '1px solid #c9c7bf', paddingTop: 4 }}>Authorised signatory</span></div></div>
          </div>
          {d.terms ? <div className="small" style={{ marginTop: 26 }}><div className="lbl">Terms &amp; conditions</div><div className="pre muted">{String(d.terms)}</div></div> : null}
          {d.notes ? <div className="small pre" style={{ marginTop: 12 }}>{String(d.notes)}</div> : null}
        </div>
      </div>
      <div className="no-print stack">
        {isInvoice && <div><SectionH title="Payments received" /><PaymentsTable query={{ invoice_id: d.id }} compact defaults={{ invoice_id: d.id, client_id: d.client_id, project_id: d.project_id, ...(balance > 0 ? { amount: balance.toFixed(2) } : {}) }} /></div>}
        <div className="grid-2">
          <div><SectionH title="Attachments" /><DocsPanel entityType={isInvoice ? 'invoice' : 'quote'} entityId={Number(d.id)} /></div>
          <div><SectionH title="Notes" /><Notes type={isInvoice ? 'invoice' : 'quote'} id={Number(d.id)} kinds={false} /></div>
        </div>
        <div><SectionH title="Changes" /><HistoryPanel resource={kind} id={Number(d.id)} /></div>
      </div>
      {reminder && <ReminderModal d={d} s={s} balance={balance} onClose={() => setReminder(false)} />}
    </>
  );
}

export default function DocumentEditor({ kind }: { kind: Kind }) {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const isNew = id === 'new';
  const q = useRecord(kind, isNew ? undefined : id);
  const isInvoice = kind === 'invoices';
  const label = isInvoice ? 'Invoices' : 'Quotations';
  const defaults = Object.fromEntries(['client', 'lead', 'project', 'cr'].map((k) => [k, sp.get(k) ?? '']).filter(([, v]) => v)) as Record<string, string>;
  const editing = isNew || sp.get('edit') === '1';
  const d = q.data as Row | undefined;
  const settings = useGet<Settings>('/settings').data;
  const closeEditor = () => { if (isNew) nav(`/${kind}`, { replace: true }); else setSp((p) => { const n = new URLSearchParams(p); n.delete('edit'); return n; }, { replace: true }); };

  if (!isNew && q.isPending) return <div id="page"><Skeleton kind="record" /></div>;
  if (!isNew && q.isError) return <div id="page"><ErrorBox error={q.error} retry={() => void q.refetch()} /></div>;

  return (
    <Page title={isNew ? `New ${isInvoice ? 'invoice' : 'quotation'}` : String(d?.number)} crumbs={<><Crumb to={`/${kind}`}>{label}</Crumb><b>{isNew ? 'New' : String(d?.number)}</b></>}>
      {d && <DocumentView kind={kind} d={d} onEdit={() => setSp((p) => { const n = new URLSearchParams(p); n.set('edit', '1'); return n; }, { replace: true })} />}
      {editing && settings && (isNew || d) && <EditorModal kind={kind} doc={isNew ? null : (d ?? null)} defaults={defaults} s={settings} onClose={closeEditor} onSaved={(r) => nav(`/${kind}/${r.id}`, { replace: true })} />}
    </Page>
  );
}
