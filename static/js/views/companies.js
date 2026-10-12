import { api, store } from '../api.js';
import { html, $, logo, money, mult, pct, ago, options, debounce, ICONS, prioChip } from '../ui.js';
import { quickNew } from '../app.js';
import { companyCard } from './dashboard.js';

const state = { q: '', stage: '', sector: '', region: '', priority: '', mode: 'grid', sort: 'updated_at', asc: false };
try { Object.assign(state, JSON.parse(localStorage.getItem('dt-companies') || '{}')); } catch { /* ignore */ }
const persist = () => { try { localStorage.setItem('dt-companies', JSON.stringify({ mode: state.mode, sort: state.sort, asc: state.asc })); } catch { /* ignore */ } };

const COLS = [
  ['name', 'Company'], ['stage', 'Stage'], ['sector', 'Sector'], ['country', 'Country'], ['ev', 'EV', 'r'], ['revenue', 'Revenue', 'r'],
  ['ebitda', 'EBITDA', 'r'], ['ebitda_margin', 'Margin', 'r'], ['ev_ebitda', 'EV/EBITDA', 'r'], ['meeting_count', 'Mtgs', 'r'], ['updated_at', 'Updated', 'r'],
];

export async function renderCompanies(view) {
  const s = store.meta.settings;
  view.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Companies</h1><p id="co-count">&nbsp;</p></div>
      <div class="btn-row">
        <a class="btn ghost" href="/api/export/companies.csv">${ICONS.download} Export CSV</a>
        <button class="btn" data-qn="cim">${ICONS.upload} New from CIM</button>
        <button class="btn primary" data-qn="company">${ICONS.plus} Add company</button>
      </div>
    </div>
    <div class="filters">
      <input type="search" id="f-q" placeholder="Filter by name, codename, tag…" value="${state.q}">
      <select id="f-stage">${options(s.stages, state.stage, { blank: 'All stages' })}</select>
      <select id="f-sector">${options(s.sectors, state.sector, { blank: 'All sectors' })}</select>
      <select id="f-region">${options(store.meta.regions, state.region, { blank: 'All regions' })}</select>
      <select id="f-priority">${options(['High', 'Medium', 'Low'], state.priority, { blank: 'Any priority' })}</select>
      <span class="spacer"></span>
      <div class="seg"><button data-mode="grid" class="${state.mode === 'grid' ? 'on' : ''}">Cards</button><button data-mode="table" class="${state.mode === 'table' ? 'on' : ''}">Table</button></div>
    </div>
    <div id="co-list"></div>`);

  view.querySelectorAll('[data-qn]').forEach((b) => b.addEventListener('click', () => quickNew(b.dataset.qn)));
  const load = async () => {
    const qs = new URLSearchParams(Object.entries({ q: state.q, stage: state.stage, sector: state.sector, region: state.region, priority: state.priority }).filter(([, v]) => v));
    const list = await api.get(`/api/companies?${qs}`);
    draw(list);
  };
  const draw = (list) => {
    $('#co-count', view).textContent = `${list.length} compan${list.length === 1 ? 'y' : 'ies'}`;
    const el = $('#co-list', view);
    if (!list.length) {
      el.innerHTML = String(html`<div class="card empty"><h3>No companies match</h3><p>Try clearing filters, or add a new company.</p></div>`);
      return;
    }
    if (state.mode === 'grid') {
      el.innerHTML = String(html`<div class="co-cards">${list.map(companyCard)}</div>`);
      return;
    }
    const k = state.sort;
    list.sort((a, b) => {
      const x = a[k], y = b[k];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * (state.asc ? 1 : -1);
    });
    el.innerHTML = String(html`<div class="card table-wrap"><table class="table">
      <thead><tr>${COLS.map(([key, label, cls]) => html`<th class="sortable ${cls || ''} ${state.sort === key ? 'sorted' : ''} ${state.sort === key && state.asc ? 'asc' : ''}" data-sort="${key}">${label}</th>`)}</tr></thead>
      <tbody>${list.map((c) => html`<tr data-id="${c.id}">
        <td><div class="cell-co">${logo(c, 'sm')}<div><b>${c.name}</b><small class="muted">${c.codename || ''}</small></div>${prioChip(c.priority)}</div></td>
        <td><span class="chip stage">${c.stage}</span></td>
        <td>${c.sector || '—'}</td><td>${c.country || '—'}</td>
        <td class="r num">${money(c.ev, c.currency)}</td><td class="r num">${money(c.revenue, c.currency)}</td><td class="r num">${money(c.ebitda, c.currency)}</td>
        <td class="r num">${pct(c.ebitda_margin)}</td><td class="r num">${mult(c.ev_ebitda)}</td><td class="r num">${c.meeting_count}</td>
        <td class="r muted" title="${new Date(c.updated_at).toLocaleString()}">${ago(c.updated_at)}</td>
      </tr>`)}</tbody></table></div>`);
    el.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      if (state.sort === th.dataset.sort) state.asc = !state.asc; else { state.sort = th.dataset.sort; state.asc = th.dataset.sort === 'name'; }
      persist(); draw(list);
    }));
    el.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/company/${tr.dataset.id}`; }));
  };

  $('#f-q', view).addEventListener('input', debounce((e) => { state.q = e.target.value; load(); }, 200));
  for (const f of ['stage', 'sector', 'region', 'priority']) $(`#f-${f}`, view).addEventListener('change', (e) => { state[f] = e.target.value; load(); });
  view.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode; persist();
    view.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
    load();
  }));
  await load();
}
