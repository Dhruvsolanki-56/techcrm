/* Pages part 1: routing table, home, pipeline, clients, projects, tasks */
'use strict';

const ROUTES = [];
const route = (path, handler, opts = {}) => ROUTES.push({ path, parts: path.split('/').filter(Boolean), handler, ...opts });
const emptyMini = (t, ic, action) => `<div class="empty mini${ic ? ' iconic' : ''}">${ic ? `<span class="em-i">${icon(ic)}</span>` : ''}<span>${esc(t)}</span>${action || ''}</div>`;
const listCard = (title, body, right) => panel(title, body, right);

const STAGE_TONE = { new: 'var(--faint)', contacted: 'var(--blue)', meeting: '#5b7fd6', proposal: 'var(--accent)', negotiation: 'var(--plum)', won: 'var(--green)', lost: 'var(--red)' };
const TASK_TONE = { todo: 'var(--faint)', in_progress: 'var(--blue)', review: '#d99312', done: 'var(--green)' };

/* ---------- generic kanban ---------- */
function kanban(root, { cols, items, group, card, onMove, onOpen, head }) {
  root.innerHTML = `<div class="kanban">${cols.map((c) => {
    const list = items.filter((i) => group(i) === c.v);
    return `<div class="kcol" data-col="${c.v}"><div class="kcol-h"><span class="dot" style="--c:${c.c || 'var(--faint)'}"></span><span>${esc(c.l)}</span><span class="n">${list.length}</span><span class="sum">${head ? head(list, c) : ''}</span></div>
      <div class="kcol-b">${list.map((i) => `<div class="kcard" draggable="true" data-id="${i.id}">${card(i)}</div>`).join('') || '<div class="kdrop">Drop here</div>'}</div></div>`;
  }).join('')}</div>`;
  let dragging = null;
  root.ondragstart = (e) => { const c = e.target.closest('.kcard'); if (!c) return; dragging = c.dataset.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragging); };
  root.ondragend = (e) => { const c = e.target.closest('.kcard'); if (c) c.classList.remove('dragging'); $$('.kcol.over', root).forEach((x) => x.classList.remove('over')); };
  root.ondragover = (e) => { const col = e.target.closest('.kcol'); if (col) { e.preventDefault(); $$('.kcol.over', root).forEach((x) => x !== col && x.classList.remove('over')); col.classList.add('over'); } };
  root.ondrop = (e) => { const col = e.target.closest('.kcol'); if (!col || !dragging) return; e.preventDefault(); col.classList.remove('over'); const id = dragging; dragging = null; onMove(id, col.dataset.col); };
  root.onclick = (e) => { const c = e.target.closest('.kcard'); if (c && !e.target.closest('a, button')) onOpen(c.dataset.id); };
}

/* line chart: animated draw-in, hover / touch / arrow-key crosshair with a tooltip card */
function lineChart(series, { h = 200, labels, fmt = compact } = {}) {
  const sm = innerWidth < 640;      // phones: taller drawing so text stays readable once scaled down
  const W = 640, H = sm ? Math.round(h * 1.9) : h, L = sm ? 60 : 44, R = 12, T = 14, B = sm ? 42 : 28; const n = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const raw = max / 4; const mag = 10 ** Math.floor(Math.log10(raw)); const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw); const top = step * 4;
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1)); const y = (v) => T + (H - T - B) * (1 - v / top);
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const data = { labels, xs: labels.map((_, i) => x(i)), series: series.map((s) => ({ name: s.name, color: s.color, values: s.values, ys: s.values.map(y) })) };
  return `<div class="chartw" data-chart="${esc(JSON.stringify(data))}" tabindex="0" aria-label="${esc(series.map((s) => s.name).join(' and '))} by month. Use the arrow keys to read each month.">
    <svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-hidden="true">
    ${[0, 1, 2, 3, 4].map((k) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(step * k)}" y2="${y(step * k)}"/><text x="${L - 8}" y="${y(step * k) + 4}" text-anchor="end">${fmt(step * k)}</text>`).join('')}
    ${labels.map((l, i) => `<text x="${x(i)}" y="${H - (sm ? 6 : 8)}" text-anchor="middle" class="xl" data-i="${i}">${esc(l)}</text>`).join('')}
    <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}"/>
    <g class="series">${series.map((s) => `${s.fill ? `<path class="area" d="${path(s.values)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z" style="fill:${s.color}"/>` : ''}<path d="${path(s.values)}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>`).join('')}</g>
    ${series.map((s, si) => `<circle class="hit" data-s="${si}" r="4.5" cx="-20" cy="-20" style="stroke:${s.color}"/>`).join('')}
    </svg><div class="ctip" role="status"></div></div>`;
}
// one set of listeners for every chart on any page
(() => {
  const show = (w, i) => {
    const d = JSON.parse(w.dataset.chart); i = Math.max(0, Math.min(d.labels.length - 1, i)); w.dataset.i = i;
    const svg = $('svg', w); const k = svg.getBoundingClientRect().width / 640;
    $('.cross', svg).setAttribute('x1', d.xs[i]); $('.cross', svg).setAttribute('x2', d.xs[i]);
    d.series.forEach((s, si) => { const c = $(`circle[data-s="${si}"]`, svg); c.setAttribute('cx', d.xs[i]); c.setAttribute('cy', s.ys[i]); });
    $$('.xl', svg).forEach((t) => t.classList.toggle('on', Number(t.dataset.i) === i));
    const net = d.series.length === 2 ? d.series[0].values[i] - d.series[1].values[i] : null;
    const tip = $('.ctip', w);
    tip.innerHTML = `<b>${esc(d.labels[i])}</b>${d.series.map((s) => `<div class="r"><i style="background:${s.color}"></i><span>${esc(s.name)}</span><em>${money(s.values[i])}</em></div>`).join('')}${net !== null ? `<div class="r net"><span>Net</span><em class="${net < 0 ? 'neg' : 'pos'}">${net < 0 ? '−' : ''}${money(Math.abs(net))}</em></div>` : ''}`;
    w.classList.add('hover');
    const px = d.xs[i] * k; const tw = tip.offsetWidth; const ww = w.clientWidth;
    let left = px + 14 + tw > ww ? px - tw - 14 : px + 14; left = Math.max(0, Math.min(ww - tw, left)); tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, Math.min(...d.series.map((s) => s.ys[i])) * k - 20)}px`;
  };
  const hide = (w) => { w.classList.remove('hover'); $$('.xl.on', w).forEach((t) => t.classList.remove('on')); };
  const idx = (w, clientX) => { const d = JSON.parse(w.dataset.chart); const r = $('svg', w).getBoundingClientRect(); const px = (clientX - r.left) / (r.width / 640); let best = 0; d.xs.forEach((v, i) => { if (Math.abs(v - px) < Math.abs(d.xs[best] - px)) best = i; }); return best; };
  document.addEventListener('pointermove', (e) => { const w = e.target.closest?.('.chartw'); $$('.chartw.hover').forEach((c) => c !== w && hide(c)); if (w) show(w, idx(w, e.clientX)); });
  document.addEventListener('pointerdown', (e) => { const w = e.target.closest?.('.chartw'); if (w) show(w, idx(w, e.clientX)); });
  document.addEventListener('pointerleave', () => $$('.chartw.hover').forEach(hide));
  document.addEventListener('focusout', (e) => { if (e.target.classList?.contains('chartw')) hide(e.target); });
  document.addEventListener('keydown', (e) => {
    const w = document.activeElement; if (!w?.classList?.contains('chartw')) return;
    const cur = w.dataset.i === undefined || !w.classList.contains('hover') ? JSON.parse(w.dataset.chart).labels.length - 1 : Number(w.dataset.i);
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(w, cur - (w.classList.contains('hover') ? 1 : 0)); } else if (e.key === 'ArrowRight') { e.preventDefault(); show(w, cur + (w.classList.contains('hover') ? 1 : 0)); } else if (e.key === 'Escape') hide(w);
  });
})();

