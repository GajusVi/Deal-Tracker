import { api, store, loadMeta } from '../api.js';
import { html, raw, $, $$, logo, money, num, ago, fmtDate, fmtTime, dateBlock, prioChip, toast, errToast, withBusy, ic, mult, parseDate, showTip, hideTip, recordBar, missingText } from '../ui.js';
import { hbars, columns } from '../charts.js';
import { quickNew, setCrumbs } from '../app.js';
import { contactView, hasDemo, clearDemo, demoSummary } from '../forms.js';

const ATTN_ICON = { overdue: 'timer', nda: 'nda', revisit: 'revisit', stale: 'stale', owner: 'noLead', cold: 'cold' };
const prettyDates = (s) => (s || '').replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' }));

export function attentionList(items) {
  if (!items.length) return html`<div class="empty" style="padding:28px 0">${ic('checkCircle')}<p style="margin:0">Nothing needs you right now.</p></div>`;
  return html`<div class="attn stagger">${items.map((a, i) => html`
    <a class="attn-item" style="--i:${i}" ${a.company_id ? html`href="#/company/${a.company_id}"` : html`data-contact="${a.contact_id}"`}>
      <span class="attn-ico s${a.severity}" aria-hidden="true">${ic(ATTN_ICON[a.kind] || 'alert')}</span>
      <span style="flex:1;min-width:0"><span class="t">${a.title}</span><span class="d">${a.company_name ? html`${a.company_name} · ` : ''}${prettyDates(a.detail)}</span></span>
    </a>`)}</div>`;
}
export function bindAttention(root, onChange) {
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-contact]');
    if (c) { e.preventDefault(); contactView(+c.dataset.contact, { onChange }); }
  });
}

// Headline figures are shown as they are: a working tool shouldn't perform its numbers.
function formatFig(v, fmt, cur) {
  if (fmt === 'money') return money(v, cur);
  if (fmt === 'pct') return html`${Math.round(v)}<small>%</small>`;
  return num(Math.round(v));
}
const fig = (value, fmt = 'int', cur = '') => formatFig(value || 0, fmt, cur);

