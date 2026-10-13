import { api, store } from '../api.js';
import { html, $, $$, logo, money, errToast, ic, recordBar, tkr, fmtDate } from '../ui.js';
import { quickNew, setCrumbs } from '../app.js';
import { moveStage } from '../forms.js';

// Stages stack down the page as lanes (no sideways scrolling); deals in a lane wrap into a grid.
// The sort applies inside each lane, or across every deal when grouping is off.
const SORTS = [
  ['relevance', 'Relevance'],
  ['ev', 'EV, high to low'],
  ['ebitda', 'EBITDA, high to low'],
  ['next', 'Next step, soonest'],
  ['days', 'Longest in stage'],
  ['record', 'Least documented'],
  ['updated', 'Recently updated'],
  ['name', 'Name, A to Z'],
];
const PRIO = { High: 0, Medium: 1, Low: 2 };
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const prefs = { sort: 'relevance', group: 'stage' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('dt-pipe') || '{}')); } catch { /* ignore */ }
const savePrefs = () => { try { localStorage.setItem('dt-pipe', JSON.stringify(prefs)); } catch { /* ignore */ } };

function comparator(key, stages) {
  const by = (f, dir = 1) => (a, b) => {
    const x = f(a), y = f(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  };
  const then = (...cs) => (a, b) => { for (const c of cs) { const r = c(a, b); if (r) return r; } return 0; };
  const t = today(), soon = inDays(14);
  const stageIx = (c) => stages.indexOf(c.stage);
  switch (key) {
    case 'ev': return then(by((c) => c.ev, -1), by((c) => c.name));
    case 'ebitda': return then(by((c) => c.ebitda, -1), by((c) => c.name));
    case 'next': return then(by((c) => c.next_step_date || null), by((c) => c.name));
    case 'days': return then(by((c) => c.days_in_stage, -1), by((c) => c.name));
    case 'record': return then(by((c) => c.record?.done), by((c) => c.name));
    case 'updated': return then(by((c) => c.updated_at, -1));
    case 'name': return by((c) => c.name.toLowerCase());
    default:
      // Relevance: overdue next steps, then next steps due within two weeks (soonest first),
      // then priority, then how far the deal has progressed, then size.
      return then(
        by((c) => (c.next_step_date && c.next_step_date < t ? 0 : 1)),
        by((c) => (c.next_step_date && c.next_step_date <= soon ? c.next_step_date : '9999')),
        by((c) => PRIO[c.priority] ?? 3),
        by((c) => stageIx(c), -1),
        by((c) => c.ev, -1),
      );
  }
}

export async function renderPipeline(view) {
  setCrumbs([{ label: 'Pipeline' }]);
  const companies = await api.get('/api/companies');
  const stages = store.meta.settings.stages;
  const terminal = new Set(store.meta.terminal_stages);
  const sector = sessionStorageGet('pipe-sector');
  const shown = companies.filter((c) => !sector || c.sector === sector);
  const cmp = comparator(prefs.sort, stages);
  const isLive = (c) => !terminal.has(c.stage) && c.status !== 'Passed';

  const lanes = stages.map((s, i) => ({ stage: s, ix: i + 1, terminal: terminal.has(s), items: shown.filter((c) => c.stage === s) }));
  const orphan = shown.filter((c) => !stages.includes(c.stage));
  if (orphan.length) lanes[0].items.push(...orphan);
  lanes.forEach((l) => l.items.sort(cmp));
  const live = shown.filter(isLive);
  const liveEv = live.reduce((a, c) => a + (c.ev || 0), 0);
  const flat = [...live].sort(cmp);
  const closedOut = shown.filter((c) => !isLive(c)).sort(cmp);

  view.innerHTML = String(html`
    <div class="page-head">
      <div>
        <h1>Pipeline</h1>
        <p>${live.length} live deal${live.length === 1 ? '' : 's'}${liveEv ? html` · ${money(liveEv)} enterprise value` : ''}. ${prefs.group === 'stage' ? 'Drag a deal to another stage to move it; any move can be undone.' : 'Every live deal in one list.'}</p>
      </div>
      <button class="btn primary" id="add">${ic('plus')}Add company</button>
    </div>

    <div class="filters pipe-bar">
      <label class="sel-label">Sort
        <select id="pipe-sort" class="compact">${SORTS.map(([k, l]) => html`<option value="${k}" ${k === prefs.sort ? 'selected' : ''}>${l}</option>`)}</select></label>
      <select id="pipe-sector" class="compact ${sector ? 'set' : ''}" aria-label="Sector"><option value="">All sectors</option>${store.meta.settings.sectors.map((s) => html`<option ${s === sector ? 'selected' : ''}>${s}</option>`)}</select>
      ${prefs.sort === 'relevance' ? html`<span class="hint">Overdue and upcoming next steps first, then priority, then the furthest-advanced deals.</span>` : ''}
      <div class="seg" role="tablist" aria-label="Layout">
        <button data-group="stage" class="${prefs.group === 'stage' ? 'on' : ''}" role="tab">${ic('list')}By stage</button>
        <button data-group="flat" class="${prefs.group === 'flat' ? 'on' : ''}" role="tab">${ic('grid')}All deals</button>
      </div>
    </div>

    ${prefs.group === 'stage' ? html`
      <div class="lanes">${lanes.map((l) => html`
        <section class="lane ${l.terminal ? 'terminal' : ''}" data-stage="${l.stage}">
          <header class="lane-head"><span class="ix">${l.terminal ? '–' : l.ix}</span><h2>${l.stage}</h2><span class="count" data-count></span><span class="ev" data-ev></span></header>
          <div class="lane-body">${l.items.map((c) => card(c))}<div class="lane-empty">${l.terminal ? 'Drop a deal here to mark it ' + l.stage.toLowerCase() : 'Drop a deal here'}</div></div>
        </section>`)}
      </div>`
    : html`
      <div class="lane-body flat">${flat.map((c) => card(c, { stage: true }))}</div>
      ${closedOut.length ? html`<details class="closed-out"><summary>Closed and passed <span class="muted">(${closedOut.length})</span></summary>
        <div class="lane-body flat">${closedOut.map((c) => card(c, { stage: true }))}</div></details>` : ''}`}`);

  $$('.lane', view).forEach(tally);
  $('#add', view).addEventListener('click', () => quickNew('company'));
  $('#pipe-sector', view).addEventListener('change', (e) => { sessionStorageSet('pipe-sector', e.target.value); renderPipeline(view); });
  $('#pipe-sort', view).addEventListener('change', (e) => { prefs.sort = e.target.value; savePrefs(); renderPipeline(view); });
  view.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => { prefs.group = b.dataset.group; savePrefs(); renderPipeline(view); }));

  if (prefs.group !== 'stage') return;
  let dragId = null;
  $$('.k-card', view).forEach((el) => {
    el.addEventListener('dragstart', (e) => { dragId = el.dataset.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  });
  $$('.lane', view).forEach((lane) => {
    lane.addEventListener('dragover', (e) => { e.preventDefault(); lane.classList.add('over'); });
    lane.addEventListener('dragleave', (e) => { if (!lane.contains(e.relatedTarget)) lane.classList.remove('over'); });
    lane.addEventListener('drop', async (e) => {
      e.preventDefault();
      lane.classList.remove('over');
      const id = dragId || e.dataTransfer.getData('text/plain');
      const c = companies.find((x) => String(x.id) === String(id));
      const el = view.querySelector(`.k-card[data-id="${id}"]`);
      if (!c || !el || c.stage === lane.dataset.stage) return;
      // Optimistic: the card lands immediately; the server catches up behind it.
      const from = el.closest('.lane');
      const body = $('.lane-body', lane);
      body.insertBefore(el, body.firstChild);
      el.classList.remove('landed'); void el.offsetWidth; el.classList.add('landed');
      tally(from); tally(lane);
      const revert = () => { $('.lane-body', from).prepend(el); tally(from); tally(lane); };
      try {
        const updated = await moveStage(c, lane.dataset.stage, { onUndo: () => renderPipeline(view) });
        if (!updated) revert();
        else Object.assign(c, { stage: updated.stage, status: updated.status });
      } catch (err) { revert(); errToast(err); }
    });
  });
}

function card(c, { stage = false } = {}) {
  const overdue = c.next_step_date && c.next_step_date < today();
  return html`
    <a class="k-card ${stage ? 'no-drag' : ''}" draggable="${stage ? 'false' : 'true'}" data-id="${c.id}" data-ev="${c.ev || 0}" href="#/company/${c.id}" style="--c:${c.color}">
      <div class="top">${logo(c, 'sm')}<div style="min-width:0;flex:1"><div class="nm-row"><b>${c.name}</b>${tkr(c.codename)}</div><small class="muted">${stage ? c.stage : c.sector || ''}</small></div>${c.priority === 'High' ? html`<span class="prio" title="High priority">${ic('flag')}</span>` : ''}</div>
      <div class="foot"><span><b>${money(c.ev, c.currency)}</b> EV${c.ebitda != null ? html` · <b>${money(c.ebitda, c.currency)}</b> EBITDA` : ''}</span><span title="Days in current stage">${c.days_in_stage ?? 0}d in stage</span></div>
      <div class="foot"><span>${c.deal_lead || html`<span class="overdue">No lead</span>`}</span>${c.record ? html`<span title="Deal record: ${c.record.done} of ${c.record.total} items${c.record.missing.length ? `. Missing ${c.record.missing.join(', ')}` : ''}">${recordBar(c.record.done, c.record.total)} ${c.record.done}/${c.record.total}</span>` : ''}</div>
      ${c.next_step ? html`<div class="next">${ic('arrowRight')}<span>${c.next_step}</span>${c.next_step_date ? html`<small class="${overdue ? 'overdue' : 'muted'}">${overdue ? 'Overdue · ' : ''}${fmtDate(c.next_step_date, { day: 'numeric', month: 'short' })}</small>` : ''}</div>` : ''}
    </a>`;
}

function tally(lane) {
  const cards = $$('.k-card', lane);
  const ev = cards.reduce((a, el) => a + Number(el.dataset.ev || 0), 0);
  $('[data-count]', lane).textContent = `${cards.length} deal${cards.length === 1 ? '' : 's'}`;
  $('[data-ev]', lane).textContent = ev ? `${money(ev)} EV` : '';
  lane.classList.toggle('is-empty', !cards.length);
}

function sessionStorageGet(k) { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }
