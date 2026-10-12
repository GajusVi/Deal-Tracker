import { api, store } from '../api.js';
import { html, $, options, debounce, dateBlock, fmtDateTime, sentimentChip, ICONS } from '../ui.js';
import { meetingForm, meetingView } from '../forms.js';

const f = { q: '', type: '', company_id: '' };

export async function renderMeetings(view) {
  const companies = await api.get('/api/companies');
  view.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Meetings & market notes</h1><p>Management meetings, banker calls, expert calls and market meetings — searchable in one place.</p></div>
      <button class="btn primary" id="add">${ICONS.plus} Log meeting</button>
    </div>
    <div class="filters">
      <input type="search" id="q" placeholder="Search titles and notes…" value="${f.q}">
      <select id="type">${options(store.meta.settings.meeting_types, f.type, { blank: 'All types' })}</select>
      <select id="co">${options([{ value: 'none', label: 'Market / general only' }, ...companies.map((c) => ({ value: c.id, label: c.name }))], f.company_id, { blank: 'All companies' })}</select>
    </div>
    <div id="list"></div>`);

  const load = async () => {
    const qs = new URLSearchParams();
    if (f.q) qs.set('q', f.q);
    if (f.type) qs.set('type', f.type);
    if (f.company_id && f.company_id !== 'none') qs.set('company_id', f.company_id);
    let ms = await api.get(`/api/meetings?${qs}`);
    if (f.company_id === 'none') ms = ms.filter((m) => !m.company_id);
    const now = new Date();
    const upcoming = ms.filter((m) => new Date(m.starts_at) >= now).reverse();
    const past = ms.filter((m) => new Date(m.starts_at) < now);
    const groups = new Map();
    past.forEach((m) => {
      const k = new Date(m.starts_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    });
    const card = (m) => html`
      <div class="card m-card" data-m="${m.id}">
        ${dateBlock(m.starts_at)}
        <div class="grow">
          <div class="title">${m.title}</div>
          <div class="meta">
            <span>${fmtDateTime(m.starts_at)}</span>
            <span class="chip">${m.meeting_type || 'Meeting'}</span>
            ${m.company_id ? html`<a class="chip" href="#/company/${m.company_id}"><span class="dot" style="background:${m.company_color}"></span>${m.company_name}</a>` : html`<span class="chip">Market</span>`}
            ${sentimentChip(m.sentiment)}
            ${m.attendees.length ? html`<span>· ${m.attendees.map((a) => a.name).join(', ')}</span>` : ''}
          </div>
          ${m.takeaways || m.notes ? html`<div class="excerpt">${m.takeaways ? html`<b>Takeaway:</b> ${m.takeaways}` : m.notes}</div>` : ''}
        </div>
      </div>`;
    $('#list', view).innerHTML = String(ms.length ? html`
      ${upcoming.length ? html`<div class="month-label">Upcoming</div>${upcoming.map(card)}` : ''}
      ${[...groups.entries()].map(([k, list]) => html`<div class="month-label">${k}</div>${list.map(card)}`)}`
      : html`<div class="card empty"><h3>No meetings found</h3><p>Log your first meeting — attach it to a company, or keep it as a general market meeting.</p></div>`);
  };
  $('#list', view).addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const m = e.target.closest('[data-m]');
    if (m) meetingView(+m.dataset.m, { onChange: load });
  });
  $('#add', view).addEventListener('click', async () => { if (await meetingForm()) load(); });
  $('#q', view).addEventListener('input', debounce((e) => { f.q = e.target.value; load(); }, 200));
  $('#type', view).addEventListener('change', (e) => { f.type = e.target.value; load(); });
  $('#co', view).addEventListener('change', (e) => { f.company_id = e.target.value; load(); });
  await load();
}
