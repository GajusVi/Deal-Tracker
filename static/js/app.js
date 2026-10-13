// Router, command palette, keyboard shortcuts, quick-add and theme.
import { api, store, loadMeta } from './api.js';
import { html, $, $$, debounce, logo, errToast, ic, modal, initials, fmtDate } from './ui.js';
import { icon as svgIcon } from './icons.js';
import { companyForm, contactForm, meetingForm, cimWizard, contactView, meetingView, hasDemo, clearDemo } from './forms.js';
import { renderDashboard, updateBadge } from './views/dashboard.js';
import { renderPipeline } from './views/pipeline.js';
import { renderCompanies } from './views/companies.js';
import { renderCompany } from './views/company.js';
import { renderMeetings } from './views/meetings.js';
import { renderContacts, renderNetwork } from './views/contacts.js';
import { renderSettings } from './views/settings.js';
import { renderTeam, renderHandover } from './views/team.js';

const view = $('#view');
const routes = [
  [/^\/?$/, 'dashboard', 'Overview', () => renderDashboard(view)],
  [/^\/pipeline$/, 'pipeline', 'Pipeline', () => renderPipeline(view)],
  [/^\/companies$/, 'companies', 'Companies', () => renderCompanies(view)],
  [/^\/company\/(\d+)(?:\/(\w+))?$/, 'companies', null, (m) => renderCompany(view, +m[1], m[2])],
  [/^\/meetings$/, 'meetings', 'Meetings', () => renderMeetings(view)],
  [/^\/contacts$/, 'contacts', 'Contacts', () => renderContacts(view)],
  [/^\/network$/, 'network', 'Network', () => renderNetwork(view)],
  [/^\/settings$/, 'settings', 'Settings', () => renderSettings(view)],
  [/^\/team$/, 'team', 'Team & handover', () => renderTeam(view)],
  [/^\/team\/(.+)$/, 'team', null, (m) => renderHandover(view, decodeURIComponent(m[1]))],
];
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ breadcrumbs
export function setCrumbs(items) {
  $('#crumbs').innerHTML = String(html`${items.map((c, i) => html`${i ? ic('chevronRight') : ''}${c.href && i < items.length - 1 ? html`<a href="${c.href}">${c.label}</a>` : html`<b>${c.label}</b>`}`)}`);
  document.title = `${items[items.length - 1].label} · Deal Tracker`;
}

// ------------------------------------------------------------------ router
let renderSeq = 0;
let firstRender = true;
export async function route() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const seq = ++renderSeq;
  $('#sidebar').classList.remove('open');
  const match = routes.find(([rx]) => rx.test(path));
  if (!match) {
    view.innerHTML = String(html`<div class="empty">${ic('alert')}<h3>Page not found</h3><a class="btn" href="#/">Go to overview</a></div>`);
    return;
  }
  const [rx, nav, label, fn] = match;
  $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === nav));
  if (label) setCrumbs([{ label }]);
  const run = async () => {
    try {
      await fn(path.match(rx));
    } catch (e) {
      if (seq !== renderSeq) return;
      view.innerHTML = String(html`<div class="empty">${ic('alert')}<h3>Something went wrong</h3><p>${e.message}</p><a class="btn" href="#/">Go to overview</a></div>`);
    }
    if (seq === renderSeq) window.scrollTo(0, 0);
  };
  if (document.startViewTransition && !firstRender && !reduceMotion()) {
    document.startViewTransition(run);
  } else {
    await run();
  }
  firstRender = false;
}
export const refresh = () => route();

// ------------------------------------------------------------------ quick add
export async function quickNew(kind) {
  if (kind === 'company') {
    const c = await companyForm();
    if (c) location.hash = `#/company/${c.id}`;
  } else if (kind === 'cim') {
    cimWizard();
  } else if (kind === 'meeting') {
    if (await meetingForm()) refresh();
  } else if (kind === 'contact') {
    if (await contactForm()) refresh();
  }
}
const qaBtn = $('#quick-add-btn'), qaMenu = $('#quick-add-menu');
qaBtn.addEventListener('click', (e) => { e.stopPropagation(); qaMenu.hidden = !qaMenu.hidden; });
qaMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-new]');
  if (!b) return;
  qaMenu.hidden = true;
  quickNew(b.dataset.new);
});
document.addEventListener('click', (e) => { if (!e.target.closest('.quick-add')) qaMenu.hidden = true; });

