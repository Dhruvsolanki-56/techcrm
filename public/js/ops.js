/* Money-sheet tabs that had no screen yet: Assets and Bank Transactions (founders only) */
'use strict';

/* ---------- Assets: laptops, phones and other devices ---------- */
route('/assets', async ({ el }) => {
  const rows = await GET('/assets');
  const live = rows.filter((a) => !/^(cancelled|completed)$/i.test(a.status || ''));
  const sum = (list, k) => list.reduce((s, a) => s + (Number(a[k]) || 0), 0);
  el.innerHTML = pageHead('Assets', 'Every laptop, phone and device the company owns, and who has it.', `<button class="btn primary" id="adda">${icon('plus')}New asset</button>`)
    + `<div class="kpis">${kpi('Assets', live.length, `${rows.length - live.length} retired`)}${kpi('Purchase Value', money(sum(live, 'purchase_value')))}${kpi('Current Value', money(sum(live, 'current_value')), 'Where entered')}${kpi('Not assigned', live.filter((a) => !a.assigned_to && !a.assigned_name).length)}</div><div id="al"></div>`;
  const open = (r) => editRecord('assets', r, null, () => Router.refresh(), { label: 'asset' });
  $('#adda', el).addEventListener('click', () => open(null));
  mountList($('#al', el), {
    resource: 'assets', rows: async () => rows, searchPlaceholder: 'Search assets…', noun: 'asset', defaultSort: { key: 'purchase_date', dir: 'desc' },
    filters: [{ key: 'asset_type', label: 'Asset Type', options: OPT.assetType }, { key: 'status', label: 'Status', options: OPT.sheetStatus }, { key: 'assigned_to', label: 'Assigned To', lookup: 'users' }],
    columns: [
      { key: 'id', label: 'Asset ID', num: true, cls: 'opt', render: (r) => `<span class="muted tnum">${r.id}</span>` },
      { key: 'asset_type', label: 'Asset Type', render: (r) => `<b>${esc(r.asset_type)}</b><div class="t2">${esc(r.make_model || '')}</div>` },
      { key: 'serial_number', label: 'Serial Number', cls: 'opt', render: (r) => (r.serial_number ? `<span class="mono">${esc(r.serial_number)}</span>` : '<span class="faint">—</span>') },
      { key: 'purchase_date', label: 'Purchase Date', cls: 'opt nowrap', render: (r) => (r.purchase_date ? fshort(r.purchase_date) : '<span class="faint">—</span>') },
      { key: 'purchase_value', label: 'Purchase Value', num: true, render: (r) => (r.purchase_value ? money(r.purchase_value) : '—') },
      { key: 'current_value', label: 'Current Value', num: true, cls: 'opt', render: (r) => (r.current_value != null && r.current_value !== '' ? money(r.current_value) : '—') },
      { key: 'assigned_to_name', label: 'Assigned To', render: (r) => (r.assigned_to ? who(r.assigned_to_name) : r.assigned_to_name ? `<span class="muted">${esc(r.assigned_to_name)}</span>` : '<span class="faint">—</span>') },
      { key: 'status', label: 'Status', render: (r) => textStatus(r.status) },
    ],
    onRow: open,
    empty: { title: 'No assets yet', text: 'Add the laptops, phones and other devices the company has bought, and who is using each one.' },
  });
}, { title: 'Assets', founder: true });

/* ---------- Bank Transactions: statement lines matched to income and expenses ---------- */
function bankTable(root) {
  mountList(root, {
    resource: 'bank_transactions', searchPlaceholder: 'Search statement…', noun: 'transaction', defaultSort: { key: 'date', dir: 'desc' },
    filters: [{ key: 'matched_status', label: 'Matched Status', options: OPT.matchStatus }, { key: 'account_id', label: 'Account', lookup: 'accounts' }],
    toolbarExtra: `<button class="btn" id="bmatch" type="button" title="Match each unmatched line to income or an expense with the same amount within 5 days">${icon('check')}Auto-match</button>`,
    columns: [
      { key: 'date', label: 'Date', cls: 'nowrap', render: (r) => fdate(r.date) },
      { key: 'description', label: 'Description', render: (r) => `<b>${esc(r.description || '—')}</b><div class="t2">${esc([r.reference, r.type, r.account_name].filter(Boolean).join(' · '))}</div>` },
      { key: 'withdrawal', label: 'Withdrawal', num: true, render: (r) => (r.withdrawal ? `<span class="neg">${money2(r.withdrawal)}</span>` : '—') },
      { key: 'deposit', label: 'Deposit', num: true, render: (r) => (r.deposit ? `<span class="pos">${money2(r.deposit)}</span>` : '—') },
      { key: 'balance', label: 'Balance', num: true, cls: 'opt', render: (r) => (r.balance != null ? money2(r.balance) : '—') },
      { key: 'matched_status', label: 'Matched Status', render: (r) => `${badge(r.matched_status === 'Matched' ? 'paid' : r.matched_status === 'Ignored' ? 'closed' : 'pending', r.matched_status)}${r.match_note ? `<div class="t2">${esc(r.match_note)}</div>` : ''}` },
    ],
    footer: (rows) => `<tr><td colspan="2">Total</td><td class="num">${money2(rows.reduce((s, r) => s + (r.withdrawal || 0), 0))}</td><td class="num">${money2(rows.reduce((s, r) => s + (r.deposit || 0), 0))}</td><td class="opt"></td><td></td></tr>`,
    add: { label: 'Add line', onClick: (reload) => editRecord('bank_transactions', null, null, reload, { label: 'bank transaction' }) },
    onRow: (r) => editRecord('bank_transactions', r, null, () => Router.refresh(), { label: 'bank transaction' }),
    empty: { title: 'No statement lines yet', text: 'Import your bank statement with Settings → Import a whole workbook (a “Bank Transactions” tab), or add lines here. Then press Auto-match.' },
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('#bmatch'); if (!b) return;
    b.disabled = true;
    try { const r = await POST('/bank-match', {}); toast(r.matched ? `Matched ${plural(r.matched, 'line')} · ${r.unmatched} still unmatched` : `Nothing new to match · ${r.unmatched} unmatched`); Router.refresh(); } catch (er) { fail(er); }
    b.disabled = false;
  });
}
