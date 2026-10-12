import { api, store } from '../api.js';
import { html, $, logo, money, num, ago, fmtDate, fmtTime, dateBlock, stageChip, prioChip, toast, errToast, withBusy, ICONS, mult } from '../ui.js';
import { hbars, columns } from '../charts.js';
import { quickNew } from '../app.js';

export async function renderDashboard(view) {
  const [d, companies] = await Promise.all([api.get('/api/dashboard'), api.get('/api/companies')]);
  const cur = d.base_currency;
  const firm = store.meta.settings.firm_name;

  if (!companies.length) {
    view.innerHTML = String(html`
      <div class="card welcome">
        <div>
          <h1>Welcome to Deal Tracker</h1>
          <p class="t2">Your private, local workspace for the deal pipeline — companies, CIMs, models, meetings and relationships in one place. Everything stays on this computer.</p>
          <ol>
            <li><b>Add a company</b> — or drop in a CIM and let the app detect revenue, EBITDA, HQ, headcount and more.</li>
            <li><b>Upload models</b> — every version is kept with timestamps, and IRR / MOIC are read from the workbook.</li>
            <li><b>Log meetings</b> with notes and attendees, and see how your contacts connect.</li>
          </ol>
          <div class="btn-row" style="margin-top:16px">
            <button class="btn primary" data-qn="cim">${ICONS.upload} New company from CIM</button>
            <button class="btn" data-qn="company">${ICONS.plus} Add company</button>
            <button class="btn ghost" id="demo">Load demo data</button>
          </div>
        </div>
        <div class="kpis" style="grid-template-columns:1fr 1fr;margin:0">
          ${['Pipeline', 'CIM facts', 'Model versions', 'Network map'].map((t, i) => html`<div class="card kpi"><div class="label">${t}</div><div class="value" style="font-size:20px">${['Kanban', 'Auto-detect', 'v1 → vN', 'Diagram'][i]}</div></div>`)}
        </div>
      </div>`);
    view.querySelectorAll('[data-qn]').forEach((b) => b.addEventListener('click', () => quickNew(b.dataset.qn)));
    $('#demo', view).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try { await api.post('/api/demo'); toast('Demo workspace loaded'); renderDashboard(view); } catch (err) { errToast(err); }
    }));
    return;
  }

  const k = d.kpis;
  const live = companies.filter((c) => !store.meta.terminal_stages.includes(c.stage) && c.status !== 'Passed');
  const prioRank = { High: 0, Medium: 1, Low: 2 };
  const featured = [...live].sort((a, b) => (prioRank[a.priority] ?? 3) - (prioRank[b.priority] ?? 3) || (b.ev || 0) - (a.ev || 0)).slice(0, 8);
  const blendedMultiple = k.pipeline_ebitda ? k.pipeline_ev / k.pipeline_ebitda : null;

  view.innerHTML = String(html`
    <div class="page-head">
      <div><h1>${firm ? `${firm} — ` : ''}Deal dashboard</h1><p>${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <div class="btn-row">
        <button class="btn" data-qn="meeting">${ICONS.plus} Log meeting</button>
        <button class="btn" data-qn="cim">${ICONS.upload} From CIM</button>
        <button class="btn primary" data-qn="company">${ICONS.plus} Add company</button>
      </div>
    </div>
    <div class="kpis">
      <div class="card kpi"><div class="label">Live deals</div><div class="value num">${k.live_deals}</div><div class="sub">${k.high_priority} high priority</div></div>
      <div class="card kpi"><div class="label">Pipeline EV</div><div class="value num">${money(k.pipeline_ev, cur)}</div><div class="sub">${blendedMultiple ? `${mult(blendedMultiple)} blended EV / EBITDA` : 'across live deals'}</div></div>
      <div class="card kpi"><div class="label">Pipeline EBITDA</div><div class="value num">${money(k.pipeline_ebitda, cur)}</div><div class="sub">Revenue ${money(k.pipeline_revenue, cur)}</div></div>
      <div class="card kpi"><div class="label">Meetings · last 30 days</div><div class="value num">${k.meetings_30d}</div><div class="sub">${d.upcoming_meetings.length} upcoming</div></div>
      <div class="card kpi"><div class="label">Contacts</div><div class="value num">${k.contacts}</div><div class="sub">${k.closed} closed · ${k.passed} passed</div></div>
    </div>

    <div class="grid grid-dash">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Pipeline by stage</h2><a href="#/pipeline" class="btn sm ghost">Open board →</a></div>
          <div class="card-body" id="ch-stage"></div>
        </div>
        <div class="grid grid-2">
          <div class="card"><div class="card-head"><h2>Live deals by sector</h2></div><div class="card-body" id="ch-sector"></div></div>
          <div class="card"><div class="card-head"><h2>Live deals by region</h2></div><div class="card-body" id="ch-region"></div></div>
        </div>
        <div class="card"><div class="card-head"><h2>Deal activity — last 12 months</h2></div><div class="card-body" id="ch-months"></div></div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Next steps</h2></div>
          <div class="card-body">
            ${d.next_steps.length ? html`<div class="list">${d.next_steps.map((n) => html`
              <a class="list-item" href="#/company/${n.company_id}">
                ${logo({ name: n.company_name, color: n.color, logo_url: n.logo_url }, 'sm')}
                <span class="grow"><span class="title">${n.next_step}</span><span class="meta">${n.company_name}</span></span>
                <span class="${n.overdue ? 'overdue' : 'muted'}" style="font-size:12px;white-space:nowrap">${n.date ? (n.overdue ? '⚠ ' : '') + fmtDate(n.date, { day: 'numeric', month: 'short' }) : ''}</span>
              </a>`)}</div>` : html`<p class="muted">Set a next step on a company to track it here.</p>`}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Upcoming meetings</h2><a href="#/meetings" class="btn sm ghost">All →</a></div>
          <div class="card-body">
            ${d.upcoming_meetings.length ? html`<div class="list">${d.upcoming_meetings.map((m) => html`
              <a class="list-item" href="#/meetings">
                ${dateBlock(m.starts_at)}
                <span class="grow"><span class="title">${m.title}</span><span class="meta">${fmtTime(m.starts_at)} · ${m.meeting_type || ''}${m.company_name ? ' · ' + m.company_name : ''}</span></span>
              </a>`)}</div>` : html`<p class="muted">Nothing scheduled.</p>`}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Recent activity</h2></div>
          <div class="card-body">
            <div class="timeline">${d.recent_activity.map((a) => html`
              <div class="tl-item" style="--c:${a.company_color || 'var(--text-3)'}">
                <div class="what">${a.company_name ? html`<a href="#/company/${a.company_id}"><b>${a.company_name}</b></a> · ` : ''}${a.summary}</div>
                <div class="when" title="${new Date(a.created_at).toLocaleString()}">${ago(a.created_at)}</div>
              </div>`)}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="page-head" style="margin:28px 0 14px"><h2 style="font-size:17px">Live companies</h2><a href="#/companies" class="btn sm ghost">All companies →</a></div>
    <div class="co-cards">${featured.map(companyCard)}</div>`);

  view.querySelectorAll('[data-qn]').forEach((b) => b.addEventListener('click', () => quickNew(b.dataset.qn)));

  hbars($('#ch-stage', view), d.by_stage.map((s) => ({ label: s.stage, value: s.count, sub: s.ev ? money(s.ev, cur) : '', href: '#/pipeline' })), { format: (v) => num(v), empty: 'No deals yet' });
  hbars($('#ch-sector', view), d.by_sector.slice(0, 8).map((s) => ({ label: s.name, value: s.count, sub: s.ev ? money(s.ev, cur) : '' })), { format: (v) => num(v) });
  hbars($('#ch-region', view), d.by_region.slice(0, 8).map((s) => ({ label: s.name, value: s.count, sub: s.ev ? money(s.ev, cur) : '' })), { format: (v) => num(v) });
  columns($('#ch-months', view), {
    categories: d.activity_by_month.map((m) => m.month),
    series: [{ key: 'meetings', label: 'Meetings', color: 'var(--series-1)' }, { key: 'companies', label: 'Companies added', color: 'var(--series-2)' }],
    rows: d.activity_by_month.map((m) => {
      const dt = new Date(`${m.month}-01T00:00:00`);
      return { cat: m.month, label: dt.toLocaleDateString(undefined, { month: 'short' }), tipTitle: dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), meetings: m.meetings, companies: m.companies };
    }),
    format: (v) => num(v),
    height: 200,
  });
}

export function companyCard(c) {
  return html`
    <a class="card co-card" href="#/company/${c.id}" style="--c:${c.color}">
      <div class="band"></div>
      <span class="chip stage-on-band">${c.stage}</span>
      <span class="prio">${prioChip(c.priority)}</span>
      ${logo(c)}
      <div class="body">
        <div><div class="name">${c.name}</div><div class="code">${[c.codename, c.sector].filter(Boolean).join(' · ') || ' '}</div></div>
        <div class="chips">${c.country ? html`<span class="chip">${c.country}</span>` : ''}${c.deal_type ? html`<span class="chip">${c.deal_type}</span>` : ''}</div>
        <div class="stats">
          <div><small class="muted">EV</small><b>${money(c.ev, c.currency)}</b></div>
          <div><small class="muted">EBITDA</small><b>${money(c.ebitda, c.currency)}</b></div>
          <div><small class="muted">EV/EBITDA</small><b>${mult(c.ev_ebitda)}</b></div>
        </div>
      </div>
    </a>`;
}
export { stageChip };
