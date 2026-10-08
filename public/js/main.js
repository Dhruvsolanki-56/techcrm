/* App shell: auth screens, sidebar, notification bell, command palette, router */
'use strict';

const Router = {
  seq: 0,
  parse() { const h = location.hash.slice(1) || '/dashboard'; const [path, q] = h.split('?'); return { path, query: Object.fromEntries(new URLSearchParams(q || '')) }; },
  match(path) {
    const parts = path.split('/').filter(Boolean);
    for (const r of ROUTES) {
      if (r.parts.length !== parts.length) continue;
      const params = {}; let ok = true;
      r.parts.forEach((p, i) => { if (p[0] === ':') params[p.slice(1)] = decodeURIComponent(parts[i]); else if (p !== parts[i]) ok = false; });
      if (ok) return { route: r, params };
    }
    return null;
  },
  async render() {
    const my = ++Router.seq; const el = $('#view'); const { path, query } = Router.parse(); const hit = Router.match(path);
    Shell.highlight(path); $('#side')?.classList.remove('open'); $$('.popover').forEach((p) => p.remove());
    const msg = (t, s) => `<header class="ph"><div class="crumbs"><b>${t}</b></div></header><div class="empty" style="margin-top:80px"><b>${t}</b>${s}</div>`;
    if (!hit) { el.innerHTML = `<div id="page">${msg('Page not found', '<div style="margin-top:12px"><a class="btn" href="#/dashboard">Go home</a></div>')}</div>`; Shell.mountBell(el); return; }
    const { route: r, params } = hit;
    if ((r.founder && !isFounder()) || (r.needs && !can(r.needs))) { el.innerHTML = `<div id="page">${msg('No access', 'Your account does not include this area. Ask a founder if you need it.')}</div>`; Shell.mountBell(el); return; }
    document.title = `${r.title || 'CRM'} · ${App.lookups.settings.company_name || 'CRM'}`;
    // show a skeleton only if loading is noticeable (avoids a flash on fast loads); refreshes keep the current page
    const kind = path === '/dashboard' ? 'dash' : /\/\d+$/.test(path) ? 'record' : 'list';
    const skT = Router.keepScroll && el.firstChild ? 0 : setTimeout(() => { if (my === Router.seq) el.innerHTML = skeleton(kind); }, el.firstChild ? 120 : 0);
    const holder = document.createElement('div'); holder.id = 'page';
    if (Router.keepScroll) holder.style.animation = 'none';
    try {
      await r.handler({ el: holder, params, query });
      clearTimeout(skT);
      if (my !== Router.seq) return;
      el.innerHTML = ''; el.appendChild(holder); Shell.mountBell(holder); if (!Router.keepScroll) countUp(holder); if (!Router.keepScroll) window.scrollTo(0, 0); Router.keepScroll = false;
    } catch (e) {
      clearTimeout(skT);
      if (my !== Router.seq) return;
      console.error(e);
      el.innerHTML = `<div id="page"><header class="ph"><div class="crumbs"><b>${esc(r.title || 'Page')}</b></div></header><div class="empty iconic-lg" style="margin-top:80px"><span class="em-i">${icon('alert')}</span><b>This page did not load</b>${esc(e.message)}<div class="row" style="margin-top:14px;justify-content:center"><button class="btn primary" id="retry" type="button">${icon('refresh')}Try again</button><a class="btn" href="#/dashboard">Go home</a></div></div></div>`; Shell.mountBell(el);
      $('#retry', el).addEventListener('click', (ev) => { ev.currentTarget.classList.add('busy'); Router.render(); });
    }
  },
  refresh() { Router.keepScroll = true; return Router.render(); },
};
window.addEventListener('hashchange', (e) => {
  Router.prevHash = new URL(e.oldURL).hash;
  if (!App.user || App.user.must_change_password) return;
  modalStack.filter((m) => !m.locked).reverse().forEach((m) => m.close());
  Router.render();
});

const NAV = [
  { items: [{ href: '/dashboard', label: 'Home', icon: 'home' }, { href: '/tasks', label: 'My work', icon: 'check' }, { href: '/calendar', label: 'Calendar', icon: 'calendar' }] },
  { group: 'Sales', items: [{ href: '/leads', label: 'Pipeline', icon: 'target', show: () => can('leads') }, { href: '/followups', label: 'Follow-ups', icon: 'phone', show: () => can('leads') }, { href: '/contact-log', label: 'Contact Log', icon: 'note', show: () => can('leads') }, { href: '/sales-report', label: 'Sales report', icon: 'activity', show: () => can('leads') }, { href: '/clients', label: 'Clients', icon: 'building', show: () => can('clients') }, { href: '/quotes', label: 'Quotations', icon: 'file', show: () => isFounder() }] },
  { group: 'Delivery', items: [{ href: '/projects', label: 'Projects', icon: 'briefcase' }, { href: '/maintenance', label: 'Maintenance', icon: 'tool', show: () => can('maintenance') }, { href: '/documents', label: 'Documents', icon: 'folder' }] },
  { group: 'Money', items: [{ href: '/invoices', label: 'Invoices', icon: 'receipt', show: () => isFounder() }, { href: '/renewals', label: 'Subscriptions & renewals', icon: 'refresh', show: () => isFounder() }, { href: '/grants', label: 'Grants', icon: 'shield', show: () => isFounder() }, { href: '/finance', label: 'Finance', icon: 'trend', show: () => isFounder() }, { href: '/assets', label: 'Assets', icon: 'box', show: () => isFounder() }] },
  { group: 'Company', items: [{ href: '/vault', label: 'Credentials', icon: 'lock', show: () => isFounder() }, { href: '/team', label: 'Team & access', icon: 'users', show: () => isFounder() }, { href: '/settings', label: 'Settings', icon: 'settings', show: () => isFounder() }] },
];

