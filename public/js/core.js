/* TechSentinals CRM — core helpers & shared UI components (no framework, no build step) */
'use strict';

const App = { user: null, lookups: { users: [], clients: [], projects: [], accounts: [], leads: [], settings: {} } };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isFounder = () => App.user && App.user.role === 'founder';
const can = (flag) => isFounder() || (App.user && App.user.modules.includes(flag));

/* ---------- formatting ---------- */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => inr.format(Number(n) || 0);
const money2 = (n) => inr2.format(Number(n) || 0);
const compact = (n) => { n = Number(n) || 0; const a = Math.abs(n); return a >= 1e7 ? (n / 1e7).toFixed(1).replace(/\.0$/, '') + ' Cr' : a >= 1e5 ? (n / 1e5).toFixed(1).replace(/\.0$/, '') + ' L' : a >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)); };
const asDate = (d) => new Date(String(d).slice(0, 10) + 'T00:00:00');
const fdate = (d) => (d ? asDate(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fshort = (d) => { if (!d) return '—'; const x = asDate(d); return x.toLocaleDateString('en-IN', x.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }); };
const fdt = (s) => (s ? new Date(String(s).replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const ago = (s) => {
  if (!s) return ''; const sec = (Date.now() - new Date(String(s).replace(' ', 'T') + 'Z')) / 1000;
  if (sec < 60) return 'just now'; if (sec < 3600) return Math.floor(sec / 60) + 'm ago'; if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  if (sec < 86400 * 7) return Math.floor(sec / 86400) + 'd ago'; return fshort(new Date(Date.now() - sec * 1000).toISOString());
};
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDaysStr = (s, n) => { const d = asDate(s); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const daysUntil = (s) => Math.round((asDate(s) - asDate(todayStr())) / 86400000);
const initials = (n) => String(n || '?').replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const pretty = (s) => (s ? String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');
const fsize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const extLink = (u) => (u ? `<a class="ln" href="${esc(/^https?:\/\//.test(u) ? u : 'https://' + u)}" target="_blank" rel="noopener noreferrer">${esc(u.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : '<span class="faint">—</span>');

/* soft, deterministic colour per name (avatars, client marks) */
const TONES = [['#e7f0ea', '#2c6a49'], ['#ebeef8', '#3a4d87'], ['#f6ebe2', '#8a4a20'], ['#f3eaf3', '#7b3f80'], ['#e6f0f3', '#2b6175'], ['#f4efdf', '#7a5d17'], ['#f0e9e7', '#704a3d'], ['#eaefe6', '#4c6833']];
const tone = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TONES[h % TONES.length]; };
const avatar = (name, size) => { const [b, f] = tone(name); return `<span class="av ${size || ''}" style="--a-bg:${b};--a-fg:${f}" title="${esc(name)}">${esc(initials(name))}</span>`; };
const logoSq = (name, size) => { const [b, f] = tone(name); return `<span class="logo-sq ${size || ''}" style="--a-bg:${b};--a-fg:${f}">${esc(initials(name))}</span>`; };
const who = (name, sub) => (name ? `<span class="who">${avatar(name, 'sm')}<span class="ellipsis">${esc(name)}${sub ? `<div class="t2">${esc(sub)}</div>` : ''}</span></span>` : '<span class="faint">—</span>');

const dueBadge = (d, done) => {
  if (!d) return '<span class="faint">—</span>';
  const n = daysUntil(d);
  const cls = done ? '' : n < 0 ? 'late' : n <= 2 ? 'soon' : '';
  const rel = done ? '' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : '';
  return `<span class="due ${cls}" title="${fdate(d)}">${rel || fshort(d)}</span>`;
};

const STATUS_TONE = {
  green: ['active', 'won', 'paid', 'done', 'completed', 'accepted', 'resolved'],
  red: ['overdue', 'lost', 'rejected', 'cancelled', 'lapsed', 'ended', 'failed'],
  amber: ['pending', 'partial', 'review', 'on_hold', 'expired', 'paused'],
  blue: ['sent', 'in_progress', 'contacted', 'meeting', 'open'],
  plum: ['maintenance', 'negotiation', 'proforma'],
  accent: ['proposal'],
};
const STATUS_LABEL = { active: 'Active', in_progress: 'In progress', on_hold: 'On hold', todo: 'To do', review: 'In review', meeting: 'Meeting', proposal: 'Proposal sent', partial: 'Part-paid' };
const PRIORITY = { low: 1, medium: 2, high: 3, urgent: 4 };
function prio(p) { const n = PRIORITY[p] || 0; return `<span class="nowrap"><span class="pri p${n}"><i></i><i></i><i></i></span>${esc(pretty(p))}</span>`; }
function badge(v, label) {
  if (v == null || v === '') return '<span class="faint">—</span>';
  if (PRIORITY[v]) return prio(v);
  const k = Object.keys(STATUS_TONE).find((c) => STATUS_TONE[c].includes(String(v)));
  return `<span class="st ${k || ''}">${esc(label || STATUS_LABEL[v] || pretty(v))}</span>`;
}

/* ---------- icons (1.75 stroke line set) ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  users: '<path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M3 12.5h18"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  check: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16 7l2.5 2.5M18.5 4.5 21 7"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
  tool: '<path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-3-3-6.5 0V11.5L3 10l7-7 1.5 1.5"/><path d="M14.7 6.3 18 3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  inbox: '<path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
  print: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  note: '<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5M8.5 9h7M8.5 12.5h4"/>',
  phone: '<path d="M5 4h3.5l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2 4.5 1.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  chat: '<path d="M4 18.5 5.3 15A7.5 7.5 0 1 1 9 18.6z"/>',
  meeting: '<circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M3 19v-1a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v1M14 14.5h2.5A3.5 3.5 0 0 1 20 18v1"/>',
  gear: '<circle cx="12" cy="12" r="2.5"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5M12 16v.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.3 7.5 9.5 4.3-1.2 7.5-5 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  eye: '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  arrowL: '<path d="M15 5l-7 7 7 7"/>', arrowR: '<path d="M9 5l7 7-7 7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  clip: '<path d="m20 11.5-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
  arrowUpRight: '<path d="M7 17 17 7M8 7h9v9"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ---------- API ---------- */
async function api(method, url, body) {
  const opts = { method, headers: { 'X-Requested-With': 'crm' }, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api' + url, opts); } catch { throw new Error('Cannot reach the server. Check your connection.'); }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && !url.startsWith('/auth/')) { App.user = null; if (window.showAuth) window.showAuth(); throw new Error('Session expired — please sign in again.'); }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
const GET = (u) => api('GET', u); const POST = (u, b) => api('POST', u, b || {}); const PUT = (u, b) => api('PUT', u, b || {}); const DEL = (u) => api('DELETE', u);
const qs = (o) => { const p = Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`); return p.length ? '?' + p.join('&') : ''; };
async function refreshLookups() { App.lookups = await GET('/lookups'); }

/* ---------- toast / overlays ---------- */
function toast(msg, err) {
  const root = $('#toasts'); const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : ''); el.setAttribute('role', err ? 'alert' : 'status');
  el.innerHTML = icon(err ? 'alert' : 'check'); el.append(document.createTextNode(msg)); root.appendChild(el);
  while (root.children.length > 3) root.firstChild.remove();
  const bye = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  let t = setTimeout(bye, err ? 6000 : 2800);
  el.addEventListener('mouseenter', () => clearTimeout(t)); el.addEventListener('mouseleave', () => { t = setTimeout(bye, 1500); });
}

/* ---------- tooltips: any element with a title gets a styled tip (keyboard focus too) ---------- */
(() => {
  let tip, cur;
  const hide = () => { if (!cur) return; if (cur.dataset.tip !== undefined && !cur.title) cur.title = cur.dataset.tip; cur = null; tip?.classList.remove('on'); };
  const show = (el) => {
    if (cur === el) return; hide(); const text = el.title; if (!text) return;
    cur = el; el.dataset.tip = text; el.removeAttribute('title');           // stop the slow native tooltip
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    tip.textContent = text; tip.classList.add('on');
    const r = el.getBoundingClientRect(); const tw = tip.offsetWidth, th = tip.offsetHeight;
    let top = r.top - th - 8; if (top < 6) top = r.bottom + 8;
    tip.style.left = Math.max(6, Math.min(innerWidth - tw - 6, r.left + r.width / 2 - tw / 2)) + 'px'; tip.style.top = top + 'px';
  };
  document.addEventListener('mouseover', (e) => { const el = e.target.closest?.('[title]'); if (el && !el.closest('svg')) show(el); else if (cur && !cur.contains(e.target)) hide(); });
  document.addEventListener('focusin', (e) => { if (e.target.matches?.('[title]')) show(e.target); });
  ['focusout', 'scroll', 'mousedown', 'keydown'].forEach((t) => document.addEventListener(t, hide, true));
})();

/* ---------- money KPIs count up once when a page appears ---------- */
function countUp(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $$('.kpi .v', root).forEach((v) => {
    const m = v.textContent.match(/^([-−]?)₹([\d,]+)(\.\d+)?$/); if (!m || v.children.length) return;
    const end = Number(m[2].replace(/,/g, '')) * (m[1] ? -1 : 1); if (!end) return; const t0 = performance.now(); const final = v.textContent;
    const step = (t) => { const p = Math.min(1, (t - t0) / 700); const e = 1 - (1 - p) ** 3; v.textContent = p < 1 ? money(Math.round(end * e)) : final; if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

/* ---------- skeleton shown while a page loads ---------- */
function skRows(n) {
  return Array.from({ length: n }, (_, i) => `<div class="sk-row"><span class="sk" style="width:26px;height:26px;border-radius:6px"></span><div style="flex:1;display:grid;gap:7px"><span class="sk" style="width:${40 + (i * 17) % 35}%;height:10px"></span><span class="sk" style="width:${20 + (i * 11) % 20}%;height:8px"></span></div><span class="sk" style="width:70px;height:10px"></span></div>`).join('');
}
function skeleton(kind) {
  const bar = (w, h = 10) => `<span class="sk" style="width:${w};height:${h}px"></span>`;
  const rows = (n) => Array.from({ length: n }, (_, i) => `<div class="sk-row"><span class="sk" style="width:26px;height:26px;border-radius:6px"></span><div style="flex:1;display:grid;gap:7px">${bar(`${40 + (i * 17) % 35}%`)}${bar(`${20 + (i * 11) % 20}%`, 8)}</div>${bar('70px')}</div>`).join('');
  const head = `<div class="sk-ph">${bar('120px', 12)}${bar('110px', 28)}</div><div style="display:grid;gap:9px;margin-bottom:22px">${bar('260px', 22)}${bar('380px', 10)}</div>`;
  if (kind === 'dash') return `<div class="sk-page" aria-busy="true" aria-label="Loading">${head}<div class="sk-kpis">${Array.from({ length: 5 }, () => `<div>${bar('60%', 9)}${bar('75%', 20)}${bar('50%', 8)}</div>`).join('')}</div>
    <div class="dash-row"><div class="sk-panel"><div class="sk-row">${bar('90px', 12)}</div><div style="padding:18px"><span class="sk" style="height:180px"></span></div></div><div class="sk-panel"><div class="sk-row">${bar('80px', 12)}</div>${rows(4)}</div></div></div>`;
  if (kind === 'record') return `<div class="sk-page" aria-busy="true" aria-label="Loading">${head}<div class="dash-row"><div class="sk-panel">${rows(6)}</div><div class="sk-panel">${rows(5)}</div></div></div>`;
  return `<div class="sk-page" aria-busy="true" aria-label="Loading">${head}<div style="display:flex;gap:10px;margin-bottom:14px">${bar('240px', 30)}${bar('110px', 30)}${bar('110px', 30)}</div><div class="sk-panel">${rows(8)}</div></div>`;
}
const fail = (e) => toast(e.message || String(e), true);

const modalStack = [];
/* Centred popup. size: 'sm' | '' (medium) | 'wide' | 'xl'. sub: one-line explanation under the title.
   m.dirty() → true means there are unsaved changes: a click outside is ignored and Esc asks first. */
function openModal({ title, sub, body, footer, size, onClose, noClose }) {
  const ov = document.createElement('div'); ov.className = 'overlay dialog';
  ov.innerHTML = `<div class="modal ${size || ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-h"><div class="mh-t"><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${noClose ? '' : `<button class="btn ghost sm icon" data-close aria-label="Close">${icon('x')}</button>`}</div>
    <div class="modal-b">${body || ''}</div>${footer ? `<div class="modal-f">${footer}</div>` : ''}</div>`;
  const m = { el: ov, box: $('.modal', ov), body: $('.modal-b', ov), foot: $('.modal-f', ov), dirty: () => false,
    close() { if (!ov.isConnected) return; ov.remove(); modalStack.splice(modalStack.indexOf(m), 1); document.body.classList.toggle('modal-open', modalStack.length > 0); if (onClose) onClose(); },
    async tryClose() { if (m.locked) return; if (m.dirty() && !(await confirmBox('You have unsaved changes in this form.', { title: 'Discard changes?', okLabel: 'Discard', cancelLabel: 'Keep editing', danger: true }))) return; m.close(); } };
  if (!noClose) {
    let downOnBackdrop = false;    // only a click that starts AND ends on the backdrop closes (not a text selection that drifts out)
    ov.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === ov; });
    ov.addEventListener('click', (e) => {
      if (e.target !== ov || !downOnBackdrop || m.locked) return;
      if (m.dirty()) { m.box.classList.remove('nudge'); void m.box.offsetWidth; m.box.classList.add('nudge'); return; }
      m.close();
    });
    $$('[data-close]', ov).forEach((b) => b.addEventListener('click', () => m.tryClose()));
  }
  $('#modal-root').appendChild(ov); modalStack.push(m); document.body.classList.add('modal-open');
  const first = $('.modal-b input:not([type=hidden]):not([type=checkbox]):not([type=file]):not(:disabled), .modal-b textarea, .modal-b select', ov);
  if (first && matchMedia('(pointer: fine)').matches) setTimeout(() => first.focus({ preventScroll: true }), 40);
  return m;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalStack.length) { e.preventDefault(); modalStack[modalStack.length - 1].tryClose(); } });

function confirmBox(message, { okLabel = 'Confirm', danger = false, title = 'Are you sure?', cancelLabel = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({ title, size: 'sm', body: `<p class="pre muted">${esc(message)}</p>`,
      footer: `<button class="btn" data-close>${esc(cancelLabel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cfm-ok">${esc(okLabel)}</button>`,
      onClose: () => { if (!done) resolve(false); } });
    $('#cfm-ok', m.el).addEventListener('click', () => { done = true; m.close(); resolve(true); });
  });
}
function promptBox(title, label, value = '', { multiline = false, required = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({ title, size: 'sm',
      body: `<label class="f"><span>${esc(label)}</span>${multiline ? `<textarea id="pr-in">${esc(value)}</textarea>` : `<input id="pr-in" value="${esc(value)}">`}</label>`,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="pr-ok">Save</button>', onClose: () => { if (!done) resolve(null); } });
    const ok = () => { const v = $('#pr-in', m.el).value.trim(); if (required && !v) return; done = true; m.close(); resolve(v); };
    $('#pr-ok', m.el).addEventListener('click', ok);
    $('#pr-in', m.el).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) ok(); });
  });
}
/* small anchored menu; returns the element */
function popover(anchor, html, { cls = '', placement = 'below' } = {}) {
  $$('.popover').forEach((p) => p.remove());
  const p = document.createElement('div'); p.className = `popover ${cls}`; p.innerHTML = html; document.body.appendChild(p);
  const r = anchor.getBoundingClientRect(); const w = p.offsetWidth; const h = p.offsetHeight;
  let left = placement === 'right' ? r.right + 8 : r.left; let top = placement === 'right' ? r.top : r.bottom + 6;
  if (placement === 'above') top = r.top - h - 6;
  left = Math.min(left, innerWidth - w - 8); top = Math.max(8, Math.min(top, innerHeight - h - 8));
  p.style.left = left + 'px'; p.style.top = top + 'px';
  setTimeout(() => { const off = (e) => { if (!p.contains(e.target)) { p.remove(); document.removeEventListener('mousedown', off); } }; document.addEventListener('mousedown', off); }, 0);
  return p;
}

function delegate(root, selector, type, fn) {
  root.addEventListener(type, (e) => { const t = e.target.closest(selector); if (t && root.contains(t)) fn(t, e); });
}

/* ---------- form builder ---------- */
const lookupOpts = {
  users: () => App.lookups.users.map((u) => ({ v: u.id, l: u.name })),
  clients: () => App.lookups.clients.map((c) => ({ v: c.id, l: c.company })),
  projects: () => App.lookups.projects.map((p) => ({ v: p.id, l: p.name })),
  accounts: () => App.lookups.accounts.map((a) => ({ v: a.id, l: a.name })),
  leads: () => App.lookups.leads.map((l) => ({ v: l.id, l: l.name + (l.company ? ` — ${l.company}` : '') })),
};
const normOpts = (arr) => arr.map((o) => (Array.isArray(o) ? { v: o[0], l: o[1] } : typeof o === 'object' ? o : { v: o, l: o }));
const optionsFor = (f) => (f.lookup ? lookupOpts[f.lookup]() : normOpts(f.options || []));

function fieldHtml(f, val) {
  if (f.section) return `<div class="fsec"><b>${esc(f.section)}</b>${f.hint ? `<span>${esc(f.hint)}</span>` : ''}</div>`;
  const v = val ?? f.default ?? '';
  const id = `fld-${f.name}`;
  const rk = f.rule || (f.type === 'money' ? 'money' : ''); const rule = rk && RULES.K[rk];
  const ra = rule ? ` data-rule="${rk}"${rule.max ? ` maxlength="${rule.max}"` : ''}${rule.inputmode ? ` inputmode="${rule.inputmode}"` : ''}${rule.upper ? ' autocapitalize="characters" style="text-transform:uppercase"' : ''}${rule.num && rule.min !== undefined ? ` min="${rule.min}"` : ''}` : '';
  let input;
  switch (f.type) {
    case 'textarea': input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`; break;
    case 'select': {
      const opts = optionsFor(f);
      input = `<select id="${id}" name="${f.name}">${f.required && !f.blank ? (f.lookup && (v == null || v === '') ? '<option value="" selected disabled hidden>Choose…</option>' : '') : `<option value="">${esc(f.blank || '—')}</option>`}${opts.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(v) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
      break;
    }
    case 'checkbox': return `<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" id="${id}" name="${f.name}" ${v === 1 || v === true || v === '1' ? 'checked' : ''}><span>${esc(f.label)}${f.help ? `<div class="hint">${esc(f.help)}</div>` : ''}</span></label>`;
    case 'money': case 'number': input = `<input type="number" id="${id}" name="${f.name}"${ra} value="${esc(v)}" step="${f.step || (f.type === 'money' ? '0.01' : 'any')}" ${f.min !== undefined ? `min="${f.min}"` : ''} placeholder="${esc(f.placeholder || '')}">`; break;
    case 'password': input = `<input type="password" id="${id}" name="${f.name}" autocomplete="new-password" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}">`; break;
    default: input = `<input type="${f.type || 'text'}" id="${id}" name="${f.name}"${ra} value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${f.type === 'date' ? '' : 'autocomplete="off"'}>`;
  }
  return `<label class="f ${f.full ? 'full' : ''}"><span>${esc(f.label)}${f.required ? ' <i>*</i>' : ''}</span>${input}<div class="f-err" id="${id}-err" role="alert"></div>${f.help ? `<div class="hint">${esc(f.help)}</div>` : ''}</label>`;
}
function readForm(root, fields) {
  const out = {};
  for (const f of fields) { const el = $(`[name="${f.name}"]`, root); if (!el) continue; out[f.name] = f.type === 'checkbox' ? el.checked : el.value; }
  return out;
}

