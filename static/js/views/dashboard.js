import { api, store } from '../api.js';
import { html, $, logo, money, num, ago, fmtDate, fmtTime, dateBlock, prioChip, toast, errToast, withBusy, ICONS, mult, ring } from '../ui.js';
import { hbars, columns } from '../charts.js';
import { quickNew } from '../app.js';
import { contactView } from '../forms.js';

const ATTN_ICON = { overdue: '⏱', nda: '§', revisit: '↺', stale: '◔', owner: '?', cold: '❄' };

export function attentionList(items) {
  if (!items.length) return html`<p class="muted" style="margin:0">Nothing slipping. Deadlines, NDAs and relationships are all in hand.</p>`;
  return html`<div class="attn">${items.map((a) => html`
    <a class="attn-item" ${a.company_id ? html`href="#/company/${a.company_id}"` : html`data-contact="${a.contact_id}"`}>
      <span class="attn-ico s${a.severity}" aria-hidden="true">${ATTN_ICON[a.kind] || '•'}</span>
      <span style="flex:1;min-width:0"><span class="t">${a.title}</span><br><span class="d">${a.company_name ? html`${a.company_name} · ` : ''}${prettyDates(a.detail)}</span></span>
    </a>`)}</div>`;
}
export function bindAttention(root, onChange) {
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-contact]');
    if (c) { e.preventDefault(); contactView(+c.dataset.contact, { onChange }); }
  });
}

