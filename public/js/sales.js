/* Sales screens built from the team's Google Sheet: Follow Ups, Contact Log, the Dashboard / Analytics tabs, grants */
'use strict';

const NEXT_ROUND = { not_started: 'initial', initial: 'first', first: 'second', second: 'third', third: 'complete', complete: 'complete' };
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const waLink = (phone) => { const d = String(phone || '').replace(/\D/g, ''); return d.length >= 10 ? `https://wa.me/${d.length === 10 ? '91' + d : d}` : ''; };

/* ---------- one contact with a lead: what happened + the next step, in one popup ---------- */
function logContactModal(l, after) {
  return formModal({
    title: 'Log contact', sub: `${l.company || l.name}${l.phone ? ' · ' + l.phone : ''}`, submit: 'Save',
    intro: l.next_action ? `Planned next action: <b>${esc(l.next_action)}</b>` : '',
    fields: [
      { name: 'kind', label: 'Contact Type', type: 'select', options: OPT.contactKind, required: true }, { name: 'stage', label: 'Sales Stage', type: 'select', options: OPT.leadStage, required: true },
      { name: 'body', label: 'Outcome', type: 'textarea', full: true, rows: 3, required: true, placeholder: 'e.g. Spoke to the owner — wants a demo next week, budget around ₹1L' },
      { name: 'followup_round', label: 'Follow-Up Round', type: 'select', options: OPT.followRound, required: true }, { name: 'next_followup', label: 'Next Follow-Up Date', type: 'date' },
      { name: 'next_action', label: 'Next Action', full: true, placeholder: 'e.g. Send demo video and pricing' },
    ],
    values: { kind: 'call', stage: l.stage, followup_round: NEXT_ROUND[l.followup_round] || 'initial', next_followup: plusDays(3), next_action: '' },
    onSubmit: async (d) => {
      const ended = CLOSED_STAGES.includes(d.stage);
      await POST('/notes', { entity_type: 'lead', entity_id: l.id, kind: d.kind, body: d.body, followup_round: ended ? 'complete' : d.followup_round, next_followup: ended ? null : d.next_followup || null });
      await PUT('/leads/' + l.id, { stage: d.stage, followup_round: ended ? 'complete' : d.followup_round, next_followup: ended ? null : d.next_followup || null, next_action: ended ? null : d.next_action || null });
      toast(ended ? 'Saved — lead closed' : d.next_followup ? `Saved — next follow-up ${fshort(d.next_followup)}` : 'Saved');
      if (after) after();
    },
  });
}