/* Every record form is a centred popup. intro may contain safe HTML. */
/* ---------- validation (rules shared with the server: js/rules.js) ---------- */
function fieldError(el, msg) {
  const slot = el.id && document.getElementById(el.id + '-err');
  el.classList.toggle('invalid', !!msg); el.setAttribute('aria-invalid', msg ? 'true' : 'false');
  if (slot) { slot.textContent = msg || ''; slot.classList.toggle('on', !!msg); }
}
const labelOf = (el) => (el.closest('label') && el.closest('label').querySelector('span') ? el.closest('label').querySelector('span').textContent.replace('*', '').trim() : 'This field');
function fieldProblem(el, label = labelOf(el)) {
  const v = el.type === 'checkbox' ? '' : el.value;
  if (el.type === 'number' && el.validity && el.validity.badInput) return `${label} must be a number.`;
  if (el.type === 'date' && v && !RULES.validDate(v)) return `${label} is not a real date.`;
  const kind = el.dataset.rule; const e = kind ? RULES.check(kind, v) : '';
  return e ? `${label} ${e}.` : '';
}
function validateForm(form, fields, data, res) {
  const out = [];
  for (const f of fields) {
    if (!f.name || f.type === 'checkbox') continue; const el = $(`[name="${f.name}"]`, form); if (!el || el.disabled) continue;
    const empty = data[f.name] == null || String(data[f.name]).trim() === '';
    const msg = f.required && empty ? `${f.label} is required.` : fieldProblem(el, f.label);
    fieldError(el, msg); if (msg) out.push({ el, label: f.label, msg });
  }
  const dmsg = res ? RULES.checkDates(res, data) : '';
  if (dmsg) for (const [late] of RULES.ORDER[res] || []) { const el = $(`[name="${late}"]`, form); if (el && data[late]) { fieldError(el, dmsg); out.push({ el, label: labelOf(el), msg: dmsg }); } }
  return out;
}
// while typing: drop characters a field can never accept, and say why
(() => {
  const say = (el, msg) => { fieldError(el, msg); el._sayAt = Date.now(); clearTimeout(el._sayT); el._sayT = setTimeout(() => { if (!fieldProblem(el)) fieldError(el, ''); }, 2400); };
  document.addEventListener('input', (e) => {
    const el = e.target; const kind = el.dataset && el.dataset.rule; if (!kind || el.type === 'number') return;
    const rule = RULES.K[kind]; let v = el.value; const pos = el.selectionStart || 0;
    if (rule.block) {
      const nv = v.replace(rule.block, '');
      if (nv !== v) {
        const hadDigit = /[0-9]/.test(v) && !/[0-9]/.test(nv);
        el.value = nv; try { el.setSelectionRange(pos - (v.length - nv.length), pos - (v.length - nv.length)); } catch { /* not a text input */ }
        say(el, hadDigit ? `Numbers are not allowed in ${labelOf(el)}.` : `That character is not allowed in ${labelOf(el)}${rule.hint ? ` (${rule.hint.toLowerCase()})` : ''}.`);
        v = nv;
      }
    }
    if (rule.upper && v !== v.toUpperCase()) { el.value = v.toUpperCase(); try { el.setSelectionRange(pos, pos); } catch { /* */ } }
    else if (el.classList.contains('invalid') && !fieldProblem(el) && !(el._sayT && Date.now() - el._sayAt < 2400)) fieldError(el, '');
  });
  document.addEventListener('keydown', (e) => {
    const el = e.target; if (el.type !== 'number' || !el.dataset || !el.dataset.rule) return;
    const neg = RULES.K[el.dataset.rule].min < 0;
    if (['e', 'E', '+'].includes(e.key) || (e.key === '-' && !neg)) { e.preventDefault(); say(el, e.key === '-' ? 'Amounts cannot be negative.' : 'Only digits and a decimal point.'); }
  });
  document.addEventListener('focusout', (e) => {
    const el = e.target; if (!el.matches || !el.matches('.form-grid input, .form-grid textarea')) return;
    fieldError(el, el.value ? fieldProblem(el) : '');
  });
  document.addEventListener('paste', (e) => {      // "₹1,20,000" pasted into an amount → 120000
    const el = e.target; if (el.type !== 'number' || !el.dataset || !el.dataset.rule) return;
    const t = (e.clipboardData || window.clipboardData).getData('text'); const n = t.replace(/[^0-9.]/g, '');
    if (n !== t) { e.preventDefault(); el.value = n; el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
})();
function formModal({ title, sub, fields, values = {}, submit = 'Save', size, onSubmit, danger, intro, extra, rules: rulesFor }) {
  if (rulesFor) fields = fields.map((f) => (f.name && !f.rule && RULES.kindFor(rulesFor, f.name) ? { ...f, rule: RULES.kindFor(rulesFor, f.name) } : f));
  const m = openModal({ title, sub, size,
    body: `<form id="mf" novalidate>${intro ? `<div class="form-intro">${intro}</div>` : ''}<div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.name])).join('')}</div>${extra || ''}<div id="mf-err" class="callout err hidden" role="alert" style="margin-top:16px"></div></form>`,
    footer: `${danger ? `<button class="btn ghost danger-text" id="mf-del" type="button" style="margin-right:auto">Delete</button>` : ''}<span class="kbd-hint">Ctrl + Enter to save</span><button class="btn" data-close type="button">Cancel</button><button class="btn primary" id="mf-ok" type="button">${esc(submit)}</button>` });
  const form = $('#mf', m.el), err = $('#mf-err', m.el), ok = $('#mf-ok', m.el);
  const snapshot = () => JSON.stringify(readForm(form, fields));
  const initial = snapshot(); let saving = false;
  m.dirty = () => !saving && snapshot() !== initial;
  const run = async () => {
    const data = readForm(form, fields);
    const problems = validateForm(form, fields, data, rulesFor);
    if (problems.length) { err.textContent = problems.length === 1 ? problems[0].msg : `Please fix ${problems.length} fields: ${problems.map((p) => p.label).join(', ')}.`; err.classList.remove('hidden'); problems[0].el.focus(); return; }
    for (const f of fields) if (typeof data[f.name] === 'string' && f.type !== 'textarea' && f.type !== 'password') data[f.name] = data[f.name].trim();
    ok.disabled = true; saving = true; err.classList.add('hidden'); const label = ok.textContent; ok.textContent = 'Saving…'; ok.classList.add('busy');
    try { await onSubmit(data, m); m.close(); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); err.scrollIntoView({ block: 'nearest' }); ok.disabled = false; saving = false; ok.textContent = label; ok.classList.remove('busy'); }
  };
  ok.addEventListener('click', run);
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); run(); } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(); });
  if (danger) $('#mf-del', m.el).addEventListener('click', async () => { if (await confirmBox(danger.message || 'Delete this record? This cannot be undone.', { danger: true, okLabel: 'Delete' })) { try { await danger.fn(); m.close(); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); } } });
  return m;
}

const LOOKUP_RESOURCES = new Set(['clients', 'projects', 'accounts', 'leads']);
/* Open the create/edit form for any resource. Calls after(record) on success. */
function editRecord(resource, rec, defaults, after, opts = {}) {
  const fields = FORMS[resource](rec).map((f) => (f.name && !f.rule && RULES.kindFor(resource, f.name) ? { ...f, rule: RULES.kindFor(resource, f.name) } : f));
  const label = opts.label || resource.replace(/_/g, ' ').replace(/s$/, '');
  const canDelete = rec && (opts.canDelete !== undefined ? opts.canDelete : isFounder());
  const realFields = fields.filter((f) => f.name).length;
  const m = formModal({
    title: `${rec ? 'Edit' : 'New'} ${label}`, sub: rec ? (rec.name || rec.company || rec.title || rec.label || '') : FORM_INFO[resource], fields, values: rec || defaults || {},
    size: opts.size || (realFields > 8 ? 'wide' : ''),
    submit: rec ? 'Save changes' : `Create ${label}`, rules: resource,
    danger: canDelete ? { message: opts.deleteMessage, fn: async () => { await DEL(`/${resource}/${rec.id}`); if (LOOKUP_RESOURCES.has(resource)) await refreshLookups(); toast('Deleted'); if (opts.afterDelete) opts.afterDelete(); else if (after) after(null); } } : null,
    onSubmit: async (data) => {
      // context the page passed in but the form does not show (e.g. which client a new contact belongs to, which lead a task is for)
      const shown = new Set(fields.map((f) => f.name).filter(Boolean));
      const hidden = rec ? {} : Object.fromEntries(Object.entries(defaults || {}).filter(([k, v]) => !shown.has(k) && v !== undefined && v !== null && v !== ''));
      const saved = rec ? await PUT(`/${resource}/${rec.id}`, data) : await POST(`/${resource}`, { ...hidden, ...data });
      if (LOOKUP_RESOURCES.has(resource)) await refreshLookups();
      toast(rec ? 'Saved' : `${label.replace(/^./, (c) => c.toUpperCase())} created`);
      if (after) after(saved);
    },
  });
  if (resource === 'tasks' && rec && !isFounder()) {
    for (const n of ['title', 'project_id', 'assignee_id', 'priority', 'due_date']) { const el = $(`[name="${n}"]`, m.el); if (el) el.disabled = true; }
    const note = document.createElement('p'); note.className = 'callout info'; note.style.marginBottom = '16px'; note.textContent = 'You can change the status and add progress details on your tasks.'; $('.form-grid', m.el).before(note);
  }
  return m;
}

