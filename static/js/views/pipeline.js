import { api, store } from '../api.js';
import { html, $$, logo, money, toast, errToast, ICONS, prioChip } from '../ui.js';
import { quickNew } from '../app.js';

export async function renderPipeline(view) {
  const companies = await api.get('/api/companies');
  const stages = store.meta.settings.stages;
  const terminal = new Set(store.meta.terminal_stages);
  const sector = sessionStorageGet('pipe-sector');
  const shown = companies.filter((c) => !sector || c.sector === sector);

  const cols = stages.map((s) => ({ stage: s, items: shown.filter((c) => c.stage === s) }));
  const orphan = shown.filter((c) => !stages.includes(c.stage));
  if (orphan.length) cols[0].items.push(...orphan);

  view.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Pipeline</h1><p>Drag cards between stages — every move is time-stamped in the company's history.</p></div>
      <div class="btn-row">
        <select id="pipe-sector" style="width:auto"><option value="">All sectors</option>${store.meta.settings.sectors.map((s) => html`<option ${s === sector ? 'selected' : ''}>${s}</option>`)}</select>
        <button class="btn primary" id="add">${ICONS.plus} Add company</button>
      </div>
    </div>
    <div class="board">${cols.map((col) => {
      const ev = col.items.reduce((a, c) => a + (c.ev || 0), 0);
      return html`
      <div class="col ${terminal.has(col.stage) ? 'terminal' : ''}" data-stage="${col.stage}">
        <div class="col-head"><div class="t">${col.stage}<span>${col.items.length}</span></div><small class="muted">${ev ? money(ev) + ' EV' : ' '}</small></div>
        <div class="col-body">${col.items.map((c) => html`
          <a class="k-card" draggable="true" data-id="${c.id}" href="#/company/${c.id}" style="--c:${c.color}">
            <div class="top">${logo(c, 'sm')}<div style="min-width:0;flex:1"><b>${c.name}</b><small class="muted">${[c.codename, c.sector].filter(Boolean).join(' · ')}</small></div></div>
            <div class="foot"><span>EV <b>${money(c.ev, c.currency)}</b></span><span title="Days in current stage">${c.days_in_stage ?? 0}d in stage</span></div>
            ${c.priority === 'High' || c.next_step ? html`<div class="foot">${prioChip(c.priority)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.next_step ? '→ ' + c.next_step : ''}</span></div>` : ''}
          </a>`)}</div>
      </div>`;
    })}</div>`);

  view.querySelector('#add').addEventListener('click', () => quickNew('company'));
  view.querySelector('#pipe-sector').addEventListener('change', (e) => { sessionStorageSet('pipe-sector', e.target.value); renderPipeline(view); });

  let dragId = null;
  $$('.k-card', view).forEach((card) => {
    card.addEventListener('dragstart', (e) => { dragId = card.dataset.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  $$('.col', view).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const id = dragId || e.dataTransfer.getData('text/plain');
      const c = companies.find((x) => String(x.id) === String(id));
      if (!c || c.stage === col.dataset.stage) return;
      try {
        await api.patch(`/api/companies/${id}`, { stage: col.dataset.stage, ...(col.dataset.stage === 'Passed' ? { status: 'Passed' } : c.status === 'Passed' ? { status: 'Active' } : {}) });
        toast(`${c.name} → ${col.dataset.stage}`);
        renderPipeline(view);
      } catch (err) { errToast(err); }
    });
  });
}

function sessionStorageGet(k) { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }
