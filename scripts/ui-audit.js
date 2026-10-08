/* UI audit — run in the browser while signed in as a founder (DevTools console: paste this file, press Enter).
   Visits every page and every form, and reports layout / accessibility / behaviour problems.
   Returns { passed, failed: [...] }. Re-run after any UI change. */
(async () => {
  const sleep = (t) => new Promise((r) => setTimeout(r, t));
  const fails = []; let passed = 0;
  const check = (ok, what) => { if (ok) passed++; else fails.push(what); };
  const errors = []; const onErr = (e) => errors.push(String(e.message || e.reason)); addEventListener('error', onErr); addEventListener('unhandledrejection', onErr);
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const overlap = (a, b) => { const r = a.getBoundingClientRect(), s = b.getBoundingClientRect(); return r.width && s.width && r.left < s.right - 1 && s.left < r.right - 1 && r.top < s.bottom - 1 && s.top < r.bottom - 1; };
  const waitIdle = async () => { for (let i = 0; i < 40; i++) { await sleep(100); if (!document.querySelector('#view [aria-busy="true"], #view .sk-page')) return; } };

  const clients = await GET('/clients'), projects = await GET('/projects'), leads = await GET('/leads'), invoices = await GET('/invoices'), quotes = await GET('/quotes');
  const pages = ['#/dashboard', '#/tasks', '#/calendar', '#/leads', '#/leads?view=list', '#/followups', '#/followups?show=all', '#/sales-report', '#/sales-report?year=2026', '#/contact-log', '#/grants', '#/assets', '#/finance?tab=bank', '#/finance?tab=payments', '#/leads?view=list&department=Website', '#/clients', '#/quotes', '#/projects', '#/maintenance', '#/documents', '#/invoices', '#/renewals', '#/finance', '#/vault', '#/team', '#/team?tab=activity', '#/settings',
    leads[0] && `#/leads/${leads[0].id}`, clients[0] && `#/clients/${clients[0].id}`, clients[0] && `#/clients/${clients[0].id}?tab=billing`, projects[0] && `#/projects/${projects[0].id}`, projects[0] && `#/projects/${projects[0].id}?tab=tasks`,
    invoices[0] && `#/invoices/${invoices[0].id}`, quotes[0] && `#/quotes/${quotes[0].id}`].filter(Boolean);

  for (const p of pages) {
    location.hash = p; await sleep(250); await waitIdle(); await sleep(450);
    const view = document.querySelector('#view'); const de = document.documentElement;
    check(!/Something went wrong|Page not found|No access/.test(view.innerText.slice(0, 300)), `${p}: page failed to render`);
    check(de.scrollWidth <= de.clientWidth + 1, `${p}: page scrolls sideways (${de.scrollWidth} > ${de.clientWidth})`);
    check(!view.querySelector('.sk, [aria-busy="true"]'), `${p}: loading skeleton never went away`);
    // cards side by side must line up (no ragged gaps)
    view.querySelectorAll('.dash-row').forEach((row, i) => { const cs = [...row.children]; if (cs.length < 2 || Math.abs(cs[0].getBoundingClientRect().top - cs[1].getBoundingClientRect().top) > 1) return; const hs = cs.map((c) => Math.round(c.getBoundingClientRect().height)); check(Math.max(...hs) - Math.min(...hs) <= 1, `${p}: row ${i + 1} cards have different heights ${hs}`); });
    // headings must not be clipped, header items must not overlap
    view.querySelectorAll('.panel-h, .ph, .pt').forEach((h) => { const kids = [...h.children].filter(vis); for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) check(!overlap(kids[i], kids[j]), `${p}: overlapping header items in "${h.innerText.slice(0, 30)}"`); });
    view.querySelectorAll('h1, .panel-h h2').forEach((h) => check(h.scrollWidth <= h.clientWidth + 1 || getComputedStyle(h).textOverflow === 'ellipsis', `${p}: heading cut off "${h.textContent.slice(0, 30)}"`));
    // every control has a name a screen reader can read
    view.querySelectorAll('button, a[href], select, input:not([type=hidden]), textarea').forEach((el) => {
      if (!vis(el)) return;
      const name = (el.getAttribute('aria-label') || el.title || el.dataset.tip || el.innerText || el.value || el.placeholder || (el.labels && el.labels[0] && el.labels[0].innerText) || el.closest('label')?.innerText || '').trim();
      check(!!name, `${p}: unlabeled ${el.tagName.toLowerCase()} ${el.outerHTML.slice(0, 80)}`);
    });
    view.querySelectorAll('img').forEach((img) => check(img.hasAttribute('alt'), `${p}: image without alt`));
    // charts react to the pointer
    for (const w of view.querySelectorAll('.chartw')) {
      const r = w.querySelector('svg').getBoundingClientRect(); w.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * 0.6, clientY: r.top + 40 })); await sleep(220);
      check(w.classList.contains('hover') && /₹/.test(w.querySelector('.ctip').innerText), `${p}: chart shows no tooltip on hover`);
      const tip = w.querySelector('.ctip').getBoundingClientRect(), box = w.getBoundingClientRect(); check(tip.left >= box.left - 1 && tip.right <= box.right + 1, `${p}: chart tooltip spills outside the chart`);
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 1, clientY: 1 }));
    }
  }

  // every form popup: opens centred, nothing spills, closes with Esc, and asks before discarding edits
  location.hash = '#/dashboard'; await sleep(200); await waitIdle();
  for (const res of Object.keys(FORMS)) {
    editRecord(res, null, {}, () => {}, { label: res }); await sleep(380);
    const ov = [...document.querySelectorAll('.overlay')].pop(); const box = ov.querySelector('.modal'), body = ov.querySelector('.modal-b'); box.getAnimations().forEach((an) => an.finish()); const r = box.getBoundingClientRect();   // finish the open animation (it freezes when the tab is hidden)
    check(r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, `form ${res}: popup off-screen`);
    check(body.scrollWidth <= body.clientWidth + 1, `form ${res}: fields spill sideways`);
    ov.querySelectorAll('.form-grid label.f').forEach((l) => { const sp = l.querySelector(':scope > span'); if (sp) check(sp.scrollWidth <= sp.clientWidth + 1, `form ${res}: label cut "${sp.textContent}"`); });
    const first = ov.querySelector('.modal-b input:not([type]), .modal-b input[type=text], .modal-b input[type=email], .modal-b textarea'); if (first) { first.value = 'x'; first.dispatchEvent(new Event('input', { bubbles: true })); }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(250);
    const titles = [...document.querySelectorAll('.overlay h2')].map((h) => h.textContent);
    check(!first || titles.includes('Discard changes?'), `form ${res}: Esc threw away typed changes without asking`);
    document.querySelector('#cfm-ok')?.click(); await sleep(250);
    check(!document.querySelector('.overlay'), `form ${res}: popup did not close`);
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
  }

  // motion is switched off for people who ask for it
  check([...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.media && /prefers-reduced-motion/.test(r.media.mediaText)); } catch { return false; } }), 'no reduced-motion rule');

  removeEventListener('error', onErr); removeEventListener('unhandledrejection', onErr);
  errors.forEach((e) => fails.push('JS error: ' + e)); location.hash = '#/dashboard';
  console.log(`UI audit (${innerWidth}px): ${passed} passed, ${fails.length} failed`); fails.forEach((f) => console.warn(f));
  return { width: innerWidth, passed, failed: fails };
})();