/* ---------- reusable data table ---------- */
function mountList(root, cfg) {
  const st = { rows: [], q: '', filters: {}, sort: cfg.defaultSort || null, limit: cfg.pageSize || 50 };
  const id = 'l' + Math.random().toString(36).slice(2, 7);
  const fOpts = (f) => (f.lookup ? lookupOpts[f.lookup]() : normOpts(f.options));
  const hasBar = cfg.search !== false || (cfg.filters || []).length || cfg.add || cfg.toolbarExtra;
  root.innerHTML = `${hasBar ? `<div class="toolbar" id="${id}-tb">${cfg.search === false ? '' : `<input type="search" placeholder="${esc(cfg.searchPlaceholder || 'Search…')}" id="${id}-q" aria-label="Search">`}
    ${(cfg.filters || []).map((f) => `<select data-f="${f.key}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}</option>${fOpts(f).map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('')}</select>`).join('')}
    <span class="grow"></span>${cfg.toolbarExtra || ''}${cfg.add ? `<button class="btn ${cfg.add.quiet ? '' : 'primary'}" id="${id}-add">${icon('plus')}${esc(cfg.add.label)}</button>` : ''}</div>` : ''}
    <div class="tbl" id="${id}-tbl" aria-busy="true">${skRows(6)}</div>`;
  const tbl = $(`#${id}-tbl`, root);
  const haystack = (r) => (cfg.searchText ? cfg.searchText(r) : Object.values(r).filter((v) => typeof v === 'string' || typeof v === 'number').join(' ')).toLowerCase();
  function draw() {
    let rows = st.rows.filter((r) => (!st.q || haystack(r).includes(st.q)) && Object.entries(st.filters).every(([k, v]) => !v || String(r[((cfg.filters || []).find((f) => f.key === k) || {}).field || k] ?? '') === v));
    if (st.sort) {
      const col = cfg.columns.find((c) => c.key === st.sort.key);
      if (col) { const g = col.sort || ((r) => r[col.key]); rows = [...rows].sort((a, b) => { const x = g(a), y = g(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }); return st.sort.dir === 'desc' ? -c : c; }); }
    }
    if (!rows.length) {
      tbl.removeAttribute('aria-busy'); tbl.innerHTML = `<div class="empty"><b>${esc(st.rows.length ? 'No matches' : (cfg.empty && cfg.empty.title) || 'Nothing here yet')}</b>${esc(st.rows.length ? 'Try a different search or clear the filters.' : (cfg.empty && cfg.empty.text) || '')}</div>`;
      return;
    }
    const shown = rows.slice(0, st.limit);
    tbl.removeAttribute('aria-busy'); tbl.innerHTML = `<div class="tbl-scroll"><table class="t"><thead><tr>${cfg.columns.map((c) => `<th class="${c.num ? 'num' : ''} ${c.sortable === false ? '' : 'sortable'}" data-sort="${c.key}" ${c.width ? `style="width:${c.width}"` : ''}>${esc(c.label)}${st.sort && st.sort.key === c.key ? `<span class="arr">${st.sort.dir === 'asc' ? '↑' : '↓'}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((r) => `<tr class="${cfg.onRow ? 'click' : ''}" data-id="${r.id}">${cfg.columns.map((c) => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>
      ${cfg.footer ? `<tfoot>${cfg.footer(rows)}</tfoot>` : ''}</table></div>
      ${cfg.compact && rows.length <= st.limit ? '' : `<div class="tbl-foot"><span>${plural(rows.length, cfg.noun || 'record')}${rows.length !== st.rows.length ? ` <span class="faint">of ${st.rows.length}</span>` : ''}</span>${rows.length > shown.length ? `<button class="btn sm" id="${id}-more">Show ${Math.min(100, rows.length - shown.length)} more</button>` : ''}</div>`}`;
  }
  async function reload() {
    try {
      st.rows = cfg.rows ? await cfg.rows() : await GET(`/${cfg.resource}${qs(cfg.query)}`);
      if (cfg.transform) st.rows = cfg.transform(st.rows);
      draw(); if (cfg.onLoad) cfg.onLoad(st.rows);
    } catch (e) { tbl.innerHTML = `<div class="empty"><b>Could not load</b>${esc(e.message)}</div>`; }
  }
  const qEl = $(`#${id}-q`, root); if (qEl) qEl.addEventListener('input', () => { st.q = qEl.value.trim().toLowerCase(); draw(); });
  $$('select[data-f]', root).forEach((s) => s.addEventListener('change', () => { st.filters[s.dataset.f] = s.value; draw(); }));
  tbl.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]'); if (th && th.classList.contains('sortable')) { const k = th.dataset.sort; st.sort = st.sort && st.sort.key === k ? { key: k, dir: st.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }; return draw(); }
    if (e.target.id === `${id}-more`) { st.limit += 100; return draw(); }
    if (e.target.closest('a, button, input, select')) return;
    const tr = e.target.closest('tr[data-id]'); if (tr && cfg.onRow) cfg.onRow(st.rows.find((r) => String(r.id) === tr.dataset.id));
  });
  const add = $(`#${id}-add`, root); if (add) add.addEventListener('click', () => cfg.add.onClick(reload));
  delegate(tbl, '[data-act]', 'click', (el, e) => { e.stopPropagation(); const r = st.rows.find((x) => String(x.id) === el.closest('tr').dataset.id); if (cfg.actions && cfg.actions[el.dataset.act]) cfg.actions[el.dataset.act](r, reload, el); });
  reload();
  return { reload, state: st, redraw: draw };
}

