/* Pages part 2: quotes, invoices, finance, renewals, maintenance, documents, vault, team, settings, calendar, activity */
'use strict';

/* =====================================================  QUOTES & INVOICES  ===================================================== */
function inWords(num) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : ''));
  const three = (n) => (n > 99 ? a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
  const words = (n) => {
    if (n === 0) return 'Zero';
    const parts = [[Math.floor(n / 1e7), 'Crore'], [Math.floor(n / 1e5) % 100, 'Lakh'], [Math.floor(n / 1e3) % 100, 'Thousand']];
    return parts.filter(([v]) => v).map(([v, w]) => two(v) + ' ' + w).concat(n % 1000 ? [three(n % 1000)] : []).join(' ');
  };
  const rupees = Math.floor(num), paise = Math.round((num - rupees) * 100);
  return `Rupees ${words(rupees)}${paise ? ` and ${words(paise)} Paise` : ''} Only`;
}

function quotesTable(root, query) {
  mountList(root, {
    resource: 'quotes', query, searchPlaceholder: 'Search quotations…', filters: [{ key: 'status', label: 'Status', options: OPT.quoteStatus }],
    columns: [{ key: 'number', label: 'Number', render: (r) => `<b>${esc(r.number)}</b>` }, { key: 'title', label: 'Title', render: (r) => esc(r.title || '—') },
      { key: 'client_name', label: 'For', render: (r) => esc(r.client_name || r.lead_name || '—') }, { key: 'issue_date', label: 'Issued', render: (r) => fdate(r.issue_date) },
      { key: 'valid_until', label: 'Valid until', render: (r) => (r.status === 'sent' ? dueBadge(r.valid_until) : fdate(r.valid_until)) }, { key: 'total', label: 'Total', num: true, render: (r) => money(r.total) }, { key: 'status', label: 'Status', render: (r) => badge(r.status) }],
    add: { label: 'New quotation', onClick: () => (location.hash = '#/quotes/new' + (query.lead_id ? '?lead=' + query.lead_id : query.client_id ? '?client=' + query.client_id : '')) },
    onRow: (r) => (location.hash = '#/quotes/' + r.id), empty: { title: 'No quotations yet', text: 'Create a professional quotation and convert it to an invoice once accepted.' },
  });
}
route('/quotes', ({ el }) => { el.innerHTML = pageHead('Quotations', 'Proposals and estimates sent to leads and clients.') + '<div id="body"></div>'; quotesTable($('#body', el), {}); }, { title: 'Quotations', founder: true });

function invoicesTable(root, query, { newQuery, onLoad } = {}) {
  mountList(root, {
    resource: 'invoices', query, searchPlaceholder: 'Search invoices…', defaultSort: { key: 'issue_date', dir: 'desc' }, onLoad,
    filters: [{ key: 'status', label: 'Status', options: OPT.invoiceStatus }, ...(query.client_id ? [] : [{ key: 'client_id', label: 'Client', lookup: 'clients' }])],
    columns: [{ key: 'number', label: 'Invoice', render: (r) => `<b>${esc(r.number)}</b>${r.kind === 'proforma' ? ' <span class="badge b-violet">Proforma</span>' : ''}<div class="small muted">${esc(r.title || '')}</div>` },
      ...(query.client_id ? [] : [{ key: 'client_name', label: 'Client', render: (r) => esc(r.client_name || '—') }]),
      ...(query.project_id ? [] : [{ key: 'project_name', label: 'Project', render: (r) => esc(r.project_name || '—') }]),
      { key: 'issue_date', label: 'Issued', render: (r) => fdate(r.issue_date) }, { key: 'due_date', label: 'Due', render: (r) => (['paid', 'cancelled', 'draft'].includes(r.status) ? fdate(r.due_date) : dueBadge(r.due_date)) },
      { key: 'total', label: 'Total', num: true, render: (r) => money(r.total) }, { key: 'balance', label: 'Balance', num: true, render: (r) => (['paid', 'cancelled', 'draft'].includes(r.status) ? '—' : `<b>${money(r.balance)}</b>`) }, { key: 'status', label: 'Status', render: (r) => badge(r.status) }],
    footer: (rows) => `<tr><td colspan="${query.client_id ? (query.project_id ? 3 : 4) : 5}">Total (${rows.length})</td><td class="num">${money(rows.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + r.total, 0))}</td><td class="num">${money(rows.filter((r) => !['cancelled', 'draft', 'paid'].includes(r.status)).reduce((s, r) => s + r.balance, 0))}</td><td></td></tr>`,
    add: { label: 'New invoice', onClick: () => (location.hash = '#/invoices/new' + (newQuery ? '?' + newQuery : '')) },
    onRow: (r) => (location.hash = '#/invoices/' + r.id), empty: { title: 'No invoices yet', text: 'Create an invoice to start tracking what clients owe you.' },
  });
}
route('/invoices', ({ el }) => {
  el.innerHTML = pageHead('Invoices', 'Bills sent to clients, with payment status.', '<a class="btn" href="/api/invoices/export.csv">' + icon('download') + ' Export CSV</a>') + '<div class="kpis" id="ik"></div><div id="body"></div>';
  invoicesTable($('#body', el), {}, { onLoad: (rows) => {
    const live = rows.filter((r) => r.kind === 'invoice' && !['draft', 'cancelled'].includes(r.status)); const out = live.filter((r) => r.status !== 'paid'); const od = live.filter((r) => r.status === 'overdue');
    $('#ik', el).innerHTML = kpi('Outstanding', money(out.reduce((s, r) => s + r.balance, 0)), `${out.length} unpaid invoices`) + kpi('Overdue', money(od.reduce((s, r) => s + r.balance, 0)), `${od.length} invoices`, od.length ? 'bad' : '')
      + kpi('Drafts', rows.filter((r) => r.status === 'draft').length, 'Not sent yet') + kpi('Paid', money(rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.total, 0)), `${rows.filter((r) => r.status === 'paid').length} invoices`, 'good');
  } });
}, { title: 'Invoices', founder: true });

/* ----- editor (large popup over the page you came from) ----- */
async function openDocEditor(kind, { id, query = {}, onCancel } = {}) {
  const resource = kind === 'invoice' ? 'invoices' : 'quotes';
  const [editing, s] = await Promise.all([id ? GET(`/${resource}/${id}`) : null, GET('/settings')]);
  const doc = editing || { client_id: query.client || '', lead_id: query.lead || '', project_id: query.project || '', title: '', issue_date: todayStr(), items: [{ description: '', hsn: '', qty: 1, rate: '' }],
    discount: 0, tax_type: s.default_tax_type, tax_rate: s.default_tax_rate, terms: kind === 'invoice' ? s.terms_invoice : s.terms_quote, notes: '', kind: 'invoice',
    due_date: addDaysStr(todayStr(), 15), valid_until: addDaysStr(todayStr(), 30) };
  if (!editing && query.lead && !query.client) { const l = App.lookups.leads.find((x) => String(x.id) === String(query.lead)); if (l) doc.title = `Proposal for ${l.company || l.name}`; }
  const label = kind === 'invoice' ? 'invoice' : 'quotation';
  let saved = false;
  const m = openModal({ title: editing ? `Edit ${label} ${editing.number}` : `New ${label}`, size: 'xl',
    sub: editing ? (editing.client_name || editing.lead_name || '') : kind === 'invoice' ? 'Saved as a draft until you mark it as sent.' : 'A priced proposal you can later turn into an invoice.',
    onClose: () => { if (!saved && onCancel) onCancel(); },
    body: `<div class="doc-ed">
      <div class="fsec"><b>${kind === 'invoice' ? 'Bill to' : 'For'}</b></div>
      <div class="form-grid cols3">
        ${kind === 'quote' ? fieldHtml({ name: 'lead_id', label: 'Lead', type: 'select', lookup: 'leads', blank: '— none —' }, doc.lead_id) : ''}
        ${fieldHtml({ name: 'client_id', label: 'Client', type: 'select', lookup: 'clients', required: kind === 'invoice', blank: '— choose —' }, doc.client_id)}
        ${fieldHtml({ name: 'project_id', label: 'Project', type: 'select', options: [] }, doc.project_id)}
        ${kind === 'invoice' ? fieldHtml({ name: 'kind', label: 'Type', type: 'select', options: [['invoice', 'Tax invoice'], ['proforma', 'Proforma invoice']], required: true }, doc.kind) : ''}
        ${fieldHtml({ name: 'title', label: 'What it is for', full: true, placeholder: 'e.g. Website development — Phase 1' }, doc.title)}
        ${fieldHtml({ name: 'issue_date', label: 'Issue date', type: 'date' }, doc.issue_date)}
        ${kind === 'invoice' ? fieldHtml({ name: 'due_date', label: 'Due date', type: 'date' }, doc.due_date) : fieldHtml({ name: 'valid_until', label: 'Valid until', type: 'date' }, doc.valid_until)}
        ${editing ? fieldHtml({ name: 'number', label: 'Number', rule: 'digitsText', help: 'Change only to match a manual number.' }, doc.number) : ''}
      </div>
      <div class="fsec"><b>Line items</b><span>HSN/SAC is optional.</span></div>
      <div class="items"><div class="item-row item-head"><span>Description</span><span>HSN/SAC</span><span class="right">Qty</span><span class="right">Rate (₹)</span><span class="right">Amount</span><span></span></div><div id="items"></div>
        <button class="btn sm ghost add-line" id="addline" type="button">${icon('plus')}Add line</button></div>
      <div class="ed-bottom">
        <div class="stack" style="gap:14px"><div class="form-grid cols3">${fieldHtml({ name: 'tax_type', label: 'Tax', type: 'select', options: OPT.taxType, required: true }, doc.tax_type)}${fieldHtml({ name: 'tax_rate', label: 'Rate %', type: 'number', rule: 'percent' }, doc.tax_rate)}${fieldHtml({ name: 'discount', label: 'Discount (₹)', type: 'money' }, doc.discount)}</div>
          ${fieldHtml({ name: 'terms', label: 'Terms & conditions', type: 'textarea', rows: 3 }, doc.terms)}${fieldHtml({ name: 'notes', label: 'Note printed on the document', type: 'textarea', rows: 2 }, doc.notes)}</div>
        <div class="totbox" id="tot"></div></div>
      <div id="ed-err" class="callout err hidden" role="alert" style="margin-top:16px"></div></div>`,
    footer: `<button class="btn" data-close type="button">Cancel</button>${!editing || editing.status === 'draft' ? `<button class="btn" id="save" type="button">${editing ? 'Save draft' : 'Save as draft'}</button><button class="btn primary" id="savesend" type="button">Save & mark as sent</button>` : '<button class="btn primary" id="save" type="button">Save changes</button>'}` });
  const el = m.el; const itemsEl = $('#items', el); let items = JSON.parse(JSON.stringify(doc.items));
  const read = (n) => $(`[name="${n}"]`, el);
  const totals = () => {
    const sub = items.reduce((t, i) => t + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0); const disc = Math.min(Number(read('discount').value) || 0, sub); const taxType = read('tax_type').value;
    const rate = taxType === 'none' ? 0 : Number(read('tax_rate').value) || 0; const tax = (sub - disc) * rate / 100;
    $('#tot', el).innerHTML = `<div class="row spread"><span class="muted">Subtotal</span><span class="tnum">${money2(sub)}</span></div>${disc ? `<div class="row spread"><span class="muted">Discount</span><span class="tnum">− ${money2(disc)}</span></div>` : ''}
      ${taxType === 'cgst_sgst' ? `<div class="row spread"><span class="muted">CGST ${rate / 2}%</span><span class="tnum">${money2(tax / 2)}</span></div><div class="row spread"><span class="muted">SGST ${rate / 2}%</span><span class="tnum">${money2(tax / 2)}</span></div>` : taxType === 'igst' ? `<div class="row spread"><span class="muted">IGST ${rate}%</span><span class="tnum">${money2(tax)}</span></div>` : ''}
      <div class="row spread grand"><span>Total</span><span class="tnum">${money2(sub - disc + tax)}</span></div><div class="faint small" style="margin-top:6px">${esc(inWords(Math.round((sub - disc + tax) * 100) / 100))}</div>`;
    items.forEach((it, i) => { const a = $(`[data-amt="${i}"]`, itemsEl); if (a) a.textContent = money2((Number(it.qty) || 0) * (Number(it.rate) || 0)); });
  };
  const drawItems = () => {
    itemsEl.innerHTML = items.map((it, i) => `<div class="item-row"><textarea rows="1" data-i="${i}" data-k="description" placeholder="Describe the work or product" aria-label="Description">${esc(it.description)}</textarea><input data-i="${i}" data-k="hsn" value="${esc(it.hsn || '')}" placeholder="998314" aria-label="HSN/SAC">
      <input type="number" step="any" min="0" data-rule="qty" data-i="${i}" data-k="qty" value="${esc(it.qty)}" class="right" aria-label="Quantity"><input type="number" step="any" min="0" data-rule="money" data-i="${i}" data-k="rate" value="${esc(it.rate)}" placeholder="0.00" class="right" aria-label="Rate"><div class="right tnum amt" data-amt="${i}"></div>
      <button class="btn ghost sm icon" type="button" data-rm="${i}" title="Remove line" ${items.length < 2 ? 'disabled' : ''}>${icon('x')}</button></div>`).join(''); totals(); $$('textarea', itemsEl).forEach((t) => { if (t.value) grow(t); });
  };
  const grow = (t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };
  itemsEl.addEventListener('input', (e) => { const t = e.target; if (t.dataset.i !== undefined) { items[t.dataset.i][t.dataset.k] = t.value; totals(); if (t.tagName === 'TEXTAREA') grow(t); } });
  delegate(itemsEl, '[data-rm]', 'click', (b) => { items.splice(Number(b.dataset.rm), 1); drawItems(); });
  $('#addline', el).addEventListener('click', () => { items.push({ description: '', hsn: '', qty: 1, rate: '' }); drawItems(); $$('textarea', itemsEl).pop().focus(); });
  ['discount', 'tax_type', 'tax_rate'].forEach((n) => read(n).addEventListener('input', totals));
  const fillProjects = () => { const cid = read('client_id').value; const cur = read('project_id').value || doc.project_id; const ps = App.lookups.projects.filter((p) => !cid || String(p.client_id) === cid);
    read('project_id').innerHTML = '<option value="">— none —</option>' + ps.map((p) => `<option value="${p.id}" ${String(p.id) === String(cur) ? 'selected' : ''}>${esc(p.name)}</option>`).join(''); };
  read('client_id').addEventListener('change', () => { doc.project_id = ''; fillProjects(); }); fillProjects(); drawItems();
  const collect = () => { const data = {}; $$('.modal-b [name]', el).forEach((n) => { data[n.name] = n.value; }); data.items = items.filter((i) => i.description || i.rate); return data; };
  const initial = JSON.stringify(collect()); m.dirty = () => !saved && JSON.stringify(collect()) !== initial;
  async function save(markSent, btn) {
    const err = $('#ed-err', el); err.classList.add('hidden');
    const data = collect();
    const fail2 = (msg) => { err.textContent = msg; err.classList.remove('hidden'); err.scrollIntoView({ block: 'nearest' }); };
    if (kind === 'invoice' && !data.client_id) { read('client_id').classList.add('invalid'); return fail2('Choose the client to bill.'); }
    if (!data.items.length) return fail2('Add at least one line item with a rate.');
    // same checks the server makes, so the message appears before saving
    const bad = $$('.modal-b [data-rule], .modal-b input[type=date]', el).map((n) => ({ n, m: fieldProblem(n) })).filter((x) => x.m);
    $$('.modal-b [data-rule], .modal-b input[type=date]', el).forEach((n) => fieldError(n, fieldProblem(n)));
    const lineBad = data.items.findIndex((it) => !String(it.description || '').trim() || !(Number(it.qty) > 0) || Number(it.rate) < 0);
    const dmsg = RULES.checkDates(resource, data);
    if (bad.length) { bad[0].n.focus(); return fail2(bad[0].m); }
    if (lineBad >= 0) { const it = data.items[lineBad]; return fail2(`Line ${lineBad + 1}: ${!String(it.description || '').trim() ? 'add a description' : !(Number(it.qty) > 0) ? 'quantity must be more than 0' : 'rate cannot be negative'}.`); }
    if (dmsg) { fieldError(read(kind === 'invoice' ? 'due_date' : 'valid_until'), dmsg); return fail2(dmsg); }
    if (markSent) data.status = 'sent';
    btn.disabled = true; const t = btn.textContent; btn.textContent = 'Saving…'; btn.classList.add('busy');
    try { const r = editing ? await PUT(`/${resource}/${editing.id}`, data) : await POST(`/${resource}`, data); saved = true; toast(markSent ? 'Saved and marked as sent' : 'Saved'); m.close(); location.hash = `#/${resource}/${r.id}`; }
    catch (e) { fail2(e.message); btn.disabled = false; btn.textContent = t; btn.classList.remove('busy'); }
  }
  $('#save', el).addEventListener('click', (e) => save(false, e.currentTarget)); const ss = $('#savesend', el); if (ss) ss.addEventListener('click', (e) => save(true, e.currentTarget));
  return m;
}
/* direct links (#/invoices/new, #/quotes/12/edit …) show the page underneath and the editor on top */
function editorRoute(kind) {
  const resource = kind === 'invoice' ? 'invoices' : 'quotes';
  return async ({ el, params, query }) => {
    const prev = Router.prevHash && !/\/(new|edit)(\?|$)/.test(Router.prevHash) ? Router.prevHash : '';
    const back = params.id ? `#/${resource}/${params.id}` : prev || `#/${resource}`;
    const [path, q] = back.slice(1).split('?'); const hit = Router.match(path);
    if (hit && !/\/(new|edit)$/.test(path)) await hit.route.handler({ el, params: hit.params, query: Object.fromEntries(new URLSearchParams(q || '')) });
    const me = location.hash;
    openDocEditor(kind, { id: params.id, query, onCancel: () => { if (location.hash === me) location.replace(back); } }).catch(fail);
  };
}
route('/invoices/new', editorRoute('invoice'), { title: 'New invoice', founder: true });
route('/invoices/:id/edit', editorRoute('invoice'), { title: 'Edit invoice', founder: true });
route('/quotes/new', editorRoute('quote'), { title: 'New quotation', founder: true });
route('/quotes/:id/edit', editorRoute('quote'), { title: 'Edit quotation', founder: true });

/* ----- printable view ----- */
function docView(kind) {
  const resource = kind === 'invoice' ? 'invoices' : 'quotes';
  return async ({ el, params }) => {
    const [d, s] = await Promise.all([GET(`/${resource}/${params.id}`), GET('/settings')]);
    const client = d.client_id ? await GET('/clients/' + d.client_id) : null; const lead = d.lead_id ? await GET('/leads/' + d.lead_id).catch(() => null) : null;
    const title = kind === 'quote' ? 'QUOTATION' : d.kind === 'proforma' ? 'PROFORMA INVOICE' : s.gstin ? 'TAX INVOICE' : 'INVOICE';
    const half = d.tax_rate / 2;
    const stamp = kind === 'invoice' && d.status === 'paid' ? '<span class="stamp" style="color:#12805c">PAID</span>' : d.status === 'cancelled' ? '<span class="stamp" style="color:#c8352f">CANCELLED</span>' : '';
    const payments = kind === 'invoice' ? await GET('/payments' + qs({ invoice_id: d.id })) : [];
    const actions = [];
    if (kind === 'invoice') {
      if (d.status === 'draft') actions.push('<button class="btn primary" data-st="sent">Mark as sent</button>');
      if (!['draft', 'cancelled', 'paid'].includes(d.status)) actions.push(`<button class="btn" id="remind">${icon('chat')}Payment reminder</button><button class="btn primary" id="pay">Record payment</button>`);
      if (!['cancelled', 'paid'].includes(d.status) && !payments.length) actions.push('<button class="btn danger" data-st="cancelled">Cancel invoice</button>');
    } else {
      if (d.status === 'draft') actions.push('<button class="btn primary" data-st="sent">Mark as sent</button>');
      if (['sent', 'draft', 'expired'].includes(d.status)) actions.push('<button class="btn" data-st="accepted">Accepted</button><button class="btn" data-st="rejected">Rejected</button>');
      actions.push('<button class="btn primary" id="toinv">Convert to invoice</button>');
    }
    const balance = d.total - (d.paid_amount || 0);
    const who2 = client ? client.company : lead ? lead.company || lead.name : '—';
    el.innerHTML = pageHead(esc(d.number), '', `<a class="btn" href="#/${resource}/${d.id}/edit">${icon('edit')}Edit</a><button class="btn" id="dup">${icon('copy')}Duplicate</button><button class="btn" id="print">${icon('print')}Print / PDF</button>${actions.join('')}`, `<a href="#/${resource}">${kind === 'invoice' ? 'Invoices' : 'Quotations'}</a> / ${esc(d.number)}`)
    + `<div class="pt no-print"><div><div class="row" style="gap:10px"><h1>${esc(who2)}</h1>${badge(d.status)}${d.kind === 'proforma' ? '<span class="tag">Proforma</span>' : ''}</div><div class="sub">${esc(d.title || '')}${d.quote_number ? ` · from quotation <a class="ln" href="#/quotes/${d.quote_id}">${esc(d.quote_number)}</a>` : ''}</div></div></div>
    <div class="kpis no-print">${kpi('Total', money2(d.total), `${d.tax_type === 'none' ? 'No tax' : `incl. ${d.tax_type === 'igst' ? 'IGST' : 'GST'} ${money2(d.tax_amount)}`}`)}${kind === 'invoice' ? kpi('Received', money2(d.paid_amount || 0), plural(payments.length, 'payment')) + kpi('Balance due', money2(balance), d.status === 'paid' ? 'Settled' : d.due_date ? `Due ${fdate(d.due_date)}` : '', balance > 0 && d.status === 'overdue' ? 'bad' : '') : kpi('Valid until', fdate(d.valid_until), d.status === 'sent' && d.valid_until ? (daysUntil(d.valid_until) < 0 ? 'Expired' : `${daysUntil(d.valid_until)} days left`) : '')}${kpi('Issued', fdate(d.issue_date), d.project_name ? esc(d.project_name) : '')}</div>
    <div class="paper-wrap"><div class="sheet"><div class="row spread" style="align-items:flex-start"><div class="row" style="align-items:flex-start;gap:14px">${s.logo ? `<img src="${esc(s.logo)}" alt="" style="max-height:56px;max-width:150px">` : ''}<div><h2 style="font-size:17px">${esc(s.company_name)}</h2>
      <div class="muted pre small" style="margin-top:3px">${esc(s.company_address)}</div><div class="muted small">${[s.company_email, s.company_phone].filter(Boolean).map(esc).join(' · ')}</div>${s.gstin ? `<div class="small" style="margin-top:2px">GSTIN ${esc(s.gstin)}${s.pan ? ' · PAN ' + esc(s.pan) : ''}</div>` : ''}</div></div>
      <div class="right"><h1>${title}</h1><div class="mono" style="margin-top:4px">${esc(d.number)}</div>${stamp}</div></div>
      <div class="cols"><div><div class="lbl">Billed to</div>${client ? `<div style="font-weight:600;font-size:14px">${esc(client.company)}</div><div class="pre small muted">${esc([client.address, client.city, client.state].filter(Boolean).join(', '))}</div>${client.gstin ? `<div class="small">GSTIN ${esc(client.gstin)}</div>` : ''}` : lead ? `<div style="font-weight:600;font-size:14px">${esc(lead.company || lead.name)}</div><div class="small muted">Attn: ${esc(lead.name)}</div>` : '—'}</div>
      <div class="right small"><div class="lbl">Details</div><div>Date: <b>${fdate(d.issue_date)}</b></div>${kind === 'invoice' ? `<div>Due: <b>${fdate(d.due_date)}</b></div>` : `<div>Valid until: <b>${fdate(d.valid_until)}</b></div>`}${d.project_name ? `<div>Project: <b>${esc(d.project_name)}</b></div>` : ''}</div></div>
      ${d.title ? `<div style="margin-top:28px;font-weight:600;font-size:14px">${esc(d.title)}</div>` : ''}
      <table><thead><tr><th style="width:34px">#</th><th>Description</th><th>HSN/SAC</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>
      ${d.items.map((it, i) => `<tr><td class="muted">${i + 1}</td><td class="pre">${esc(it.description)}</td><td class="muted">${esc(it.hsn || '')}</td><td class="num">${it.qty}</td><td class="num">${money2(it.rate)}</td><td class="num">${money2(it.qty * it.rate)}</td></tr>`).join('')}</tbody></table>
      <div class="totals"><div><span class="muted">Subtotal</span><span>${money2(d.subtotal)}</span></div>${d.discount ? `<div><span class="muted">Discount</span><span>− ${money2(d.discount)}</span></div>` : ''}
        ${d.tax_type === 'cgst_sgst' ? `<div><span class="muted">CGST @ ${half}%</span><span>${money2(d.tax_amount / 2)}</span></div><div><span class="muted">SGST @ ${half}%</span><span>${money2(d.tax_amount / 2)}</span></div>` : d.tax_type === 'igst' ? `<div><span class="muted">IGST @ ${d.tax_rate}%</span><span>${money2(d.tax_amount)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${money2(d.total)}</span></div>${kind === 'invoice' && d.paid_amount ? `<div><span class="muted">Paid</span><span>− ${money2(d.paid_amount)}</span></div><div style="font-weight:650"><span>Balance due</span><span>${money2(balance)}</span></div>` : ''}</div>
      <div class="small muted" style="margin-top:10px">Amount in words: ${esc(inWords(d.total))}</div>
      <div class="cols">${kind === 'invoice' && (s.bank_account_no || s.upi_id) ? `<div class="small"><div class="lbl">Payment details</div><div>${esc(s.bank_account_name || s.company_name)}</div>${s.bank_name ? `<div>${esc(s.bank_name)}</div>` : ''}${s.bank_account_no ? `<div>A/c <b>${esc(s.bank_account_no)}</b>${s.bank_ifsc ? ' · IFSC <b>' + esc(s.bank_ifsc) + '</b>' : ''}</div>` : ''}${s.upi_id ? `<div>UPI <b>${esc(s.upi_id)}</b></div>` : ''}</div>` : '<div></div>'}
        <div class="right small" style="padding-top:30px">For <b>${esc(s.company_name)}</b><div style="margin-top:38px"><span style="border-top:1px solid #c9c7bf;padding-top:4px">Authorised signatory</span></div></div></div>
      ${d.terms ? `<div class="small" style="margin-top:26px"><div class="lbl">Terms & conditions</div><div class="pre muted">${esc(d.terms)}</div></div>` : ''}${d.notes ? `<div class="small pre" style="margin-top:12px">${esc(d.notes)}</div>` : ''}</div></div>
    <div class="no-print stack">${kind === 'invoice' ? `<div>${sectionH('Payments received')}<div id="pays"></div></div>` : ''}<div class="grid g2"><div>${sectionH('Attachments')}<div id="docs"></div></div><div>${sectionH('Notes')}<div id="notes"></div></div></div></div>`;
    $('#print', el).addEventListener('click', () => { document.title = `${d.number}`; window.print(); });
    delegate(el, '[data-st]', 'click', async (b) => { if (b.dataset.st === 'cancelled' && !(await confirmBox('Cancel this invoice? It will no longer count as money owed.', { danger: true, okLabel: 'Cancel invoice' }))) return; try { await PUT(`/${resource}/${d.id}`, { status: b.dataset.st }); toast('Updated'); Router.refresh(); } catch (e) { fail(e); } });
    const rm = $('#remind', el); if (rm) rm.addEventListener('click', () => reminderModal(d, s, balance));
    const pay = $('#pay', el); if (pay) pay.addEventListener('click', () => paymentModal(null, { invoice_id: d.id, client_id: d.client_id, project_id: d.project_id, amount: (d.total - d.paid_amount).toFixed(2) }, () => Router.refresh()));
    const ti = $('#toinv', el); if (ti) ti.addEventListener('click', async () => { try { const r = await POST(`/quotes/${d.id}/to-invoice`); toast('Draft invoice created'); location.hash = '#/invoices/' + r.invoice_id; } catch (e) { fail(e); } });
    $('#dup', el).addEventListener('click', async () => { try { const r = await POST(`/${resource}`, { client_id: d.client_id, lead_id: d.lead_id, project_id: d.project_id, title: d.title, items: d.items, discount: d.discount, tax_type: d.tax_type, tax_rate: d.tax_rate, terms: d.terms, notes: d.notes, kind: d.kind }); toast('Duplicated as a new draft'); location.hash = `#/${resource}/${r.id}/edit`; } catch (e) { fail(e); } });
    if (kind === 'invoice') paymentsTable($('#pays', el), { invoice_id: d.id }, { invoice_id: d.id, client_id: d.client_id, project_id: d.project_id });
    docsPanel($('#docs', el), kind, d.id); notesPanel($('#notes', el), kind, d.id);
  };
}
/* ready-to-send payment reminder (copy, WhatsApp or email — nothing is sent by the CRM itself) */
async function reminderModal(d, s, balance) {
  const contacts = d.client_id ? await GET('/contacts' + qs({ client_id: d.client_id })).catch(() => []) : [];
  const c = contacts[0] || {};
  const late = d.due_date && daysUntil(d.due_date) < 0;
  const pay = [s.bank_account_no && `Bank transfer: ${s.bank_account_name || s.company_name}, A/c ${s.bank_account_no}${s.bank_ifsc ? `, IFSC ${s.bank_ifsc}` : ''}`, s.upi_id && `UPI: ${s.upi_id}`].filter(Boolean);
  const text = `Hi ${(c.name || '').split(' ')[0] || 'there'},\n\nThis is a friendly reminder that invoice ${d.number}${d.title ? ` (${d.title})` : ''} has ${money2(balance)} outstanding, ${late ? `which was due on ${fdate(d.due_date)}` : `due on ${fdate(d.due_date)}`}.\n${pay.length ? `\nYou can pay by:\n${pay.map((p) => '• ' + p).join('\n')}\n` : ''}\nPlease ignore this if it has already been paid. Thank you!\n\n${s.company_name}`;
  const phone = String(c.whatsapp || c.phone || '').replace(/\D/g, '');
  const wa = phone ? `https://wa.me/${phone.length === 10 ? '91' + phone : phone}?text=${encodeURIComponent(text)}` : '';
  const mail = c.email ? `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(`Payment reminder — ${d.number}`)}&body=${encodeURIComponent(text)}` : '';
  const m = openModal({ title: 'Payment reminder', sub: c.name ? `To ${c.name} · edit if needed, then send it from WhatsApp or email.` : 'Add a contact to the client to send it directly.', size: 'wide', body: `<textarea id="rm-t" rows="12" style="width:100%">${esc(text)}</textarea>`,
    footer: `<button class="btn" id="rm-copy">${icon('copy')}Copy</button>${mail ? `<a class="btn" id="rm-mail" href="${esc(mail)}">${icon('mail')}Email</a>` : ''}${wa ? `<a class="btn primary" id="rm-wa" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">${icon('chat')}WhatsApp</a>` : ''}` });
  const cur = () => $('#rm-t', m.el).value;
  $('#rm-copy', m.el).addEventListener('click', () => copyText(cur()));
  const w = $('#rm-wa', m.el); if (w) w.addEventListener('click', () => { w.href = `https://wa.me/${phone.length === 10 ? '91' + phone : phone}?text=${encodeURIComponent(cur())}`; POST('/notes', { entity_type: 'invoice', entity_id: d.id, kind: 'whatsapp', body: 'Payment reminder sent on WhatsApp.' }).catch(() => {}); });
  const e = $('#rm-mail', m.el); if (e) e.addEventListener('click', () => { e.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(`Payment reminder — ${d.number}`)}&body=${encodeURIComponent(cur())}`; POST('/notes', { entity_type: 'invoice', entity_id: d.id, kind: 'email', body: 'Payment reminder sent by email.' }).catch(() => {}); });
}
route('/invoices/:id', docView('invoice'), { title: 'Invoice', founder: true });
route('/quotes/:id', docView('quote'), { title: 'Quotation', founder: true });

/* =====================================================  FINANCE  ===================================================== */
function paymentModal(rec, defaults, after) {
  const m = editRecord('payments', rec, defaults, after, { label: 'payment', size: 'wide' });
  const cSel = $('[name="client_id"]', m.el), iSel = $('[name="invoice_id"]', m.el), amt = $('[name="amount"]', m.el);
  let invs = [];
  async function load(clientId, selected) {
    invs = clientId ? await GET('/invoices' + qs({ client_id: clientId })) : [];
    invs = invs.filter((i) => i.kind === 'invoice' && (['sent', 'partial', 'overdue'].includes(i.status) || String(i.id) === String(selected)));
    iSel.innerHTML = '<option value="">— not against an invoice —</option>' + invs.map((i) => `<option value="${i.id}" ${String(i.id) === String(selected) ? 'selected' : ''}>${esc(i.number)} — balance ${money2(i.balance)}</option>`).join('');
  }
  load(cSel.value, (rec && rec.invoice_id) || (defaults && defaults.invoice_id));
  cSel.addEventListener('change', () => load(cSel.value, ''));
  iSel.addEventListener('change', () => { const i = invs.find((x) => String(x.id) === iSel.value); if (i && !Number(amt.value)) amt.value = i.balance.toFixed(2); });
  return m;
}
function paymentsTable(root, query, defaults) {
  mountList(root, {
    resource: 'payments', query, searchPlaceholder: 'Search payments…', defaultSort: { key: 'date', dir: 'desc' },
    filters: query.client_id || query.invoice_id || query.project_id ? [] : [{ key: 'client_id', label: 'Client', lookup: 'clients' }, { key: 'account_id', label: 'Account', lookup: 'accounts' }],
    columns: [{ key: 'date', label: 'Date', render: (r) => fdate(r.date) }, ...(query.client_id || query.invoice_id ? [] : [{ key: 'client_name', label: 'Client', render: (r) => esc(r.client_name || '—') }]),
      { key: 'invoice_number', label: 'Invoice', render: (r) => (r.invoice_id ? `<a href="#/invoices/${r.invoice_id}">${esc(r.invoice_number)}</a>` : '<span class="muted">On account</span>') },
      { key: 'method', label: 'Method', render: (r) => `${esc(r.method || '—')}<div class="small muted">${esc(r.reference || '')}</div>` }, { key: 'account_name', label: 'Account', render: (r) => esc(r.account_name || '—') },
      { key: 'tds', label: 'TDS', num: true, render: (r) => (r.tds ? money2(r.tds) : '—') }, { key: 'amount', label: 'Received', num: true, render: (r) => `<b>${money2(r.amount)}</b>` }],
    footer: (rows) => `<tr><td colspan="${query.client_id || query.invoice_id ? 4 : 5}">Total</td><td class="num">${money2(rows.reduce((s, r) => s + (r.tds || 0), 0))}</td><td class="num">${money2(rows.reduce((s, r) => s + r.amount, 0))}</td></tr>`,
    add: { label: 'Record payment', onClick: (reload) => paymentModal(null, defaults, reload) }, onRow: null,
    actions: {}, empty: { title: 'No payments recorded', text: 'Record money received from clients.' },
    toolbarExtra: query.client_id || query.invoice_id || query.project_id ? '' : '<a class="btn" href="/api/payments/export.csv">' + icon('download') + ' CSV</a>',
  });
  root.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (!tr || e.target.closest('a,button')) return; GET('/payments/' + tr.dataset.id).then((r) => paymentModal(r, null, () => Router.refresh())).catch(fail); });
}
function expensesTable(root, query, defaults) {
  mountList(root, {
    resource: 'expenses', query, searchPlaceholder: 'Search expenses…', defaultSort: { key: 'date', dir: 'desc' },
    filters: query.project_id ? [] : [{ key: 'category', label: 'Category', options: OPT.expenseCategory }, { key: 'status', label: 'Status', options: [['paid', 'Paid'], ['pending', 'Pending']] }, { key: 'project_id', label: 'Project', lookup: 'projects' }, { key: 'paid_by_id', label: 'Paid by', lookup: 'users' }],
    columns: [{ key: 'date', label: 'Date', render: (r) => fdate(r.date) }, { key: 'category', label: 'Category', render: (r) => `<span class="chip">${esc(r.category || '—')}</span>` },
      { key: 'vendor', label: 'Paid to', render: (r) => `<b>${esc(r.vendor || '—')}</b><div class="small muted">${esc(r.description || '')}</div>` }, ...(query.project_id ? [] : [{ key: 'project_name', label: 'Project', render: (r) => esc(r.project_name || '—') }]),
      { key: 'account_name', label: 'From', render: (r) => (r.paid_by_name ? `<span class="badge b-amber">Paid by ${esc(r.paid_by_name)}</span>` : esc(r.account_name || '—')) }, { key: 'status', label: 'Status', render: (r) => badge(r.status) }, { key: 'amount', label: 'Amount', num: true, render: (r) => `<b>${money2(r.amount)}</b>` }],
    footer: (rows) => `<tr><td colspan="${query.project_id ? 5 : 6}">Total</td><td class="num">${money2(rows.reduce((s, r) => s + r.amount, 0))}</td></tr>`,
    add: { label: 'Add expense', onClick: (reload) => editRecord('expenses', null, defaults, reload, { label: 'expense' }) },
    onRow: (r) => editRecord('expenses', r, null, () => Router.refresh(), { label: 'expense' }), empty: { title: 'No expenses', text: 'Log salaries, tools, hosting, rent — everything the company spends.' },
    toolbarExtra: query.project_id ? '' : '<a class="btn" href="/api/expenses/export.csv">' + icon('download') + ' CSV</a>',
  });
}

function fyRange(offset = 0) {
  const startM = Number(App.lookups.settings.fy_start_month || 4); const n = new Date(); let y = n.getFullYear(); if (n.getMonth() + 1 < startM) y -= 1; y += offset;
  const from = `${y}-${String(startM).padStart(2, '0')}-01`; const e = new Date(y + 1, startM - 1, 0);
  return [from, `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`];
}
const RANGES = {
  month: () => { const n = new Date(); return [todayStr().slice(0, 8) + '01', `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()).padStart(2, '0')}`]; },
  lastmonth: () => { const n = new Date(); const a = new Date(n.getFullYear(), n.getMonth() - 1, 1), b = new Date(n.getFullYear(), n.getMonth(), 0); const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return [f(a), f(b)]; },
  quarter: () => { const n = new Date(); const q = Math.floor(n.getMonth() / 3) * 3; const a = new Date(n.getFullYear(), q, 1), b = new Date(n.getFullYear(), q + 3, 0); const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return [f(a), f(b)]; },
  fy: () => fyRange(0), lastfy: () => fyRange(-1), last12: () => [addDaysStr(todayStr(), -365), todayStr()],
};
function trendChart(trend) {
  const lbl = trend.map((t) => new Date(t.month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' }));
  return lineChart([{ name: 'Collected', values: trend.map((t) => t.income), color: 'var(--accent)', fill: true }, { name: 'Spent', values: trend.map((t) => t.expense), color: '#c47f17', dash: true }], { labels: lbl, h: 220 });
}
const barRows = (rows, fmt = money) => { const max = Math.max(1, ...rows.map((r) => r.v)); return rows.length ? `<div class="hbars">${rows.map((r) => `<div class="r"><span title="${esc(r.k)}">${esc(r.k)}</span><div class="tr"><i style="width:${Math.max(2, 100 * r.v / max)}%"></i></div><span class="right tnum">${fmt(r.v)}</span></div>`).join('')}</div>` : '<div class="faint small">No data for this period.</div>'; };

route('/finance', async ({ el, query }) => {
  const tab = query.tab || 'overview';
  const tabs = [{ key: 'overview', label: 'Overview' }, { key: 'payments', label: 'Payments received' }, { key: 'expenses', label: 'Expenses' }, { key: 'accounts', label: 'Accounts & founders' }];
  el.innerHTML = pageHead('Finance', 'Money in, money out, and what is left.') + tabsHtml(tabs, tab, '#/finance') + '<div id="tab"></div>'; const t = $('#tab', el);
  if (tab === 'payments') return paymentsTable(t, {}, {});
  if (tab === 'expenses') return expensesTable(t, {}, {});
  if (tab === 'accounts') {
    const sum = await GET('/finance/summary');
    t.innerHTML = `<div class="kpis">${kpi('Total cash', money(sum.cash), `${sum.accounts.length} accounts`)}${kpi('Company owes founders', money(sum.founders.reduce((s, f) => s + f.company_owes, 0)), 'Paid personally, not yet reimbursed')}${kpi('Pending expenses', money(sum.pending_expenses.v), `${sum.pending_expenses.n} bills to pay`)}</div>
      <div class="stack"><div><div class="section-h"><h2>Bank & cash accounts</h2></div><div id="acc"></div></div>
      <div class="card"><div class="card-h"><h2>Founders’ ledger</h2></div><div class="table-wrap"><table class="t"><thead><tr><th>Founder</th><th class="num">Capital put in</th><th class="num">Withdrawals</th><th class="num">Paid personally for company</th><th class="num">Reimbursed</th><th class="num">Company owes</th></tr></thead><tbody>
        ${sum.founders.map((f) => `<tr><td>${avatar(f.name, 'sm')} ${esc(f.name)}</td><td class="num">${money(f.capital)}</td><td class="num">${money(f.withdrawals)}</td><td class="num">${money(f.paid_personally)}</td><td class="num">${money(f.reimbursed)}</td><td class="num"><b class="${f.company_owes > 0 ? 'warn' : ''}">${money(f.company_owes)}</b></td></tr>`).join('')}</tbody></table></div></div>
      <div><div class="section-h"><h2>Capital, withdrawals & tax payments</h2></div><div id="trf"></div></div></div>`;
    mountList($('#acc', t), { resource: 'accounts', search: false, add: { label: 'Add account', onClick: (r) => editRecord('accounts', null, { active: 1 }, r, { label: 'account' }) },
      columns: [{ key: 'name', label: 'Account', render: (r) => `<b>${esc(r.name)}</b> ${r.active ? '' : '<span class="badge">Inactive</span>'}` }, { key: 'type', label: 'Type', render: (r) => pretty(r.type) }, { key: 'opening_balance', label: 'Opening', num: true, render: (r) => money2(r.opening_balance) }, { key: 'balance', label: 'Balance now', num: true, render: (r) => `<b>${money2(r.balance)}</b>` }],
      onRow: (r) => editRecord('accounts', r, null, () => Router.refresh(), { label: 'account' }), empty: { title: 'No accounts yet', text: 'Add your bank account(s) and cash so balances are tracked.' } });
    mountList($('#trf', t), { resource: 'transfers', search: false, add: { label: 'Add entry', onClick: (r) => editRecord('transfers', null, null, r, { label: 'entry' }) }, filters: [{ key: 'kind', label: 'Type', options: OPT.transferKind }, { key: 'user_id', label: 'Founder', lookup: 'users' }],
      columns: [{ key: 'date', label: 'Date', render: (r) => fdate(r.date) }, { key: 'kind', label: 'Type', render: (r) => pretty((OPT.transferKind.find((k) => k[0] === r.kind) || [0, r.kind])[1]) }, { key: 'user_name', label: 'Founder', render: (r) => esc(r.user_name || '—') },
        { key: 'account_name', label: 'Account', render: (r) => esc(r.account_name || '—') + (r.to_account_name ? ' → ' + esc(r.to_account_name) : '') }, { key: 'notes', label: 'Notes', render: (r) => esc(r.notes || '') }, { key: 'amount', label: 'Amount', num: true, render: (r) => `<b>${money2(r.amount)}</b>` }],
      onRow: (r) => editRecord('transfers', r, null, () => Router.refresh(), { label: 'entry' }), empty: { title: 'Nothing recorded', text: 'Record founder capital, withdrawals and tax payments here.' } });
    return;
  }
  // overview
  const preset = query.range || 'fy'; const [from, to] = query.from && query.to ? [query.from, query.to] : RANGES[preset]();
  const sum = await GET('/finance/summary' + qs({ from, to }));
  const rcv = sum.income.cash + sum.income.tds;
  t.innerHTML = `<div class="toolbar"><select id="rg" style="width:auto">${[['month', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This quarter'], ['fy', 'This financial year'], ['lastfy', 'Last financial year'], ['last12', 'Last 12 months'], ['custom', 'Custom…']].map(([v, l]) => `<option value="${v}" ${(query.from ? 'custom' : preset) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input type="date" id="rf" value="${from}" style="width:auto"> <span class="muted">to</span> <input type="date" id="rt" value="${to}" style="width:auto"> <button class="btn" id="rgo">Apply</button><span class="grow"></span><span class="muted small">${fdate(from)} – ${fdate(to)}</span></div>
    <div class="kpis">${kpi('Received', money(rcv), `${sum.income.n} payments${sum.income.tds ? ` · incl. TDS ${money(sum.income.tds)}` : ''}`)}${kpi('Spent', money(sum.expenses.v), `${sum.expenses.n} expenses`)}${kpi('Profit', money(sum.profit), 'Received − spent', sum.profit < 0 ? 'bad' : 'good')}
      ${kpi('Invoiced', money(sum.invoiced.total), `${sum.invoiced.n} invoices`)}${kpi('Still to collect', money(sum.receivables), 'All unpaid invoices')}${kpi('Cash now', money(sum.cash), 'All accounts')}${kpi('Monthly recurring', money(sum.mrr), 'Active maintenance plans')}</div>
    <div class="grid g-main"><div class="stack"><div class="card"><div class="card-h"><h2>Collected vs spent · last 12 months</h2><div class="legend"><span style="--c:var(--accent)">Collected</span><span style="--c:#c47f17">Spent</span></div></div><div class="card-b">${trendChart(sum.trend)}</div></div>
      <div class="card"><div class="card-h"><h2>Project profitability</h2><span class="muted small">All time</span></div><div class="table-wrap"><table class="t"><thead><tr><th>Project</th><th class="num">Invoiced</th><th class="num">Received</th><th class="num">Expenses</th><th class="num">Profit</th></tr></thead><tbody>
        ${sum.projects.filter((p) => p.invoiced || p.received || p.cost).map((p) => `<tr class="click"><td><a href="#/projects/${p.id}"><b>${esc(p.name)}</b></a><div class="small muted">${esc(p.client_name || '')}</div></td><td class="num">${money(p.invoiced)}</td><td class="num">${money(p.received)}</td><td class="num">${money(p.cost)}</td><td class="num"><b class="${p.received - p.cost < 0 ? 'warn' : ''}">${money(p.received - p.cost)}</b></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No project money yet.</td></tr>'}</tbody></table></div></div></div>
    <div class="stack"><div class="card"><div class="card-h"><h2>Unpaid invoices by age</h2></div><div class="card-b">${barRows([{ k: 'Not yet due', v: sum.aging.current }, { k: '1–30 days late', v: sum.aging.d30 }, { k: '31–60 days late', v: sum.aging.d60 }, { k: '61–90 days late', v: sum.aging.d90 }, { k: '90+ days late', v: sum.aging.d90p }])}</div></div>
      <div class="card"><div class="card-h"><h2>Spending by category</h2></div><div class="card-b">${barRows(sum.expense_by_category)}</div></div>
      <div class="card"><div class="card-h"><h2>Top clients (received)</h2></div><div class="card-b">${barRows(sum.income_by_client)}</div></div>
      <div class="card"><div class="card-h"><h2>GST position</h2></div><div class="card-b"><dl class="kv" style="grid-template-columns:1fr auto"><dt>GST charged on invoices</dt><dd class="right">${money(sum.gst.output)}</dd><dt>GST paid on expenses</dt><dd class="right">${money(sum.gst.input)}</dd><dt><b>Net GST payable</b></dt><dd class="right"><b>${money(sum.gst.net)}</b></dd></dl><div class="hint">Estimate from invoices issued and expenses logged in this period. Confirm with your CA.</div></div></div>
      <div class="card"><div class="card-h"><h2>Renewals in next 60 days</h2></div><div class="card-b"><b>${sum.renewals_60d.n}</b> items · we pay <b>${money(sum.renewals_60d.cost)}</b> · billable to clients <b>${money(sum.renewals_60d.price)}</b></div></div></div></div>`;
  const go = () => { location.hash = `#/finance?from=${$('#rf', t).value}&to=${$('#rt', t).value}`; };
  $('#rg', t).addEventListener('change', (e) => { if (e.target.value !== 'custom') location.hash = '#/finance?range=' + e.target.value; });
  $('#rgo', t).addEventListener('click', go);
}, { title: 'Finance', founder: true });

/* =====================================================  RENEWALS  ===================================================== */
const renewalKindLabel = (k) => (OPT.renewalKind.find((x) => x[0] === k) || [k, pretty(k)])[1];
function renewalsTable(root, query, defaults, { full } = {}) {
  mountList(root, {
    resource: 'renewals', query, searchPlaceholder: 'Search renewals…', defaultSort: { key: 'renewal_date', dir: 'asc' },
    filters: full ? [{ key: 'kind', label: 'Kind', options: OPT.renewalKind }, { key: 'status', label: 'Status', options: [['active', 'Active'], ['lapsed', 'Lapsed'], ['cancelled', 'Cancelled']] }, { key: 'client_id', label: 'Client', lookup: 'clients' }] : [],
    columns: [{ key: 'name', label: 'Item', render: (r) => `<b>${esc(r.name)}</b><div class="small muted">${esc(renewalKindLabel(r.kind))}${r.vendor ? ' · ' + esc(r.vendor) : ''}</div>` }, ...(query.client_id ? [] : [{ key: 'client_name', label: 'Client', render: (r) => esc(r.client_name || '—') }]),
      { key: 'renewal_date', label: 'Renews / expires', render: (r) => (r.status !== 'active' ? fdate(r.renewal_date) : `${dueBadge(r.renewal_date)}<div class="small muted">${r.renewal_date ? (daysUntil(r.renewal_date) < 0 ? -daysUntil(r.renewal_date) + ' days ago' : 'in ' + daysUntil(r.renewal_date) + ' days') : ''}</div>`) },
      { key: 'cycle', label: 'Cycle', render: (r) => pretty(r.cycle) + (r.auto_renew ? ' · auto' : '') },
      ...(isFounder() ? [{ key: 'our_cost', label: 'We pay', num: true, render: (r) => (r.our_cost ? money(r.our_cost) : '—') }, { key: 'client_price', label: 'Client pays', num: true, render: (r) => (r.client_price ? money(r.client_price) : '—') }] : []),
      { key: 'status', label: 'Status', render: (r) => badge(r.status) },
      ...(isFounder() ? [{ key: 'a', label: '', sortable: false, render: (r) => (r.status === 'active' && r.cycle !== 'one-time' ? '<button class="btn sm" data-act="renew" title="Mark as renewed and move the date forward">Mark renewed</button>' : '') }] : [])],
    add: isFounder() ? { label: 'Add renewal', onClick: (r) => editRecord('renewals', null, defaults, r, { label: 'renewal' }) } : null,
    onRow: isFounder() ? (r) => editRecord('renewals', r, null, () => Router.refresh(), { label: 'renewal' }) : null,
    actions: { renew: async (r, reload) => { try { const x = await POST(`/renewals/${r.id}/renew`); toast('Next renewal: ' + fdate(x.renewal_date)); reload(); } catch (e) { fail(e); } } },
    empty: { title: 'Nothing tracked yet', text: 'Add maintenance plans, domains, hosting, SSL and subscriptions so nothing expires unnoticed.' },
  });
}
route('/renewals', ({ el }) => { el.innerHTML = pageHead('Renewals & plans', 'Maintenance plans, domains, hosting, SSL and subscriptions — never miss a renewal.') + '<div id="body"></div>'; renewalsTable($('#body', el), {}, {}, { full: true }); }, { title: 'Renewals', founder: true });

/* =====================================================  MAINTENANCE  ===================================================== */
function logsTable(root, query, defaults) {
  mountList(root, { resource: 'maintenance_logs', query, searchPlaceholder: 'Search work log…', filters: [{ key: 'status', label: 'Status', options: [['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved']] }],
    columns: [{ key: 'title', label: 'Work item', render: (r) => `<b>${esc(r.title)}</b><div class="small muted">${esc(r.type || '')}${r.billable ? ' · billable' : ''}</div>` }, ...(query.client_id ? [] : [{ key: 'client_name', label: 'Client', render: (r) => `${esc(r.client_name || '—')}<div class="small muted">${esc(r.project_name || '')}</div>` }]),
      { key: 'priority', label: 'Priority', render: (r) => badge(r.priority) }, { key: 'status', label: 'Status', render: (r) => badge(r.status) }, { key: 'assignee_name', label: 'Assigned', render: (r) => esc(r.assignee_name || '—') },
      { key: 'reported_on', label: 'Reported', render: (r) => fdate(r.reported_on) }, { key: 'hours', label: 'Hours', num: true, render: (r) => r.hours || '—' }],
    add: { label: 'Log work', onClick: (r) => editRecord('maintenance_logs', null, { assignee_id: App.user.id, ...defaults }, r, { label: 'work item' }) },
    onRow: (r) => editRecord('maintenance_logs', r, null, () => Router.refresh(), { label: 'work item', canDelete: isFounder() }), empty: { title: 'Nothing logged', text: 'Log fixes, updates and support requests so you have a history per client.' } });
}
route('/maintenance', ({ el }) => {
  el.innerHTML = pageHead('Maintenance & support', `Fixes, updates and support requests for live clients.${isFounder() ? ' Paid plans live under <a class="ln" href="#/renewals">Renewals & plans</a>.' : ''}`) + '<div id="body"></div>';
  logsTable($('#body', el), {}, {});
}, { title: 'Maintenance', needs: 'maintenance' });

/* =====================================================  DOCUMENTS  ===================================================== */
route('/documents', ({ el }) => {
  el.innerHTML = pageHead('Documents', 'Every contract, spec, design and file — searchable in one place.') + '<div id="body"></div>';
  const f = isFounder();
  mountList($('#body', el), { resource: 'documents', searchPlaceholder: 'Search documents…', filters: [{ key: 'category', label: 'Category', options: OPT.docCategory }, { key: 'entity_type', label: 'Linked to', options: f ? [['client', 'Client'], ['project', 'Project'], ['lead', 'Lead'], ['invoice', 'Invoice'], ['quote', 'Quotation'], ['task', 'Task'], ['general', 'General']] : [['project', 'Project'], ['task', 'Task']] }],
    columns: docColumns(true),
    add: { label: 'Upload document', onClick: (reload) => {
      const opts = f ? [['general', 'Company-wide (general)'], ['client', 'A client'], ['project', 'A project'], ['lead', 'A lead']] : [['project', 'A project']];
      formModal({ title: 'Attach to…', size: 'sm', submit: 'Next', fields: [{ name: 'target', label: 'This document belongs to', type: 'select', options: opts, required: true }, { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients' }, { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' }, { name: 'lead_id', label: 'Lead', type: 'select', lookup: 'leads' }],
        values: { target: opts[0][0] }, onSubmit: async (d) => { const id = d.target === 'client' ? d.client_id : d.target === 'project' ? d.project_id : d.target === 'lead' ? d.lead_id : null; if (d.target !== 'general' && !id) throw new Error('Choose which one it belongs to.'); setTimeout(() => uploadModal(d.target, id, reload), 50); } });
    } },
    actions: { edit: (r, reload) => { if (!(f || r.uploaded_by === App.user.id)) return toast('Only the uploader or a founder can edit this.', true); editRecord('documents', r, null, reload, { label: 'document', canDelete: true }); } },
    empty: { title: 'No documents yet', text: 'Upload contracts, specs, designs, KYC and more.' } });
}, { title: 'Documents' });

/* =====================================================  VAULT (credentials)  ===================================================== */
function credForm(rec, defaults, after) {
  const fields = [S('What it is'), { name: 'label', label: 'What is this for?', required: true, full: true, placeholder: 'e.g. cPanel — acmecorp.com' }, { name: 'kind', label: 'Kind', type: 'select', options: OPT.credKind },
    { name: 'client_id', label: 'Client', type: 'select', lookup: 'clients' }, { name: 'project_id', label: 'Project', type: 'select', lookup: 'projects' }, S('Login', 'Password and secret notes are encrypted before they are stored.'), { name: 'url', label: 'Login URL / host / IP', full: true }, { name: 'username', label: 'Username / email' },
    { name: 'password', label: 'Password', type: 'password', placeholder: rec && rec.has_password ? '(unchanged — type to replace)' : '' },
    { name: 'secret', label: 'Secret notes (encrypted)', type: 'textarea', full: true, rows: 3, placeholder: rec && rec.has_secret ? '(unchanged — type to replace)' : 'SSH keys, recovery codes, API secrets, security answers…' }, S('Other'), { name: 'notes', label: 'Other notes (not encrypted)', type: 'textarea', full: true, rows: 2, help: 'Port numbers, which plan, who to contact — never passwords here.' }];
  formModal({ title: rec ? 'Edit credential' : 'New credential', sub: rec ? rec.label : 'Stored encrypted. Only founders can see it, and every reveal is logged.', fields, values: rec || defaults || {}, size: 'wide', danger: rec ? { message: 'Delete this credential permanently?', fn: async () => { await DEL('/credentials/' + rec.id); toast('Deleted'); after(); } } : null,
    onSubmit: async (d) => { if (!d.client_id && !d.project_id) throw new Error('Link it to a client or a project.'); if (!d.password) delete d.password; if (!d.secret) delete d.secret; if (rec) await PUT('/credentials/' + rec.id, d); else await POST('/credentials', d); toast('Saved'); after(); } });
}
async function revealCred(r) {
  try {
    const x = await POST(`/credentials/${r.id}/reveal`);
    const m = openModal({ title: r.label, body: `<dl class="kv"><dt>Where</dt><dd>${r.url ? extLink(r.url) : '—'}</dd><dt>Username</dt><dd class="mono">${esc(r.username || '—')} ${r.username ? '<button class="btn sm" data-copy="u">Copy</button>' : ''}</dd>
      <dt>Password</dt><dd class="mono">${x.password ? `<span id="pw">••••••••••</span> <button class="btn sm" id="pwshow">Show</button> <button class="btn sm" data-copy="p">Copy</button>` : '—'}</dd>${x.secret ? `<dt>Secret notes</dt><dd class="pre mono">${esc(x.secret)}</dd>` : ''}<dt>Notes</dt><dd class="pre">${esc(r.notes || '—')}</dd></dl>
      <p class="hint">This view was logged. It closes itself after 60 seconds.</p>` });
    const tm = setTimeout(() => m.close(), 60000); m.el.addEventListener('remove', () => clearTimeout(tm));
    delegate(m.el, '[data-copy]', 'click', (b) => copyText(b.dataset.copy === 'u' ? r.username : x.password));
    const sh = $('#pwshow', m.el); if (sh) sh.addEventListener('click', () => { const pw = $('#pw', m.el); const on = sh.textContent === 'Show'; pw.textContent = on ? x.password : '••••••••••'; sh.textContent = on ? 'Hide' : 'Show'; });
  } catch (e) { fail(e); }
}
function credentialsPanel(root, query) {
  mountList(root, { resource: 'credentials', rows: () => GET('/credentials' + qs(query)), searchPlaceholder: 'Search credentials…', filters: query.client_id || query.project_id ? [] : [{ key: 'kind', label: 'Kind', options: OPT.credKind }],
    searchText: (r) => [r.label, r.kind, r.client_name, r.project_name, r.url, r.username].join(' '),
    columns: [{ key: 'label', label: 'Credential', render: (r) => `<div class="who"><span class="logo-sq sm" style="--a-bg:#f1f0ec;--a-fg:#5b574e">${icon('key')}</span><div style="min-width:0"><div class="t1 ellipsis">${esc(r.label)}</div><div class="t2">${esc(r.kind || '')}</div></div></div>` },
      ...(query.client_id || query.project_id ? [] : [{ key: 'client_name', label: 'Belongs to', render: (r) => `${esc(r.client_name || '—')}<div class="t2">${esc(r.project_name || '')}</div>` }]),
      { key: 'url', label: 'Where', render: (r) => (r.url ? extLink(r.url) : '<span class="faint">—</span>') },
      { key: 'username', label: 'Username', render: (r) => (r.username ? `<span class="mono">${esc(r.username)}</span> <button class="btn ghost sm icon" data-act="cu" title="Copy username">${icon('copy')}</button>` : '<span class="faint">—</span>') },
      { key: 'a', label: '', sortable: false, cls: 'nowrap right', render: (r) => `${r.has_password || r.has_secret ? `<button class="btn sm" data-act="show">${icon('eye')}Reveal</button> ` : ''}${r.has_password ? `<button class="btn sm" data-act="cp">${icon('copy')}Password</button> ` : ''}<button class="btn sm ghost icon" data-act="edit" title="Edit">${icon('edit')}</button>` }],
    add: { label: 'Add credential', onClick: (reload) => credForm(null, { client_id: query.client_id || '', project_id: query.project_id || '' }, reload) },
    actions: { show: (r) => revealCred(r), edit: (r, reload) => credForm(r, null, reload), cu: (r) => copyText(r.username),
      cp: async (r) => { try { const x = await POST(`/credentials/${r.id}/reveal`); await copyText(x.password); } catch (e) { fail(e); } } },
    empty: { title: 'No credentials stored', text: 'Hosting, servers, databases, domain logins — stored encrypted, visible to founders only.' },
    toolbarExtra: '<span class="muted small row">' + icon('shield') + 'Encrypted · founders only · reveals are logged</span>' });
}
route('/vault', ({ el }) => { el.innerHTML = pageHead('Credentials vault', 'Client servers, hosting, domains and logins — encrypted at rest.') + '<div id="body"></div>'; credentialsPanel($('#body', el), {}); }, { title: 'Credentials', founder: true });

/* =====================================================  TEAM  ===================================================== */
const FLAG_LABELS = { leads: ['Leads', 'View, add and update leads'], clients: ['All clients & contacts', 'View every client (read-only)'], all_projects: ['All projects', 'See every project, not just assigned ones'], maintenance: ['Maintenance', 'Support work log for every client'] };
function genPassword() { const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const a = new Uint32Array(12); crypto.getRandomValues(a); return [...a].map((x) => c[x % c.length]).join('') + '7'; }
function userModal(u, after) {
  const isNew = !u;
  const m = formModal({ title: isNew ? 'Add team member' : `Edit ${u.name}`, size: 'wide', rules: 'users', submit: isNew ? 'Create account' : 'Save', sub: isNew ? 'They sign in with their email and a temporary password you share.' : u.email,
    fields: [S('Person'), { name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Email (login)', type: 'email', required: true }, { name: 'title', label: 'Title', placeholder: 'e.g. Co-founder, Design intern' }, { name: 'phone', label: 'Phone', type: 'tel' },
      S('Sign-in & role'), { name: 'role', label: 'Role', type: 'select', options: [['founder', 'Founder — full access to everything'], ['intern', 'Intern — limited access']], required: true, default: 'intern' },
      ...(isNew ? [{ name: 'password', label: 'Temporary password', required: true, type: 'text', default: genPassword(), help: 'They must change it on first login. Share it privately.' }] : [{ name: 'password', label: 'Reset password (optional)', type: 'text', help: 'Leave empty to keep the current one. Resetting signs them out.' }, { name: 'active', label: 'Account active', type: 'checkbox', default: 1 },
        ...(u.two_factor ? [{ name: 'reset_2fa', label: 'Turn off their two-step login (lost phone)', type: 'checkbox' }] : [])])],
    values: u ? { ...u, password: '', active: u.active ? 1 : 0 } : {},
    extra: `<div id="flags"><div class="fsec sep"><b>Extra access for interns</b></div><p class="muted small" style="margin:-4px 0 12px">Interns always get: their own tasks, projects they are assigned to, and those projects’ files. Tick anything else they need. Finance, invoices, quotations, credentials and team settings are never available to interns.</p>
      <div class="form-grid">${Object.entries(FLAG_LABELS).map(([k, [l, h]]) => `<label class="check"><input type="checkbox" data-flag="${k}" ${u && u.modules.includes(k) ? 'checked' : ''}><span>${l}<div class="hint">${h}</div></span></label>`).join('')}</div></div>`,
    onSubmit: async (d) => {
      const body = { name: d.name, email: d.email, title: d.title, phone: d.phone, role: d.role, modules: $$('[data-flag]:checked', m.el).map((c) => c.dataset.flag) };
      if (d.password) body.password = d.password; if (!isNew) body.active = d.active; if (d.reset_2fa) body.reset_2fa = true;
      if (isNew) await POST('/users', body); else await PUT('/users/' + u.id, body);
      await refreshLookups(); toast(isNew ? 'Account created — share the temporary password privately' : 'Saved'); after();
    } });
  const sync = () => { $('#flags', m.el).style.display = $('[name="role"]', m.el).value === 'intern' ? '' : 'none'; };
  $('[name="role"]', m.el).addEventListener('change', sync); sync();
}
route('/team', ({ el, query }) => {
  const tab = query.tab || 'people';
  el.innerHTML = pageHead('Team & access', 'Founders see everything. Interns see only what you allow.', tab === 'people' ? `<button class="btn primary" id="add">${icon('plus')} Add team member</button>` : '')
    + tabsHtml([{ key: 'people', label: 'People' }, { key: 'activity', label: 'Activity log' }], tab, '#/team') + '<div id="body"></div>';
  if (tab === 'activity') return activityLog($('#body', el));
  $('#body', el).insertAdjacentHTML('beforebegin', `<div class="card" style="margin-bottom:16px"><div class="card-b small"><b>How access works.</b> <span class="badge b-primary">Founder</span> full access — leads, clients, finance, invoices, credentials, team, settings. <span class="badge">Intern</span> sees only their assigned tasks and the projects (with files, tasks, timeline) they are added to; founders can switch on extra areas per person below. Interns never see money or credentials. Turn on two-step login for every founder — it protects the credentials vault.</div></div>`);
  $('#add', el).addEventListener('click', () => userModal(null, () => Router.refresh()));
  mountList($('#body', el), { resource: 'users', rows: () => GET('/users'), search: false,
    columns: [{ key: 'name', label: 'Person', render: (r) => `${avatar(r.name)} <b>${esc(r.name)}</b>${r.id === App.user.id ? ' <span class="badge">You</span>' : ''}<div class="small muted">${esc(r.title || '')}</div>` }, { key: 'email', label: 'Login', render: (r) => esc(r.email) },
      { key: 'role', label: 'Role', render: (r) => (r.role === 'founder' ? '<span class="badge b-primary">Founder</span>' : '<span class="badge">Intern</span>') },
      { key: 'modules', label: 'Extra access', sortable: false, render: (r) => (r.role === 'founder' ? '<span class="muted">Everything</span>' : r.modules.length ? r.modules.map((m) => `<span class="chip">${esc((FLAG_LABELS[m] || [m])[0])}</span>`).join(' ') : '<span class="muted">Standard</span>') },
      { key: 'two_factor', label: 'Two-step login', render: (r) => (r.two_factor ? badge('active', 'On') : `<span class="${r.role === 'founder' ? 'warn' : 'muted'}">Off</span>`) },
      { key: 'last_login', label: 'Last login', render: (r) => (r.last_login ? ago(r.last_login) : 'Never') }, { key: 'active', label: 'Status', render: (r) => (r.active ? badge('active') : badge('ended', 'Deactivated')) }],
    onRow: (r) => userModal(r, () => Router.refresh()) });
}, { title: 'Team', founder: true });

/* =====================================================  SETTINGS  ===================================================== */
route('/settings', async ({ el }) => {
  const s = await GET('/settings');
  const F = (name, label, o = {}) => fieldHtml({ name, label, rule: RULES.kindFor('settings', name) || undefined, ...o }, s[name]);
  el.innerHTML = pageHead('Settings', 'Company profile used on invoices and quotations.') + `<div class="stack"><div class="card"><div class="card-h"><h2>Company</h2></div><div class="card-b"><form id="sf" class="stack"><div class="form-grid">
    ${F('company_name', 'Company name')}${F('company_website', 'Website')}${F('company_address', 'Address', { type: 'textarea', full: true, rows: 2 })}${F('company_email', 'Email', { type: 'email' })}${F('company_phone', 'Phone')}${F('gstin', 'GSTIN')}${F('pan', 'PAN')}${F('state', 'State')}
    <div class="full"><span class="muted small" style="font-weight:600">Logo (PNG/JPG, under 600 KB)</span><div class="row" style="margin-top:4px"><img id="logo-prev" src="${s.logo || ''}" alt="" style="max-height:48px;${s.logo ? '' : 'display:none'}"><input type="file" id="logo" aria-label="Upload logo" accept="image/png,image/jpeg,image/webp" style="width:auto"><button type="button" class="btn sm" id="logo-rm">Remove</button></div></div></div>
    <h3>Bank details (printed on invoices)</h3><div class="form-grid">${F('bank_account_name', 'Account holder')}${F('bank_name', 'Bank & branch')}${F('bank_account_no', 'Account number')}${F('bank_ifsc', 'IFSC')}${F('upi_id', 'UPI ID')}</div>
    <h3>Numbering, tax & terms</h3><div class="form-grid">${F('invoice_prefix', 'Invoice prefix')}${F('quote_prefix', 'Quotation prefix')}${F('default_tax_rate', 'Default tax rate %', { type: 'number' })}${F('default_tax_type', 'Default tax type', { type: 'select', options: OPT.taxType, required: true })}
    ${F('fy_start_month', 'Financial year starts in', { type: 'select', required: true, options: [['4', 'April (India)'], ['1', 'January'], ['7', 'July'], ['10', 'October']] })}${F('terms_invoice', 'Default invoice terms', { type: 'textarea', full: true, rows: 3 })}${F('terms_quote', 'Default quotation terms', { type: 'textarea', full: true, rows: 3 })}</div>
    <div><button class="btn primary" type="submit">Save settings</button></div></form></div></div>
    <div class="grid g2"><div class="card"><div class="card-h"><h2>Backup & export</h2></div><div class="card-b stack"><p class="muted" style="margin:0">The system saves an automatic copy of the database every day (last 14 kept in <span class="mono">data/backups</span>). Also copy the whole <span class="mono">data</span> folder to a safe place regularly — it holds your files and the encryption key for the vault.</p>
      <div class="row wrap"><a class="btn primary" href="/api/backup">${icon('download')} Download database backup</a><a class="btn" href="/api/leads/export.csv">Leads CSV</a><a class="btn" href="/api/clients/export.csv">Clients CSV</a><a class="btn" href="/api/invoices/export.csv">Invoices CSV</a><a class="btn" href="/api/payments/export.csv">Payments CSV</a><a class="btn" href="/api/expenses/export.csv">Expenses CSV</a></div></div></div>
    <div class="card"><div class="card-h"><h2>Move from Excel</h2></div><div class="card-b stack"><p class="muted" style="margin:0">Bring your existing lead list or client list across in one go. Works with .xlsx and .csv; rows already in the CRM are skipped, so it is safe to run again.</p>
      <div class="row wrap"><button class="btn primary" id="imp-leads" type="button">${icon('upload')}Import leads</button><button class="btn" id="imp-clients" type="button">${icon('upload')}Import clients</button></div></div></div>
    </div></div>`;
  $('#imp-leads', el).addEventListener('click', () => importModal('leads'));
  $('#imp-clients', el).addEventListener('click', () => importModal('clients'));
  let logo = s.logo || '';
  $('#logo', el).addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 600000) { e.target.value = ''; return toast('Logo is larger than 600 KB.', true); } const r = new FileReader(); r.onload = () => { logo = r.result; $('#logo-prev', el).src = logo; $('#logo-prev', el).style.display = ''; }; r.readAsDataURL(f); });
  $('#logo-rm', el).addEventListener('click', () => { logo = ''; $('#logo-prev', el).style.display = 'none'; });
  $('#sf', el).addEventListener('submit', async (e) => { e.preventDefault(); const bad = $$('#sf [data-rule]', el).map((n) => ({ n, m: fieldProblem(n) })).filter((x) => x.m); $$('#sf [data-rule]', el).forEach((n) => fieldError(n, fieldProblem(n))); if (bad.length) { bad[0].n.focus(); return toast(bad.length === 1 ? bad[0].m : `Please fix ${bad.length} fields before saving.`, true); } const d = {}; $$('[name]', $('#sf', el)).forEach((n) => { d[n.name] = n.value; }); d.logo = logo; try { await PUT('/settings', d); await refreshLookups(); toast('Settings saved'); Shell.refreshBrand(); } catch (err) { fail(err); } });
}, { title: 'Settings', founder: true });

/* =====================================================  ACTIVITY LOG (tab on Team)  ===================================================== */
function activityLog(root) {
  const watch = ['vault_reveal', 'delete', 'login_failed', 'export', 'backup', '2fa_off', '2fa_reset', 'password_reset'];
  mountList(root, { resource: 'audit', rows: () => GET('/audit?limit=800'), searchPlaceholder: 'Search the log…',
    filters: [{ key: 'user_name', label: 'Person', options: App.lookups.users.map((u) => u.name) }, { key: 'action', label: 'Action', options: ['create', 'update', 'delete', 'login', 'login_failed', 'vault_reveal', 'upload', 'download', 'convert', 'export', 'backup', 'password_change', 'password_reset', '2fa_on', '2fa_off', '2fa_reset'] }],
    columns: [{ key: 'at', label: 'When', render: (r) => `<span title="${esc(r.at)}">${fdt(r.at)}</span>`, cls: 'nowrap' }, { key: 'user_name', label: 'Who', render: (r) => esc(r.user_name || '—') },
      { key: 'action', label: 'Action', render: (r) => `<span class="badge ${watch.includes(r.action) ? 'b-amber' : ''}">${esc(r.action.replace(/_/g, ' '))}</span>` },
      { key: 'entity', label: 'On', render: (r) => esc((r.entity || '').replace(/_/g, ' ')) }, { key: 'detail', label: 'Detail', render: (r) => esc(r.detail || '') }, { key: 'ip', label: 'IP', render: (r) => `<span class="muted small">${esc(r.ip || '')}</span>` }],
    pageSize: 100 });
}
route('/activity', () => { location.replace('#/team?tab=activity'); }, { title: 'Activity', founder: true });

/* =====================================================  CALENDAR  ===================================================== */
route('/calendar', async ({ el, query }) => {
  const now = new Date(); const ym = query.m || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; const [Y, M] = ym.split('-').map(Number);
  const first = new Date(Y, M - 1, 1); const startOffset = (first.getDay() + 6) % 7; const gridStart = new Date(Y, M - 1, 1 - startOffset);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const gridEnd = new Date(gridStart); gridEnd.setDate(gridEnd.getDate() + 41);
  const data = await GET('/calendar' + qs({ from: fmt(gridStart), to: fmt(gridEnd) })); const by = {};
  data.items.forEach((i) => (by[i.date] = by[i.date] || []).push(i));
  const prev = new Date(Y, M - 2, 1), next = new Date(Y, M, 1); const ymf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  let cells = ''; for (let i = 0; i < 42; i++) { const d = new Date(gridStart); d.setDate(d.getDate() + i); const k = fmt(d); const items = by[k] || [];
    cells += `<div class="cal-d ${d.getMonth() !== M - 1 ? 'out' : ''} ${k === todayStr() ? 'today' : ''}" data-d="${k}"><span class="n">${d.getDate()}</span>${items.slice(0, 3).map((x) => `<div class="ev c-${x.type}" title="${esc(x.title)}"><span>${esc(x.title.replace(/^(Task|Deadline|Renewal|Follow up|Invoice due|Quote expires): /, ''))}</span></div>`).join('')}${items.length > 3 ? `<div class="small faint" style="padding:1px 4px">+${items.length - 3} more</div>` : ''}</div>`; }
  const upcoming = data.items.filter((i) => i.date >= todayStr()).slice(0, 14);
  const monthName = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  el.innerHTML = pageHead('Calendar', '', `<a class="btn icon" href="#/calendar?m=${ymf(prev)}" title="Previous month">${icon('arrowL')}</a><a class="btn" href="#/calendar">Today</a><a class="btn icon" href="#/calendar?m=${ymf(next)}" title="Next month">${icon('arrowR')}</a>${isFounder() ? `<button class="btn primary" id="addev">${icon('plus')}Reminder</button>` : ''}`, '<b>Calendar</b>')
    + `<div class="pt"><div><h1>${monthName}</h1><div class="sub">Deadlines, due dates, renewals and follow-ups in one view.</div></div><div class="legend"><span class="c-project">Project deadline</span><span class="c-task">Task</span><span class="c-invoice">Invoice due</span><span class="c-renewal">Renewal / quote</span><span class="c-followup">Follow-up</span></div></div>
    <div class="grid g-main" style="grid-template-columns:minmax(0,1fr) 320px"><div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-h">${d}</div>`).join('')}${cells}</div>
    <section class="panel" id="cal-side" style="align-self:start"><div class="panel-h"><h2 id="side-t">Coming up</h2></div><div id="side-b">${agenda(upcoming)}</div></section></div>`;
  function agenda(items) { return items.length ? `<div class="list">${items.map((i) => `<${i.link ? `a href="${esc(i.link)}"` : `div data-ev="${i.event_id || ''}"`} class="li" style="align-items:flex-start"><span class="ev c-${i.type}" style="margin:3px 0 0;padding:0"></span><div class="grow"><div class="t" style="white-space:normal">${esc(i.title)}</div><div class="s">${esc(i.sub || '')}</div></div><span class="small muted nowrap">${fshort(i.date)}</span></${i.link ? 'a' : 'div'}>`).join('')}</div>` : emptyMini('Nothing scheduled.'); }
  delegate(el, '.cal-d', 'click', (c) => { $$('.cal-d.sel', el).forEach((x) => x.classList.remove('sel')); c.classList.add('sel'); const items = by[c.dataset.d] || []; $('#side-t', el).textContent = fdate(c.dataset.d); $('#side-b', el).innerHTML = agenda(items) + (isFounder() ? `<div style="padding:12px 16px;border-top:1px solid var(--line)"><button class="btn sm" data-add="${c.dataset.d}">${icon('plus')}Reminder on this day</button></div>` : ''); });
  delegate(el, '[data-add]', 'click', (b) => editRecord('events', null, { date: b.dataset.add, kind: 'Reminder' }, () => Router.refresh(), { label: 'reminder' }));
  const ae = $('#addev', el); if (ae) ae.addEventListener('click', () => editRecord('events', null, { date: todayStr(), kind: 'Reminder' }, () => Router.refresh(), { label: 'reminder' }));
  if (isFounder()) delegate(el, '[data-ev]', 'click', async (it) => { if (!it.dataset.ev) return; try { editRecord('events', await GET('/events/' + it.dataset.ev), null, () => Router.refresh(), { label: 'reminder' }); } catch (e) { fail(e); } });
}, { title: 'Calendar' });