const Shell = {
  notifs: [], unread: 0,
  highlight(path) { $$('#nav a').forEach((a) => a.classList.toggle('on', path === a.dataset.href || path.startsWith(a.dataset.href + '/'))); },
  mark() { const s = App.lookups.settings || {}; return `<span class="mark">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : esc((s.company_name || 'T')[0])}</span>`; },
  refreshBrand() { const b = $('#ws'); if (b) b.innerHTML = `${Shell.mark()}<span class="nm">${esc(App.lookups.settings.company_name || 'CRM')}</span>`; },
  async notifCount() {
    try { const n = await GET('/notifications'); const more = n.unread > Shell.unread; Shell.notifs = n.items; Shell.unread = n.unread; Shell.paintBells(more); } catch { /* ignore */ }
  },
  bell: () => `<button class="btn icon ghost bell" type="button" data-bell aria-label="Notifications" aria-haspopup="dialog">${icon('bell')}<span class="bell-n hidden" aria-hidden="true"></span></button>`,
  paintBells(ring) {
    $$('[data-bell]').forEach((b) => {
      const n = $('.bell-n', b); n.textContent = Shell.unread > 9 ? '9+' : Shell.unread; n.classList.toggle('hidden', !Shell.unread);
      b.setAttribute('aria-label', Shell.unread ? `Notifications, ${Shell.unread} unread` : 'Notifications');
      if (ring) { b.classList.remove('ring'); void b.offsetWidth; b.classList.add('ring'); }
    });
  },
  // every page header gets the bell at its right end (phones use the one in the top bar)
  mountBell(root) {
    const ph = $('.ph', root); if (!ph || $('[data-bell]', ph)) return;
    let a = $('.actions', ph); if (!a) { a = document.createElement('div'); a.className = 'actions'; ph.appendChild(a); }
    a.insertAdjacentHTML('beforeend', `${a.children.length ? '<span class="bell-sep" aria-hidden="true"></span>' : ''}${Shell.bell()}`);
    Shell.paintBells(false);
  },
  async openBell(btn) {
    if (Shell.bellWasOpen || $('.popover.notifs')) { Shell.bellWasOpen = false; $$('.popover.notifs').forEach((p) => p.remove()); return; }   // second click closes
    await Shell.notifCount(); const items = Shell.notifs;
    const p = popover(btn, `<div class="pop-h"><span>Notifications</span>${Shell.unread ? '<button class="btn sm ghost" id="readall">Mark all read</button>' : ''}</div>
      <div class="notif-list">${items.length ? items.map((n) => `<a class="notif ${n.read ? '' : 'unread'}" href="${esc(n.link || '#/dashboard')}">${esc(n.text)}<div class="w">${ago(n.at)}</div></a>`).join('') : `<div class="empty mini iconic"><span class="em-i">${icon('bell')}</span><span>You are all caught up.</span></div>`}</div>`, { placement: 'below-end', cls: 'notifs' });
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Notifications');
    const ra = $('#readall', p); if (ra) ra.addEventListener('click', async () => { await POST('/notifications/read'); await Shell.notifCount(); p.remove(); });
    $$('a', p).forEach((a) => a.addEventListener('click', () => p.remove()));
  },
  build() {
    const nav = NAV.map((g) => {
      const items = g.items.filter((i) => !i.show || i.show());
      return items.length ? `${g.group ? `<div class="nav-h">${g.group}</div>` : ''}${items.map((i) => `<a href="#${i.href}" data-href="${i.href}">${icon(i.icon)}<span>${i.label}</span></a>`).join('')}` : '';
    }).join('');
    $('#app').innerHTML = `<div class="app"><aside class="side" id="side">
        <div class="ws" id="ws"></div>
        <button class="cmdk" id="cmdk">${icon('search')}<span>Search…</span><kbd>Ctrl K</kbd></button>
        <nav class="nav" id="nav">${nav}</nav>
        <div class="side-foot"><button class="me" id="me">${avatar(App.user.name)}<span class="grow"><div class="n ellipsis">${esc(App.user.name)}</div><div class="r">${isFounder() ? 'Founder' : 'Intern'}</div></span></button></div>
      </aside>
      <div class="main"><div class="mobilebar"><button class="btn icon ghost" id="burger" aria-label="Menu">${icon('menu')}</button><span class="grow ellipsis">${esc(App.lookups.settings.company_name || 'CRM')}</span><button class="btn icon ghost" id="msearch" aria-label="Search">${icon('search')}</button>${Shell.bell()}</div>
      <main id="view"></main></div></div>`;
    Shell.refreshBrand();
    $('#burger').addEventListener('click', () => $('#side').classList.toggle('open'));
    $('#cmdk').addEventListener('click', () => Palette.open()); $('#msearch').addEventListener('click', () => Palette.open());
    if (!Shell.bellWired) { Shell.bellWired = true; delegate(document.body, '[data-bell]', 'click', (b) => Shell.openBell(b)); document.addEventListener('mousedown', (e) => { Shell.bellWasOpen = !!(e.target.closest && e.target.closest('[data-bell]') && $('.popover.notifs')); }, true); }   // once, even if the shell is rebuilt after signing in again
    $('#me').addEventListener('click', (e) => {
      const p = popover(e.currentTarget, `<div style="padding:10px 14px 8px"><div style="font-weight:600">${esc(App.user.name)}</div><div class="small muted">${esc(App.user.email)}</div></div>
        <div class="menu-i" id="m-pw">${icon('key')}Change password</div><div class="menu-i" id="m-2fa">${icon('shield')}Two-step login <span class="grow"></span><span class="small ${App.user.two_factor ? '' : 'warn'}">${App.user.two_factor ? 'On' : 'Off'}</span></div><div class="menu-i" id="m-out">${icon('logout')}Sign out</div>`, { cls: 'narrow', placement: 'above' });
      $('#m-pw', p).addEventListener('click', () => { p.remove(); Shell.passwordModal(false); });
      $('#m-2fa', p).addEventListener('click', () => { p.remove(); Shell.twoFactorModal(); });
      $('#m-out', p).addEventListener('click', async () => { p.remove(); await POST('/auth/logout').catch(() => {}); App.user = null; showAuth(); });
    });
    document.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); Palette.open(); } };
    Shell.notifCount(); clearInterval(Shell.poll); Shell.poll = setInterval(Shell.notifCount, 60000);
  },
  passwordModal(forced) {
    const m = formModal({ title: forced ? 'Choose your password' : 'Change password', size: 'sm', submit: 'Update password', intro: forced ? 'You signed in with a temporary password. Pick your own to continue.' : '',
      fields: [{ name: 'current', label: 'Current password', type: 'password', required: true }, { name: 'next', label: 'New password', type: 'password', required: true, help: 'At least 10 characters, with letters and numbers.' }],
      onSubmit: async (d) => {
        await POST('/password', { current: d.current, next: d.next }); toast('Password updated');
        if (App.user.must_change_password) { App.user.must_change_password = false; Router.render(); Shell.notifCount(); }
      } });
    if (forced) { m.locked = true; $$('[data-close]', m.el).forEach((b) => b.remove()); }
  },
  async twoFactorModal() {
    if (App.user.two_factor) {
      return formModal({ title: 'Two-step login is on', size: 'sm', submit: 'Turn off', intro: 'Signing in needs your password and a code from your authenticator app. Turning it off makes your account easier to break into.',
        fields: [{ name: 'password', label: 'Your password', type: 'password', required: true }],
        onSubmit: async (d) => { await POST('/2fa/disable', d); App.user.two_factor = false; toast('Two-step login turned off', true); } });
    }
    formModal({ title: 'Turn on two-step login', size: 'sm', submit: 'Continue', intro: 'After this, signing in needs your password plus a 6-digit code from an app on your phone (Google Authenticator, Microsoft Authenticator, Authy or 1Password).',
      fields: [{ name: 'password', label: 'Confirm your password', type: 'password', required: true }],
      onSubmit: async (d) => {
        const r = await POST('/2fa/setup', d);
        setTimeout(() => {
          const m = formModal({ title: 'Add CRM to your authenticator', size: 'sm', submit: 'Turn on',
            intro: `In the app choose <b>Add account → Enter a setup key</b> and type this key (time-based):<div class="mono" style="margin:12px 0;padding:12px;border:1px solid var(--line);border-radius:8px;font-size:15px;letter-spacing:.06em;word-break:break-all;user-select:all">${esc(r.secret.match(/.{1,4}/g).join(' '))}</div>On your phone you can also <a class="ln" href="${esc(r.uri)}">open it in the app directly</a>. Then type the 6-digit code it shows.`,
            fields: [{ name: 'code', label: '6-digit code', required: true, placeholder: '123 456' }],
            onSubmit: async (x) => { await POST('/2fa/enable', { code: x.code }); App.user.two_factor = true; toast('Two-step login is on. Other devices were signed out.'); } });
          const c = $('[name="code"]', m.el); if (c) { c.setAttribute('inputmode', 'numeric'); c.setAttribute('autocomplete', 'one-time-code'); }
        }, 50);
      } });
  },
};

/* ---------- command palette (Ctrl+K) ---------- */
const Palette = {
  open() {
    if ($('.palette')) return;
    const jumps = [];
    NAV.forEach((g) => g.items.filter((i) => !i.show || i.show()).forEach((i) => jumps.push({ type: 'Go to', title: i.label, link: '#' + i.href, icon: i.icon })));
    const creates = [
      can('leads') && { type: 'Create', title: 'New lead', run: () => editRecord('leads', null, { owner_id: App.user.id }, (l) => l && (location.hash = '#/leads/' + l.id), { label: 'lead' }), icon: 'plus' },
      { type: 'Create', title: 'New task', run: () => editRecord('tasks', null, { assignee_id: App.user.id }, () => Router.refresh(), { label: 'task' }), icon: 'plus' },
      isFounder() && { type: 'Create', title: 'New client', run: () => editRecord('clients', null, null, (c) => c && (location.hash = '#/clients/' + c.id), { label: 'client' }), icon: 'plus' },
      isFounder() && { type: 'Create', title: 'New project', run: () => editRecord('projects', null, { manager_id: App.user.id }, (p) => p && (location.hash = '#/projects/' + p.id), { label: 'project' }), icon: 'plus' },
      isFounder() && { type: 'Create', title: 'New invoice', link: '#/invoices/new', icon: 'plus' },
      isFounder() && { type: 'Create', title: 'New quotation', link: '#/quotes/new', icon: 'plus' },
      isFounder() && { type: 'Create', title: 'Record expense', run: () => editRecord('expenses', null, null, () => Router.refresh(), { label: 'expense' }), icon: 'plus' },
    ].filter(Boolean);
    const TYPE_ICON = { Client: 'building', Contact: 'users', Lead: 'target', Project: 'briefcase', Task: 'check', Invoice: 'receipt', Quote: 'file', Document: 'folder', Renewal: 'refresh', Credential: 'lock' };
    const m = openModal({ title: 'Search', size: 'palette', body: `<input id="pal-q" placeholder="Search clients, projects, invoices, files… or type a command" autocomplete="off"><div class="pal-list" id="pal-l"></div>
      <div class="pal-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div>` });
    m.box.classList.add('palette'); m.el.classList.add('top'); m.box.style.maxWidth = '600px'; $('.modal-h', m.el).remove(); m.body.style.padding = '0';
    const q = $('#pal-q', m.el), list = $('#pal-l', m.el); let items = [], sel = 0, timer, pending = false;
    const draw = () => {
      let lastType = null;
      list.innerHTML = items.length ? items.map((it, i) => { const h = it.group !== lastType ? `<div class="pal-h">${esc(it.group)}</div>` : ''; lastType = it.group;
        return `${h}<div class="pal-i ${i === sel ? 'sel' : ''}" data-i="${i}">${icon(it.icon || TYPE_ICON[it.type] || 'arrowR')}<span class="grow" style="min-width:0"><div class="ellipsis">${esc(it.title)}</div>${it.sub ? `<div class="sb">${esc(it.sub)}</div>` : ''}</span><span class="ty">${esc(it.type)}</span></div>`; }).join('') : `<div class="empty mini">${pending ? 'Searching…' : 'No results'}</div>`;
      const s = $('.pal-i.sel', list); if (s) s.scrollIntoView({ block: 'nearest' });
    };
    const base = () => { const t = q.value.trim().toLowerCase(); const f = (a) => a.filter((x) => !t || x.title.toLowerCase().includes(t));
      return [...f(creates).map((x) => ({ ...x, group: 'Actions' })), ...f(jumps).map((x) => ({ ...x, group: 'Navigate' }))]; };
    const update = () => { sel = 0; items = base(); const t = q.value.trim(); pending = t.length >= 2; draw(); clearTimeout(timer); if (!pending) return;
      timer = setTimeout(async () => { try { const r = await GET('/search' + qs({ q: t })); if (q.value.trim() !== t) return; pending = false; items = [...r.map((x) => ({ ...x, group: 'Records' })), ...base()]; sel = 0; draw(); } catch { /* ignore */ } }, 160); };
    const go = (it) => { if (!it) return; m.close(); if (it.run) it.run(); else if (it.link) location.hash = it.link; };
    q.addEventListener('input', update);
    q.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); } else if (e.key === 'Enter') { e.preventDefault(); go(items[sel]); } });
    delegate(list, '.pal-i', 'click', (el) => go(items[Number(el.dataset.i)]));
    q.focus(); update();
  },
};

