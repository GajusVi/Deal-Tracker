import { api, store } from '../api.js';
import { html, $, options, debounce, dateBlock, sentimentChip, ic, tkr } from '../ui.js';
import { setCrumbs } from '../app.js';
import { meetingForm, meetingView } from '../forms.js';

const f = { q: '', type: '', company_id: '' };

export async function renderMeetings(view) {
  setCrumbs([{ label: 'Meetings' }]);
  const companies = await api.get('/api/companies');
  view.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Meetings</h1><p>Management meetings, banker and expert calls, and general market notes, all searchable.</p></div>
      <button class="btn primary" id="add">${ic('plus')}Log meeting</button>
    </div>
    <div class="filters">
      <label class="search">${ic('search')}<input type="search" id="q" placeholder="Search titles and notes" value="${f.q}" aria-label="Search meetings"></label>
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
    const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const card = (m, i) => html`
      <div class="m-card" data-m="${m.id}" style="--i:${i}">
        ${dateBlock(m.starts_at)}
        <div class="grow">
          <div class="title">${m.title}</div>
          <div class="meta-line">
            <span>${time(m.starts_at)}</span>
            <span>${m.meeting_type || 'Meeting'}</span>
            ${m.company_id ? html`<a href="#/company/${m.company_id}" class="co-link"><span class="dot" style="background:${m.company_color}"></span>${m.company_name}${tkr(m.company_codename)}</a>` : html`<span>Market</span>`}
            ${m.attendees.length ? html`<span>${m.attendees.map((a) => a.name).join(', ')}</span>` : ''}
            ${m.sentiment ? html`<span>${sentimentChip(m.sentiment)}</span>` : ''}
          </div>
          ${m.takeaways || m.notes ? html`<div class="excerpt">${m.takeaways || m.notes}</div>` : ''}
        </div>
      </div>`;
    $('#list', view).innerHTML = String(ms.length ? html`
      ${upcoming.length ? html`<div class="month-label">Upcoming</div><div class="stagger">${upcoming.map(card)}</div>` : ''}
      ${[...groups.entries()].map(([k, list]) => html`<div class="month-label">${k}</div><div class="stagger">${list.map(card)}</div>`)}`
      : html`<div class="empty">${ic('meetings')}<h3>${f.q || f.type || f.company_id ? 'Nothing matches' : 'No meetings yet'}</h3><p>${f.q || f.type || f.company_id ? 'Try a different search or filter.' : 'Log your first meeting. Attach it to a company, or keep it as a general market note.'}</p></div>`);
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
