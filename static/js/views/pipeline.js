import { api, store } from '../api.js';
import { html, $, $$, logo, money, errToast, ic } from '../ui.js';
import { quickNew, setCrumbs } from '../app.js';
import { moveStage } from '../forms.js';

export async function renderPipeline(view) {
  setCrumbs([{ label: 'Pipeline' }]);
  const companies = await api.get('/api/companies');
  const stages = store.meta.settings.stages;
  const terminal = new Set(store.meta.terminal_stages);
  const sector = sessionStorageGet('pipe-sector');
  const shown = companies.filter((c) => !sector || c.sector === sector);

  const cols = stages.map((s) => ({ stage: s, items: shown.filter((c) => c.stage === s) }));
  const orphan = shown.filter((c) => !stages.includes(c.stage));
  if (orphan.length) cols[0].items.push(...orphan);
  const live = shown.filter((c) => !terminal.has(c.stage) && c.status !== 'Passed');
  const liveEv = live.reduce((a, c) => a + (c.ev || 0), 0);

  view.innerHTML = String(html`
    <div class="page-head">
      <div>
        <h1>Pipeline</h1>
        <p>${live.length} live deal${live.length === 1 ? '' : 's'}${liveEv ? html` · ${money(liveEv)} enterprise value` : ''}. Drag a card to move it. Every move is time-stamped, and any move can be undone.</p>
      </div>
      <div class="btn-row">
        <select id="pipe-sector" class="compact"><option value="">All sectors</option>${store.meta.settings.sectors.map((s) => html`<option ${s === sector ? 'selected' : ''}>${s}</option>`)}</select>
        <button class="btn primary" id="add">${ic('plus')}Add company</button>
      </div>
    </div>
    <div class="board">${cols.map((col) => html`
      <section class="col ${terminal.has(col.stage) ? 'terminal' : ''}" data-stage="${col.stage}">
        <header class="col-head"><div class="t">${col.stage}<span data-count></span></div><small class="muted" data-ev></small></header>
        <div class="col-body">${col.items.map(card)}<div class="col-empty">${terminal.has(col.stage) ? 'None yet' : 'Drop a deal here'}</div></div>
      </section>`)}
    </div>`);
  $$('.col', view).forEach(tally);
  const board = $('.board', view);
  const edge = () => board.classList.toggle('at-end', board.scrollLeft + board.clientWidth >= board.scrollWidth - 4);
  board.addEventListener('scroll', edge, { passive: true }); edge();

  $('#add', view).addEventListener('click', () => quickNew('company'));
  $('#pipe-sector', view).addEventListener('change', (e) => { sessionStorageSet('pipe-sector', e.target.value); renderPipeline(view); });

  let dragId = null;
  $$('.k-card', view).forEach((el) => {
    el.addEventListener('dragstart', (e) => { dragId = el.dataset.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  });
  $$('.col', view).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const id = dragId || e.dataTransfer.getData('text/plain');
      const c = companies.find((x) => String(x.id) === String(id));
      const el = view.querySelector(`.k-card[data-id="${id}"]`);
      if (!c || !el || c.stage === col.dataset.stage) return;
      // Optimistic: the card lands immediately; the server catches up behind it.
      const from = el.closest('.col');
      const body = $('.col-body', col);
      body.insertBefore(el, body.firstChild);
      el.classList.remove('landed'); void el.offsetWidth; el.classList.add('landed');
      tally(from); tally(col);
      const revert = () => { $('.col-body', from).prepend(el); tally(from); tally(col); };
      try {
        const updated = await moveStage(c, col.dataset.stage, { onUndo: () => renderPipeline(view) });
        if (!updated) revert();
        else Object.assign(c, { stage: updated.stage, status: updated.status });
      } catch (err) { revert(); errToast(err); }
    });
  });
}

function card(c) {
  return html`
    <a class="k-card" draggable="true" data-id="${c.id}" data-ev="${c.ev || 0}" href="#/company/${c.id}" style="--c:${c.color}">
      <div class="top">${logo(c, 'sm')}<div style="min-width:0;flex:1"><b>${c.name}</b><small class="muted">${[c.codename, c.sector].filter(Boolean).join(' · ')}</small></div>${c.priority === 'High' ? html`<span class="prio" title="High priority">${ic('flag')}</span>` : ''}</div>
      <div class="foot"><span><b>${money(c.ev, c.currency)}</b> EV</span><span title="Days in current stage">${c.days_in_stage ?? 0}d in stage</span></div>
      <div class="foot"><span>${c.deal_lead || html`<span class="overdue">No lead</span>`}</span><span title="How much of this deal a successor would inherit">Memory ${c.knowledge}%</span></div>
      ${c.next_step ? html`<div class="next">${ic('arrowRight')}<span>${c.next_step}</span></div>` : ''}
    </a>`;
}

function tally(col) {
  const cards = $$('.k-card', col);
  const ev = cards.reduce((a, el) => a + Number(el.dataset.ev || 0), 0);
  $('[data-count]', col).textContent = cards.length;
  $('[data-ev]', col).textContent = ev ? `${money(ev)} EV` : ' ';
  col.classList.toggle('is-empty', !cards.length);
}

function sessionStorageGet(k) { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }
