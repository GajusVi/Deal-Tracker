import { api, store, loadMeta } from '../api.js';
import { html, raw, $, $$, logo, money, num, ago, fmtDate, fmtTime, dateBlock, prioChip, toast, errToast, withBusy, ic, mult, parseDate, recordBar, missingText } from '../ui.js';
import { hbars, columns } from '../charts.js';
import { quickNew, setCrumbs } from '../app.js';
import { contactView, hasDemo, clearDemo, demoSummary } from '../forms.js';

const ATTN_ICON = { overdue: 'timer', nda: 'nda', revisit: 'revisit', stale: 'stale', owner: 'noLead', cold: 'cold' };
const prettyDates = (s) => (s || '').replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' }));

const SEVERITY = { 3: ['Urgent', 'urgent'], 2: ['Soon', 'soon'], 1: ['FYI', 'fyi'] };
const DATE_LABEL = { overdue: 'Due', nda: null, revisit: 'Revisit', stale: 'Last touch', cold: 'Last met' };
const shortDate = (d) => fmtDate(d, { day: 'numeric', month: 'short' });

export function attentionList(items) {
  if (!items.length) return html`<div class="empty" style="padding:28px 0">${ic('checkCircle')}<p style="margin:0">Nothing needs you right now.</p></div>`;
  return html`<div class="attn">${items.map((a) => {
    const [sev, cls] = SEVERITY[a.severity] || SEVERITY[1];
    const expired = a.kind === 'nda' && a.date && a.date < new Date().toISOString().slice(0, 10);
    const when = a.date ? `${a.kind === 'nda' ? (expired ? 'Expired' : 'Expires') : DATE_LABEL[a.kind] || ''} ${shortDate(a.date)}`.trim() : '';
    return html`
    <a class="attn-row" ${a.company_id ? html`href="#/company/${a.company_id}"` : html`data-contact="${a.contact_id}"`}>
      <span class="sev ${cls}">${sev}</span>
      <span class="what"><b>${a.company_name || a.contact_name || ''}</b><span>${a.title}<small> · ${a.detail}</small></span></span>
      <span class="when ${cls === 'urgent' ? 'urgent' : ''}">${when}</span>
    </a>`;
  })}</div>`;
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
  const blended = k.pipeline_ebitda ? k.pipeline_ev / k.pipeline_ebitda : null;

  // Coming up: next steps and meetings in one chronological agenda.
  const horizon = Date.now() + 21 * 86400000;
  const agenda = [
    ...d.next_steps.filter((n) => n.date).map((n) => ({ when: n.date, title: n.next_step, sub: n.company_name, href: `#/company/${n.company_id}`, overdue: n.overdue, kind: 'Next step' })),
    ...d.upcoming_meetings.map((m) => ({ when: m.starts_at, title: m.title, sub: [fmtTime(m.starts_at), m.meeting_type].filter(Boolean).join(' · '), href: m.company_id ? `#/company/${m.company_id}/meetings` : '#/meetings', kind: 'Meeting' })),
  ].filter((a) => (parseDate(a.when) || 0) <= horizon || a.overdue).sort((a, b) => String(a.when).localeCompare(String(b.when))).slice(0, 7);

  const flow = d.by_stage.filter((x) => !terminal.includes(x.stage));
  const flowEv = Math.max(...flow.map((x) => x.ev || 0), 1);
  const stageOrder = store.meta.settings.stages;
  const deals = [...live].sort((a, b) => stageOrder.indexOf(b.stage) - stageOrder.indexOf(a.stage) || (b.ev || 0) - (a.ev || 0));
  const today = new Date().toISOString().slice(0, 10);
  const sentence = `${k.live_deals} live deal${k.live_deals === 1 ? '' : 's'} worth ${money(k.pipeline_ev, cur)} in enterprise value. `
    + (urgent ? `${urgent} item${urgent === 1 ? '' : 's'} need${urgent === 1 ? 's' : ''} your attention today.` : 'Nothing urgent today.');
  const ATTN_SHOWN = 5;

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
      <div><div class="label">Meetings, last 30 days</div><div class="value">${fig(k.meetings_30d)}</div><div class="sub">${d.upcoming_meetings.length} scheduled</div></div>
      <a href="#/team" title="Deals with lead, description, CIM facts, model, notes, people and next step all on record"><div class="label">Complete deal records</div><div class="value">${fig(d.records.complete)}<small>of ${d.records.live}</small></div><div class="sub">${d.records.gaps ? `${d.records.gaps} item${d.records.gaps === 1 ? '' : 's'} missing` : 'nothing missing'}</div></a>
    </div>

    <div class="dash-row">
      <section class="panel dash-panel">
        <div class="panel-head"><h2>Needs attention</h2>${d.attention.length ? html`<span class="count">${d.attention.length}</span>` : ''}</div>
        <div id="attn">${attentionList(d.attention.slice(0, ATTN_SHOWN))}</div>
        ${d.attention.length > ATTN_SHOWN ? html`<button class="panel-more" id="attn-more">Show all ${d.attention.length}</button>` : ''}
      </section>
      <section class="panel dash-panel">
        <div class="panel-head"><h2>Coming up</h2><span class="aside">next 3 weeks</span></div>
        ${agenda.length ? html`<div class="agenda">${agenda.map((a) => html`
          <a class="agenda-row" href="${a.href}">${dateBlock(a.when)}
            <span class="what"><b>${a.title}</b><small>${a.kind === 'Meeting' ? a.sub : `Next step · ${a.sub || ''}`}</small></span>
            ${a.overdue ? html`<span class="sev urgent">Overdue</span>` : ''}</a>`)}</div>`
          : html`<p class="muted" style="padding:8px 0 4px">Nothing scheduled. Set next steps on deals to see them here.</p>`}
      </section>
    </div>

    <div class="dash-row">
      <section class="panel dash-panel">
        <div class="panel-head"><h2>Pipeline by stage</h2><a class="aside link" href="#/pipeline">Open board ${ic('arrowRight')}</a></div>
        <table class="stage-table">
          <thead><tr><th>Stage</th><th class="r">Deals</th><th class="r">Enterprise value</th><th></th></tr></thead>
          <tbody>${flow.map((x) => html`<tr class="${x.count ? '' : 'zero'}">
            <td>${x.stage}</td><td class="r num">${x.count}</td><td class="r num">${x.ev ? money(x.ev, cur) : '–'}</td>
            <td class="bar-cell"><span class="bar"><i style="width:${x.ev ? Math.max((x.ev / flowEv) * 100, 2) : 0}%"></i></span></td></tr>`)}</tbody>
          <tfoot><tr><td>Total live</td><td class="r num">${k.live_deals}</td><td class="r num">${money(k.pipeline_ev, cur)}</td><td></td></tr></tfoot>
        </table>
      </section>
      <section class="panel dash-panel">
        <div class="panel-head"><h2>Recent activity</h2></div>
        <div class="feed">${d.recent_activity.slice(0, 7).map((a) => html`
          <div class="feed-row">
            <span class="what">${a.company_name ? html`<a href="#/company/${a.company_id}"><b>${a.company_name}</b></a>` : ''}<span>${a.summary.replace(' → ', ' to ')}</span></span>
            <span class="when" title="${new Date(a.created_at).toLocaleString()}">${ago(a.created_at)}</span>
          </div>`)}</div>
      </section>
    </div>

    <section class="section">
      <div class="section-head"><h2>Live deals</h2><a class="aside link" href="#/companies">All companies ${ic('arrowRight')}</a></div>
      <div class="table-wrap panel"><table class="table deals-table">
        <thead><tr><th>Company</th><th>Stage</th><th class="r">EV</th><th class="r">EBITDA</th><th class="r">EV / EBITDA</th><th>Lead</th><th>Next step</th><th>Deal record</th></tr></thead>
        <tbody>${deals.map((c) => html`<tr data-href="#/company/${c.id}">
          <td><div class="cell-co">${logo(c, 'sm')}<div><b>${c.name}</b><small class="muted">${c.codename || c.sector || ''}</small></div>${c.priority === 'High' ? html`<span class="prio" title="High priority">${ic('flag')}</span>` : ''}</div></td>
          <td>${c.stage}</td>
          <td class="r num">${money(c.ev, c.currency)}</td>
          <td class="r num">${money(c.ebitda, c.currency)}</td>
          <td class="r num">${c.ev_ebitda != null ? mult(c.ev_ebitda) : '–'}</td>
          <td>${c.deal_lead || html`<span class="overdue">None</span>`}</td>
          <td class="next">${c.next_step ? html`<span>${c.next_step}</span>${c.next_step_date ? html`<small class="${c.next_step_date < today ? 'overdue' : 'muted'}">${shortDate(c.next_step_date)}</small>` : ''}` : html`<span class="muted">–</span>`}</td>
          <td><span class="rec-cell" title="${c.record.missing.length ? `Missing ${c.record.missing.join(', ')}` : 'Complete'}">${recordBar(c.record.done, c.record.total)}<span class="${c.record.missing.length ? 'rec-missing' : 'rec-full'}">${c.record.missing.length ? `${c.record.missing.length} missing` : 'Complete'}</span></span></td>
        </tr>`)}</tbody>
      </table></div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Pipeline mix</h2>
        <div class="seg" id="mix-tabs" role="tablist">${[['sector', 'Sector'], ['region', 'Region'], ['adv', 'Intermediaries'], ['months', 'Activity']].map(([key, label], i) => html`<button data-mix="${key}" class="${i ? '' : 'on'}" role="tab">${label}</button>`)}</div></div>
      <div class="panel panel-pad"><div id="mix"></div></div>
    </section>`);

  view.querySelectorAll('[data-qn]').forEach((b) => b.addEventListener('click', () => quickNew(b.dataset.qn)));
  $('#clear-demo', view)?.addEventListener('click', (e) => withBusy(e.currentTarget, () => clearDemo()));
  bindAttention($('#attn', view), () => renderDashboard(view));
  $('#attn-more', view)?.addEventListener('click', (e) => { $('#attn', view).innerHTML = String(attentionList(d.attention)); e.currentTarget.remove(); });
  view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));

  const byEv = (rows) => [...rows].filter((r) => r.ev || r.count).sort((x, y) => (y.ev || 0) - (x.ev || 0)).slice(0, 8).map((r) => ({ label: r.name, value: r.ev || 0, sub: `${r.count} deal${r.count === 1 ? '' : 's'}` }));
  const mix = {
    sector: (el) => hbars(el, byEv(d.by_sector), { format: (v) => money(v, cur) }),
    region: (el) => hbars(el, byEv(d.by_region), { format: (v) => money(v, cur) }),
    adv: (el) => hbars(el, [...d.intermediaries].sort((x, y) => (y.ev || 0) - (x.ev || 0)).slice(0, 8).map((r) => ({ label: r.name, value: r.ev || 0, sub: `${r.deals} deal${r.deals === 1 ? '' : 's'} · furthest: ${r.best_stage || 'passed'}` })), { format: (v) => money(v, cur), empty: 'Add advisors to deals to see who brings you the best flow.' }),
    months: (el) => columns(el, {
      categories: d.activity_by_month.map((m) => m.month),
      series: [{ key: 'meetings', label: 'Meetings', color: 'var(--bar)' }, { key: 'companies', label: 'Companies added', color: 'var(--accent)' }],
      rows: d.activity_by_month.map((m) => {
        const dt = new Date(`${m.month}-01T00:00:00`);
        return { cat: m.month, label: dt.toLocaleDateString(undefined, { month: 'short' }), tipTitle: dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), meetings: m.meetings, companies: m.companies };
      }),
      format: (v) => num(v),
      height: 200,
    }),
  };
  const showMix = (key) => {
    $$('#mix-tabs button', view).forEach((b) => b.classList.toggle('on', b.dataset.mix === key));
    const el = $('#mix', view); el.innerHTML = ''; mix[key](el);
    try { sessionStorage.setItem('dt-mix', key); } catch { /* ignore */ }
  };
  $('#mix-tabs', view).addEventListener('click', (e) => { const b = e.target.closest('[data-mix]'); if (b) showMix(b.dataset.mix); });
  let saved = 'sector';
  try { saved = sessionStorage.getItem('dt-mix') || 'sector'; } catch { /* ignore */ }
  showMix(mix[saved] ? saved : 'sector');
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