const prettyDates = (s) => (s || '').replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' }));

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export async function renderDashboard(view) {
  const [d, companies] = await Promise.all([api.get('/api/dashboard'), api.get('/api/companies')]);
  const cur = d.base_currency;
  const firm = store.meta.settings.firm_name;
  updateBadge(d.attention);

  if (!companies.length) {
    view.innerHTML = String(html`
      <div class="card hero-welcome">
        <div>
          <div class="eyebrow">Deal Tracker</div>
          <h1 style="margin-top:8px">Your firm’s memory,<br>in one place.</h1>
          <p class="lead">Every company, CIM, model, meeting and relationship — captured as you work, so nothing walks out the door when people do.</p>
          <ol>
            <li><b>Drop in a CIM</b> and key facts are detected for you, with page references.</li>
            <li><b>Upload models</b> — each version is kept, and IRR / MOIC are read automatically.</li>
            <li><b>Log meetings and people</b>, then hand any deal over with one click.</li>
          </ol>
          <div class="btn-row" style="margin-top:24px">
            <button class="btn primary" data-qn="cim">${ICONS.upload} New company from CIM</button>
            <button class="btn" data-qn="company">${ICONS.plus} Add company</button>
            <button class="btn ghost" id="demo">Explore with demo data</button>
          </div>
        </div>
        <div class="feature-tiles">
          ${[['Pipeline', 'Drag & drop'], ['CIM facts', 'Auto-detected'], ['Models', 'Versioned'], ['Handover', 'One click']].map(([t, v]) => html`<div class="card"><small class="muted">${t}</small><b>${v}</b></div>`)}
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
  const blended = k.pipeline_ebitda ? k.pipeline_ev / k.pipeline_ebitda : null;

  view.innerHTML = String(html`
    <div class="page-head">
      <div><div class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1 style="margin-top:6px">${greeting()}${firm ? html`<span class="muted" style="font-weight:600">, ${firm}</span>` : ''}</h1></div>
      <div class="btn-row">
        <button class="btn" data-qn="meeting">${ICONS.plus} Log meeting</button>
        <button class="btn" data-qn="cim">${ICONS.upload} From CIM</button>
        <button class="btn primary" data-qn="company">${ICONS.plus} Add company</button>
      </div>
    </div>
    <div class="kpis">
      <div class="card kpi"><div class="label">Live deals</div><div class="value">${k.live_deals}</div><div class="sub">${k.high_priority} high priority</div></div>
      <div class="card kpi"><div class="label">Pipeline enterprise value</div><div class="value">${money(k.pipeline_ev, cur)}</div><div class="sub">${blended ? `${mult(blended)} blended EV / EBITDA` : 'across live deals'}</div></div>
      <div class="card kpi"><div class="label">Pipeline EBITDA</div><div class="value">${money(k.pipeline_ebitda, cur)}</div><div class="sub">on ${money(k.pipeline_revenue, cur)} revenue</div></div>
      <div class="card kpi"><div class="label">Meetings, last 30 days</div><div class="value">${k.meetings_30d}</div><div class="sub">${d.upcoming_meetings.length} upcoming · ${k.contacts} contacts</div></div>
      <a class="card kpi" href="#/team" style="color:inherit;text-decoration:none" title="How much of each live deal would survive someone leaving">
        <div class="label">Knowledge captured</div>
        <div class="row" style="justify-content:space-between;align-items:flex-end"><div class="value">${d.knowledge ?? '—'}${d.knowledge != null ? html`<span style="font-size:20px">%</span>` : ''}</div>${ring(d.knowledge, 40)}</div>
        <div class="sub">would survive a departure</div>
      </a>
    </div>

    <div class="grid grid-dash">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Needs attention</h2><span class="muted" style="font-size:13px">${d.attention.length} item${d.attention.length === 1 ? '' : 's'}</span></div>
          <div class="card-body" id="attn">${attentionList(d.attention.slice(0, 7))}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Pipeline by stage</h2><a href="#/pipeline" class="btn sm ghost">Open board</a></div>
          <div class="card-body" id="ch-stage"></div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Next steps</h2></div>
          <div class="card-body">
            ${d.next_steps.length ? html`<div class="list">${d.next_steps.map((n) => html`
              <a class="list-item" href="#/company/${n.company_id}">
                ${logo({ name: n.company_name, color: n.color, logo_url: n.logo_url }, 'sm')}
                <span class="grow"><span class="title">${n.next_step}</span><span class="meta">${n.company_name}</span></span>
                <span class="${n.overdue ? 'overdue' : 'muted'}" style="font-size:13px;white-space:nowrap">${n.date ? fmtDate(n.date, { day: 'numeric', month: 'short' }) : ''}</span>
              </a>`)}</div>` : html`<p class="muted">Set a next step on a company to track it here.</p>`}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Coming up</h2><a href="#/meetings" class="btn sm ghost">All meetings</a></div>
          <div class="card-body">
            ${d.upcoming_meetings.length ? html`<div class="list">${d.upcoming_meetings.map((m) => html`
              <a class="list-item" href="#/meetings">
                ${dateBlock(m.starts_at)}
                <span class="grow"><span class="title">${m.title}</span><span class="meta">${fmtTime(m.starts_at)} · ${m.meeting_type || ''}${m.company_name ? ' · ' + m.company_name : ''}</span></span>
              </a>`)}</div>` : html`<p class="muted">Nothing scheduled.</p>`}
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-3" style="margin-top:20px">
      <div class="card"><div class="card-head"><h2>By sector</h2></div><div class="card-body" id="ch-sector"></div></div>
      <div class="card"><div class="card-head"><h2>By region</h2></div><div class="card-body" id="ch-region"></div></div>
      <div class="card"><div class="card-head"><h2>Intermediaries</h2><span class="muted" style="font-size:12px">deals shown · furthest stage</span></div><div class="card-body" id="ch-adv"></div></div>
    </div>

    <div class="grid grid-dash" style="margin-top:20px">
      <div class="card"><div class="card-head"><h2>Activity, last 12 months</h2></div><div class="card-body" id="ch-months"></div></div>
      <div class="card">
        <div class="card-head"><h2>Recent activity</h2></div>
        <div class="card-body" style="max-height:340px;overflow:auto">
          <div class="timeline">${d.recent_activity.map((a) => html`
            <div class="tl-item" style="--c:${a.company_color || 'var(--text-3)'}">
              <div class="what">${a.company_name ? html`<a href="#/company/${a.company_id}"><b>${a.company_name}</b></a> · ` : ''}${a.summary}</div>
              <div class="when" title="${new Date(a.created_at).toLocaleString()}">${ago(a.created_at)}</div>
            </div>`)}</div>
        </div>
      </div>
    </div>

    <div class="section-head"><h2>Live companies</h2><a href="#/companies" class="btn sm ghost">All companies</a></div>
    <div class="co-cards">${featured.map(companyCard)}</div>`);

  view.querySelectorAll('[data-qn]').forEach((b) => b.addEventListener('click', () => quickNew(b.dataset.qn)));
  bindAttention($('#attn', view), () => renderDashboard(view));

  hbars($('#ch-stage', view), d.by_stage.map((s) => ({ label: s.stage, value: s.count, sub: s.ev ? money(s.ev, cur) : '', href: '#/pipeline' })), { format: (v) => num(v), empty: 'No deals yet' });
  hbars($('#ch-sector', view), d.by_sector.slice(0, 7).map((s) => ({ label: s.name, value: s.count, sub: s.ev ? money(s.ev, cur) : '' })), { format: (v) => num(v) });
  hbars($('#ch-region', view), d.by_region.slice(0, 7).map((s) => ({ label: s.name, value: s.count, sub: s.ev ? money(s.ev, cur) : '' })), { format: (v) => num(v) });
  hbars($('#ch-adv', view), d.intermediaries.slice(0, 7).map((s) => ({ label: s.name, value: s.deals, sub: s.best_stage || 'passed', tip: html`<b>${s.name}</b><br>${s.deals} deal(s) shown · ${money(s.ev, cur)} EV<br>Furthest: ${s.best_stage || '—'}` })), { format: (v) => num(v), empty: 'Add sell-side advisors to deals to see who brings you the best flow.' });
  columns($('#ch-months', view), {
    categories: d.activity_by_month.map((m) => m.month),
    series: [{ key: 'meetings', label: 'Meetings', color: 'var(--series-1)' }, { key: 'companies', label: 'Companies added', color: 'var(--series-2)' }],
    rows: d.activity_by_month.map((m) => {
      const dt = new Date(`${m.month}-01T00:00:00`);
      return { cat: m.month, label: dt.toLocaleDateString(undefined, { month: 'short' }), tipTitle: dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), meetings: m.meetings, companies: m.companies };
    }),
    format: (v) => num(v),
    height: 220,
  });
}

export function updateBadge(attention) {
  const b = document.getElementById('attn-badge');
  if (!b) return;
  const n = (attention || []).filter((a) => a.severity >= 3).length;
  b.hidden = !n;
  b.textContent = n;
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
        <div class="chips">${c.country ? html`<span class="chip">${c.country}</span>` : ''}${c.deal_type ? html`<span class="chip">${c.deal_type}</span>` : ''}${c.deal_lead ? html`<span class="chip">${c.deal_lead}</span>` : ''}</div>
        <div class="stats">
          <div><small class="muted">EV</small><b>${money(c.ev, c.currency)}</b></div>
          <div><small class="muted">EBITDA</small><b>${money(c.ebitda, c.currency)}</b></div>
          <div><small class="muted">EV/EBITDA</small><b>${mult(c.ev_ebitda)}</b></div>
        </div>
        ${c.knowledge != null ? html`<div title="Deal knowledge captured: ${c.knowledge}%"><div class="row" style="justify-content:space-between;font-size:11px;color:var(--text-3);margin-bottom:4px"><span>Knowledge captured</span><span>${c.knowledge}%</span></div><div class="kbar"><i style="width:${c.knowledge}%"></i></div></div>` : ''}
      </div>
    </a>`;
}