// ------------------------------------------------------------------ command palette
const NAV = [
  ['Overview', '#/', 'overview', 'G O'], ['Pipeline', '#/pipeline', 'pipeline', 'G P'], ['Companies', '#/companies', 'companies', 'G C'],
  ['Meetings', '#/meetings', 'meetings', 'G M'], ['Contacts', '#/contacts', 'contacts', 'G R'], ['Network', '#/network', 'network', 'G N'],
  ['Team & handover', '#/team', 'team', 'G T'], ['Settings', '#/settings', 'settings', 'G S'],
];
function actions() {
  return [
    { label: 'New company', icon: 'plus', kbd: 'C', run: () => quickNew('company') },
    { label: 'New company from CIM', icon: 'scan', kbd: 'U', run: () => quickNew('cim') },
    { label: 'Log meeting notes', icon: 'meetings', kbd: 'M', run: () => quickNew('meeting') },
    { label: 'New contact', icon: 'userPlus', run: () => quickNew('contact') },
    { label: `Switch to ${isDark() ? 'light' : 'dark'} mode`, icon: isDark() ? 'sun' : 'moon', run: toggleTheme },
    { label: 'Keyboard shortcuts', icon: 'keyboard', kbd: '?', run: showShortcuts },
    ...(hasDemo() ? [{ label: 'Clear sample data', icon: 'trash', run: () => clearDemo() }] : []),
  ];
}

let paletteOpen = false;
export async function openPalette() {
  if (paletteOpen) return;
  paletteOpen = true;
  let companies = [];
  api.get('/api/companies').then((c) => { companies = c; render(); }).catch(() => {});
  let q = '', items = [], active = 0, remote = [];
  const m = modal({
    title: '', size: 'cmdk',
    body: html`<div class="cmdk-input">${ic('search')}<input id="cmdk-q" type="text" placeholder="Search companies, people, notes, CIM text — or type a command" autocomplete="off" spellcheck="false"></div>
      <div class="cmdk-list" id="cmdk-list" role="listbox"></div>
      <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span><kbd>esc</kbd> to close</span></div>`,
    onClose: () => { paletteOpen = false; },
  });
  const el = m.el;
  el.classList.add('cmdk');
  $('.modal-head', el).remove();
  $('.modal-body', el).style.padding = '0';
  const input = $('#cmdk-q', el), list = $('#cmdk-list', el);
  const TYPE_ICON = { company: 'companies', contact: 'contacts', meeting: 'meetings', document: 'file' };

  function build() {
    const ql = q.toLowerCase();
    const has = (s) => !ql || s.toLowerCase().includes(ql);
    const groups = [];
    const acts = actions().filter((a) => has(a.label));
    const navs = NAV.filter(([l]) => has(`Go to ${l}`)).map(([label, href, icon, kbd]) => ({ label: `Go to ${label}`, icon, kbd, run: () => { location.hash = href; } }));
    const cos = companies.filter((c) => has(`${c.name} ${c.codename || ''} ${c.sector || ''}`)).slice(0, q ? 6 : 5)
      .map((c) => ({ label: c.name, sub: [c.codename, c.stage].filter(Boolean).join(' · '), logo: c, run: () => { location.hash = `#/company/${c.id}`; } }));
    if (cos.length) groups.push([q ? 'Companies' : 'Recent companies', cos]);
    const rem = remote.filter((r) => r.type !== 'company').map((r) => ({
      label: r.title, sub: (r.subtitle || '').replace(/\b(\d{4}-\d{2}-\d{2})(T[\d:.+Z-]*)?\b/g, (d) => fmtDate(d.slice(0, 10))), icon: TYPE_ICON[r.type] || 'file',
      run: () => (r.type === 'contact' ? contactView(r.id, { onChange: refresh }) : r.type === 'meeting' ? meetingView(r.id, { onChange: refresh }) : (location.hash = `#/company/${r.company_id}/docs`)),
    }));
    if (rem.length) groups.push(['People, notes & documents', rem]);
    if (acts.length) groups.push(['Actions', acts]);
    if (navs.length) groups.push(['Navigate', navs]);
    return groups;
  }
  function render() {
    const groups = build();
    items = groups.flatMap(([, it]) => it);
    active = Math.min(active, Math.max(items.length - 1, 0));
    let i = 0;
    list.innerHTML = items.length ? String(html`${groups.map(([title, its]) => html`<div class="cmdk-group">${title}</div>${its.map((it) => {
      const idx = i++;
      return html`<div class="cmdk-item ${idx === active ? 'active' : ''}" data-i="${idx}" role="option">${it.logo ? logo(it.logo, 'xs') : ic(it.icon)}<span>${it.label}</span>${it.sub ? html`<span class="sub">${it.sub}</span>` : html`<span class="spacer"></span>`}${it.kbd ? html`<kbd>${it.kbd}</kbd>` : ''}</div>`;
    })}`)}`) : String(html`<div class="cmdk-empty">No results for “${q}”</div>`);
    const a = list.querySelector('.cmdk-item.active');
    a && a.scrollIntoView({ block: 'nearest' });
  }
  const searchRemote = debounce(async () => {
    if (q.trim().length < 2) { remote = []; render(); return; }
    try { remote = await api.get(`/api/search?q=${encodeURIComponent(q.trim())}`); } catch { remote = []; }
    render();
  }, 120);
  const choose = (it) => { if (!it) return; m.close(); setTimeout(() => it.run(), 60); };
  input.addEventListener('input', () => { q = input.value; active = 0; render(); searchRemote(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(items[active]); }
  });
  list.addEventListener('mousemove', (e) => {
    const r = e.target.closest('.cmdk-item');
    if (r && +r.dataset.i !== active) { active = +r.dataset.i; list.querySelectorAll('.cmdk-item').forEach((x) => x.classList.toggle('active', +x.dataset.i === active)); }
  });
  list.addEventListener('click', (e) => { const r = e.target.closest('.cmdk-item'); if (r) choose(items[+r.dataset.i]); });
  render();
  setTimeout(() => input.focus(), 20);
}
$('#cmdk-trigger').addEventListener('click', openPalette);