export async function renderDashboard(view) {
  setCrumbs([{ label: 'Overview' }]);
  const [d, companies] = await Promise.all([api.get('/api/dashboard'), api.get('/api/companies')]);
  const cur = d.base_currency;
  updateBadge(d.attention);

  if (!companies.length) return renderWelcome(view);

  const k = d.kpis;
  const terminal = store.meta.terminal_stages;
  const live = companies.filter((c) => !terminal.includes(c.stage) && c.status !== 'Passed');
  const urgent = d.attention.filter((a) => a.severity >= 3).length;
  const prioRank = { High: 0, Medium: 1, Low: 2 };
  const featured = [...live].sort((a, b) => (prioRank[a.priority] ?? 3) - (prioRank[b.priority] ?? 3) || (b.ev || 0) - (a.ev || 0)).slice(0, 6);
  const blended = k.pipeline_ebitda ? k.pipeline_ev / k.pipeline_ebitda : null;

  // Coming up: next steps and meetings in one chronological agenda.
  const horizon = Date.now() + 21 * 86400000;
  const agenda = [
    ...d.next_steps.filter((n) => n.date).map((n) => ({ when: n.date, title: n.next_step, sub: n.company_name, href: `#/company/${n.company_id}`, overdue: n.overdue, kind: 'Next step' })),
    ...d.upcoming_meetings.map((m) => ({ when: m.starts_at, title: m.title, sub: [fmtTime(m.starts_at), m.meeting_type].filter(Boolean).join(' · '), href: m.company_id ? `#/company/${m.company_id}/meetings` : '#/meetings', kind: 'Meeting' })),
  ].filter((a) => (parseDate(a.when) || 0) <= horizon || a.overdue).sort((a, b) => String(a.when).localeCompare(String(b.when))).slice(0, 7);

  // Pipeline funnel: share of EV per live stage.
  const flow = d.by_stage.filter((x) => !terminal.includes(x.stage));
  const flowEv = flow.reduce((a, x) => a + (x.ev || 0), 0) || 1;
  const sentence = `${k.live_deals} live deal${k.live_deals === 1 ? '' : 's'} worth ${money(k.pipeline_ev, cur)} in enterprise value. `
    + (urgent ? `${urgent} item${urgent === 1 ? '' : 's'} need${urgent === 1 ? 's' : ''} your attention today.` : 'Nothing urgent today.');

  view.innerHTML = String(html`
    ${hasDemo() ? html`<div class="banner"><span class="ico">${ic('layers')}</span>
      <div style="flex:1;min-width:0"><b>You're exploring sample data</b><p>${demoSummary()} are examples. Clearing them keeps anything you've added.</p></div>
      <button class="btn sm" id="clear-demo">Clear sample data</button></div>` : ''}
    <div class="page-head">
      <div><span class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <h1>Overview</h1><p>${sentence}</p></div>
      <div class="btn-row">
        <button class="btn" data-qn="meeting">${ic('meetings')}Log meeting</button>
        <button class="btn" data-qn="cim">${ic('scan')}From CIM</button>
        <button class="btn primary" data-qn="company">${ic('plus')}Add company</button>
      </div>
    </div>

    <div class="strip" id="strip">
      <div><div class="label">Live deals</div><div class="value">${fig(k.live_deals)}</div><div class="sub">${k.high_priority} high priority</div></div>
      <div><div class="label">Pipeline value</div><div class="value">${fig(k.pipeline_ev, 'money', cur)}</div><div class="sub">${blended ? `${mult(blended)} blended EV/EBITDA` : 'enterprise value'}</div></div>
      <div><div class="label">Pipeline EBITDA</div><div class="value">${fig(k.pipeline_ebitda, 'money', cur)}</div><div class="sub">on ${money(k.pipeline_revenue, cur)} revenue</div></div>
      <div><div class="label">Meetings · 30 days</div><div class="value">${fig(k.meetings_30d)}</div><div class="sub">${d.upcoming_meetings.length} scheduled</div></div>
      <a href="#/team" title="Deals with lead, description, CIM facts, model, notes, people and next step all on record"><div class="label">Complete deal records</div><div class="value">${fig(d.records.complete)}<small>of ${d.records.live}</small></div><div class="sub">${d.records.gaps ? `${d.records.gaps} item${d.records.gaps === 1 ? '' : 's'} missing` : 'nothing missing'}</div></a>
    </div>

    <div class="grid grid-dash section">
      <div>
        <div class="section-head"><h2>Needs attention</h2><span class="aside">${d.attention.length ? `${d.attention.length} open` : ''}</span></div>
        <div id="attn">${attentionList(d.attention.slice(0, 6))}</div>

        <div class="section">
          <div class="section-head"><h2>Pipeline</h2><a class="aside link" href="#/pipeline">Open board</a></div>
          <div class="funnel" role="img" aria-label="Enterprise value by stage">${flow.map((x, i) => html`<i style="width:${Math.max(x.ev ? (x.ev / flowEv) * 100 : 0, x.count ? 1.5 : 0)}%;--o:${(0.3 + (0.7 * (i + 1)) / flow.length).toFixed(2)}" data-tip="${x.stage}|${x.count}|${money(x.ev, cur)}"></i>`)}</div>
          <div class="funnel-rows">${flow.map((x) => html`<a href="#/pipeline" title="${x.stage}"><div class="s">${x.stage}</div><div class="n">${x.count}</div><div class="v">${x.ev ? money(x.ev, cur) : '—'}</div></a>`)}</div>
        </div>
      </div>
      <div>
        <div class="section-head"><h2>Coming up</h2><span class="aside">next three weeks</span></div>
        ${agenda.length ? html`<div class="list stagger">${agenda.map((a, i) => html`
          <a class="list-item" href="${a.href}" style="--i:${i}">${dateBlock(a.when)}
            <span class="grow"><span class="title">${a.title}</span><span class="meta">${a.kind} · ${a.sub || ''}</span></span>
            ${a.overdue ? html`<span class="chip neg">Overdue</span>` : ''}</a>`)}</div>`
          : html`<p class="muted">Nothing scheduled. Set next steps on deals to see them here.</p>`}

        <div class="section">
          <div class="section-head"><h2>Recent activity</h2></div>
          <div class="timeline">${d.recent_activity.slice(0, 6).map((a) => html`
            <div class="tl-item" style="--c:${a.company_color || 'var(--ink-3)'}">
              <div class="what">${a.company_name ? html`<a href="#/company/${a.company_id}">${a.company_name}</a> · ` : ''}<span class="t2">${a.summary}</span></div>
              <div class="when" title="${new Date(a.created_at).toLocaleString()}">${ago(a.created_at)}</div>
            </div>`)}</div>
        </div>
      </div>
    </div>

    <div class="grid grid-3 section">
      <div><div class="section-head"><h2>By sector</h2><span class="aside">live EV</span></div><div id="ch-sector"></div></div>
      <div><div class="section-head"><h2>By region</h2><span class="aside">live EV</span></div><div id="ch-region"></div></div>
      <div><div class="section-head"><h2>Intermediaries</h2><span class="aside">deals shown</span></div><div id="ch-adv"></div></div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Live deals</h2><a class="aside link" href="#/companies">All companies</a></div>
      <div class="co-cards stagger">${featured.map((c, i) => companyCard(c, i))}</div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Activity</h2><span class="aside">last 12 months</span></div>
      <div id="ch-months"></div>
    </div>`);

  view.querySelectorAll('[data-qn]').forEach((b) => b.addEventListener('click', () => quickNew(b.dataset.qn)));
  $('#clear-demo', view)?.addEventListener('click', (e) => withBusy(e.currentTarget, () => clearDemo()));
  bindAttention($('#attn', view), () => renderDashboard(view));
  $$('.funnel i', view).forEach((b) => {
    const [stage, count, ev] = b.dataset.tip.split('|');
    b.addEventListener('mousemove', (e) => showTip(e, html`<b>${stage}</b><br>${count} deal(s) · ${ev}`));
    b.addEventListener('mouseleave', hideTip);
  });

  const byEv = (rows) => rows.filter((r) => r.ev || r.count).slice(0, 6).map((r) => ({ label: r.name, value: r.ev || 0, sub: `${r.count} deal${r.count === 1 ? '' : 's'}` }));
  hbars($('#ch-sector', view), byEv(d.by_sector), { format: (v) => money(v, cur) });
  hbars($('#ch-region', view), byEv(d.by_region), { format: (v) => money(v, cur) });
  hbars($('#ch-adv', view), d.intermediaries.slice(0, 6).map((r) => ({ label: r.name, value: r.deals, sub: r.best_stage || 'passed', tip: html`<b>${r.name}</b><br>${r.deals} deal(s) · ${money(r.ev, cur)}<br>Furthest: ${r.best_stage || '—'}` })), { format: (v) => num(v), empty: 'Add advisors to deals to see who brings you the best flow.' });
  columns($('#ch-months', view), {
    categories: d.activity_by_month.map((m) => m.month),
    series: [{ key: 'meetings', label: 'Meetings', color: 'var(--bar)' }, { key: 'companies', label: 'Companies added', color: 'var(--bar-soft)' }],
    rows: d.activity_by_month.map((m) => {
      const dt = new Date(`${m.month}-01T00:00:00`);
      return { cat: m.month, label: dt.toLocaleDateString(undefined, { month: 'short' }), tipTitle: dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), meetings: m.meetings, companies: m.companies };
    }),
    format: (v) => num(v),
    height: 180,
  });
}

