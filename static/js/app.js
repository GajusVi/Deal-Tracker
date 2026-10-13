// Router, global search, quick-add and theme.
import { api, store, loadMeta } from './api.js';
import { html, $, $$, debounce, logo, errToast } from './ui.js';
import { companyForm, contactForm, meetingForm, cimWizard, contactView, meetingView } from './forms.js';
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
  [/^\/?$/, 'dashboard', () => renderDashboard(view)],
  [/^\/pipeline$/, 'pipeline', () => renderPipeline(view)],
  [/^\/companies$/, 'companies', () => renderCompanies(view)],
  [/^\/company\/(\d+)(?:\/(\w+))?$/, 'companies', (m) => renderCompany(view, +m[1], m[2])],
  [/^\/meetings$/, 'meetings', () => renderMeetings(view)],
  [/^\/contacts$/, 'contacts', () => renderContacts(view)],
  [/^\/network$/, 'network', () => renderNetwork(view)],
  [/^\/settings$/, 'settings', () => renderSettings(view)],
  [/^\/team$/, 'team', () => renderTeam(view)],
  [/^\/team\/(.+)$/, 'team', (m) => renderHandover(view, decodeURIComponent(m[1]))],
];

let renderSeq = 0;
export async function route() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const seq = ++renderSeq;
  $('#sidebar').classList.remove('open');
  for (const [rx, nav, fn] of routes) {
    const m = path.match(rx);
    if (!m) continue;
    $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === nav));
    try {
      await fn(m);
    } catch (e) {
      if (seq !== renderSeq) return;
      view.innerHTML = String(html`<div class="card empty"><h3>Something went wrong</h3><p>${e.message}</p><a class="btn" href="#/">Back to dashboard</a></div>`);
    }
    if (seq === renderSeq) window.scrollTo(0, 0);
    return;
  }
  view.innerHTML = String(html`<div class="card empty"><h3>Page not found</h3><a class="btn" href="#/">Dashboard</a></div>`);
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
    const m = await meetingForm();
    if (m) refresh();
  } else if (kind === 'contact') {
    const c = await contactForm();
    if (c) refresh();
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

// ------------------------------------------------------------------ search
const sInput = $('#global-search'), sBox = $('#search-results');
let sActive = -1, sItems = [];
const TYPE_LABEL = { company: 'Company', contact: 'Contact', meeting: 'Meeting', document: 'CIM / Doc' };
const doSearch = debounce(async () => {
  const q = sInput.value.trim();
  if (q.length < 2) { sBox.hidden = true; return; }
  try { sItems = await api.get(`/api/search?q=${encodeURIComponent(q)}`); } catch { sItems = []; }
  sActive = sItems.length ? 0 : -1;
  renderSearch();
}, 180);
function renderSearch() {
  sBox.hidden = false;
  if (!sItems.length) { sBox.innerHTML = String(html`<div class="search-empty">No matches for “${sInput.value}”</div>`); return; }
  sBox.innerHTML = String(html`${sItems.map((r, i) => html`
    <div class="sr ${i === sActive ? 'active' : ''}" data-i="${i}">
      ${r.type === 'company' ? logo({ name: r.title, color: r.color, logo_url: r.logo_url }, 'sm') : html`<span class="avatar sm" style="--c:var(--text-3)">${r.type[0].toUpperCase()}</span>`}
      <div><b>${r.title}</b><small>${r.subtitle || ''}</small></div>
      <span class="sr-type">${TYPE_LABEL[r.type]}</span>
    </div>`)}`);
}
function openResult(r) {
  sBox.hidden = true;
  sInput.value = '';
  sInput.blur();
  if (r.type === 'company') location.hash = `#/company/${r.id}`;
  else if (r.type === 'document') location.hash = `#/company/${r.company_id}/docs`;
  else if (r.type === 'contact') contactView(r.id, { onChange: refresh });
  else if (r.type === 'meeting') meetingView(r.id, { onChange: refresh });
}
sInput.addEventListener('input', doSearch);
sInput.addEventListener('focus', () => { if (sInput.value.trim().length >= 2) renderSearch(); });
sInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { sActive = Math.min(sActive + 1, sItems.length - 1); renderSearch(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sActive = Math.max(sActive - 1, 0); renderSearch(); e.preventDefault(); }
  else if (e.key === 'Enter' && sItems[sActive]) openResult(sItems[sActive]);
  else if (e.key === 'Escape') { sBox.hidden = true; sInput.blur(); }
});
sBox.addEventListener('mousedown', (e) => { const r = e.target.closest('.sr'); if (r) { e.preventDefault(); openResult(sItems[+r.dataset.i]); } });
document.addEventListener('click', (e) => { if (!e.target.closest('.search')) sBox.hidden = true; });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); sInput.focus(); sInput.select(); }
});

// ------------------------------------------------------------------ theme / menu
$('#theme-toggle').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('dt-theme', next); } catch { /* storage unavailable */ }
  refresh();
});
$('#menu-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#sidebar').classList.toggle('open'); });
document.addEventListener('click', (e) => { if (!e.target.closest('#sidebar') && !e.target.closest('#menu-btn')) $('#sidebar').classList.remove('open'); });

export function applyBranding() {
  $('#firm-name').textContent = store.meta.settings.firm_name || 'Private Equity';
  document.title = `Deal Tracker · ${store.meta.settings.firm_name || ''}`.replace(/ · $/, '');
}

// ------------------------------------------------------------------ boot
(async function boot() {
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
