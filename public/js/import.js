/* Import leads / clients from Excel (.xlsx) or CSV.
   The file is read in the browser (no upload of the raw sheet): pick file → check column matching → import. */
'use strict';

const IMPORT_COLS = {
  leads: [['name', 'Contact person'], ['company', 'Company'], ['email', 'Email'], ['phone', 'Phone'], ['city', 'City'], ['website', 'Website'], ['source', 'Came from'],
    ['service', 'Interested in'], ['value', 'Deal value'], ['stage', 'Stage'], ['next_followup', 'Next follow-up'], ['notes', 'Notes']],
  clients: [['company', 'Company name'], ['contact_name', 'Contact person'], ['contact_email', 'Contact email'], ['contact_phone', 'Contact phone'], ['industry', 'Industry'], ['website', 'Website'],
    ['gstin', 'GSTIN'], ['pan', 'PAN'], ['address', 'Address'], ['city', 'City'], ['state', 'State'], ['country', 'Country'], ['status', 'Status'], ['tags', 'Tags'], ['notes', 'Notes']],
};
// common heading spellings → field (headings are compared lower-case with spaces/punctuation removed)
const IMPORT_GUESS = {
  leads: { name: 'name', contactname: 'name', contactperson: 'name', person: 'name', leadname: 'name', fullname: 'name', company: 'company', companyname: 'company', organisation: 'company', organization: 'company', business: 'company',
    email: 'email', emailid: 'email', mail: 'email', phone: 'phone', mobile: 'phone', mobileno: 'phone', phoneno: 'phone', contact: 'phone', contactnumber: 'phone', whatsapp: 'phone', city: 'city', location: 'city', website: 'website', url: 'website',
    source: 'source', leadsource: 'source', service: 'service', requirement: 'service', interest: 'service', interestedin: 'service', value: 'value', budget: 'value', amount: 'value', dealvalue: 'value',
    stage: 'stage', status: 'stage', nextfollowup: 'next_followup', followupdate: 'next_followup', followup: 'next_followup', notes: 'notes', remarks: 'notes', comment: 'notes', comments: 'notes' },
  clients: { company: 'company', companyname: 'company', clientname: 'company', client: 'company', name: 'company', business: 'company', industry: 'industry', website: 'website', url: 'website', gstin: 'gstin', gst: 'gstin', gstno: 'gstin', pan: 'pan', panno: 'pan',
    address: 'address', billingaddress: 'address', city: 'city', state: 'state', country: 'country', status: 'status', tags: 'tags', notes: 'notes', remarks: 'notes',
    contactname: 'contact_name', contactperson: 'contact_name', contact: 'contact_name', email: 'contact_email', emailid: 'contact_email', contactemail: 'contact_email', phone: 'contact_phone', mobile: 'contact_phone', contactphone: 'contact_phone', contactnumber: 'contact_phone' },
};