/* ---------- auth screens ---------- */
function authScreen(st, inner) {
  const s = st || {};
  $('#app').innerHTML = `<div class="auth"><div class="auth-l"><div class="ws" style="padding:0"><span class="mark">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : esc((s.company_name || 'T')[0])}</span><span>${esc(s.company_name || 'CRM')}</span></div>
    <div class="auth-form">${inner}</div><div class="auth-foot">Private workspace · access is limited to your team</div></div>
    <div class="auth-r"><div class="auth-quote"><div class="big">Every client, project, file, invoice and login — in one place instead of five.</div>
    <ul><li>${icon('building')}Leads, clients and full project history</li><li>${icon('receipt')}Quotations, GST invoices and payments</li><li>${icon('lock')}Encrypted vault for client server access</li><li>${icon('check')}Tasks for the team, with deadlines that do not slip</li></ul></div></div></div>`;
}
async function showAuth() {
  clearInterval(Shell.poll); modalStack.slice().forEach((m) => m.close());
  let st; try { st = await GET('/auth/state'); } catch (e) { authScreen(null, `<h1>Cannot reach the server</h1><p class="sub">${esc(e.message)}</p>`); return; }
  if (st.setup_needed) {
    authScreen(st, `<h1>Set up your workspace</h1><p class="sub">Create the first founder account. You can invite the other founders and interns right after.</p>
      <form id="af">${[['company_name', 'Company name', 'text', st.company_name || 'TechSentinals'], ['name', 'Your name', 'text', ''], ['email', 'Work email', 'email', ''], ['password', 'Password', 'password', '']].map(([n, l, t, v]) => `<label class="f"><span>${l}</span><input name="${n}" type="${t}" value="${esc(v)}" required autocomplete="${t === 'password' ? 'new-password' : 'off'}"></label>`).join('')}
      <p class="hint" style="margin:6px 0 16px">Password: 10+ characters with letters and numbers.</p><div id="ae" class="callout err hidden" style="margin-bottom:12px"></div><button class="btn primary">Create workspace</button></form>`);
  } else {
    authScreen(st, `<h1>Welcome back</h1><p class="sub">Sign in with your work email.</p><form id="af"><label class="f"><span>Email</span><input name="email" type="email" required autocomplete="username" autofocus></label>
      <label class="f"><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>
      <label class="f hidden" id="codef"><span>Code from your authenticator app</span><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123 456" maxlength="7"></label>
      <div id="ae" class="callout err hidden" style="margin-top:14px"></div><div style="margin-top:18px"><button class="btn primary">Sign in</button></div></form>
      ${st.demo ? `<div class="demo-box"><b>Public demo</b><span>Sample company data. It resets on its own every so often. Pick an account:</span>
        <div class="demo-acc">${[['aarav@demo.test', 'Aarav Mehta', 'Founder: sees everything'], ['kabir@demo.test', 'Kabir Singh', 'Intern: with maintenance access'], ['tara@demo.test', 'Tara Nair', 'Intern: own tasks and projects only']].map(([e, n, r]) => `<button type="button" class="btn" data-demo="${e}"><span class="grow" style="text-align:left"><b style="display:block">${n}</b><span class="small muted">${r}</span></span>${icon('arrowR')}</button>`).join('')}</div></div>` : ''}`);
    if (st.demo) $$('[data-demo]').forEach((b) => b.addEventListener('click', () => { $('[name=email]').value = b.dataset.demo; $('[name=password]').value = 'Demo-Pass-2026'; $('#af').requestSubmit(); }));
  }
  $('#af').addEventListener('submit', async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); const btn = $('button', e.target); btn.disabled = true;
    if (!d.code) delete d.code;
    const res = await fetch('/api' + (st.setup_needed ? '/auth/setup' : '/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'crm' }, credentials: 'same-origin', body: JSON.stringify(d) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : { error: 'Cannot reach the server. Check your connection.' };
    if (res && res.ok) return boot();
    const a = $('#ae');
    if (j.need_code) {
      const f = $('#codef'); const first = f.classList.contains('hidden'); f.classList.remove('hidden'); $('input', f).focus();
      if (first && !d.code) { a.classList.add('hidden'); btn.disabled = false; return; }
    }
    a.textContent = j.error || `Sign-in failed (${res && res.status})`; a.classList.remove('hidden'); btn.disabled = false;
  });
}

async function boot() {
  let st; try { st = await GET('/auth/state'); } catch { return showAuth(); }
  if (st.setup_needed || !st.user) return showAuth();
  App.user = st.user;
  try { await refreshLookups(); } catch { return showAuth(); }
  Shell.build();
  if (!location.hash) location.hash = '#/dashboard';
  if (App.user.must_change_password) { $('#view').innerHTML = '<div class="empty" style="margin-top:120px">Choose your own password to continue.</div>'; return Shell.passwordModal(true); }
  await Router.render();
}
window.showAuth = showAuth;
boot();