// ------------------------------------------------------------------ shortcuts
const SHORTCUTS = [
  ['Search or run a command', ['⌘', 'K']], ['New company', ['C']], ['New company from CIM', ['U']], ['Log meeting notes', ['M']],
  ['Go to overview', ['G', 'O']], ['Go to pipeline', ['G', 'P']], ['Go to companies', ['G', 'C']], ['Go to meetings', ['G', 'M']],
  ['Go to contacts', ['G', 'R']], ['Go to network', ['G', 'N']], ['Go to team & handover', ['G', 'T']], ['Show shortcuts', ['?']],
];
function showShortcuts() {
  modal({
    title: 'Keyboard shortcuts', size: 'narrow',
    body: html`<div class="shortcuts">${SHORTCUTS.map(([l, keys]) => html`<div>${l}</div><span>${keys.map((k) => html`<kbd>${k}</kbd>`)}</span>`)}</div>`,
  });
}
$('#shortcuts-btn').addEventListener('click', showShortcuts);

let gPending = 0;
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  const t = e.target;
  const typing = t.closest && t.closest('input, textarea, select, [contenteditable="true"]');
  if (typing || mod || e.altKey || $('#modal-root').children.length) return;
  const k = e.key.toLowerCase();
  if (gPending && Date.now() - gPending < 1200) {
    gPending = 0;
    const dest = { o: '#/', p: '#/pipeline', c: '#/companies', m: '#/meetings', r: '#/contacts', n: '#/network', t: '#/team', s: '#/settings' }[k];
    if (dest) { e.preventDefault(); location.hash = dest; }
    return;
  }
  if (k === 'g') { gPending = Date.now(); return; }
  if (k === 'c') { e.preventDefault(); quickNew('company'); }
  else if (k === 'u') { e.preventDefault(); quickNew('cim'); }
  else if (k === 'm') { e.preventDefault(); quickNew('meeting'); }
  else if (k === '/') { e.preventDefault(); openPalette(); }
  else if (e.key === '?') { e.preventDefault(); showShortcuts(); }
});

// ------------------------------------------------------------------ prefetch & chrome
document.addEventListener('mouseover', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#/company/"]');
  if (!a) return;
  const id = (a.getAttribute('href').match(/#\/company\/(\d+)/) || [])[1];
  if (id) api.prefetch(`/api/companies/${id}`);
}, { passive: true });
window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });

const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
function paintThemeToggle() {
  const b = $('#theme-toggle');
  b.innerHTML = `${svgIcon(isDark() ? 'sun' : 'moon')}<span>${isDark() ? 'Light mode' : 'Dark mode'}</span>`;
}
function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  const apply = () => {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('dt-theme', next); } catch { /* storage unavailable */ }
    paintThemeToggle();
  };
  if (document.startViewTransition && !reduceMotion()) document.startViewTransition(apply); else apply();
}
$('#theme-toggle').addEventListener('click', toggleTheme);
$('#menu-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#sidebar').classList.toggle('open'); });
document.addEventListener('click', (e) => { if (!e.target.closest('#sidebar') && !e.target.closest('#menu-btn')) $('#sidebar').classList.remove('open'); });

export function applyBranding() {
  const firm = store.meta.settings.firm_name || '';
  $('#firm-name').textContent = firm || 'Private equity';
  $('#brand-mark').textContent = firm ? initials(firm).slice(0, 1) : 'D';
}

// ------------------------------------------------------------------ boot
(async function boot() {
  $$('i[data-icon]').forEach((i) => { i.outerHTML = svgIcon(i.dataset.icon); });
  paintThemeToggle();
  if (!/Mac|iPhone|iPad/.test(navigator.platform)) $('#cmdk-kbd').textContent = 'Ctrl K';
  try {
    await loadMeta();
    applyBranding();
  } catch (e) {
    errToast(e);
    return;
  }
  window.addEventListener('hashchange', route);
  route();
  api.get('/api/dashboard').then((d) => updateBadge(d.attention)).catch(() => {});
})();