function renderWelcome(view) {
  view.innerHTML = String(html`
    <div class="welcome">
      <div>
        <span class="eyebrow">Deal Tracker</span>
        <h1>Your firm's memory, kept in one place.</h1>
        <p class="lead">Companies, CIMs, models, meetings and relationships, captured while you work. Everything stays on this computer.</p>
        <ul class="steps-list">
          <li><span class="n">1</span><div><b>Drop in a CIM.</b> <span>Revenue, EBITDA, margins and more are found for you, with the page they came from.</span></div></li>
          <li><span class="n">2</span><div><b>Upload your model.</b> <span>Every version is kept, and IRR and MOIC are read from the workbook.</span></div></li>
          <li><span class="n">3</span><div><b>Log meetings and people.</b> <span>When someone moves on, their deals hand over in one step.</span></div></li>
        </ul>
        <div class="btn-row" style="margin-top:32px">
          <button class="btn primary" data-qn="cim">${ic('scan')}Start from a CIM</button>
          <button class="btn" data-qn="company">${ic('plus')}Add a company</button>
          <button class="btn ghost" id="demo">Explore with sample data</button>
        </div>
      </div>
      <div class="preview" aria-hidden="true">
        <div class="row" style="justify-content:space-between;margin-bottom:14px"><span class="eyebrow">Deal memory</span><span class="muted" style="font-size:12px">Project Atlas</span></div>
        ${[['Deal lead assigned', 100], ['Key facts from CIM', 100], ['Model v3 on file', 100], ['Meeting notes', 80], ['People mapped', 60]].map(([t, p]) => html`
          <div class="p-row"><span class="grow" style="font-size:13.5px">${t}</span><span style="width:120px" class="bar-mini"><i style="width:${p}%"></i></span></div>`)}
        <div class="row" style="justify-content:space-between;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)"><span class="muted" style="font-size:12.5px">Would survive a departure</span><b class="serif" style="font-size:24px;font-weight:500">88%</b></div>
      </div>
    </div>`);
  view.querySelectorAll('[data-qn]').forEach((b) => b.addEventListener('click', () => quickNew(b.dataset.qn)));
  $('#demo', view).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try { await api.post('/api/demo'); await loadMeta(); toast('Sample workspace loaded', '', { icon: 'check' }); renderDashboard(view); } catch (err) { errToast(err); }
  }));
}