/* ---------- file readers ---------- */
function parseCsvText(text) {
  text = text.replace(/^﻿/, '');
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
// minimal .xlsx reader: unzip with the browser's DecompressionStream; returns [{ name, rows }] for every tab (or only the first)
async function readXlsx(file) { return (await readWorkbook(new Uint8Array(await file.arrayBuffer()), { first: true }))[0].rows; }
async function readWorkbook(buf, { first = false } = {}) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65600); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This does not look like an Excel .xlsx file.');
  const entries = {}; let p = dv.getUint32(eocd + 16, true);
  for (let n = dv.getUint16(eocd + 10, true); n > 0; n--) {
    const nameLen = dv.getUint16(p + 28, true);
    entries[new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen))] = { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), at: dv.getUint32(p + 42, true) };
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  const read = async (name) => {
    const e = entries[name]; if (!e) return null;
    const start = e.at + 30 + dv.getUint16(e.at + 26, true) + dv.getUint16(e.at + 28, true); const data = buf.subarray(start, start + e.size);
    if (e.method === 0) return new TextDecoder().decode(data);
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const tags = (d, t) => [...d.getElementsByTagName(t)];
  const wb = xml(await read('xl/workbook.xml')); const rels = xml((await read('xl/_rels/workbook.xml.rels')) || '<r/>');
  const sheets = tags(wb, 'sheet').slice(0, first ? 1 : 60).map((sh) => ({ name: sh.getAttribute('name') || 'Sheet', rid: sh.getAttribute('r:id') }));
  if (!sheets.length) throw new Error('Could not find any sheet in this workbook.');
  const ss = await read('xl/sharedStrings.xml');
  const shared = ss ? tags(xml(ss), 'si').map((si) => tags(si, 't').map((t) => t.textContent).join('')) : [];
  // which cell styles are dates (so 45200 becomes 2023-09-30)
  const st = await read('xl/styles.xml'); const dateXf = new Set();
  if (st) {
    const sd = xml(st); const custom = {}; tags(sd, 'numFmt').forEach((f) => { custom[f.getAttribute('numFmtId')] = f.getAttribute('formatCode') || ''; });
    const xfs = tags(sd, 'cellXfs')[0]; if (xfs) [...xfs.children].forEach((xf, i) => { const id = Number(xf.getAttribute('numFmtId')); if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dy]/i.test((custom[id] || '').replace(/"[^"]*"|\[[^\]]*\]/g, ''))) dateXf.add(i); });
  }
  const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const serialDate = (v) => { const d = new Date(Math.round((Number(v) - 25569) * 86400000)); return isNaN(d) ? v : d.toISOString().slice(0, 10); };
  const out = [];
  for (const sh of sheets) {
    const target = (tags(rels, 'Relationship').find((r) => r.getAttribute('Id') === sh.rid)?.getAttribute('Target') || 'worksheets/sheet1.xml').replace(/^\/?(xl\/)?/, '');
    const sheetXml = await read('xl/' + target); if (!sheetXml) continue;
    out.push({ name: sh.name, rows: tags(xml(sheetXml), 'row').map((r) => {
    const cells = [];
    tags(r, 'c').forEach((c) => {
      const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let val = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? tags(c, 't').map((x) => x.textContent).join('') : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
      if (!t && v !== '' && dateXf.has(Number(c.getAttribute('s')))) val = serialDate(v);
      else if (!t && /^-?\d+\.\d{6,}$/.test(val)) val = String(Math.round(Number(val) * 100) / 100);    // tidy floating-point noise
      cells[colIdx(c.getAttribute('r') || '')] = val;
    });
    return Array.from(cells, (x) => x ?? '');
  }) });
  }
  if (!out.length) throw new Error('Could not read the sheets in this workbook.');
  return out;
}
async function readSheet(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'xls') throw new Error('Old .xls files are not supported. In Excel: File → Save As → Excel Workbook (.xlsx), then try again.');
  const rows = ext === 'xlsx' ? await readXlsx(file) : parseCsvText(await file.text());
  return rows.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
}

/* ---------- the import popup ---------- */
function importModal(kind, after) {
  const noun = kind === 'leads' ? 'leads' : 'clients';
  const cols = IMPORT_COLS[kind];
  const m = openModal({ title: `Import ${noun} from Excel`, sub: 'Your sheet is read in this browser. Nothing is saved until you press Import.', size: 'wide',
    body: `<div id="im-step1">${dropZone('im-file', 'Drop your Excel or CSV file here, or <u>choose one</u>', '.xlsx or .csv — first row must be the column headings', '.xlsx,.csv,text/csv')}
      <div class="im-help"><div><b>What gets imported</b><span>${cols.map((c) => c[1]).join(', ')}. Other columns are ignored.</span></div>
      <div><b>Safe to repeat</b><span>${kind === 'leads' ? 'Leads with an email, phone or name already in the CRM' : 'Companies already in the CRM'} are skipped, never duplicated.</span></div>
      <div><b>Need a starting point?</b><span><button class="btn sm" id="im-tpl" type="button">${icon('download')}Download a blank template</button></span></div></div></div>
      <div id="im-step2" class="hidden"></div><div id="im-err" class="callout err hidden" role="alert" style="margin-top:14px"></div>`,
    footer: '<button class="btn" data-close type="button">Cancel</button><button class="btn primary" id="im-go" type="button" disabled>Import</button>' });
  const err = $('#im-err', m.el), go = $('#im-go', m.el), step2 = $('#im-step2', m.el);
  let rows = [], header = [], map = [];
  const showErr = (msg) => { err.textContent = msg; err.classList.toggle('hidden', !msg); };
  $('#im-tpl', m.el).addEventListener('click', () => csvDownload(`${noun}-template.csv`, [cols.map((c) => c[1])]));
  const guess = (h) => IMPORT_GUESS[kind][String(h).toLowerCase().replace(/[^a-z0-9]/g, '')] || '';
  function drawMapping() {
    const used = map.filter(Boolean);
    const required = kind === 'leads' ? (used.includes('name') || used.includes('company')) : used.includes('company');
    const ok = required && rows.length;
    step2.innerHTML = `<div class="im-file"><span class="logo-sq sm" style="--a-bg:var(--accent-soft);--a-fg:var(--accent)">${icon('file')}</span><div class="grow"><b>${esc($('#im-file', m.el).files[0].name)}</b><div class="small muted">${plural(rows.length, 'row')} found · check where each column goes</div></div><button class="btn sm" id="im-change" type="button">Choose another file</button></div>
      <div class="tbl im-map"><table class="t"><thead><tr><th>Column in your file</th><th>Example</th><th style="width:220px">Goes into</th></tr></thead><tbody>
      ${header.map((h, i) => `<tr class="${map[i] ? '' : 'off'}"><td><b>${esc(h || `Column ${i + 1}`)}</b></td><td class="muted ellipsis" style="max-width:260px">${esc(rows.find((r) => r[i])?.[i] || '—')}</td>
        <td><select data-col="${i}"><option value="">Don’t import</option>${cols.map(([k, l]) => `<option value="${k}" ${map[i] === k ? 'selected' : ''} ${map[i] !== k && used.includes(k) ? 'disabled' : ''}>${esc(l)}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>
      ${required ? '' : `<div class="callout warn" style="margin-top:12px">Match at least one column to <b>${kind === 'leads' ? 'Contact person or Company' : 'Company name'}</b>.</div>`}`;
    go.disabled = !ok; go.textContent = ok ? `Import ${plural(rows.length, noun.slice(0, -1))}` : 'Import';
    $$('select[data-col]', step2).forEach((s) => s.addEventListener('change', () => { map[Number(s.dataset.col)] = s.value; drawMapping(); }));
    $('#im-change', step2).addEventListener('click', () => { step2.classList.add('hidden'); $('#im-step1', m.el).classList.remove('hidden'); $('#im-file', m.el).click(); });
  }
  wireDropZone(m.el, 'im-file', async (file) => {
    showErr('');
    try {
      const all = await readSheet(file);
      if (all.length < 2) throw new Error('The sheet needs a heading row and at least one row of data.');
      [header, ...rows] = all; map = header.map(guess);
      map = map.map((k, i) => (k && map.indexOf(k) !== i ? '' : k));    // one column per field
      $('#im-step1', m.el).classList.add('hidden'); step2.classList.remove('hidden'); drawMapping();
    } catch (e) { showErr(e.message); }
  });
  m.dirty = () => !step2.classList.contains('hidden') && !go.dataset.done;
  go.addEventListener('click', async () => {
    if (go.dataset.done) { m.close(); return; }
    const records = rows.map((r) => { const o = {}; map.forEach((k, i) => { if (k) o[k] = r[i] ?? ''; }); return o; });
    go.disabled = true; go.textContent = 'Importing…'; showErr('');
    try {
      const r = await POST('/import/' + kind, { records });
      await refreshLookups();
      step2.innerHTML = `<div class="im-done"><span class="im-tick">${icon('check')}</span><h3>${plural(r.added, noun.slice(0, -1))} imported</h3>
        <p class="muted">${r.duplicates.length ? `${plural(r.duplicates.length, 'row')} already existed and ${r.duplicates.length === 1 ? 'was' : 'were'} skipped. ` : ''}${r.skipped.length ? `${plural(r.skipped.length, 'row')} had no ${kind === 'leads' ? 'name' : 'company'} and ${r.skipped.length === 1 ? 'was' : 'were'} left out.` : ''}${!r.duplicates.length && !r.skipped.length ? 'Every row was added.' : ''}</p>
        ${(r.warnings || []).length ? `<p class="small" style="margin-top:8px;color:var(--amber)">${plural(r.warnings.length, 'cell')} had an invalid value (e.g. letters in a phone number) and ${r.warnings.length === 1 ? 'was' : 'were'} left empty.</p>` : ''}${r.duplicates.length || r.skipped.length || (r.warnings || []).length ? `<details><summary>Show which rows</summary><div class="small muted pre" style="margin-top:8px">${esc([...r.duplicates.map((x) => x + ' — already in the CRM'), ...r.skipped, ...(r.warnings || [])].slice(0, 300).join('\n'))}</div></details>` : ''}</div>`;
      go.dataset.done = '1'; const sub = $('.mh-t p', m.el); if (sub) sub.textContent = 'Finished. The new records are already in your list.'; go.disabled = false; go.textContent = 'Done'; $('[data-close]', m.foot).classList.add('hidden');
      if (after) after();
    } catch (e) { showErr(e.message); go.disabled = false; go.textContent = `Import ${plural(rows.length, noun.slice(0, -1))}`; }
  });
  return m;
}

/* ---------- a whole workbook: the team's Google Sheets (sales + money) ----------
   Link → the server fetches the sheet as .xlsx (it must be shared by link), or drop the downloaded .xlsx.
   Every tab is read here; the server recognises the known tabs, shows a preview, then imports. */
const WB_SECTIONS = [['leads', 'Leads', 'Master Leads'], ['contact_log', 'Contact log entries', 'Contact Log'], ['clients', 'Clients', 'Clients'], ['projects', 'Projects', 'Projects'],
  ['income', 'Money received', 'Income'], ['expenses', 'Expenses', 'Expenses'], ['grants', 'Grants', 'Grants'], ['subscriptions', 'Subscriptions → Renewals', 'Subscriptions']];
const WB_MARKERS = /company\/?person|leadid|clientname|projectname|grantname|software\/?service|paymentmode|vendor/i;
function workbookModal(after) {
  let tabs = null, preview = null, fileName = '';
  const accounts = App.lookups.accounts || [];
  const m = openModal({ title: 'Import a whole workbook', sub: 'Your “TechSentinals CRM” and “TechSentinals OS” Google Sheets, or any Excel file with the same tabs.', size: 'wide',
    body: `<div id="wb-1"><label class="f"><span>Google Sheet link</span><div class="row"><input id="wb-url" placeholder="https://docs.google.com/spreadsheets/d/…" inputmode="url" style="flex:1"><button class="btn" id="wb-fetch" type="button">Read sheet</button></div>
        <div class="hint">Works when the sheet is shared as “Anyone with the link can view”. If it is private, use File → Download → Microsoft Excel (.xlsx) and drop the file below.</div></label>
      <div class="or"><span>or</span></div>${dropZone('wb-file', 'Drop the downloaded .xlsx here, or <u>choose it</u>', 'Google Sheets: File → Download → Microsoft Excel', '.xlsx')}</div>
      <div id="wb-2" class="hidden"></div><div id="wb-err" class="callout err hidden" role="alert" style="margin-top:14px"></div>`,
    footer: '<button class="btn" data-close type="button">Cancel</button><button class="btn primary" id="wb-go" type="button" disabled>Import</button>' });
  const err = $('#wb-err', m.el), go = $('#wb-go', m.el), step2 = $('#wb-2', m.el);
  const showErr = (msg) => { err.textContent = msg || ''; err.classList.toggle('hidden', !msg); };
  m.dirty = () => !!tabs && !go.dataset.done;
  async function use(bytes, name) {
    const book = await readWorkbook(bytes);
    tabs = {};
    for (const sh of book) {        // only tabs that look like data we know (keeps the upload small)
      if (!sh.rows.slice(0, 15).some((r) => r.some((c) => WB_MARKERS.test(String(c).replace(/\s/g, ''))))) continue;
      tabs[sh.name] = sh.rows.map((r) => { let n = r.length; while (n && !String(r[n - 1] ?? '').trim()) n--; return r.slice(0, n).map((c) => String(c ?? '').trim()); }).filter((r) => r.some(Boolean));
    }
    fileName = name;
    if (!Object.keys(tabs).length) throw new Error('No known tabs in this workbook (looked for Master Leads, Contact Log, Clients, Projects, Income, Expenses, Grants, Subscriptions).');
    await runPreview();
  }
  async function runPreview() {
    showErr(''); go.disabled = true; go.textContent = 'Checking…';
    const acc = $('#wb-acc', m.el) ? $('#wb-acc', m.el).value : (accounts.find((a) => a.type === 'bank') || accounts[0] || {}).id || '';
    preview = await POST('/workbook/import', { tabs, dry_run: true, account_id: acc || null });
    drawPreview(acc);
  }
  function drawPreview(acc) {
    const sec = preview.sections; const total = Object.values(sec).reduce((n, x) => n + x.added, 0);
    const people = Object.entries(preview.people_not_found || {});
    const lists = Object.entries(preview.list_additions || {});
    const needsAcc = (sec.income && sec.income.added) || (sec.expenses && sec.expenses.added);
    $('#wb-1', m.el).classList.add('hidden'); step2.classList.remove('hidden');
    step2.innerHTML = `<div class="im-file"><span class="logo-sq sm" style="--a-bg:var(--accent-soft);--a-fg:var(--accent)">${icon('file')}</span><div class="grow"><b>${esc(fileName)}</b><div class="small muted">Tabs found: ${Object.keys(tabs).map(esc).join(', ')}</div></div><button class="btn sm" id="wb-again" type="button">Use another</button></div>
      <div class="tbl"><table class="t"><thead><tr><th>What</th><th class="num">In the sheet</th><th class="num">Will be added</th><th class="num">Already in CRM</th><th>Skipped</th></tr></thead><tbody>
      ${WB_SECTIONS.filter(([k]) => sec[k]).map(([k, label, tab]) => { const x = sec[k]; return `<tr><td><b>${label}</b><div class="t2">from “${tab}”</div></td><td class="num">${x.found}</td><td class="num"><b>${x.added}</b></td><td class="num">${x.already || '—'}</td><td class="small">${x.skipped.length ? `<details><summary>${x.skipped.length}</summary>${x.skipped.slice(0, 40).map((t) => `<div>${esc(t)}</div>`).join('')}</details>` : '—'}</td></tr>`; }).join('')}
      </tbody></table></div>
      ${needsAcc ? `<label class="f" style="margin-top:14px;max-width:360px"><span>Money in and out goes through account</span><select id="wb-acc">${accounts.length ? accounts.map((a) => `<option value="${a.id}" ${String(a.id) === String(acc) ? 'selected' : ''}>${esc(a.name)}</option>`).join('') : '<option value="">— No account yet (add one in Finance first) —</option>'}</select><div class="hint">So the bank balance in Finance matches. Income from your own company is treated as founders' money, not client income.</div></label>` : ''}
      ${people.length ? `<div class="callout warn" style="margin-top:14px"><b>Not matched to a team member:</b> ${people.map(([n, c]) => `${esc(n)} (${c})`).join(', ')}. Add them under Team &amp; access first (same first name is enough), then import, so their leads and subscriptions are assigned to them.</div>` : ''}
      ${lists.length ? `<div class="callout info" style="margin-top:12px">New dropdown values will be added: ${lists.map(([k, v]) => v.map(esc).join(', ')).join(', ')}.</div>` : ''}
      ${(preview.warnings || []).length ? `<details class="small" style="margin-top:12px"><summary>${plural(preview.warnings.length, 'note')} about individual rows</summary>${preview.warnings.slice(0, 80).map((w) => `<div class="muted">${esc(w)}</div>`).join('')}</details>` : ''}`;
    $('#wb-again', step2).addEventListener('click', () => { tabs = null; step2.classList.add('hidden'); $('#wb-1', m.el).classList.remove('hidden'); go.disabled = true; go.textContent = 'Import'; });
    const as = $('#wb-acc', step2); if (as) as.addEventListener('change', () => runPreview().catch((e) => showErr(e.message)));
    go.disabled = !total; go.textContent = total ? `Import ${plural(total, 'record')}` : 'Nothing new to import';
  }
  $('#wb-fetch', m.el).addEventListener('click', async () => {
    const b = $('#wb-fetch', m.el); showErr(''); b.disabled = true; b.classList.add('busy'); b.textContent = 'Reading…';
    try { const r = await POST('/workbook/fetch', { url: $('#wb-url', m.el).value }); const bin = atob(r.data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); await use(bytes, r.name); }
    catch (e) { showErr(e.message); }
    b.disabled = false; b.classList.remove('busy'); b.textContent = 'Read sheet';
  });
  $('#wb-url', m.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#wb-fetch', m.el).click(); } });
  wireDropZone(m.el, 'wb-file', async (file) => { showErr(''); try { if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose the .xlsx file (Google Sheets: File → Download → Microsoft Excel).'); await use(new Uint8Array(await file.arrayBuffer()), file.name); } catch (e) { showErr(e.message); } });
  go.addEventListener('click', async () => {
    if (go.dataset.done) { m.close(); return; }
    go.disabled = true; go.textContent = 'Importing…'; go.classList.add('busy'); showErr('');
    try {
      const acc = $('#wb-acc', m.el) ? $('#wb-acc', m.el).value : null;
      const r = await POST('/workbook/import', { tabs, account_id: acc || null });
      await refreshLookups();
      const parts = WB_SECTIONS.filter(([k]) => r.sections[k] && r.sections[k].added).map(([k, label]) => `<li><b>${r.sections[k].added}</b> ${label.toLowerCase()}</li>`).join('');
      step2.innerHTML = `<div class="im-done"><span class="im-tick">${icon('check')}</span><h3>Imported</h3><ul class="wb-done">${parts || '<li>Nothing new</li>'}</ul>
        <p class="muted">Open <a href="#/followups" data-close-link>Follow-ups</a> for today's calls, or the <a href="#/sales-report" data-close-link>Sales report</a> to check the numbers against your sheet.</p></div>`;
      $$('[data-close-link]', step2).forEach((a) => a.addEventListener('click', () => m.close()));
      go.dataset.done = '1'; go.textContent = 'Done'; go.disabled = false; $('[data-close]', m.foot).classList.add('hidden');
      if (after) after();
    } catch (e) { showErr(e.message); go.disabled = false; go.textContent = 'Import'; }
    go.classList.remove('busy');
  });
  return m;
}
