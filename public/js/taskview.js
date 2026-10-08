/* Task popup: people, checklist, discussion with @mentions, history, watchers (Jira-style teamwork, kept small) */

const taskKey = (id) => `T-${id}`;
const avStack = (people, max = 3) => (people && people.length ? `<span class="av-stack">${people.slice(0, max).map((p) => avatar(p.name, 'sm')).join('')}${people.length > max ? `<span class="av sm more" title="${esc(people.slice(max).map((p) => p.name).join(', '))}">+${people.length - max}</span>` : ''}</span>` : '');
const peopleNames = (people) => (people && people.length ? people.map((p) => p.name).join(', ') : '');
const onTask = (t, uid = App.user.id) => (t.assignees || []).some((a) => a.id === uid);

async function openTask(t0, after) {
  let t; try { t = await GET('/tasks/' + t0.id); } catch (e) { return fail(e); }
  const canEdit = isFounder() || t.created_by === App.user.id || onTask(t);
  let changed = false;
  const m = openModal({ title: t.title, sub: [taskKey(t.id), t.project_name || 'No project', t.client_name].filter(Boolean).join(' · '), size: 'xl',
    onClose: () => { if (changed && after) after(); },
    body: `<div class="pop-split">
    <div class="pop-main">${t.description ? `<div class="doc-text pre">${esc(t.description)}</div>` : '<div class="faint">No details written for this task.</div>'}
      <div class="pop-sec"><div class="sec-h"><h3>Checklist</h3><span class="faint small" id="ck-sum"></span></div><div id="tk-check" aria-busy="true">${skRows(2)}</div></div>
      <div class="pop-sec"><div class="sec-h"><h3>Discussion</h3><div class="seg sm" id="tk-tabs" role="tablist"><button type="button" role="tab" data-tab="comments" class="on" aria-selected="true">Comments</button><button type="button" role="tab" data-tab="history" aria-selected="false">History</button><button type="button" role="tab" data-tab="all" aria-selected="false">All</button></div></div>
        <div id="tk-thread" aria-busy="true">${skRows(3)}</div><div id="tk-compose"></div></div>
      <div class="pop-sec"><h3>Files</h3><div id="tk-files"></div></div></div>
    <aside class="pop-side">${prop('Status', canEdit ? `<select id="tk-st" aria-label="Status">${OPT.taskStatus.map(([v, l]) => `<option value="${v}" ${v === t.status ? 'selected' : ''}>${l}</option>`).join('')}</select>` : badge(t.status))}${prop('Priority', prio(t.priority))}
      ${prop(`People${(t.assignees || []).length > 1 ? ` · ${t.assignees.length}` : ''}`, (t.assignees || []).length ? `<div class="people-list">${t.assignees.map((a) => `<div class="who">${avatar(a.name, 'sm')}<span class="ellipsis">${esc(a.name)}${a.id === App.user.id ? ' <span class="faint">(you)</span>' : ''}</span></div>`).join('')}</div>` : '<span class="faint">Nobody yet</span>')}
      ${prop('Watching', '<div id="tk-watch"></div>')}
      ${prop('Project', t.project_id ? `<a href="#/projects/${t.project_id}" data-close-link>${esc(t.project_name)}</a>` : '')}${prop('Due', t.due_date ? `${dueBadge(t.due_date, t.status === 'done')}${t.status !== 'done' && Math.abs(daysUntil(t.due_date)) > 1 ? `<div class="faint small">${daysUntil(t.due_date) < 0 ? plural(-daysUntil(t.due_date), 'day') + ' late' : 'in ' + plural(daysUntil(t.due_date), 'day')}</div>` : ''}` : '')}${prop('Created by', `${esc(t.creator_name || '—')}<div class="faint small">${fshort(t.created_at)}</div>`)}</aside></div>`,
    footer: canEdit ? `<button class="btn" id="tk-edit">${icon('edit')}Edit task</button>${t.status !== 'done' ? `<button class="btn accent" id="tk-done">${icon('check')}Mark done</button>` : ''}` : '<button class="btn" data-close>Close</button>' });
  m.body.classList.add('flush');
  $$('[data-close-link]', m.el).forEach((a) => a.addEventListener('click', () => m.close()));
  $$('[data-close]', m.foot || m.el).forEach((b) => b.addEventListener('click', () => m.close()));
  docsPanel($('#tk-files', m.el), 'task', t.id);

  let collab = { checklist: [], watchers: [], watching: false, people: [] };
  const thread = taskThread(m, t, () => collab.people);
  const drawWatch = () => {
    const w = collab.watchers;
    $('#tk-watch', m.el).innerHTML = `<div class="watch-row">${avStack(w, 4)}<span class="small muted">${w.length ? plural(w.length, 'person', 'people') : 'Nobody'}</span></div>
      <button type="button" class="btn sm ${collab.watching ? '' : 'ghost'}" id="tk-w" aria-pressed="${collab.watching}">${icon('eye')}${collab.watching ? 'Watching' : 'Watch'}</button>
      <div class="hint">${collab.watching ? 'You get a notification for new comments and status changes.' : 'Watch to get notified about comments and status changes.'}</div>`;
    $('#tk-w', m.el).addEventListener('click', async () => {
      try { const r = await POST(`/tasks/${t.id}/watch`, { on: !collab.watching }); collab.watching = r.watching;
        collab.watchers = r.watching ? [...collab.watchers.filter((x) => x.id !== App.user.id), { id: App.user.id, name: App.user.name }] : collab.watchers.filter((x) => x.id !== App.user.id);
        drawWatch(); toast(r.watching ? 'You are watching this task' : 'You stopped watching this task'); } catch (e) { fail(e); }
    });
  };
  const drawChecklist = () => checklistUI($('#tk-check', m.el), $('#ck-sum', m.el), t, collab, canEdit, () => { changed = true; });
  try { collab = await GET(`/tasks/${t.id}/collab`); } catch (e) { fail(e); }
  drawWatch(); drawChecklist(); thread.load();

  const st = $('#tk-st', m.el);
  if (st) st.addEventListener('change', async () => { try { await PUT('/tasks/' + t.id, { status: st.value }); t.status = st.value; changed = true; toast('Status updated'); thread.load(); } catch (e) { fail(e); st.value = t.status; } });
  const dn = $('#tk-done', m.el); if (dn) dn.addEventListener('click', () => { m.close(); completeTask(t.id, after); });
  const ed = $('#tk-edit', m.el); if (ed) ed.addEventListener('click', () => { m.close(); editRecord('tasks', t, null, () => after && after(), { label: 'task' }); });
  return m;
}

/* ---------- checklist: split the task into pieces, each piece can go to one person ---------- */
function checklistUI(root, sum, t, collab, canEdit, onChange) {
  const people = t.assignees || [];
  const draw = () => {
    const list = collab.checklist; const done = list.filter((c) => c.done).length;
    sum.textContent = list.length ? `${done} of ${list.length} done` : '';
    root.removeAttribute('aria-busy');
    root.innerHTML = `${list.length ? `<div class="ck-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${list.length}" aria-valuenow="${done}" aria-label="Checklist progress"><i style="width:${Math.round(100 * done / list.length)}%"></i></div>` : ''}
      <div class="ck-list">${list.map((c) => `<div class="ck ${c.done ? 'done' : ''}" data-ck="${c.id}">
        <button type="button" class="ck-box" data-tick ${canEdit ? '' : 'disabled'} aria-pressed="${!!c.done}" aria-label="${c.done ? 'Mark not done' : 'Mark done'}: ${esc(c.text)}">${icon('check')}</button>
        <div class="ck-main"><span class="ck-t">${esc(c.text)}</span>${c.done && c.done_by_name ? `<span class="ck-by">${esc(c.done_by_name)} · ${ago(c.done_at)}</span>` : ''}</div>
        ${canEdit && people.length ? `<select class="ck-who" data-who aria-label="Who does this"><option value="">Anyone</option>${people.map((p) => `<option value="${p.id}" ${p.id === c.assignee_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : c.assignee_name ? who(c.assignee_name) : ''}
        ${canEdit ? `<button type="button" class="btn ghost sm icon" data-rm aria-label="Remove item">${icon('x')}</button>` : ''}</div>`).join('')}</div>
      ${list.length || canEdit ? '' : '<div class="faint small">No checklist for this task.</div>'}
      ${canEdit ? `<form class="ck-add" novalidate><input id="ck-new" maxlength="300" placeholder="${list.length ? 'Add another item…' : 'Break the work into steps, e.g. “Build the login screen”'}" aria-label="New checklist item">
        ${people.length > 1 ? `<select id="ck-new-who" aria-label="Who does this"><option value="">Anyone</option>${people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>` : ''}<button class="btn sm" type="submit">${icon('plus')}Add</button></form>` : ''}`;
  };
  const save = async (fn) => { try { collab.checklist = await fn(); onChange(); draw(); } catch (e) { fail(e); draw(); } };
  root.addEventListener('submit', (e) => {
    e.preventDefault(); const inp = $('#ck-new', root); const text = inp.value.trim(); if (!text) return inp.focus();
    const w = $('#ck-new-who', root);
    save(() => POST(`/tasks/${t.id}/checklist`, { text, assignee_id: w ? w.value || null : null })).then(() => { const i = $('#ck-new', root); if (i) i.focus(); });
  });
  delegate(root, '[data-tick]', 'click', (b) => { const id = b.closest('[data-ck]').dataset.ck; const c = collab.checklist.find((x) => String(x.id) === id); save(() => PUT(`/tasks/${t.id}/checklist/${id}`, { done: !c.done })); });
  delegate(root, '[data-who]', 'change', (s) => save(() => PUT(`/tasks/${t.id}/checklist/${s.closest('[data-ck]').dataset.ck}`, { assignee_id: s.value || null })));
  delegate(root, '[data-rm]', 'click', (b) => save(() => DEL(`/tasks/${t.id}/checklist/${b.closest('[data-ck]').dataset.ck}`)));
  draw();
}

/* ---------- discussion: comments (with @mentions, edit your own) + automatic history ---------- */
function taskThread(m, t, peopleOf) {
  const box = $('#tk-thread', m.el), compose = $('#tk-compose', m.el);
  let notes = [], tab = 'comments';
  const isLog = (n) => n.kind === 'history' || n.kind === 'system';
  const parseM = (n) => { try { return JSON.parse(n.mentions || '[]') || []; } catch { return []; } };
  const bodyHtml = (n) => { let h = esc(n.body); for (const p of parseM(n)) h = h.split('@' + esc(p.name)).join(`<span class="mention${p.id === App.user.id ? ' me' : ''}">@${esc(p.name)}</span>`); return h; };
  const item = (n) => (isLog(n)
    ? `<div class="th-log">${icon('activity')}<span>${n.kind === 'history' ? `<b>${esc(n.user_name || 'Someone')}</b> ` : ''}${esc(n.body)}</span><span class="faint">· ${ago(n.created_at)}</span></div>`
    : `<div class="th-c" data-n="${n.id}">${avatar(n.user_name || '?')}<div class="th-b"><div class="th-meta"><b>${esc(n.user_name || 'Someone')}</b><span class="faint">${ago(n.created_at)}${n.edited_at ? ' · edited' : ''}</span>
        <span class="grow"></span>${n.user_id === App.user.id ? `<button type="button" class="btn ghost sm" data-edit>Edit</button>` : ''}${n.user_id === App.user.id || isFounder() ? `<button type="button" class="btn ghost sm icon" data-del aria-label="Delete comment">${icon('x')}</button>` : ''}</div>
        <div class="th-text pre">${bodyHtml(n)}</div></div></div>`);
  const draw = () => {
    const shown = notes.filter((n) => (tab === 'all' ? true : tab === 'history' ? isLog(n) : !isLog(n)));
    box.removeAttribute('aria-busy');
    box.innerHTML = shown.length ? `<div class="th">${shown.map(item).join('')}</div>`
      : `<div class="empty mini">${tab === 'history' ? 'No changes recorded yet.' : 'No comments yet. Ask a question, share progress, or @mention someone to pull them in.'}</div>`;
  };
  const load = async () => {
    try { notes = (await GET('/notes' + qs({ entity_type: 'task', entity_id: t.id }))).reverse(); draw(); } catch (e) { box.innerHTML = `<div class="empty mini">${esc(e.message)}</div>`; }
  };
  $$('#tk-tabs [data-tab]', m.el).forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab; $$('#tk-tabs [data-tab]', m.el).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); }); draw();
  }));
  delegate(box, '[data-del]', 'click', async (b) => {
    if (!(await confirmBox('Delete this comment?', { danger: true, okLabel: 'Delete' }))) return;
    try { await DEL('/notes/' + b.closest('[data-n]').dataset.n); load(); } catch (e) { fail(e); }
  });
  delegate(box, '[data-edit]', 'click', (b) => {
    const wrap = b.closest('[data-n]'); const n = notes.find((x) => String(x.id) === wrap.dataset.n); const txt = $('.th-text', wrap);
    txt.outerHTML = `<div class="th-editing"><textarea rows="3" aria-label="Edit comment">${esc(n.body)}</textarea><div class="bar2"><span class="grow"></span><button type="button" class="btn sm" data-x>Cancel</button><button type="button" class="btn sm primary" data-s>Save</button></div></div>`;
    const ta = $('.th-editing textarea', wrap); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    $('[data-x]', wrap).addEventListener('click', draw);
    $('[data-s]', wrap).addEventListener('click', async () => { if (!ta.value.trim()) return; try { await PUT('/notes/' + n.id, { body: ta.value }); load(); } catch (e) { fail(e); } });
  });

  // composer with @mention suggestions
  compose.innerHTML = `<div class="composer th-compose"><div class="mention-wrap"><textarea id="th-body" rows="2" placeholder="Write a comment… type @ to mention someone"></textarea><div class="mention-pop hidden" role="listbox" aria-label="People"></div></div>
    <div class="bar2"><button type="button" class="btn ghost sm" id="th-at" aria-label="Mention someone">${icon('at')}Mention</button><span class="grow faint small">Ctrl + Enter to send</span><button type="button" class="btn primary sm" id="th-post">Comment</button></div></div>`;
  const ta = $('#th-body', compose), pop = $('.mention-pop', compose); const picked = new Map(); let hits = [], sel = 0, q = null;
  m.dirty = () => !!ta.value.trim();
  const close = () => { pop.classList.add('hidden'); q = null; };
  const show = () => {
    const before = ta.value.slice(0, ta.selectionStart); const mm = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    if (!mm) return close();
    q = mm[2].toLowerCase();
    hits = peopleOf().filter((p) => p.id !== App.user.id && (!q || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || p.name.toLowerCase().startsWith(q))).slice(0, 6);
    if (!hits.length) { pop.innerHTML = '<div class="mp-none">Nobody on this task by that name</div>'; pop.classList.remove('hidden'); return; }
    sel = Math.min(sel, hits.length - 1);
    pop.innerHTML = hits.map((p, i) => `<button type="button" role="option" class="mp-i ${i === sel ? 'on' : ''}" data-i="${i}" aria-selected="${i === sel}">${avatar(p.name, 'sm')}<span>${esc(p.name)}</span><span class="faint small">${esc(p.title || pretty(p.role))}</span></button>`).join('');
    pop.classList.remove('hidden');
  };
  const choose = (p) => {
    const pos = ta.selectionStart; const before = ta.value.slice(0, pos).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    ta.value = before + ta.value.slice(pos); ta.setSelectionRange(before.length, before.length); picked.set(p.name, p.id); close(); ta.focus();
  };
  ta.addEventListener('input', () => { sel = 0; show(); });
  ta.addEventListener('click', show);
  ta.addEventListener('blur', () => setTimeout(close, 150));
  ta.addEventListener('keydown', (e) => {
    if (q !== null && hits.length && !pop.classList.contains('hidden')) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; show(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(hits[sel]); return; }
    }
    if (e.key === 'Escape' && q !== null) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); }
  });
  pop.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); choose(hits[Number(b.dataset.i)]); } });
  $('#th-at', compose).addEventListener('click', () => {
    const pos = ta.selectionStart ?? ta.value.length; const pre = ta.value.slice(0, pos); const add = (pre && !/\s$/.test(pre) ? ' ' : '') + '@';
    ta.value = pre + add + ta.value.slice(pos); ta.focus(); ta.setSelectionRange(pos + add.length, pos + add.length); sel = 0; show();
  });
  const btn = $('#th-post', compose);
  async function post() {
    const body = ta.value.trim(); if (!body || btn.disabled) return;
    const mentions = [...picked].filter(([name]) => body.includes('@' + name)).map(([, id]) => id);
    btn.disabled = true; btn.classList.add('busy');
    try {
      await POST('/notes', { entity_type: 'task', entity_id: t.id, body, kind: 'note', mentions });
      ta.value = ''; picked.clear();
      if (tab === 'history') $('#tk-tabs [data-tab="comments"]', m.el).click();
      await load(); box.scrollTop = box.scrollHeight;
      if (mentions.length) toast(`Sent — ${plural(mentions.length, 'person was', 'people were')} notified`);
    } catch (e) { fail(e); }
    btn.disabled = false; btn.classList.remove('busy');
  }
  btn.addEventListener('click', post);
  return { load };
}
