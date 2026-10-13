import { api, store } from '../api.js';
import { html, $, options, debounce, avatar, strength, ago, ic, typeColor, TYPE_COLORS } from '../ui.js';
import { setCrumbs } from '../app.js';
import { contactForm, contactView } from '../forms.js';
import { networkGraph } from '../graph.js';

const f = { q: '', type: '' };

export async function renderContacts(view) {
  setCrumbs([{ label: 'Contacts' }]);
  view.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Contacts</h1><p>Management teams, bankers, experts, co-investors and lenders, with who owns each relationship and when you last spoke.</p></div>
      <div class="btn-row"><a class="btn ghost" href="#/network">${ic('network')}Network</a><button class="btn primary" id="add">${ic('userPlus')}New contact</button></div>
    </div>
    <div class="filters">
      <label class="search">${ic('search')}<input type="search" id="q" placeholder="Search name, firm, email" value="${f.q}" aria-label="Search contacts"></label>
      <select id="type">${options(store.meta.settings.contact_types, f.type, { blank: 'All types' })}</select>
    </div>
    <div id="list"></div>`);
  const load = async () => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    const list = await api.get(`/api/contacts?${qs}`);
    $('#list', view).innerHTML = String(list.length ? html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Organisation</th><th>Type</th><th>Owner</th><th>Strength</th><th class="r">Meetings</th><th class="r">Last met</th><th>Email</th></tr></thead>
        <tbody>${list.map((p) => html`<tr data-p="${p.id}">
          <td><div class="cell-co">${avatar(p)}<div><b>${p.name}</b><small class="muted">${p.title || ''}</small></div></div></td>
          <td>${p.company_id ? html`<span class="co-link"><span class="dot" style="background:${p.company_color}"></span>${p.company_name}</span>` : p.organization || html`<span class="muted">–</span>`}</td>
          <td>${p.contact_type ? html`<span class="co-link"><span class="dot" style="background:${typeColor(p.contact_type)}"></span>${p.contact_type}</span>` : html`<span class="muted">–</span>`}</td>
          <td>${p.owner || html`<span class="muted">–</span>`}</td>
          <td>${strength(p.strength)}</td>
          <td class="r num">${p.meeting_count}</td>
          <td class="r muted">${p.last_met ? ago(p.last_met) : 'Never'}</td>
          <td>${p.email ? html`<a href="mailto:${p.email}" data-mail>${p.email}</a>` : ''}</td>
        </tr>`)}</tbody></table></div>`
      : html`<div class="empty">${ic('contacts')}<h3>${f.q || f.type ? 'Nothing matches' : 'No contacts yet'}</h3><p>${f.q || f.type ? 'Try a different search or type.' : 'Add the people you meet. They show up on meetings, deals and the network.'}</p></div>`);
  };
  $('#list', view).addEventListener('click', (e) => {
    if (e.target.closest('[data-mail]')) return;
    const r = e.target.closest('[data-p]');
    if (r) contactView(+r.dataset.p, { onChange: load });
  });
  $('#add', view).addEventListener('click', async () => { if (await contactForm()) load(); });
  $('#q', view).addEventListener('input', debounce((e) => { f.q = e.target.value; load(); }, 200));
  $('#type', view).addEventListener('change', (e) => { f.type = e.target.value; load(); });
  await load();
}

export async function renderNetwork(view) {
  setCrumbs([{ label: 'Network' }]);
  const g = await api.get('/api/graph');
  const types = store.meta.settings.contact_types;
  view.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Network</h1><p>Who knows whom across your deals. Hover to trace a connection, click to open, scroll to zoom.</p></div>
      <div class="btn-row"><label class="search-inline">${ic('search')}<input type="search" id="hl" placeholder="Highlight a person or company" aria-label="Highlight"></label><button class="btn primary" id="add">${ic('userPlus')}New contact</button></div>
    </div>
    <div class="graph-wrap" id="net"></div>`);
  const wrap = $('#net', view);
  if (!g.nodes.length) {
    wrap.innerHTML = String(html`<div class="empty" style="padding-top:120px"><h3>No relationships yet</h3><p>Add contacts and link them to companies and to each other.</p></div>`);
  } else {
    const graph = networkGraph(wrap, g, {
      onOpen: (n) => (n.kind === 'company' ? (location.hash = `#/company/${n.ref}`) : contactView(n.ref, { onChange: () => renderNetwork(view) })),
    });
    $('#hl', view).addEventListener('input', debounce((e) => graph.setHighlight(e.target.value), 150));
    const legend = document.createElement('div');
    legend.className = 'graph-legend';
    const used = new Set(g.nodes.filter((n) => n.kind === 'contact').map((n) => n.type));
    legend.innerHTML = String(html`
      <div class="row legend"><span><i style="background:var(--accent);border-radius:3px"></i>Company</span><span><i style="background:var(--ink);border-radius:3px"></i>Organisation</span></div>
      <div class="row legend">${types.slice(0, TYPE_COLORS.length).filter((t) => used.has(t)).map((t) => html`<span><i style="background:${typeColor(t)};border-radius:50%"></i>${t}</span>`)}${[...used].some((t) => !types.slice(0, TYPE_COLORS.length).includes(t)) ? html`<span><i style="background:#8d8f97;border-radius:50%"></i>Other</span>` : ''}</div>
      <div class="row legend"><span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--ink-3)" stroke-width="2"/></svg>Works at</span><span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="5 3"/></svg>On deal</span><span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--accent)" stroke-width="2"/></svg>Relationship</span><span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="2 3"/></svg>Met re: deal</span></div>`);
    wrap.after(legend);
  }
  $('#add', view).addEventListener('click', async () => { if (await contactForm()) renderNetwork(view); });
}