/* ---------- Follow-ups: the daily action queue ---------- */
route('/followups', async ({ el, query }) => {
  const all = await GET('/leads'); const t = todayStr(); const in7 = plusDays(7);
  const who = query.who || (isFounder() ? 'all' : 'mine');
  const open = all.filter((l) => !CLOSED_STAGES.includes(l.stage) && (who === 'all' || l.owner_id === App.user.id)
    && (!query.department || l.department === query.department) && (!query.priority || l.priority === query.priority));
  const rank = { hot: 0, medium: 1, cold: 2 };
  const by = (a, b) => (a.next_followup || '9999').localeCompare(b.next_followup || '9999') || (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1);
  const groups = [
    ['today', 'Due Today', open.filter((l) => l.next_followup === t), 'warn'],
    ['overdue', 'Overdue', open.filter((l) => l.next_followup && l.next_followup < t), 'bad'],
    ['week', 'Next 7 Days', open.filter((l) => l.next_followup > t && l.next_followup <= in7), ''],
    ['later', 'Later', open.filter((l) => l.next_followup > in7), ''],
    ['nodate', 'No Date', open.filter((l) => !l.next_followup), ''],
  ];
  const sel = query.show || (groups[0][2].length || groups[1][2].length ? 'due' : 'all');
  groups.sort((x, y) => ['overdue', 'today', 'week', 'later', 'nodate'].indexOf(x[0]) - ['overdue', 'today', 'week', 'later', 'nodate'].indexOf(y[0]));
  const row = (l) => { const wa = waLink(l.phone); return `<div class="fu-row" data-lead="${l.id}">
    <div class="fu-main"><div class="t1"><a href="#/leads/${l.id}">${esc(l.company || l.name)}</a> ${heat(l.priority)}</div>
      <div class="t2">${esc([l.company && l.company !== l.name ? l.name : '', l.department, l.city].filter(Boolean).join(' · '))}</div>
      ${l.next_action ? `<div class="fu-next">${icon('arrowR')}${esc(l.next_action)}</div>` : ''}</div>
    <div class="fu-meta">${badge(l.stage)}<span class="small muted">${esc(ROUND_LABEL[l.followup_round] || '')}</span></div>
    <div class="fu-when">${l.next_followup ? dueBadge(l.next_followup) : '<span class="faint small">No date</span>'}<div class="small muted">${l.last_contact ? 'last contact ' + fshort(l.last_contact) : 'never contacted'}</div></div>
    <div class="fu-act">${l.phone ? `<a class="btn sm icon" href="tel:${esc(l.phone)}" title="Call ${esc(l.phone)}" aria-label="Call">${icon('phone')}</a>` : ''}${wa ? `<a class="btn sm icon" href="${wa}" target="_blank" rel="noopener noreferrer" title="WhatsApp" aria-label="WhatsApp">${icon('chat')}</a>` : ''}
      <button class="btn sm" data-log="${l.id}">Log contact</button>${l.owner_name ? avatar(l.owner_name, 'sm') : ''}</div></div>`; };
  const shown = groups.filter(([k, , list]) => list.length && (sel === 'all' || (sel === 'due' ? ['overdue', 'today'].includes(k) : sel === k)));
  const link = (o) => { const p = new URLSearchParams({ who, ...(query.department ? { department: query.department } : {}), ...(query.priority ? { priority: query.priority } : {}), show: sel, ...o }); return '#/followups?' + p; };
  el.innerHTML = pageHead('Follow-ups', 'Open this every morning: who to call today, who is overdue, and what to say next.', `<a class="btn" href="#/contact-log">${icon('note')}Contact Log</a><button class="btn primary" id="addl">${icon('plus')}New lead</button>`)
    + `<div class="kpis fu-kpis">${['today', 'overdue', 'week', 'nodate', 'later'].map((k) => groups.find((g) => g[0] === k)).map(([k, label, list, cls]) => `<a class="kpi ${cls && list.length ? cls : ''} ${sel === k ? 'on' : ''}" href="${link({ show: k })}"><div class="l">${label}</div><div class="v">${list.length}</div></a>`).join('')}</div>
    <div class="toolbar"><div class="seg"><a class="${who === 'mine' ? 'on' : ''}" href="${link({ who: 'mine' })}">Mine</a><a class="${who === 'all' ? 'on' : ''}" href="${link({ who: 'all' })}">Everyone</a></div>
      <div class="seg"><a class="${sel === 'due' ? 'on' : ''}" href="${link({ show: 'due' })}">Due now</a><a class="${sel === 'all' ? 'on' : ''}" href="${link({ show: 'all' })}">All open</a></div>
      <select id="fd" aria-label="Department / Product"><option value="">All departments / products</option>${normOpts(OPT.leadDept).map((o) => `<option value="${esc(o.v)}" ${query.department === o.v ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>
      <select id="fp" aria-label="Priority"><option value="">Any priority</option>${OPT.leadPriority.map(([v, n]) => `<option value="${v}" ${query.priority === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    ${shown.length ? shown.map(([k, label, list]) => `<section class="panel fu-group fu-${k}"><div class="panel-h"><h2>${label}</h2><span class="muted small">${list.length}</span></div><div class="fu-list">${list.sort(by).map(row).join('')}</div></section>`).join('')
      : `<div class="panel"><div class="empty iconic"><span class="em-i">${icon('check')}</span><b>${sel === 'due' ? 'Nothing due right now' : 'No open leads here'}</b>${sel === 'due' ? `<a class="btn sm" href="${link({ show: 'all' })}">See all open leads</a>` : ''}</div></div>`}`;
  const go = () => { location.hash = link({ department: $('#fd', el).value, priority: $('#fp', el).value }).replace(/([?&])(department|priority)=(&|$)/g, '$1'); };
  $('#fd', el).addEventListener('change', go); $('#fp', el).addEventListener('change', go);
  $('#addl', el).addEventListener('click', () => editRecord('leads', null, { owner_id: App.user.id }, () => Router.refresh(), { label: 'lead', size: 'wide' }));
  delegate(el, '[data-log]', 'click', (b) => logContactModal(all.find((l) => String(l.id) === b.dataset.log), () => Router.refresh()));
}, { title: 'Follow-ups', needs: 'leads' });

/* ---------- Sales report: the sheet's Dashboard, Dept, Source and Monthly tabs ---------- */
route('/sales-report', async ({ el, query }) => {
  const a = await GET('/sales/analytics' + (query.year ? '?year=' + encodeURIComponent(query.year) : '')); const T = a.total;
  const pct = (n) => `${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
  // a column = [heading, value(row), number?]; the headings are the sheet's
  const C = { leads: ['Total Leads', (r) => r.leads], open: ['Open Leads', (r) => r.open], hotOpen: ['Hot Open', (r) => r.hot || '—'], hot: ['Hot Leads', (r) => r.hot_all || '—'], conv: ['Converted', (r) => r.converted || '—'],
    lost: ['Closed / Lost', (r) => r.lost || '—'], rate: ['Conversion Rate', (r) => pct(r.conversion)], pipe: ['Open Pipeline', (r) => (r.pipeline ? money(r.pipeline) : '—')], wpipe: ['Weighted Pipeline', (r) => (r.weighted ? money(r.weighted) : '—')],
    india: ['India', (r) => r.india || '—'], foreign: ['Foreign', (r) => r.foreign || '—'], overdue: ['Overdue', (r) => (r.overdue ? `<span class="neg">${r.overdue}</span>` : '—')] };
  const table = (rows, first, cols, opts = {}) => (rows.length ? `<div class="tbl-scroll"><table class="t rep"><thead><tr><th>${first}</th>${opts.side ? '<th>Business Side</th>' : ''}${cols.map((c) => `<th class="num">${c[0]}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr${opts.link ? ` class="click" data-href="${opts.link(r)}"` : ''}><td><b>${esc(opts.label ? opts.label(r.name) : r.name)}</b></td>${opts.side ? `<td class="muted">${esc(r.side || '—')}</td>` : ''}${cols.map((c) => `<td class="num">${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : emptyMini('No leads yet.'));
  const DEPT = [C.leads, C.open, C.hotOpen, C.conv, C.lost, C.rate, C.pipe, C.wpipe, C.overdue]; const SRC = [C.leads, C.open, C.conv, C.rate, C.pipe, C.wpipe, C.hot, C.india, C.foreign, C.overdue];
  const stageOrder = OPT.leadStage.map(([v]) => v);
  const stages = [...a.by_stage].sort((x, y) => stageOrder.indexOf(x.name) - stageOrder.indexOf(y.name));
  const smax = Math.max(1, ...stages.map((s) => s.leads));
  const mon = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  const india = a.by_market.find((m) => m.name === 'India') || { leads: 0, converted: 0, pipeline: 0, conversion: 0 }; const foreign = a.by_market.find((m) => m.name === 'Foreign') || { leads: 0, converted: 0, pipeline: 0, conversion: 0 };
  el.innerHTML = pageHead('Sales report', 'Your sheet’s Dashboard, Monthly, Dept and Source Analytics tabs — always up to date.', `<a class="btn" href="#/followups">${icon('phone')}Follow-ups</a>${isFounder() ? `<a class="btn" href="/api/leads/export.csv">${icon('download')}CSV</a>` : ''}`)
    + `<div class="kpis">${kpi('Total Leads', T.leads)}${kpi('Open Leads', T.open)}${kpi('Converted', T.converted, '', 'good')}${kpi('Conversion Rate', pct(T.conversion))}</div>
    <div class="kpis" style="margin-top:-6px">${kpi('Open Pipeline', money(T.pipeline))}${kpi('Weighted Pipeline', money(T.weighted))}${kpi('Due Today', T.due_today, '', T.due_today ? 'warn' : '')}${kpi('Overdue', T.overdue, `${T.no_date} with no date`, T.overdue ? 'bad' : '')}</div>
    <div class="dash"><div class="dash-row">
      ${panel('Funnel by stage', `<div class="panel-b funnel">${stages.map((s) => `<a class="r" href="#/leads?view=list"><span class="muted">${esc(STATUS_LABEL[s.name] || pretty(s.name))}</span><div class="tr"><i style="width:${Math.max(6, 100 * s.leads / smax)}%;background:${STAGE_TONE[s.name] || 'var(--accent)'};color:#fff;font-weight:600">${s.leads}</i></div><span class="right tnum">${s.pipeline ? compact(s.pipeline) : ''}</span></a>`).join('')}</div>`)}
      ${panel('India vs Foreign', `<div class="panel-b"><div class="split2"><div><div class="l">India</div><div class="v">${india.leads}</div><div class="s">${india.converted} converted · ${pct(india.conversion)}</div><div class="s">${money(india.pipeline)} open</div></div>
        <div><div class="l">Foreign</div><div class="v">${foreign.leads}</div><div class="s">${foreign.converted} converted · ${pct(foreign.conversion)}</div><div class="s">${money(foreign.pipeline)} open</div></div></div>
        ${a.by_side.filter((s) => s.name !== 'Not set').length ? `<div class="split2" style="margin-top:14px">${a.by_side.filter((s) => s.name !== 'Not set').map((s) => `<div><div class="l">${esc(s.name)}s</div><div class="v">${s.leads}</div><div class="s">${s.converted} converted · ${pct(s.conversion)}</div></div>`).join('')}</div>` : ''}</div>`)}
    </div>
    ${panel(a.year ? `New leads vs converted — ${a.year}` : 'New leads vs converted — last 12 months', `<div class="panel-b">${lineChart([{ name: 'New Leads', values: a.monthly.map((m) => m.added), color: 'var(--accent)', fill: true }, { name: 'Converted', values: a.monthly.map((m) => m.converted), color: 'var(--green)' }, { name: 'Lost / closed', values: a.monthly.map((m) => m.lost), color: 'var(--red)', dash: true }], { labels: a.monthly.map((m) => mon(m.month)), fmt: (n) => String(Math.round(n)) })}</div>`, '<div class="legend"><span style="--c:var(--accent)">New Leads</span><span style="--c:var(--green)">Converted</span><span style="--c:var(--red)">Lost / closed</span></div>')}
    ${panel('Department & Product Analytics', table(a.by_department, 'Department / Product', DEPT, { side: true, link: (r) => (r.name === 'Not set' ? '#/leads?view=list' : `#/leads?view=list&department=${encodeURIComponent(r.name)}`) }))}
    ${panel('Lead Source Analytics', table(a.by_source, 'Lead Source', SRC, { link: (r) => (r.name === 'Not set' ? '#/leads' : `#/leads?source=${encodeURIComponent(r.name)}`) }))}
    <div class="dash-row">${panel('By Assigned To', table(a.by_owner, 'Assigned To', [C.leads, C.open, C.conv, C.rate, C.overdue]))}${panel('By Category', table(a.by_category, 'Category', [C.leads, C.open, C.conv, C.rate, C.pipe]))}</div>
    ${panel('Monthly Analytics', `<div class="tbl-scroll"><table class="t rep"><thead><tr><th>Month</th><th class="num">New Leads</th><th class="num">Converted</th><th class="num">India Converted</th><th class="num">Foreign Converted</th><th class="num">Conversion Rate</th><th class="num">New Pipeline</th><th class="num">Follow-Ups Scheduled</th><th class="num">Currently Overdue</th></tr></thead>
      <tbody>${(a.year ? a.monthly : [...a.monthly].reverse()).map((m) => `<tr><td>${mon(m.month)}</td><td class="num">${m.added || '—'}</td><td class="num">${m.converted || '—'}</td><td class="num">${m.india_converted || '—'}</td><td class="num">${m.foreign_converted || '—'}</td><td class="num">${m.added ? pct(m.conversion) : '—'}</td><td class="num">${m.value_added ? money(m.value_added) : '—'}</td><td class="num">${m.followups_scheduled || '—'}</td><td class="num">${m.overdue ? `<span class="neg">${m.overdue}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>`,
      `<label class="inline-sel"><span class="muted small">Analysis Year</span><select id="ayear" aria-label="Analysis Year"><option value="">Last 12 months</option>${[...new Set([...(a.years || []), String(new Date().getFullYear())])].sort().reverse().map((y) => `<option ${a.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></label>`)}
    </div><p class="small muted" style="margin-top:12px">Weighted pipeline uses the stage guide from your sheet: New 10%, Contacted 20%, Qualified 35%, Demo/Meeting 50%, Proposal 65%, Negotiation 80%.</p>`;
  delegate(el, 'tr[data-href]', 'click', (tr) => { location.hash = tr.dataset.href; });
  $('#ayear', el).addEventListener('change', (e) => { location.hash = '#/sales-report' + (e.target.value ? '?year=' + e.target.value : ''); });
}, { title: 'Sales report', needs: 'leads' });

/* ---------- Contact Log: every call, WhatsApp, email, meeting, demo, proposal or visit ---------- */
route('/contact-log', async ({ el, query }) => {
  const p = new URLSearchParams(); for (const k of ['kind', 'user_id', 'from', 'to']) if (query[k]) p.set(k, query[k]);
  const rows = await GET('/contact-log' + (p.toString() ? '?' + p : ''));
  const kindL = Object.fromEntries(OPT.contactKind);
  el.innerHTML = pageHead('Contact Log', 'Every contact with every lead — logged from a lead’s page or Follow-ups with “Log contact”.', `<a class="btn" href="#/followups">${icon('phone')}Follow-ups</a><button class="btn" id="clcsv">${icon('download')}CSV</button>`)
    + `<div class="toolbar"><select id="clk" aria-label="Contact Type"><option value="">Any Contact Type</option>${OPT.contactKind.map(([v, n]) => `<option value="${v}" ${query.kind === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select id="clu" aria-label="Assigned To"><option value="">Anyone</option>${App.lookups.users.map((u) => `<option value="${u.id}" ${String(query.user_id) === String(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
      <label class="inline-sel"><span class="muted small">From</span><input type="date" id="clf" value="${esc(query.from || '')}"></label><label class="inline-sel"><span class="muted small">To</span><input type="date" id="clt" value="${esc(query.to || '')}"></label></div><div id="cl"></div>`;
  const go = () => { const q = new URLSearchParams(); [['kind', '#clk'], ['user_id', '#clu'], ['from', '#clf'], ['to', '#clt']].forEach(([k, s]) => { const v = $(s, el).value; if (v) q.set(k, v); }); location.hash = '#/contact-log' + (q.toString() ? '?' + q : ''); };
  ['#clk', '#clu', '#clf', '#clt'].forEach((s) => $(s, el).addEventListener('change', go));
  const COLS = [['Activity ID', (r) => r.id], ['Contact Date', (r) => r.contact_date], ['Lead ID', (r) => r.lead_id], ['Company / Person', (r) => r.company], ['Contact Type', (r) => kindL[r.kind] || pretty(r.kind)],
    ['Follow-Up Round', (r) => ROUND_LABEL[r.followup_round] || ''], ['Outcome', (r) => r.body], ['Next Follow-Up Date', (r) => r.next_followup || ''], ['Assigned To', (r) => r.user_name || '']];
  $('#clcsv', el).addEventListener('click', () => csvDownload(`contact-log-${todayStr()}.csv`, [COLS.map((c) => c[0]), ...rows.map((r) => COLS.map((c) => c[1](r) ?? ''))]));
  mountList($('#cl', el), {
    resource: 'contact-log', rows: async () => rows, noun: 'contact', defaultSort: { key: 'contact_date', dir: 'desc' },
    columns: [
      { key: 'id', label: 'Activity ID', num: true, cls: 'opt', render: (r) => `<span class="muted tnum">${r.id}</span>` },
      { key: 'contact_date', label: 'Contact Date', cls: 'nowrap', render: (r) => fshort(r.contact_date) },
      { key: 'lead_id', label: 'Lead ID', num: true, cls: 'opt', render: (r) => `<span class="muted tnum">${r.lead_id}</span>` },
      { key: 'company', label: 'Company / Person', render: (r) => `<b>${esc(r.company || '—')}</b>` },
      { key: 'kind', label: 'Contact Type', render: (r) => esc(kindL[r.kind] || pretty(r.kind)) },
      { key: 'followup_round', label: 'Follow-Up Round', cls: 'opt nowrap', render: (r) => esc(ROUND_LABEL[r.followup_round] || '—') },
      { key: 'body', label: 'Outcome', render: (r) => `<div class="clamp2">${esc(r.body)}</div>` },
      { key: 'next_followup', label: 'Next Follow-Up Date', cls: 'opt nowrap', render: (r) => (r.next_followup ? fshort(r.next_followup) : '<span class="faint">—</span>') },
      { key: 'user_name', label: 'Assigned To', cls: 'opt', render: (r) => who(r.user_name) },
    ],
    onRow: (r) => (location.hash = '#/leads/' + r.lead_id),
    empty: { title: 'No contacts logged yet', text: 'Use “Log contact” on a lead or on Follow-ups after each call, WhatsApp or meeting.' },
  });
}, { title: 'Contact Log', needs: 'leads' });

/* ---------- Grants ---------- */
route('/grants', async ({ el }) => {
  const [grants, expenses] = await Promise.all([GET('/grants'), GET('/expenses')]);
  const sum = (k) => grants.reduce((s, g) => s + (g[k] || 0), 0);
  const req = sum('requested'), rec = sum('received'), used = sum('used');
  el.innerHTML = pageHead('Grants', 'Government and programme funding: what you asked for, what came in, how it was spent and when to report.', `<button class="btn primary" id="addg">${icon('plus')}New grant</button>`)
    + `<div class="kpis">${kpi('Total Requested', money(req))}${kpi('Total Received', money(rec), req ? `${Math.round(100 * rec / req)}% of requested` : '')}${kpi('Still to come', money(Math.max(0, req - rec)))}${kpi('Grant money used', money(used), rec ? `${money(rec - used)} left to spend` : '', rec && used > rec ? 'bad' : '')}</div>
    <div id="gl"></div><section class="panel" style="margin-top:18px"><div class="panel-h"><h2>Spent from grants</h2><span class="muted small">Expenses marked “Paid from grant”</span></div><div id="ge"></div></section>`;
  const add = () => editRecord('grants', null, null, async () => { await refreshLookups(); Router.refresh(); }, { label: 'grant' });
  $('#addg', el).addEventListener('click', add);
  mountList($('#gl', el), {
    resource: 'grants', rows: async () => grants, search: false, noun: 'grant',
    columns: [
      { key: 'id', label: 'Grant ID', num: true, cls: 'opt', render: (r) => `<span class="muted tnum">${r.id}</span>` },
      { key: 'name', label: 'Grant Name', render: (r) => `<b>${esc(r.name)}</b><div class="t2">${esc(r.funder || '')}</div>` },
      { key: 'applied_on', label: 'Application Date', cls: 'opt nowrap', render: (r) => (r.applied_on ? fshort(r.applied_on) : '<span class="faint">—</span>') },
      { key: 'status', label: 'Status', render: (r) => badge(r.status) },
      { key: 'requested', label: 'Amount Requested', num: true, render: (r) => (r.requested ? money(r.requested) : '—') }, { key: 'received', label: 'Amount Received', num: true, render: (r) => (r.received ? money(r.received) : '—') },
      { key: 'pending', label: 'To come', num: true, sort: (r) => (r.requested || 0) - (r.received || 0), render: (r) => ((r.requested || 0) - (r.received || 0) > 0 ? money(r.requested - r.received) : '—') },
      { key: 'used', label: 'Used', num: true, render: (r) => `${r.used ? money(r.used) : '—'}${r.received ? `<div class="t2">${Math.round(100 * (r.used || 0) / r.received)}% of received</div>` : ''}` },
      { key: 'next_report_date', label: 'Next Reporting Date', render: (r) => (r.next_report_date ? dueBadge(r.next_report_date) : '<span class="faint">—</span>') },
    ],
    onRow: (r) => editRecord('grants', r, null, async () => { await refreshLookups(); Router.refresh(); }, { label: 'grant', afterDelete: async () => { await refreshLookups(); Router.refresh(); } }),
    empty: { title: 'No grants yet', text: 'Add a startup or government grant to track requested, received and spent amounts, and reporting dates.' },
  });
  const spent = expenses.filter((e) => e.grant_id);
  mountList($('#ge', el), {
    resource: 'expenses', rows: async () => spent, search: false, compact: true, noun: 'expense', defaultSort: { key: 'date', dir: 'desc' },
    columns: [{ key: 'date', label: 'Date', render: (r) => fdate(r.date) }, { key: 'grant_name', label: 'Grant Name', render: (r) => esc(r.grant_name || '—') }, { key: 'vendor', label: 'Vendor', render: (r) => `<b>${esc(r.vendor || '—')}</b><div class="t2">${esc(r.description || '')}</div>` },
      { key: 'category', label: 'Category', render: (r) => esc(r.category || '—') }, { key: 'amount', label: 'Amount', num: true, render: (r) => `<b>${money2(r.amount)}</b>` }],
    onRow: (r) => editRecord('expenses', r, null, () => Router.refresh(), { label: 'expense' }),
    empty: { title: 'Nothing spent from grants yet', text: 'When you add an expense, pick the grant under “Paid from grant”.' },
  });
}, { title: 'Grants', founder: true });