export function updateBadge(attention) {
  const b = document.getElementById('attn-badge');
  if (!b) return;
  const n = (attention || []).filter((a) => a.severity >= 3).length;
  b.hidden = !n;
  b.textContent = n;
}

export function stageTrack(c) {
  const flow = store.meta.settings.stages.filter((x) => !store.meta.terminal_stages.includes(x));
  const idx = c.stage === 'Closed' ? flow.length - 1 : flow.indexOf(c.stage);
  return html`<span class="track-stage ${c.stage === 'Passed' ? 'passed' : ''}" title="${c.stage}">${flow.map((_, i) => html`<i class="${i <= idx ? 'on' : ''}"></i>`)}</span>`;
}

export function companyCard(c, i = 0) {
  return html`
    <a class="card co-card" href="#/company/${c.id}" style="--c:${c.color};--i:${i}">
      <div class="head">${logo(c)}<div><div class="name">${c.name}</div><div class="code">${[c.codename, c.sector].filter(Boolean).join(' · ') || ' '}</div></div>${prioChip(c.priority)}</div>
      <div class="desc">${c.description || raw('<span class="muted">No description yet.</span>')}</div>
      <div>
        <div class="foot" style="margin-bottom:7px"><span style="color:var(--ink)">${c.stage}</span><span>${c.deal_lead || 'No lead'}${c.is_demo ? ' · Sample' : ''}</span></div>
        ${stageTrack(c)}
      </div>
      <div class="stats">
        <div><small class="muted">EV</small><b>${money(c.ev, c.currency)}</b></div>
        <div><small class="muted">EBITDA</small><b>${money(c.ebitda, c.currency)}</b></div>
        <div><small class="muted">EV / EBITDA</small><b>${c.ev_ebitda != null ? mult(c.ev_ebitda) : '–'}</b></div>
      </div>
      ${c.record && !store.meta.terminal_stages.includes(c.stage) && c.status !== 'Passed' ? html`<div class="rec-line" title="Deal record: ${c.record.done} of ${c.record.total} items">${recordBar(c.record.done, c.record.total)}<span class="${c.record.missing.length ? 'rec-missing' : 'rec-full'}">${missingText(c.record.missing)}</span></div>` : ''}
    </a>`;
}