/* ---------- notes / activity timeline ---------- */
const NOTE_ICON = { note: 'note', call: 'phone', meeting: 'meeting', email: 'mail', whatsapp: 'chat', system: 'gear' };
const NOTE_VERB = { note: 'added a note', call: 'logged a call', meeting: 'logged a meeting', email: 'logged an email', whatsapp: 'logged a WhatsApp chat', system: '' };
function notesPanel(root, type, id, { canWrite = true, kinds = true, placeholder } = {}) {
  root.innerHTML = `${canWrite ? `<div class="composer"><textarea id="nt-body" rows="2" placeholder="${esc(placeholder || 'Write a note, call summary, decision or WhatsApp gist…')}"></textarea>
    <div class="bar2">${kinds ? '<select id="nt-kind" aria-label="Type"><option value="note">Note</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select>' : ''}<span class="grow faint small">Ctrl + Enter to post</span><button class="btn primary sm" id="nt-add">Post</button></div></div>` : ''}
    <div class="tl" id="nt-list" aria-busy="true">${skRows(3)}</div>`;
  const list = $('#nt-list', root);
  async function load() {
    try {
      const notes = await GET('/notes' + qs({ entity_type: type, entity_id: id }));
      list.removeAttribute('aria-busy'); list.innerHTML = notes.length ? notes.map((n) => `<div class="tl-item ${n.kind === 'system' ? 'sys' : ''}"><div class="tl-ico">${icon(NOTE_ICON[n.kind] || 'note')}</div><div style="min-width:0">
        <div class="tl-meta">${n.kind === 'system' ? '' : `<b>${esc(n.user_name || 'Someone')}</b> ${NOTE_VERB[n.kind] || ''} ·`} <span>${ago(n.created_at)}</span>
        ${n.kind !== 'system' && (isFounder() || n.user_id === App.user.id) ? `<button class="btn ghost sm icon" data-del="${n.id}" title="Delete">${icon('x')}</button>` : ''}</div>
        <div class="tl-body pre">${esc(n.body)}</div></div></div>`).join('') : '<div class="empty mini">No activity yet. Notes, calls and decisions you log will appear here.</div>';
    } catch (e) { list.innerHTML = `<div class="empty mini">${esc(e.message)}</div>`; }
  }
  if (canWrite) {
    const post = async () => { const b = $('#nt-body', root); if (!b.value.trim()) return; try { await POST('/notes', { entity_type: type, entity_id: id, body: b.value, kind: kinds ? $('#nt-kind', root).value : 'note' }); b.value = ''; load(); } catch (e) { fail(e); } };
    $('#nt-add', root).addEventListener('click', post);
    $('#nt-body', root).addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post(); });
  }
  delegate(list, '[data-del]', 'click', async (el) => { if (await confirmBox('Delete this note?', { danger: true, okLabel: 'Delete' })) { try { await DEL('/notes/' + el.dataset.del); load(); } catch (e) { fail(e); } } });
  load();
}

