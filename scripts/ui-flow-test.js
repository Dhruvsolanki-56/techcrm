/* End-to-end form test — run in the browser while signed in as a founder (DevTools console: paste, Enter).
   Fills EVERY form through the real popups, saves, reads the record back from the server and compares,
   tries invalid input on each form, then deletes what it created. Uses names starting with "ZZ Test". */
(async () => {
  const sleep = (t) => new Promise((r) => setTimeout(r, t));
  const log = []; let pass = 0; const fails = []; window.__flowFails = fails; window.__flowPass = () => pass;
  const waitFor = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { const v = fn(); if (v) return v; await sleep(100); } return null; };
  const ok = (c, what, extra) => { if (c) pass++; else fails.push(what + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 300) : '')); };
  const top = () => [...document.querySelectorAll('.overlay')].pop();
  const finish = () => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* */ } });
  const set = (ov, name, value) => {
    if (Array.isArray(value)) {       // people picker: tick exactly these ids
      const boxes = [...ov.querySelectorAll(`[name="${name}"]`)]; if (!boxes.length) throw new Error(`field ${name} missing`);
      boxes.forEach((b) => { b.checked = value.map(String).includes(b.value); b.dispatchEvent(new Event('change', { bubbles: true })); }); return value;
    }
    const el = ov.querySelector(`[name="${name}"]`); if (!el) throw new Error(`field ${name} missing`);
    if (el.type === 'checkbox') el.checked = !!value; else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    return el.value;
  };
  const fill = (ov, vals) => Object.entries(vals).forEach(([k, v]) => set(ov, k, v));
  const save = async (btnSel = '#mf-ok') => {
    const ov = top(); ov.querySelector(btnSel).click();
    for (let i = 0; i < 40; i++) { await sleep(100); if (!ov.isConnected) return ''; const e = ov.querySelector('.callout.err:not(.hidden)'); if (e && e.textContent) return e.textContent; }
    return 'timeout';
  };
  const open = async (res, defaults = {}) => { editRecord(res, null, defaults, () => {}, { label: res }); await sleep(250); finish(); return top(); };
  const closeAll = async () => { document.querySelectorAll('.overlay').forEach((o) => o.remove()); document.body.classList.remove('modal-open'); };
  const latest = async (res, where) => (await GET('/' + res)).filter(where).sort((a, b) => b.id - a.id)[0];
  const created = [];      // [resource, id] to clean up
  const T = 'ZZ Test';
  const ov1 = (a) => (Array.isArray(a[0]) ? a[0][0] : a[0]);

  // ---------- 1. invalid input is blocked in every form ----------
  const negative = [
    ['leads', { name: 'Ravi', phone: '12 34' }, 'Phone'], ['leads', { name: 'Ravi', email: 'ravi@' }, 'Email'], ['leads', { name: 'Ravi', website: 'not a site' }, 'Website'],
    ['clients', { company: T + ' Bad GST', gstin: '27ABC' }, 'GSTIN'], ['clients', { company: T + ' Bad PAN', pan: '12345' }, 'PAN'],
    ['projects', { name: T + ' Bad dates', start_date: '2026-06-10', deadline: '2026-06-01' }, 'Deadline'],
    ['contacts', { name: 'Priya', phone: '12' }, 'Phone'],
  ];
  for (const [res, vals, expect] of negative) {
    const ov = await open(res, res === 'contacts' ? { client_id: App.lookups.clients[0].id } : {}); fill(ov, vals);
    if (res === 'projects') { const sel = ov.querySelector('[name=client_id]'); if (sel) set(ov, 'client_id', App.lookups.clients[0].id); }
    const msg = await save(); ok(msg && new RegExp(expect, 'i').test(msg), `${res}: invalid ${expect} is refused with a clear message`, msg);
    ok(!!ov.querySelector('.invalid'), `${res}: the wrong field is outlined in red`);
    await closeAll();
  }
  // typing blocks
  { const ov = await open('leads'); const n = ov.querySelector('[name=name]'); n.value = 'Ravi99 Kumar'; n.dispatchEvent(new Event('input', { bubbles: true }));
    ok(n.value === 'Ravi Kumar', 'digits typed into a name are removed while typing', n.value);
    ok(/Numbers are not allowed/.test(ov.querySelector('#fld-name-err').textContent), 'and a message says why', ov.querySelector('#fld-name-err').textContent);
    const ph = ov.querySelector('[name=phone]'); ph.value = '98abc765'; ph.dispatchEvent(new Event('input', { bubbles: true })); ok(ph.value === '98765', 'letters typed into a phone are removed', ph.value);
    const c = ov.querySelector('[name=city]'); c.value = 'Pune1'; c.dispatchEvent(new Event('input', { bubbles: true })); ok(c.value === 'Pune', 'digits typed into a city are removed', c.value);
    const v = ov.querySelector('[name=value]'); const ev = new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true }); v.dispatchEvent(ev); ok(ev.defaultPrevented, 'minus sign blocked in amounts');
    await closeAll(); }
  { const ov = await open('clients'); const g = ov.querySelector('[name=gstin]'); g.value = '27abcde1234f1z5'; g.dispatchEvent(new Event('input', { bubbles: true })); ok(g.value === '27ABCDE1234F1Z5', 'GSTIN switches to capitals while typing', g.value); await closeAll(); }

  // ---------- 2. fill and save every form ----------
  const today = new Date().toISOString().slice(0, 10); const plus = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
  const check = (rec, vals, res) => { for (const [k, v] of Object.entries(vals)) { const got = rec[k]; const want = typeof got === 'number' ? Number(v) : typeof v === 'boolean' ? (v ? 1 : 0) : String(v).trim(); ok(String(got) === String(want) || (k === 'gstin' || k === 'pan') && String(got) === String(want).toUpperCase(), `${res}: ${k} saved correctly`, [got, want]); } };
  const steps = [
    ['clients', { company: T + ' Client Pvt Ltd', industry: 'Retail / D2C', website: 'zztest.example.com', status: 'active', gstin: '27aaacz1234a1z5', pan: 'aaacz1234a', address: '12 Test Road, Baner', city: 'Pune', state: 'Maharashtra', tags: 'test', country: 'India', notes: 'Created by the form test' }, (r) => r.company === T + ' Client Pvt Ltd'],
  ];
  for (const [res, vals, find] of steps) { const ov = await open(res); fill(ov, vals); const msg = await save(); ok(!msg, `${res}: saves without error`, msg); await refreshLookups(); const rec = await latest(res, find); ok(!!rec, `${res}: record exists on the server`); if (rec) { created.push([res, rec.id]); check(await GET(`/${res}/${rec.id}`), vals, res); } }
  const client = App.lookups.clients.find((c) => c.company === T + ' Client Pvt Ltd');
  const accounts = App.lookups.accounts || (await GET('/accounts'));
  const more = [
    ['contacts', { name: "Anne-Marie D'Souza", role: 'CTO', email: 'anne@zztest.example.com', phone: '+91 98765 43210', whatsapp: '9876543210', is_primary: true, notes: 'Prefers WhatsApp' }, (r) => r.email === 'anne@zztest.example.com'],
    ['leads', { name: 'Rahul Verma', company: T + ' Lead Co', email: 'rahul@zzlead.example.com', phone: '+91 91234 56789', city: 'Navi Mumbai', website: 'https://zzlead.example.com', department: ov1(OPT.leadDept), category: ov1(OPT.leadCategory), market: 'India', country: 'India', requirement: 'Online store with 200 products', priority: 'hot', followup_round: 'first', next_action: 'Send demo video', last_contact: today, meeting_date: plus(2), value: 250000, stage: 'meeting', source: ov1(OPT.leadSource), owner_id: App.user.id, next_followup: plus(3), notes: 'Wants an e-commerce site' }, (r) => r.email === 'rahul@zzlead.example.com'],
    ['projects', { name: T + ' Website', client_id: client.id, type: ov1(OPT.projectType), status: 'active', priority: 'high', manager_id: App.user.id, budget: 180000, start_date: today, deadline: plus(30), live_url: 'zztest.example.com', staging_url: 'https://staging.zztest.example.com', repo_url: 'https://github.com/example/zz', design_url: 'https://figma.com/file/zz', tech_stack: 'Next.js, Node', description: 'Company site', specs: '5 pages + blog' }, (r) => r.name === T + ' Website'],
  ];
  for (const [res, vals, find] of more) { const ov = await open(res, res === 'contacts' ? { client_id: client.id } : {}); fill(ov, vals); const msg = await save(); ok(!msg, `${res}: saves without error`, msg); await refreshLookups(); const rec = await latest(res, find); ok(!!rec, `${res}: record exists on the server`); if (rec) { created.push([res, rec.id]); check(await GET(`/${res}/${rec.id}`), vals, res); } }
  const project = App.lookups.projects.find((p) => p.name === T + ' Website');
  const acc = accounts[0];
  const rest = [
    ['tasks', { title: T + ' task: build contact form', project_id: project.id, status: 'todo', priority: 'urgent', due_date: plus(2), description: 'Use the new API' }, (r) => r.title === T + ' task: build contact form'],
    ['grants', { name: T + ' grant', funder: 'ZZ Council', applied_on: today, requested: 200000, received: 50000, status: 'disbursed', next_report_date: plus(30), notes: 'Tranche one' }, (r) => r.name === T + ' grant'],
    ['payments', { amount: 50000, date: today, client_id: client.id, category: 'Client payment', tds: 1000, project_id: project.id, account_id: acc.id, method: ov1(OPT.payMethod), reference: 'UTR123456', notes: 'Advance' }, (r) => r.reference === 'UTR123456'],
    ['expenses', { amount: 11800, date: today, category: ov1(OPT.expenseCategory), vendor: 'Hosting Co', description: T + ' server', status: 'paid', tax_amount: 1800, account_id: acc.id, method: ov1(OPT.payMethod), reference: 'BILL-77', project_id: project.id, client_id: client.id, receipt_url: 'https://zzbill.example.com/77', notes: 'Yearly' }, (r) => r.description === T + ' server'],
    ['accounts', { name: T + ' Cash box', type: ov1(OPT.accountType), opening_balance: 2500, active: true, notes: 'Petty cash' }, (r) => r.name === T + ' Cash box'],
    ['transfers', { kind: ov1(OPT.transferKind), amount: 7000, date: today, user_id: App.user.id, account_id: acc.id, notes: T + ' capital' }, (r) => r.notes === T + ' capital'],
    ['renewals', { name: T + ' domain', kind: 'domain', vendor: 'GoDaddy', client_id: client.id, project_id: project.id, renewal_date: plus(40), cycle: 'yearly', our_cost: 900, client_price: 1500, status: 'active', auto_renew: true, owner_id: App.user.id, notes: '.com' }, (r) => r.name === T + ' domain'],
    ['maintenance_logs', { title: T + ' fix contact form', project_id: project.id, client_id: client.id, type: ov1(OPT.maintType), priority: 'high', status: 'in_progress', assignee_id: App.user.id, reported_on: today, hours: 1.5, billable: true, description: 'SMTP password expired' }, (r) => r.title === T + ' fix contact form'],
    ['events', { title: T + ' GST filing', date: plus(5), kind: ov1(OPT.eventKind), client_id: client.id, project_id: project.id, notes: 'GSTR-3B' }, (r) => r.title === T + ' GST filing'],
  ];
  for (const [res, vals, find] of rest) {
    const ov = await open(res); fill(ov, vals); const msg = await save(); ok(!msg, `${res}: saves without error`, msg); await refreshLookups();
    const rec = await latest(res, find); ok(!!rec, `${res}: record exists on the server`); if (rec) { created.push([res, rec.id]); check(await GET(`/${res}/${rec.id}`), vals, res); }
  }
  // edit + task popup actions
  { const t = await latest('tasks', (r) => r.title.startsWith(T)); openTask(t, () => {}); await sleep(500); finish(); const ov = top();
    const done = [...ov.querySelectorAll('button')].find((b) => /Mark done/.test(b.textContent)); done.click(); await sleep(700);
    ok((await GET('/tasks/' + t.id)).status === 'done', 'task popup: "Mark done" updates the task'); await closeAll();
    editRecord('tasks', await GET('/tasks/' + t.id), null, () => {}, { label: 'task' }); await sleep(300); finish(); set(top(), 'status', 'in_progress'); const msg = await save(); ok(!msg && (await GET('/tasks/' + t.id)).status === 'in_progress', 'task: edit and save changes');
    // teamwork: put two people on it, split the work, discuss with an @mention
    const mate = App.lookups.users.find((u) => u.id !== App.user.id);
    editRecord('tasks', await GET('/tasks/' + t.id), null, () => {}, { label: 'task' }); await sleep(300); finish();
    set(top(), 'assignee_ids', [App.user.id, mate.id]); const m2 = await save();
    const t2 = await GET('/tasks/' + t.id); ok(!m2 && t2.assignees.map((a) => a.id).sort().join() === [App.user.id, mate.id].sort().join(), 'task: two people picked in the form are both on the task', t2.assignees);
    openTask(t2, () => {}); await waitFor(() => top() && top().querySelector('#ck-new')); finish(); const tv = top();
    tv.querySelector('#ck-new').value = 'ZZ step for ' + mate.name; const who = tv.querySelector('#ck-new-who'); ok(!!who, 'checklist: can pick who does a step when several people are on the task'); if (who) who.value = String(mate.id);
    tv.querySelector('.ck-add button').click(); await waitFor(() => tv.querySelector('.ck'));
    ok(tv.querySelectorAll('.ck').length === 1 && tv.querySelector('.ck .ck-who').value === String(mate.id), 'checklist: step added for a teammate');
    tv.querySelector('[data-tick]').click(); await waitFor(() => tv.querySelector('.ck.done'));
    ok(tv.querySelector('#ck-sum').textContent === '1 of 1 done', 'checklist: ticking updates progress');
    const ta = tv.querySelector('#th-body'); ta.focus(); ta.value = '@' + mate.name.slice(0, 3).toLowerCase(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event('input'));
    const opt = await waitFor(() => [...tv.querySelectorAll('.mp-i')].find((b) => b.textContent.includes(mate.name))); ok(!!opt, 'comment: typing @ suggests teammates');
    if (opt) opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    ta.value += 'please review'; tv.querySelector('#th-post').click(); await waitFor(() => tv.querySelector('.th-c .mention'));
    const n = (await GET('/notes?entity_type=task&entity_id=' + t.id)).find((x) => x.kind === 'note');
    ok(n && n.body === '@' + mate.name + ' please review' && JSON.parse(n.mentions || '[]')[0]?.id === mate.id, 'comment: mention is saved and highlighted', n);
    tv.querySelector('#tk-tabs [data-tab=history]').click(); ok([...tv.querySelectorAll('.th-log')].some((x) => /added/.test(x.textContent)) && [...tv.querySelectorAll('.th-log')].some((x) => /changed status/.test(x.textContent)), 'history tab lists who was added and status changes');
    await closeAll(); }

  // ---------- 3. invoice editor: fill lines, save as sent, record payment ----------
  location.hash = `#/invoices/new?client=${client.id}`; await sleep(1200); finish();
  { const ov = top(); set(ov, 'title', T + ' invoice'); set(ov, 'project_id', project.id);
    const line = ov.querySelector('#items textarea'); line.value = 'Website design'; line.dispatchEvent(new Event('input', { bubbles: true }));
    const q = ov.querySelector('[data-k=qty]'), rt = ov.querySelector('[data-k=rate]'); q.value = 2; q.dispatchEvent(new Event('input', { bubbles: true })); rt.value = 25000; rt.dispatchEvent(new Event('input', { bubbles: true }));
    ov.querySelector('#addline').click(); await sleep(100);
    const l2 = [...ov.querySelectorAll('#items textarea')].pop(); l2.value = 'Hosting (1 year)'; l2.dispatchEvent(new Event('input', { bubbles: true }));
    const r2 = [...ov.querySelectorAll('[data-k=rate]')].pop(); r2.value = 6000; r2.dispatchEvent(new Event('input', { bubbles: true }));
    ok(/66,080/.test(ov.querySelector('#tot').innerText), 'invoice editor: totals update live (56,000 + 18% GST = 66,080 minus nothing)', ov.querySelector('#tot').innerText);
    set(ov, 'due_date', '2020-01-01'); const bad = await save('#savesend'); ok(/before the issue date|real date/i.test(bad), 'invoice editor: due date before issue date is refused', bad);
    set(ov, 'due_date', plus(15)); const msg = await save('#savesend'); ok(!msg, 'invoice editor: "Save & mark as sent" works', msg); }
  await sleep(1200);
  const inv = await latest('invoices', (r) => r.title === T + ' invoice'); ok(inv && inv.status === 'sent' && Math.round(inv.total) === 66080, 'invoice saved with status sent and total ₹66,080', inv && [inv.status, inv.total]);
  if (inv) {
    created.unshift(['invoices', inv.id]);
    ok(location.hash === `#/invoices/${inv.id}`, 'after saving, the invoice page opens', location.hash);
    const pay = await waitFor(() => [...document.querySelectorAll('#view button')].find((b) => /Record payment/.test(b.textContent))); pay.click(); await waitFor(() => top()); await sleep(200); finish();
    const ov = top(); set(ov, 'amount', 66080); if (ov.querySelector('[name=account_id]')) set(ov, 'account_id', acc.id); const msg = await save(); ok(!msg, 'record payment from the invoice page', msg);
    await sleep(800); const after = await GET('/invoices/' + inv.id); ok(after.status === 'paid', 'invoice turns "paid" after full payment', after.status);
    const p = await latest('payments', (r) => r.invoice_id === inv.id); if (p) created.unshift(['payments', p.id]);
  }
  // quotation → invoice
  location.hash = `#/quotes/new?client=${client.id}`; await sleep(1200); finish();
  { const ov = top(); set(ov, 'title', T + ' quote'); const line = ov.querySelector('#items textarea'); line.value = 'SEO package'; line.dispatchEvent(new Event('input', { bubbles: true }));
    const rt = ov.querySelector('[data-k=rate]'); rt.value = 15000; rt.dispatchEvent(new Event('input', { bubbles: true })); const msg = await save('#save'); ok(!msg, 'quotation editor: save as draft', msg); }
  await sleep(1200); const qt = await latest('quotes', (r) => r.title === T + ' quote'); ok(!!qt, 'quotation saved'); if (qt) created.unshift(['quotes', qt.id]);

  // lead → client conversion
  { const lead = await latest('leads', (r) => r.email === 'rahul@zzlead.example.com'); location.hash = '#/leads/' + lead.id; (await waitFor(() => document.querySelector('#convert'))).click(); await waitFor(() => top()); await sleep(200); finish(); top().querySelector('#cp').checked = false; top().querySelector('#go').click(); await sleep(1500);
    const conv = await GET('/leads/' + lead.id); ok(conv.client_id && conv.stage === 'won', 'lead converts to a client (stage → won)', [conv.client_id, conv.stage]);
    if (conv.client_id) created.push(['clients', conv.client_id]); }

  // document upload
  { const blob = new File(['%PDF-1.4 test'], 'zz-test-proposal.pdf', { type: 'application/pdf' }); location.hash = '#/clients/' + client.id + '?tab=files'; await sleep(1200);
    uploadModal('client', client.id, () => {}); await sleep(300); finish(); const ov = top(); const dt = new DataTransfer(); dt.items.add(blob); const inp = ov.querySelector('#up-file'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
    ov.querySelector('#up-title').value = T + ' proposal'; ov.querySelector('#up-ok').click(); await sleep(1500);
    const d = await latest('documents', (r) => r.title === T + ' proposal'); ok(!!d, 'document upload saved'); if (d) created.unshift(['documents', d.id]); await closeAll(); }

  // credential: create + reveal
  { location.hash = '#/vault'; const btn = await waitFor(() => [...document.querySelectorAll('#view button')].find((b) => /Add credential/.test(b.textContent))); btn.click(); await waitFor(() => top()); await sleep(200); finish();
    fill(top(), { label: T + ' cPanel', client_id: client.id, url: 'cpanel.zztest.example.com', username: 'admin', password: 'S3cret-Pass!', secret: 'recovery-code-123' }); const msg = await save(); ok(!msg, 'credential saves', msg);
    const c = (await GET('/credentials')).find((x) => x.label === T + ' cPanel'); ok(c && !('password' in c), 'credential list never shows the password');
    if (c) { const rv = await POST(`/credentials/${c.id}/reveal`); ok(rv.password === 'S3cret-Pass!' && rv.secret === 'recovery-code-123', 'reveal returns the right decrypted password'); await DEL('/credentials/' + c.id); } }

  // team member: invalid then valid
  { userModal(null, () => {}); await sleep(300); finish(); fill(top(), { name: 'Zara Test 2', email: 'zz.intern@example.com', role: 'intern' }); ok(top().querySelector('[name=name]').value === 'Zara Test ', 'team member: digits typed into the name are removed', top().querySelector('[name=name]').value);
    set(top(), 'email', 'not-an-email'); const bad = await save(); ok(/Email/.test(bad), 'team member: broken email refused', bad);
    set(top(), 'email', 'zz.intern@example.com'); const msg = await save(); ok(!msg, 'team member created', msg);
    const u = (await GET('/users')).find((x) => x.email === 'zz.intern@example.com'); ok(u && u.role === 'intern' && u.must_change_password, 'new intern must change the temporary password on first login', u);
    if (u) await PUT('/users/' + u.id, { active: false }); }

  // settings: invalid IFSC refused, valid saved
  { location.hash = '#/settings'; const f = await waitFor(() => document.querySelector('#sf')); const old = f.querySelector('[name=bank_ifsc]').value;
    f.querySelector('[name=bank_ifsc]').value = 'HDFC12'; f.querySelector('[type=submit]').click(); await sleep(500);
    ok(f.querySelector('[name=bank_ifsc]').classList.contains('invalid'), 'settings: wrong IFSC is outlined and not saved');
    f.querySelector('[name=bank_ifsc]').value = old || 'HDFC0001234'; f.querySelector('[type=submit]').click(); await sleep(800); ok(!f.querySelector('.invalid'), 'settings: saves when fixed'); }

  // ---------- 4. every page still renders with the new data ----------
  for (const p of ['#/dashboard', '#/finance', '#/calendar', '#/followups', '#/sales-report', '#/grants', '#/leads?view=list&priority=hot', '#/renewals', '#/maintenance', '#/projects/' + project.id, '#/clients/' + client.id + '?tab=billing']) { location.hash = p; await sleep(1100); ok(!/Something went wrong|did not load/.test(document.querySelector('#view').innerText), `${p} renders with the test data`); }

  // ---------- 5. clean up ----------
  const order = ['payments', 'invoices', 'quotes', 'documents', 'events', 'maintenance_logs', 'renewals', 'transfers', 'expenses', 'grants', 'tasks', 'contacts', 'leads', 'projects', 'accounts', 'clients'];
  for (const res of order) for (const [r, id] of created.filter(([r]) => r === res)) { try { await DEL(`/${r}/${id}`); } catch (e) { log.push(`cleanup ${r} ${id}: ${e.message}`); } }
  for (const l of (await GET('/leads')).filter((x) => x.email === 'rahul@zzlead.example.com')) { try { await DEL('/leads/' + l.id); } catch { /* */ } }
  await refreshLookups(); location.hash = '#/dashboard';
  console.log(`Form flow test: ${pass} passed, ${fails.length} failed`); fails.forEach((f) => console.warn(f)); log.forEach((l) => console.log(l));
  return { passed: pass, failed: fails, notes: log };
})();