/* =====================================================  HOME  ===================================================== */
const taskLine = (t, showWho) => `<div class="li" data-task="${t.id}" style="cursor:pointer"><button class="check-btn" data-done="${t.id}" title="Mark as done" aria-label="Mark ${esc(t.title)} as done"></button>
  <div class="grow"><div class="t">${esc(t.title)}</div><div class="s">${esc(t.project_name || 'No project')}${showWho && t.assignees && t.assignees.length ? ' · ' + esc(peopleNames(t.assignees)) : ''}${t.comment_count ? ` · ${t.comment_count} comment${t.comment_count === 1 ? '' : 's'}` : ''}</div></div>${PRIORITY[t.priority] >= 3 ? prio(t.priority) : ''}${dueBadge(t.due_date)}</div>`;

async function completeTask(id, after) {
  try { await PUT('/tasks/' + id, { status: 'done' }); toast('Nice — task marked as done'); if (after) after(); } catch (e) { fail(e); }
}

route('/dashboard', async ({ el }) => {
  const d = await GET('/dashboard'); const k = d.kpi; const f = isFounder(); const now = new Date();
  const greet = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const dateLine = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  // everything that needs a decision today, in one queue
  const att = [];
  (d.overdue_invoices || []).forEach((i) => att.push({ kind: 'Invoice', when: i.due_date, title: `${i.client_name} owes ${money(i.balance)}`, sub: `${i.number} · was due ${fshort(i.due_date)}`, link: `#/invoices/${i.id}` }));
  (d.overdue_tasks || []).forEach((t) => att.push({ kind: 'Task', when: t.due_date, title: t.title, sub: `${t.assignee_name || 'Unassigned'} · ${t.project_name || 'No project'}`, task: t.id }));
  (d.followups || []).filter((l) => l.next_followup <= todayStr()).forEach((l) => att.push({ kind: 'Follow-up', when: l.next_followup, title: `Call ${l.name}`, sub: `${l.company || ''} · ${pretty(STATUS_LABEL[l.stage] || l.stage)}`, link: `#/leads/${l.id}` }));
  (d.renewals || []).filter((r) => daysUntil(r.renewal_date) <= 7).forEach((r) => att.push({ kind: 'Renewal', when: r.renewal_date, title: r.name, sub: `${r.client_name || ''} · ${pretty(r.kind)}`, link: '#/renewals' }));
  (d.deadlines || []).filter((p) => daysUntil(p.deadline) <= 3).forEach((p) => att.push({ kind: 'Deadline', when: p.deadline, title: p.name, sub: p.client_name || '', link: `#/projects/${p.id}` }));
  att.sort((a, b) => a.when.localeCompare(b.when));
  // when little is urgent, show what is coming up this week so the card stays useful
  const soon = [];
  (d.followups || []).filter((l) => l.next_followup > todayStr() && daysUntil(l.next_followup) <= 7).forEach((l) => soon.push({ kind: 'Follow-up', when: l.next_followup, title: `Call ${l.name}`, sub: l.company || '', link: `#/leads/${l.id}` }));
  (d.renewals || []).filter((r) => daysUntil(r.renewal_date) > 7 && daysUntil(r.renewal_date) <= 21).forEach((r) => soon.push({ kind: 'Renewal', when: r.renewal_date, title: r.name, sub: r.client_name || '', link: '#/renewals' }));
  (d.deadlines || []).filter((p) => daysUntil(p.deadline) > 3 && daysUntil(p.deadline) <= 14).forEach((p) => soon.push({ kind: 'Deadline', when: p.deadline, title: p.name, sub: p.client_name || '', link: `#/projects/${p.id}` }));
  soon.sort((a, b) => a.when.localeCompare(b.when));
  const attLine = (a) => `<${a.link ? `a href="${a.link}"` : `div data-task="${a.task}"`} class="li" style="cursor:pointer"><span class="kind">${a.kind}</span><div class="grow"><div class="t">${esc(a.title)}</div><div class="s">${esc(a.sub)}</div></div>${dueBadge(a.when)}</${a.link ? 'a' : 'div'}>`;
  const room = Math.max(0, 6 - Math.min(att.length, 6));
  const attHtml = (att.length ? `<div class="list">${att.slice(0, 6).map(attLine).join('')}</div>` : emptyMini('Nothing is overdue or waiting on you. Good place to be.', 'check'))
    + (room && soon.length ? `<div class="sub-h">Coming up</div><div class="list">${soon.slice(0, att.length ? room - 1 : 3).map(attLine).join('')}</div>` : '');

  let html = pageHead('Home', '', f ? `<button class="btn" id="q-lead">${icon('plus')}Lead</button><a class="btn primary" href="#/invoices/new">${icon('plus')}Invoice</a>` : '<a class="btn primary" href="#/tasks">Open my work</a>', '<b>Home</b>');
  html += `<div class="hello"><h1>${greet}, ${esc(App.user.name.split(' ')[0])}</h1><div class="sub">${dateLine} · ${att.length ? `${plural(att.length, 'thing')} need${att.length === 1 ? 's' : ''} attention` : 'all clear'}</div></div>`;
  if (f) {
    const net = k.month_income - k.month_expense;
    html += `<div class="kpis">${kpi('Collected this month', money(k.month_income), `Spent ${money(k.month_expense)}`)}${kpi('Net this month', money(net), 'Collected − spent', net < 0 ? 'bad' : '')}
      ${kpi('Outstanding', money(k.receivables), k.overdue.n ? `<span class="neg">${money(k.overdue.v)} overdue</span>` : 'Nothing overdue')}${kpi('Open pipeline', money(k.open_leads.v), `${plural(k.open_leads.n, 'open deal')}`)}${kpi('Cash in bank', money(k.cash), `${money(k.mrr)}/mo recurring`)}</div>`;
    const tr = d.trend || [];
    const lbl = tr.map((t) => new Date(t.month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' }));
    const left = [
      panel('Cash flow', `<div class="panel-b">${lineChart([{ name: 'Collected', values: tr.map((t) => t.income), color: 'var(--accent)', fill: true }, { name: 'Spent', values: tr.map((t) => t.expense), color: '#c47f17', dash: true }], { labels: lbl })}</div>`,
        `<div class="legend"><span style="--c:var(--accent)">Collected</span><span style="--c:#c47f17">Spent</span></div>`),
      panel('Needs attention', attHtml, `<span class="muted small">${att.length || ''}</span>`),
      panel('Projects in flight', d.my_projects.length ? `<div class="tbl-scroll"><table class="t"><tbody>${d.my_projects.map((p) => `<tr class="click" data-href="#/projects/${p.id}"><td><div class="who">${logoSq(p.name, 'sm')}<div style="min-width:0"><div class="t1 ellipsis">${esc(p.name)}</div><div class="t2 ellipsis">${esc(p.client_name || '')}</div></div></div></td>
        <td>${badge(p.status)}</td><td><div class="prog"><div class="bar"><i style="width:${p.task_count ? Math.round(100 * p.tasks_done / p.task_count) : 0}%"></i></div>${p.task_count ? Math.round(100 * p.tasks_done / p.task_count) + '%' : '—'}</div></td><td class="num">${dueBadge(p.deadline)}</td><td style="width:40px">${p.manager_name ? avatar(p.manager_name, 'sm') : ''}</td></tr>`).join('')}</tbody></table></div>` : emptyMini('No active projects.', 'briefcase', '<a class="btn sm" href="#/projects">Projects</a>'), '<a href="#/projects">All projects</a>'),
    ];
    const stages = OPT.leadStage.filter(([v]) => !['won', 'lost'].includes(v));
    const pmax = Math.max(1, ...stages.map(([v]) => (d.pipeline[v] || {}).v || 0));
    const right = [
      panel('My tasks', d.my_tasks.length ? `<div class="list">${d.my_tasks.slice(0, 5).map((t) => taskLine(t)).join('')}</div>` : emptyMini('Nothing assigned to you. Enjoy the quiet.', 'check', '<a class="btn sm" href="#/tasks?scope=all">See the team board</a>'), '<a href="#/tasks">My work</a>'),
      panel('Pipeline', `<div class="panel-b funnel">${stages.map(([v, l]) => { const s = d.pipeline[v] || { n: 0, v: 0 }; return `<div class="r"><span class="muted">${esc(l)}</span><div class="tr"><i style="width:${Math.max(8, 100 * s.v / pmax)}%">${s.n}</i></div><span class="right tnum">${compact(s.v)}</span></div>`; }).join('')}</div>`, '<a href="#/leads">Open pipeline</a>'),
      panel('Team', `<div class="list">${d.team_load.map((u) => `<a class="li" href="#/tasks?scope=all&assignee=${u.id}">${avatar(u.name)}<div class="grow"><div class="t">${esc(u.name)}</div><div class="s">${u.open_tasks} open${u.overdue_tasks ? ` · <span class="neg">${u.overdue_tasks} overdue</span>` : ''}</div></div><span class="small muted">${u.done_week} done this week</span></a>`).join('')}</div>`),
      panel('Recent activity', d.activity.length ? `<div class="list act-grid">${d.activity.slice(0, 6).map((a) => `<div class="act">${avatar(a.user_name || '?', 'sm')}<div class="grow ellipsis" title="${esc(a.detail || '')}"><b>${esc((a.user_name || 'System').split(' ')[0])}</b> <span class="x">${esc(a.action === 'create' ? 'added' : a.action === 'update' ? 'updated' : a.action === 'delete' ? 'deleted' : a.action === 'convert' ? 'converted' : a.action === 'upload' ? 'uploaded' : a.action)} ${esc((a.entity || '').replace(/_/g, ' ').replace(/s$/, ''))}</span> ${esc(a.detail || '')}</div><span class="w">${ago(a.at)}</span></div>`).join('')}</div>` : emptyMini('Nothing yet.'), '<a href="#/team?tab=activity">Full log</a>'),
    ];
    // rows, not two free columns: cards side by side always share a height, so nothing leaves a gap
    html += `<div class="dash">${[[left[0], right[1]], [left[1], right[2]], [left[2], right[0]]].map(([a, b]) => `<div class="dash-row">${a}${b}</div>`).join('')}${right[3]}</div>`;
  } else {
    const week = d.my_tasks.filter((t) => t.due_date && daysUntil(t.due_date) <= 7).length;
    html += `<div class="kpis">${kpi('Open tasks', d.my_tasks.length)}${kpi('Due this week', week)}${kpi('Overdue', d.tasks_overdue, '', d.tasks_overdue ? 'bad' : '')}${kpi('My projects', d.my_projects.length)}</div>
      <div class="dash"><div class="dash-row">${panel('My tasks', d.my_tasks.length ? `<div class="list">${d.my_tasks.map((t) => taskLine(t)).join('')}</div>` : emptyMini('Nothing assigned to you right now.'), '<a href="#/tasks">Board</a>')}
      ${panel('Upcoming deadlines', d.deadlines.length ? `<div class="list">${d.deadlines.map((p) => `<a class="li" href="#/projects/${p.id}">${logoSq(p.name, 'sm')}<div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(p.client_name || '')}</div></div>${dueBadge(p.deadline)}</a>`).join('')}</div>` : emptyMini('No deadlines in the next 3 weeks.'))}</div>
      <div class="dash-row">${panel('My projects', d.my_projects.length ? `<div class="list">${d.my_projects.map((p) => `<a class="li" href="#/projects/${p.id}">${logoSq(p.name, 'sm')}<div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(p.client_name || '')}</div></div>${badge(p.status)}</a>`).join('')}</div>` : emptyMini('You have not been added to a project yet.'))}
      ${d.renewals ? panel('Renewals coming up', d.renewals.length ? `<div class="list">${d.renewals.map((r) => `<a class="li" href="#/renewals"><div class="grow"><div class="t">${esc(r.name)}</div><div class="s">${esc(r.client_name || '')}</div></div>${dueBadge(r.renewal_date)}</a>`).join('')}</div>` : emptyMini('Nothing due.')) : ''}</div></div>`;
  }
  el.innerHTML = html;
  const ql = $('#q-lead', el); if (ql) ql.addEventListener('click', () => editRecord('leads', null, { owner_id: App.user.id }, (l) => l && (location.hash = '#/leads/' + l.id), { label: 'lead' }));
  delegate(el, '[data-done]', 'click', (b, e) => { e.stopPropagation(); b.style.background = 'var(--accent)'; completeTask(b.dataset.done, () => Router.refresh()); });
  delegate(el, '[data-task]', 'click', async (t, e) => { if (e.target.closest('[data-done]')) return; try { openTask(await GET('/tasks/' + t.dataset.task), () => Router.refresh()); } catch (err) { fail(err); } });
  delegate(el, 'tr[data-href]', 'click', (tr) => { location.hash = tr.dataset.href; });
}, { title: 'Home' });

/* =====================================================  PIPELINE (LEADS)  ===================================================== */
const leadCard = (l) => `<div class="t">${esc(l.company || l.name)}</div><div class="s">${esc(l.company ? l.name : '')}${l.service ? (l.company ? ' · ' : '') + esc(l.service) : ''}</div>
  <div class="f"><b class="tnum">${l.value ? money(l.value) : '<span class="faint">No value</span>'}</b><span class="grow"></span>${!['won', 'lost'].includes(l.stage) && l.next_followup ? dueBadge(l.next_followup) : ''}${l.owner_name ? avatar(l.owner_name, 'sm') : ''}</div>`;

async function moveLead(id, stage, after) {
  try {
    const body = { stage };
    if (stage === 'lost') { const r = await promptBox('Mark as lost', 'What was the reason? It helps spot patterns later.', ''); if (r === null) return after(); if (r) body.lost_reason = r; }
    await PUT('/leads/' + id, body); toast(`Moved to ${STATUS_LABEL[stage] || pretty(stage)}`);
  } catch (e) { fail(e); }
  after();
}

route('/leads', async ({ el }) => {
  const view = localStorage.getItem('leadView') || 'board';
  const leads = await GET('/leads');
  const open = leads.filter((l) => !['won', 'lost'].includes(l.stage));
  const won = leads.filter((l) => l.stage === 'won');
  const winRate = won.length + leads.filter((l) => l.stage === 'lost').length ? Math.round(100 * won.length / (won.length + leads.filter((l) => l.stage === 'lost').length)) : null;
  el.innerHTML = pageHead('Pipeline', '', `<div class="seg"><button class="${view === 'board' ? 'on' : ''}" data-v="board">Board</button><button class="${view === 'list' ? 'on' : ''}" data-v="list">List</button></div>
    ${isFounder() ? `<button class="btn" id="implead">${icon('upload')}Import</button>` : ''}<button class="btn primary" id="addlead">${icon('plus')}New lead</button>`, '<b>Pipeline</b>')
    + `<div class="pt"><div><h1>Pipeline</h1><div class="sub">${plural(open.length, 'open deal')} worth <b style="color:var(--ink)">${money(open.reduce((s, l) => s + (l.value || 0), 0))}</b>${winRate !== null ? ` · ${winRate}% win rate` : ''} · ${open.filter((l) => l.next_followup && l.next_followup <= todayStr()).length} follow-ups due</div></div></div><div id="lead-body"></div>`;
  $$('[data-v]', el).forEach((b) => b.addEventListener('click', () => { localStorage.setItem('leadView', b.dataset.v); Router.refresh(); }));
  $('#addlead', el).addEventListener('click', () => editRecord('leads', null, { owner_id: App.user.id }, () => Router.refresh(), { label: 'lead' }));
  const il = $('#implead', el); if (il) il.addEventListener('click', () => importModal('leads', () => Router.refresh()));
  const body = $('#lead-body', el);
  if (view === 'list') {
    mountList(body, {
      resource: 'leads', rows: async () => leads, searchPlaceholder: 'Search deals…', defaultSort: { key: 'created_at', dir: 'desc' }, noun: 'lead',
      filters: [{ key: 'stage', label: 'Stage', options: OPT.leadStage }, { key: 'owner_id', label: 'Owner', lookup: 'users' }, { key: 'source', label: 'Source', options: OPT.leadSource }],
      columns: [
        { key: 'company', label: 'Deal', render: (r) => `<div class="who">${logoSq(r.company || r.name, 'sm')}<div style="min-width:0"><div class="t1 ellipsis">${esc(r.company || r.name)}</div><div class="t2 ellipsis">${esc(r.company ? r.name : '')}</div></div></div>` },
        { key: 'stage', label: 'Stage', render: (r) => badge(r.stage) }, { key: 'value', label: 'Value', num: true, render: (r) => (r.value ? money(r.value) : '<span class="faint">—</span>') },
        { key: 'service', label: 'Interested in', render: (r) => esc(r.service || '—') }, { key: 'next_followup', label: 'Follow-up', render: (r) => (['won', 'lost'].includes(r.stage) ? '<span class="faint">—</span>' : dueBadge(r.next_followup)) },
        { key: 'owner_name', label: 'Owner', render: (r) => who(r.owner_name) }, { key: 'source', label: 'Source', render: (r) => `<span class="muted">${esc(r.source || '—')}</span>` },
      ],
      onRow: (r) => (location.hash = '#/leads/' + r.id), empty: { title: 'No leads yet', text: 'Add the enquiries you are working on.' },
    });
  } else if (!leads.length) {
    body.innerHTML = '<div class="panel"><div class="empty"><b>Your pipeline is empty</b>Add the enquiries you are working on with New lead, or bring them in from Excel with Import.</div></div>';
  } else {
    kanban(body, { cols: OPT.leadStage.map(([v, l]) => ({ v, l, c: STAGE_TONE[v] })), items: leads, group: (l) => l.stage, card: leadCard,
      head: (list) => (list.length ? compact(list.reduce((s, l) => s + (l.value || 0), 0)) : ''), onOpen: (id) => (location.hash = '#/leads/' + id), onMove: (id, st) => moveLead(id, st, () => Router.refresh()) });
  }
}, { title: 'Pipeline', needs: 'leads' });

route('/leads/:id', async ({ el, params, query }) => {
  const l = await GET('/leads/' + params.id); const tab = query.tab || 'activity'; const f = isFounder();
  const tabs = [{ key: 'activity', label: 'Activity' }, { key: 'tasks', label: 'Tasks' }, { key: 'files', label: 'Files' }, ...(f ? [{ key: 'quotes', label: 'Quotations' }] : [])];
  const days = Math.max(0, Math.round((Date.now() - new Date(String(l.created_at).replace(' ', 'T') + 'Z')) / 86400000));
  el.innerHTML = pageHead(esc(l.name), '', `${f && !l.client_id && l.stage !== 'lost' ? `<button class="btn accent" id="convert">${icon('check')}Convert to client</button>` : ''}${f ? `<a class="btn" href="#/quotes/new?lead=${l.id}">New quotation</a>` : ''}<button class="btn" id="edit">${icon('edit')}Edit</button>`, `<a href="#/leads">Pipeline</a> / ${esc(l.company || l.name)}`)
    + `<div class="record"><div class="record-main"><div class="rec-head">${logoSq(l.company || l.name)}<div><h1>${esc(l.company || l.name)}</h1><div class="meta">${badge(l.stage)}${l.company ? `<span>${esc(l.name)}</span>` : ''}${l.source ? `<span>via ${esc(l.source)}</span>` : ''}${l.client_id ? `<a href="#/clients/${l.client_id}">Now a client →</a>` : ''}</div></div></div>
      <div class="highlights">${hl('Deal value', l.value ? money(l.value) : '—', esc(l.service || ''))}${hl('Next follow-up', l.next_followup ? fshort(l.next_followup) : '—', l.next_followup ? (daysUntil(l.next_followup) < 0 ? `<span class="neg">${-daysUntil(l.next_followup)} days late</span>` : daysUntil(l.next_followup) === 0 ? 'Today' : `in ${daysUntil(l.next_followup)} days`) : 'Not scheduled', l.next_followup && daysUntil(l.next_followup) < 0 && !['won', 'lost'].includes(l.stage) ? 'bad' : '')}
        ${hl('Expected close', l.expected_close ? fshort(l.expected_close) : '—')}${hl('In pipeline', plural(days, 'day'), `since ${fshort(l.created_at)}`)}</div>
      ${tabsHtml(tabs, tab, '#/leads/' + l.id)}<div id="tab"></div></div>
      <aside class="record-side">${propsSec('Deal', `${prop('Stage', `<select id="stg">${OPT.leadStage.map(([v, n]) => `<option value="${v}" ${v === l.stage ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}${prop('Value', l.value ? money(l.value) : '')}${prop('Interested in', esc(l.service || ''))}${prop('Source', esc(l.source || ''))}${prop('Owner', l.owner_name ? who(l.owner_name) : '')}${l.lost_reason ? prop('Lost because', esc(l.lost_reason)) : ''}`)}
        ${propsSec('Contact', `${prop('Name', esc(l.name))}${prop('Email', l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : '')}${prop('Phone', l.phone ? `<a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>` : '')}${prop('City', esc(l.city || ''))}${prop('Website', l.website ? extLink(l.website) : '')}`)}
        ${propsSec('Requirements', `<div class="doc-text pre">${l.notes ? esc(l.notes) : '<span class="faint">Nothing written yet.</span>'}</div>`)}</aside></div>`;
  const t = $('#tab', el);
  $('#edit', el).addEventListener('click', () => editRecord('leads', l, null, () => Router.refresh(), { label: 'lead', afterDelete: () => (location.hash = '#/leads') }));
  $('#stg', el).addEventListener('change', (e) => moveLead(l.id, e.target.value, () => Router.refresh()));
  const cv = $('#convert', el);
  if (cv) cv.addEventListener('click', () => {
    const m = openModal({ title: 'Convert to client', sub: l.company || l.name, body: `<p class="muted">Creates a client for <b style="color:var(--ink)">${esc(l.company || l.name)}</b>, adds ${esc(l.name)} as the main contact, and carries over notes, files and quotations.</p>
      <label class="check" style="margin-top:18px"><input type="checkbox" id="cp" checked><span>Also start a project for this deal</span></label>
      <label class="f" style="margin-top:14px"><span>Project name</span><input id="pn" value="${esc((l.company || l.name) + ' — ' + (l.service || 'Project'))}"></label>`,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn accent" id="go">Convert</button>' });
    $('#go', m.el).addEventListener('click', async () => { try { const r = await POST(`/leads/${l.id}/convert`, { create_project: $('#cp', m.el).checked, project_name: $('#pn', m.el).value }); await refreshLookups(); m.close(); toast('Client created'); location.hash = '#/clients/' + r.client_id; } catch (e) { fail(e); } });
  });
  if (tab === 'activity') notesPanel(t, 'lead', l.id, { placeholder: 'Log a call, meeting, WhatsApp chat or next step…' });
  else if (tab === 'tasks') mountList(t, { resource: 'tasks', query: { lead_id: l.id }, search: false, compact: true, noun: 'task', columns: taskColumns(), onRow: (r) => openTask(r, () => Router.refresh()), add: { label: 'Add task', onClick: () => editRecord('tasks', null, { lead_id: l.id, assignee_id: App.user.id }, () => Router.refresh(), { label: 'task' }) }, empty: { title: 'No tasks', text: 'Add reminders like “Send revised proposal”.' } });
  else if (tab === 'files') docsPanel(t, 'lead', l.id, { canUpload: f });
  else if (tab === 'quotes') quotesTable(t, { lead_id: l.id });
}, { title: 'Lead', needs: 'leads' });

/* =====================================================  CLIENTS  ===================================================== */
route('/clients', ({ el }) => {
  el.innerHTML = pageHead('Clients', 'Every company you work with, with everything about them one click away.', isFounder() ? `<button class="btn" id="imp">${icon('upload')}Import</button><button class="btn primary" id="add">${icon('plus')}New client</button>` : '') + '<div id="body"></div>';
  if (isFounder()) $('#imp', el).addEventListener('click', () => importModal('clients', () => Router.refresh()));
  if (isFounder()) $('#add', el).addEventListener('click', () => editRecord('clients', null, null, (c) => c && (location.hash = '#/clients/' + c.id), { label: 'client' }));
  mountList($('#body', el), {
    resource: 'clients', searchPlaceholder: 'Search clients…', noun: 'client', filters: [{ key: 'status', label: 'Status', options: OPT.clientStatus }, { key: 'account_manager_id', label: 'Manager', lookup: 'users' }],
    columns: [
      { key: 'company', label: 'Company', render: (r) => `<div class="who">${logoSq(r.company, 'sm')}<div style="min-width:0"><div class="t1 ellipsis">${esc(r.company)}</div><div class="t2 ellipsis">${esc([r.industry, r.city].filter(Boolean).join(' · '))}</div></div></div>` },
      { key: 'contact_name', label: 'Main contact', render: (r) => (r.contact_name ? `<div class="t1" style="font-weight:450">${esc(r.contact_name)}</div><div class="t2">${esc(r.contact_phone || r.contact_email || '')}</div>` : '<span class="faint">—</span>') },
      { key: 'status', label: 'Status', render: (r) => badge(r.status) }, { key: 'project_count', label: 'Projects', num: true },
      ...(isFounder() ? [{ key: 'lifetime_received', label: 'Received', num: true, render: (r) => (r.lifetime_received ? money(r.lifetime_received) : '<span class="faint">—</span>') }, { key: 'outstanding', label: 'Outstanding', num: true, render: (r) => (r.outstanding > 0 ? `<span class="neg">${money(r.outstanding)}</span>` : '<span class="faint">—</span>') }] : []),
      { key: 'manager_name', label: 'Manager', render: (r) => who(r.manager_name) },
    ],
    onRow: (r) => (location.hash = '#/clients/' + r.id), empty: { title: 'No clients yet', text: 'Convert a won lead, or add a client.' },
  });
}, { title: 'Clients' });

route('/clients/:id', async ({ el, params, query }) => {
  const f = isFounder(); const c = await GET('/clients/' + params.id); const tab = query.tab || 'projects';
  const contacts = await GET('/contacts?client_id=' + c.id);
  const tabs = [{ key: 'projects', label: 'Projects' }, { key: 'activity', label: 'Activity' }, ...(f ? [{ key: 'billing', label: 'Invoices & payments' }] : []), { key: 'files', label: 'Files' },
    ...(f ? [{ key: 'vault', label: 'Credentials' }] : []), ...(can('maintenance') ? [{ key: 'care', label: f ? 'Maintenance & renewals' : 'Maintenance' }] : [])];
  el.innerHTML = pageHead(esc(c.company), '', f ? `<a class="btn" href="#/invoices/new?client=${c.id}">${icon('plus')}Invoice</a><button class="btn" id="edit">${icon('edit')}Edit</button>` : '', `<a href="#/clients">Clients</a> / ${esc(c.company)}`)
    + `<div class="record"><div class="record-main"><div class="rec-head">${logoSq(c.company)}<div><h1>${esc(c.company)}</h1><div class="meta">${badge(c.status)}${c.industry ? `<span>${esc(c.industry)}</span>` : ''}${c.city ? `<span>${esc(c.city)}</span>` : ''}${c.website ? extLink(c.website) : ''}</div></div></div>
      <div class="highlights">${f ? hl('Received to date', money(c.lifetime_received)) + hl('Outstanding', money(c.outstanding), c.outstanding > 0 ? 'Unpaid invoices' : 'All settled', c.outstanding > 0 ? 'bad' : '') : ''}${hl('Projects', c.project_count)}${hl('Client since', fshort(c.created_at))}</div>
      ${tabsHtml(tabs, tab, '#/clients/' + c.id)}<div id="tab"></div></div>
      <aside class="record-side">${propsSec('Details', `${prop('Status', badge(c.status))}${prop('Manager', c.manager_name ? who(c.manager_name) : '')}${prop('Industry', esc(c.industry || ''))}${prop('Website', c.website ? extLink(c.website) : '')}${prop('GSTIN', c.gstin ? `<span class="mono">${esc(c.gstin)}</span>` : '')}${prop('PAN', c.pan ? `<span class="mono">${esc(c.pan)}</span>` : '')}${prop('Address', esc([c.address, c.city, c.state].filter(Boolean).join(', ')))}${prop('Tags', c.tags ? `<span class="tags">${c.tags.split(',').map((x) => `<span class="tag">${esc(x.trim())}</span>`).join('')}</span>` : '')}`)}
        ${propsSec(`People · ${contacts.length}`, contacts.length ? contacts.map((p) => `<div class="person ${f ? 'click' : ''}" data-contact="${p.id}" style="${f ? 'cursor:pointer' : ''}">${avatar(p.name, 'lg')}<div style="min-width:0"><div class="n">${esc(p.name)} ${p.is_primary ? '<span class="tag accent" style="height:18px;font-size:11px">Main</span>' : ''}</div><div class="r ellipsis">${esc(p.role || '')}</div>
          <div class="r">${p.email ? `<a class="ln" href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}${p.email && p.phone ? ' · ' : ''}${p.phone ? `<a class="ln" href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ''}</div></div></div>`).join('') : '<div class="faint small">No contacts yet.</div>', f ? `<button class="btn sm ghost" id="addc">${icon('plus')}Add</button>` : '')}
        ${c.notes ? propsSec('Internal notes', `<div class="doc-text pre">${esc(c.notes)}</div>`) : ''}</aside></div>`;
  const t = $('#tab', el);
  if (f) {
    $('#edit', el).addEventListener('click', () => editRecord('clients', c, null, () => Router.refresh(), { label: 'client', afterDelete: () => (location.hash = '#/clients') }));
    $('#addc', el).addEventListener('click', () => editRecord('contacts', null, { client_id: c.id, is_primary: contacts.length ? 0 : 1 }, () => Router.refresh(), { label: 'contact' }));
    delegate(el, '[data-contact]', 'click', (p) => editRecord('contacts', contacts.find((x) => String(x.id) === p.dataset.contact), null, () => Router.refresh(), { label: 'contact' }));
  }
  if (tab === 'projects') projectsTable(t, { client_id: c.id }, { addDefaults: { client_id: c.id } });
  else if (tab === 'activity') notesPanel(t, 'client', c.id);
  else if (tab === 'billing' && f) {
    t.innerHTML = `<div class="stack"><div>${sectionH('Invoices')}<div id="inv"></div></div><div>${sectionH('Payments received')}<div id="pay"></div></div></div>`;
    invoicesTable($('#inv', t), { client_id: c.id }, { newQuery: `client=${c.id}` });
    paymentsTable($('#pay', t), { client_id: c.id }, { client_id: c.id });
  } else if (tab === 'files') docsPanel(t, 'client', c.id, { canUpload: f });
  else if (tab === 'vault' && f) credentialsPanel(t, { client_id: c.id });
  else if (tab === 'care') {
    t.innerHTML = `<div class="stack"><div>${sectionH('Work log')}<div id="ml"></div></div>${f ? `<div>${sectionH('Maintenance plans, domains & hosting')}<div id="rn"></div></div>` : ''}</div>`;
    logsTable($('#ml', t), { client_id: c.id }, { client_id: c.id });
    if (f) renewalsTable($('#rn', t), { client_id: c.id }, { client_id: c.id });
  }
}, { title: 'Client' });

/* =====================================================  PROJECTS  ===================================================== */
const pct = (p) => (p.task_count ? Math.round(100 * p.tasks_done / p.task_count) : 0);
function projectsTable(root, query, { addDefaults } = {}) {
  mountList(root, {
    resource: 'projects', query, searchPlaceholder: 'Search projects…', noun: 'project', compact: !!query.client_id,
    filters: query.client_id ? [] : [{ key: 'status', label: 'Status', options: OPT.projectStatus }, { key: 'client_id', label: 'Client', lookup: 'clients' }, { key: 'manager_id', label: 'Manager', lookup: 'users' }],
    columns: [
      { key: 'name', label: 'Project', render: (r) => `<div class="who">${logoSq(r.name, 'sm')}<div style="min-width:0"><div class="t1 ellipsis">${esc(r.name)}</div><div class="t2 ellipsis">${esc([r.code, query.client_id ? r.type : r.client_name].filter(Boolean).join(' · '))}</div></div></div>` },
      { key: 'status', label: 'Status', render: (r) => badge(r.status) }, { key: 'priority', label: 'Priority', render: (r) => prio(r.priority) },
      { key: 'task_count', label: 'Progress', sort: pct, render: (r) => (r.task_count ? `<div class="prog"><div class="bar"><i style="width:${pct(r)}%"></i></div>${pct(r)}%</div>` : '<span class="faint small">No tasks</span>') },
      { key: 'deadline', label: 'Deadline', render: (r) => (['completed', 'cancelled'].includes(r.status) ? `<span class="muted">${fshort(r.completed_on || r.deadline)}</span>` : ['maintenance', 'on_hold'].includes(r.status) ? '<span class="faint">—</span>' : dueBadge(r.deadline)) },
      { key: 'manager_name', label: 'Lead', render: (r) => who(r.manager_name) },
      ...(isFounder() ? [{ key: 'budget', label: 'Value', num: true, render: (r) => (r.budget ? money(r.budget) : '<span class="faint">—</span>') }] : []),
    ],
    add: isFounder() ? { label: 'New project', onClick: (reload) => editRecord('projects', null, { manager_id: App.user.id, ...addDefaults }, (p) => { if (p) location.hash = '#/projects/' + p.id; else reload(); }, { label: 'project' }) } : null,
    onRow: (r) => (location.hash = '#/projects/' + r.id), empty: { title: 'No projects', text: isFounder() ? 'Create a project to keep its tasks, files, logins and money together.' : 'You have not been added to any project yet.' },
  });
}
route('/projects', ({ el }) => { el.innerHTML = pageHead('Projects', 'Everything being built and looked after.') + '<div id="body"></div>'; projectsTable($('#body', el), {}); }, { title: 'Projects' });

route('/projects/:id', async ({ el, params, query }) => {
  const f = isFounder(); const p = await GET('/projects/' + params.id); const tab = query.tab || 'overview';
  const members = await GET(`/projects/${p.id}/members`);
  const tabs = [{ key: 'overview', label: 'Overview' }, { key: 'tasks', label: `Tasks` }, { key: 'files', label: 'Files' }, { key: 'activity', label: 'Activity' },
    ...(f ? [{ key: 'vault', label: 'Credentials' }, { key: 'finance', label: 'Finance' }] : []), ...(can('maintenance') || p.status === 'maintenance' ? [{ key: 'care', label: 'Maintenance' }] : [])];
  const days = p.deadline ? daysUntil(p.deadline) : null; const closed = ['completed', 'cancelled'].includes(p.status);
  el.innerHTML = pageHead(esc(p.name), '', f ? `<button class="btn" id="addt">${icon('plus')}Task</button><button class="btn" id="edit">${icon('edit')}Edit</button>` : `<button class="btn" id="addt">${icon('plus')}Task</button>`, `<a href="#/projects">Projects</a> / ${esc(p.name)}`)
    + `<div class="record"><div class="record-main"><div class="rec-head">${logoSq(p.name)}<div><h1>${esc(p.name)}</h1><div class="meta">${badge(p.status)}${p.client_id ? `<a href="#/clients/${p.client_id}">${esc(p.client_name || '')}</a>` : ''}<span class="mono">${esc(p.code || '')}</span></div></div></div>
      <div class="highlights">${hl('Progress', `${pct(p)}%`, `${p.tasks_done} of ${p.task_count} tasks done`)}
        ${hl('Deadline', p.deadline ? fshort(p.deadline) : '—', days === null || closed ? (p.completed_on ? `Completed ${fshort(p.completed_on)}` : '') : days < 0 ? `<span class="neg">${-days} days late</span>` : `${days} days left`, !closed && days !== null && days < 0 && !['maintenance', 'on_hold'].includes(p.status) ? 'bad' : '')}
        ${f ? hl('Project value', p.budget ? money(p.budget) : '—') : ''}${hl('Open tasks', p.task_count - p.tasks_done)}</div>
      ${tabsHtml(tabs, tab, '#/projects/' + p.id)}<div id="tab"></div></div>
      <aside class="record-side">${propsSec('Properties', `${prop('Status', badge(p.status))}${prop('Priority', prio(p.priority))}${prop('Lead', p.manager_name ? who(p.manager_name) : '')}${prop('Client', p.client_id ? `<a href="#/clients/${p.client_id}">${esc(p.client_name || '')}</a>` : '')}${prop('Type', esc(p.type || ''))}${prop('Start', p.start_date ? fdate(p.start_date) : '')}${prop('Deadline', p.deadline ? fdate(p.deadline) : '')}${f ? prop('Value', p.budget ? money(p.budget) : '') : ''}${prop('Stack', p.tech_stack ? `<span class="tags">${p.tech_stack.split(',').map((x) => `<span class="tag">${esc(x.trim())}</span>`).join('')}</span>` : '')}`)}
        ${propsSec('Links', `${prop('Live', extLink(p.live_url))}${prop('Staging', extLink(p.staging_url))}${prop('Repository', extLink(p.repo_url))}${prop('Design', extLink(p.design_url))}`)}
        ${propsSec(`Team · ${members.length}`, members.length ? members.map((m) => `<div class="person">${avatar(m.name, 'lg')}<div><div class="n">${esc(m.name)}</div><div class="r">${esc(m.title || pretty(m.role))}</div></div></div>`).join('') : '<div class="faint small">Nobody assigned yet.</div>', f ? '<button class="btn sm ghost" id="team">Manage</button>' : '')}</aside></div>`;
  const t = $('#tab', el);
  $('#addt', el).addEventListener('click', () => editRecord('tasks', null, { project_id: p.id, assignee_id: App.user.id }, () => (tab === 'tasks' ? Router.refresh() : (location.hash = `#/projects/${p.id}?tab=tasks`)), { label: 'task' }));
  if (f) {
    $('#edit', el).addEventListener('click', () => editRecord('projects', p, null, () => Router.refresh(), { label: 'project', afterDelete: () => (location.hash = '#/projects') }));
    $('#team', el).addEventListener('click', () => {
      const ids = members.map((m) => m.id);
      const m = openModal({ title: 'Project team', sub: 'Interns only see projects they are part of.', body: `<div class="list">${App.lookups.users.map((u) => `<label class="check" style="padding:9px 0;align-items:center"><input type="checkbox" value="${u.id}" ${ids.includes(u.id) ? 'checked' : ''}>${avatar(u.name, 'sm')}<span>${esc(u.name)} <span class="muted small">· ${esc(u.title || pretty(u.role))}</span></span></label>`).join('')}</div>`,
        footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Save team</button>' });
      $('#go', m.el).addEventListener('click', async () => { try { await PUT(`/projects/${p.id}/members`, { user_ids: $$('input:checked', m.el).map((i) => Number(i.value)) }); m.close(); toast('Team updated'); Router.refresh(); } catch (e) { fail(e); } });
    });
  }
  if (tab === 'overview') {
    t.innerHTML = `<div class="stack">${p.description ? `<p class="doc-text" style="font-size:14px">${esc(p.description)}</p>` : ''}
      ${panel('Scope & specification', `<div class="panel-b doc-text pre">${p.specs ? esc(p.specs) : `<span class="faint">No specification yet.${f ? ' Use Edit to write the scope: pages, features, integrations, hosting and what is out of scope.' : ''}</span>`}</div>`)}</div>`;
  } else if (tab === 'tasks') taskBoard(t, { project_id: p.id });
  else if (tab === 'files') docsPanel(t, 'project', p.id, { canUpload: true });
  else if (tab === 'activity') notesPanel(t, 'project', p.id, { placeholder: 'Decisions, client feedback, blockers…' });
  else if (tab === 'vault' && f) credentialsPanel(t, { project_id: p.id, client_id: p.client_id });
  else if (tab === 'finance' && f) {
    const pr = (await GET('/finance/summary')).projects.find((x) => x.id === p.id) || { invoiced: 0, received: 0, cost: 0 };
    t.innerHTML = `<div class="kpis">${kpi('Invoiced', money(pr.invoiced), p.budget ? `${Math.round(100 * pr.invoiced / p.budget)}% of value` : '')}${kpi('Received', money(pr.received))}${kpi('Expenses', money(pr.cost))}${kpi('Profit so far', money(pr.received - pr.cost), 'Received − expenses', pr.received - pr.cost < 0 ? 'bad' : 'good')}</div>
      <div class="stack" style="margin-top:22px"><div>${sectionH('Invoices')}<div id="inv"></div></div><div>${sectionH('Payments')}<div id="pay"></div></div><div>${sectionH('Expenses')}<div id="exp"></div></div></div>`;
    invoicesTable($('#inv', t), { project_id: p.id }, { newQuery: `client=${p.client_id}&project=${p.id}` });
    paymentsTable($('#pay', t), { project_id: p.id }, { client_id: p.client_id, project_id: p.id });
    expensesTable($('#exp', t), { project_id: p.id }, { project_id: p.id });
  } else if (tab === 'care') logsTable(t, { project_id: p.id }, { project_id: p.id, client_id: p.client_id });
}, { title: 'Project' });

/* =====================================================  TASKS  ===================================================== */
function taskColumns() {
  return [
    { key: 'title', label: 'Task', render: (r) => `<div class="t1">${esc(r.title)}</div><div class="t2">${taskKey(r.id)} · ${esc(r.project_name || 'No project')}${r.check_total ? ` · ${r.check_done}/${r.check_total} steps` : ''}${r.comment_count ? ` · ${r.comment_count} comments` : ''}</div>` },
    { key: 'status', label: 'Status', render: (r) => badge(r.status) }, { key: 'priority', label: 'Priority', render: (r) => prio(r.priority) },
    { key: 'assignee_name', label: 'People', render: (r) => ((r.assignees || []).length > 1 ? `<span class="who">${avStack(r.assignees)}<span class="ellipsis">${esc(r.assignees.map((a) => a.name.split(' ')[0]).join(', '))}</span></span>` : who(r.assignee_name)) },
    { key: 'due_date', label: 'Due', render: (r) => dueBadge(r.due_date, r.status === 'done') },
  ];
}
const taskCard = (t) => `<div class="t">${esc(t.title)}</div><div class="s"><span class="tkey">${taskKey(t.id)}</span> ${esc(t.project_name || 'No project')}</div>
  <div class="f">${prio(t.priority)}${t.check_total ? `<span class="meta-i ${t.check_done === t.check_total ? 'ok' : ''}" title="Checklist: ${t.check_done} of ${t.check_total} done">${icon('check')}${t.check_done}/${t.check_total}</span>` : ''}${t.comment_count ? `<span class="meta-i" title="${plural(t.comment_count, 'comment')}">${icon('chat')}${t.comment_count}</span>` : ''}<span class="grow"></span>${t.due_date ? dueBadge(t.due_date, t.status === 'done') : ''}${avStack(t.assignees)}</div>`;

async function taskBoard(root, query) {
  const draw = async () => {
    const tasks = await GET('/tasks' + qs(query));
    const doneAll = tasks.filter((t) => t.status === 'done'); const shown = tasks.filter((t) => t.status !== 'done').concat(doneAll.slice(-20));
    kanban(root, { cols: OPT.taskStatus.map(([v, l]) => ({ v, l, c: TASK_TONE[v] })), items: shown, group: (t) => t.status, card: taskCard,
      head: (list, c) => (c.v === 'done' && doneAll.length > list.length ? `latest ${list.length}` : ''),
      onOpen: (id) => openTask(tasks.find((t) => String(t.id) === String(id)), draw),
      onMove: async (id, st) => { try { await PUT('/tasks/' + id, { status: st }); } catch (e) { fail(e); } draw(); } });
  };
  try { await draw(); } catch (e) { fail(e); }
}

route('/tasks', async ({ el, query }) => {
  const f = isFounder(); const scope = query.scope || 'mine'; const view = localStorage.getItem('taskView') || 'board';
  const q = {}; if (scope === 'mine') q.assignee_id = App.user.id; if (query.assignee) q.assignee_id = query.assignee; if (query.project) q.project_id = query.project;
  el.innerHTML = pageHead('My work', '', `<div class="seg"><button class="${view === 'board' ? 'on' : ''}" data-v="board">Board</button><button class="${view === 'list' ? 'on' : ''}" data-v="list">List</button></div><button class="btn primary" id="addt">${icon('plus')}New task</button>`, `<b>${scope === 'mine' && !query.assignee ? 'My work' : 'Tasks'}</b>`)
    + `<div class="toolbar"><div class="seg"><a class="${scope === 'mine' && !query.assignee ? 'on' : ''}" href="#/tasks?scope=mine">Assigned to me</a><a class="${scope === 'all' || query.assignee ? 'on' : ''}" href="#/tasks?scope=all">${f ? 'Everyone' : 'My projects'}</a></div>
    ${f ? `<select id="fa"><option value="">Anyone</option>${App.lookups.users.map((u) => `<option value="${u.id}" ${String(query.assignee) === String(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
    <select id="fp"><option value="">All projects</option>${App.lookups.projects.map((p) => `<option value="${p.id}" ${String(query.project) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div><div id="body"></div>`;
  $$('[data-v]', el).forEach((b) => b.addEventListener('click', () => { localStorage.setItem('taskView', b.dataset.v); Router.refresh(); }));
  $('#addt', el).addEventListener('click', () => editRecord('tasks', null, { assignee_id: App.user.id, project_id: query.project || '' }, () => Router.refresh(), { label: 'task' }));
  const go = () => { const p = new URLSearchParams({ scope: 'all' }); if ($('#fa', el) && $('#fa', el).value) p.set('assignee', $('#fa', el).value); if ($('#fp', el).value) p.set('project', $('#fp', el).value); if (!p.get('assignee') && scope === 'mine' && !$('#fa', el)) p.set('scope', 'mine'); location.hash = '#/tasks?' + p; };
  if ($('#fa', el)) $('#fa', el).addEventListener('change', go); $('#fp', el).addEventListener('change', go);
  const body = $('#body', el);
  if (query.open) {
    const rest = new URLSearchParams(query); rest.delete('open'); history.replaceState(null, '', '#/tasks' + (rest.toString() ? '?' + rest : ''));
    openTask({ id: query.open }, () => Router.refresh());
  }
  if (view === 'board') taskBoard(body, q);
  else mountList(body, { resource: 'tasks', query: q, searchPlaceholder: 'Search tasks…', noun: 'task', filters: [{ key: 'status', label: 'Status', options: OPT.taskStatus }, { key: 'priority', label: 'Priority', options: OPT.priority }], columns: taskColumns(), onRow: (r) => openTask(r, () => Router.refresh()), empty: { title: 'No tasks', text: 'Create a task and assign it to someone.' } });
}, { title: 'My work' });
