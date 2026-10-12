import { api, store } from '../api.js';
import { html, $, options, debounce, avatar, strength, ago, ICONS, typeColor, TYPE_COLORS } from '../ui.js';
import { contactForm, contactView } from '../forms.js';
import { networkGraph } from '../graph.js';

const f = { q: '', type: '' };

export async function renderContacts(view) {
  view.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Contacts</h1><p>Management teams, bankers, experts, co-investors and lenders — with relationship strength and meeting history.</p></div>
      <div class="btn-row"><a class="btn" href="#/network">Network diagram</a><button class="btn primary" id="add">${ICONS.plus} New contact</button></div>
    </div>
    <div class="filters">
      <input type="search" id="q" placeholder="Search name, firm, email…" value="${f.q}">
      <select id="type">${options(store.meta.settings.contact_types, f.type, { blank: 'All types' })}</select>
    </div>
    <div id="list"></div>`);
  const load = async () => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    const list = await api.get(`/api/contacts?${qs}`);
    $('#list', view).innerHTML = String(list.length ? html`
      <div class="card table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Organisation</th><th>Type</th><th>Strength</th><th class="r">Meetings</th><th class="r">Last met</th><th>Email</th></tr></thead>
        <tbody>${list.map((p) => html`<tr data-p="${p.id}">
          <td><div class="cell-co">${avatar(p)}<div><b>${p.name}</b><small class="muted">${p.title || ''}</small></div></div></td>
          <td>${p.company_id ? html`<span class="chip"><span class="dot" style="background:${p.company_color}"></span>${p.company_name}</span>` : p.organization || '—'}</td>
          <td>${p.contact_type ? html`<span class="chip"><span class="dot" style="background:${typeColor(p.contact_type)}"></span>${p.contact_type}</span>` : '—'}</td>
          <td>${strength(p.strength)}</td>
          <td class="r num">${p.meeting_count}</td>
          <td class="r muted">${p.last_met ? ago(p.last_met) : '—'}</td>
          <td>${p.email ? html`<a href="mailto:${p.email}" data-mail>${p.email}</a>` : ''}</td>
        </tr>`)}</tbody></table></div>`
      : html`<div class="card empty"><h3>No contacts yet</h3><p>Add the people you meet — they show up on meetings, deals and the network diagram.</p></div>`);
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
  const g = await api.get('/api/graph');
  const types = store.meta.settings.contact_types;
  view.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Relationship network</h1><p>Who knows whom across your deals. Drag to rearrange, scroll to zoom, click to open, hover to trace connections.</p></div>
      <div class="btn-row"><input type="search" id="hl" placeholder="Highlight person or company…" style="width:260px"><button class="btn primary" id="add">${ICONS.plus} New contact</button></div>
    </div>
    <div class="card graph-wrap" id="net">
    </div>`);
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
      <div class="row"><span class="legend"><span><i style="background:var(--series-1);border-radius:3px"></i>Company</span><span><i style="background:var(--text-3)"></i>Organisation</span></span></div>
      <div class="row legend">${types.slice(0, TYPE_COLORS.length).filter((t) => used.has(t)).map((t) => html`<span><i style="background:${typeColor(t)};border-radius:50%"></i>${t}</span>`)}${[...used].some((t) => !types.slice(0, TYPE_COLORS.length).includes(t)) ? html`<span><i style="background:#8d8f97;border-radius:50%"></i>Other</span>` : ''}</div>
      <div class="row legend"><span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--border-strong)" stroke-width="2"/></svg>Works at</span><span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--border-strong)" stroke-width="2" stroke-dasharray="5 3"/></svg>On deal</span><span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--series-7)" stroke-width="2"/></svg>Relationship</span><span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--border-strong)" stroke-width="2" stroke-dasharray="2 3"/></svg>Met re: deal</span></div>`);
    wrap.after(legend);
  }
  $('#add', view).addEventListener('click', async () => { if (await contactForm()) renderNetwork(view); });
}