/* ---------- drag-and-drop file picker ---------- */
const dropZone = (id, title, sub, accept = '') => `<label class="drop" id="${id}-zone"><input type="file" id="${id}" ${accept ? `accept="${accept}"` : ''}>
  <span class="drop-i">${icon('upload')}</span><span class="drop-t">${title}</span><span class="drop-s" id="${id}-name">${esc(sub)}</span></label>`;
function wireDropZone(root, id, onFile) {
  const zone = $(`#${id}-zone`, root), input = $(`#${id}`, root), name = $(`#${id}-name`, root);
  const show = () => { const f = input.files[0]; zone.classList.toggle('has', !!f); if (f) name.textContent = `${f.name} · ${fsize(f.size)}`; if (f && onFile) onFile(f); };
  input.addEventListener('change', show);
  ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; show(); } });
}

/* ---------- documents ---------- */
function uploadModal(entityType, entityId, after, defaults = {}) {
  const m = openModal({ title: 'Upload document', sub: 'Up to 60 MB. Stored on your own server.', body: `<div class="form-grid">
    <div class="full">${dropZone('up-file', 'Drop a file here, or <u>choose one</u>', 'PDF, images, Word, Excel, ZIP…')}</div>
    <label class="f full"><span>Title</span><input id="up-title" placeholder="Defaults to the file name"></label>
    <label class="f"><span>Category</span><select id="up-cat">${OPT.docCategory.map((c) => `<option ${c === (defaults.category || 'Other') ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    <label class="f"><span>Notes</span><input id="up-notes"></label></div><div id="up-err" class="callout err hidden" style="margin-top:14px"></div>`,
    footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="up-ok">Upload</button>' });
  wireDropZone(m.el, 'up-file');
  $('#up-ok', m.el).addEventListener('click', async () => {
    const file = $('#up-file', m.el).files[0], err = $('#up-err', m.el);
    if (!file) { err.textContent = 'Choose a file first.'; err.classList.remove('hidden'); return; }
    const fd = new FormData(); fd.append('entity_type', entityType); if (entityId) fd.append('entity_id', entityId);
    fd.append('title', $('#up-title', m.el).value); fd.append('category', $('#up-cat', m.el).value); fd.append('notes', $('#up-notes', m.el).value); fd.append('file', file);
    const b = $('#up-ok', m.el); b.disabled = true; b.textContent = 'Uploading…';
    try {
      const r = await fetch('/api/documents/upload', { method: 'POST', body: fd, headers: { 'X-Requested-With': 'crm' }, credentials: 'same-origin' });
      const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Upload failed');
      toast('Uploaded'); m.close(); if (after) after();
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); b.disabled = false; b.textContent = 'Upload'; }
  });
}
const INLINE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];
const fileKind = (r) => { const ext = (r.filename.split('.').pop() || '').toUpperCase().slice(0, 4); return `<span class="logo-sq sm" style="--a-bg:#f1f0ec;--a-fg:#5b574e;font-size:9px">${esc(ext || 'FILE')}</span>`; };
const docColumns = (showEntity) => [
  { key: 'title', label: 'Document', render: (r) => `<div class="who">${fileKind(r)}<div style="min-width:0"><div class="t1 ellipsis">${esc(r.title)}</div><div class="t2 ellipsis">${esc(r.filename)} · ${fsize(r.size)}</div></div></div>` },
  { key: 'category', label: 'Category', render: (r) => `<span class="tag">${esc(r.category || 'Other')}</span>` },
  ...(showEntity ? [{ key: 'entity_name', label: 'Linked to', render: (r) => (r.entity_type === 'general' ? '<span class="muted">Company</span>' : `<span class="muted">${pretty(r.entity_type)}</span> ${esc(r.entity_name || '—')}`) }] : []),
  { key: 'created_at', label: 'Added', render: (r) => `${fshort(r.created_at)}<div class="t2">${esc(r.uploader_name || '')}</div>` },
  { key: 'a', label: '', sortable: false, cls: 'nowrap right', render: (r) => `${INLINE_MIME.includes(r.mime) ? `<a class="btn sm" href="/api/files/${r.id}?inline=1" target="_blank" rel="noopener">${icon('eye')}View</a> ` : ''}<a class="btn sm icon" href="/api/files/${r.id}" title="Download">${icon('download')}</a> <button class="btn sm icon ghost" data-act="edit" title="Edit">${icon('edit')}</button>` },
];
function docsPanel(root, entityType, entityId, { canUpload = true } = {}) {
  mountList(root, {
    resource: 'documents', query: { entity_type: entityType, entity_id: entityId }, columns: docColumns(false), searchPlaceholder: 'Search files…', compact: true, noun: 'file',
    add: canUpload ? { label: 'Upload', onClick: (reload) => uploadModal(entityType, entityId, reload) } : null,
    empty: { title: 'No files yet', text: 'Contracts, specs, designs, KYC, meeting notes — keep them all here.' },
    actions: { edit: (r, reload) => { if (!(isFounder() || r.uploaded_by === App.user.id)) return toast('Only the uploader or a founder can edit this.', true); editRecord('documents', r, null, reload, { label: 'document', canDelete: true }); } },
  });
}

/* ---------- page building blocks ---------- */
/* crumb: optional HTML trail like '<a href="#/leads">Leads</a> / Name'. title may contain safe HTML. */
function pageHead(title, sub, actions, crumb) {
  const trail = (crumb || `<b>${title}</b>`).split(' / ').map((p, i, a) => (i === a.length - 1 && crumb ? `<b>${p}</b>` : p)).join('<span class="sep">/</span>');
  return `<header class="ph"><div class="crumbs">${trail}</div><div class="actions">${actions || ''}</div></header>${crumb ? '' : `<div class="pt"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>`}`;
}
function tabsHtml(tabs, current, base) {
  return `<nav class="tabs" role="tablist">${tabs.map((t) => `<a href="${base}?tab=${t.key}" class="${t.key === current ? 'on' : ''}" role="tab">${esc(t.label)}</a>`).join('')}</nav>`;
}
function kpi(label, value, sub, cls) { return `<div class="kpi ${cls || ''}"><div class="l">${esc(label)}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`; }
function hl(label, value, sub, cls) { return `<div class="hl ${cls || ''}"><div class="l">${esc(label)}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`; }
const prop = (label, html) => `<dl class="prop"><dt>${esc(label)}</dt><dd>${html == null || html === '' ? '<span class="faint">—</span>' : html}</dd></dl>`;
const propsSec = (title, body, action) => `<section class="props-sec"><div class="props-h"><span>${esc(title)}</span>${action || ''}</div>${body}</section>`;
const panel = (title, body, right) => `<section class="panel"><div class="panel-h"><h2>${title}</h2>${right || ''}</div>${body}</section>`;
const sectionH = (title, right) => `<div class="section-h"><h2>${title}</h2>${right || ''}</div>`;
function csvDownload(filename, rows) {
  const esc2 = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc2).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const copyText = async (text) => { try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); } catch { toast('Copy failed — select and copy manually.', true); } };
