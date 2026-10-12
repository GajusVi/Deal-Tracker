import { api, store } from '../api.js';
import {
  html, raw, $, $$, logo, money, mult, pct, num, ago, fmtDate, fmtDateTime, toast, errToast, withBusy, confirmDialog,
  dropzone, dominantColor, ICONS, fileExt, bytes, avatar, strength, sentimentChip, dateBlock, prioChip, modal, options, formValues,
} from '../ui.js';
import { companyForm, contactForm, meetingForm, meetingView, contactView, reviewCim, renderSeriesChart } from '../forms.js';
import { networkGraph } from '../graph.js';

const TABS = [
  ['overview', 'Overview'], ['docs', 'CIM & documents'], ['models', 'Models'], ['meetings', 'Meetings'], ['people', 'People & network'], ['timeline', 'Timeline'],
];

export async function renderCompany(view, id, tab = 'overview') {
  const c = await api.get(`/api/companies/${id}`);
  const s = store.meta.settings;
  const terminal = store.meta.terminal_stages;
  const flow = s.stages.filter((x) => !terminal.includes(x));
  const curIdx = flow.indexOf(c.stage);
  const models = c.documents.filter((d) => d.kind === 'model');
  const docs = c.documents.filter((d) => d.kind !== 'model');
  const counts = { docs: docs.length, models: models.length, meetings: c.meetings.length, people: c.contacts.length };
  if (!TABS.some(([k]) => k === tab)) tab = 'overview';

  view.innerHTML = String(html`
    <div class="card hero" style="--c:${c.color}">
      <div class="cover"></div>
      <div class="hero-main">
        <span id="hero-logo" title="Click to change logo">${logo(c, 'lg')}</span>
        <div class="hero-title">
          <h1>${c.name}</h1>
          <div class="sub">
            ${c.codename ? html`<span>${c.codename}</span>·` : ''}
            ${c.sector ? html`<span>${c.sector}</span>` : ''}
            ${c.country ? html`<span class="chip">📍 ${[c.hq_city, c.country].filter(Boolean).join(', ')}</span>` : ''}
            ${c.region ? html`<span class="chip">${c.region}</span>` : ''}
            ${c.deal_type ? html`<span class="chip">${c.deal_type}</span>` : ''}
            ${prioChip(c.priority)}
            ${c.status && c.status !== 'Active' ? html`<span class="chip">${c.status}</span>` : ''}
          </div>
        </div>
        <div class="btn-row">
          <button class="btn" id="b-meeting">${ICONS.plus} Log meeting</button>
          <button class="btn" id="b-upload">${ICONS.upload} Upload</button>
          <button class="btn primary" id="b-edit">${ICONS.edit} Edit</button>
        </div>
      </div>
      <div class="stepper" id="stepper">
        ${flow.map((st, i) => html`<button data-stage="${st}" class="${st === c.stage ? 'current' : i < curIdx ? 'done' : ''}" title="Move to ${st}">${st}</button>`)}
        ${terminal.filter((t) => s.stages.includes(t)).map((t) => html`<button data-stage="${t}" class="term ${t === c.stage ? 'current' : ''} ${t === 'Passed' ? 'passed' : ''}">${t === 'Closed' ? '✓ ' : '✕ '}${t}</button>`)}
      </div>
      <div class="metrics">
        <div class="metric"><small class="muted">Enterprise value</small><b>${money(c.ev, c.currency)}</b></div>
        <div class="metric"><small class="muted">Revenue</small><b>${money(c.revenue, c.currency)}</b></div>
        <div class="metric"><small class="muted">EBITDA</small><b>${money(c.ebitda, c.currency)}</b></div>
        <div class="metric"><small class="muted">Margin</small><b>${pct(c.ebitda_margin)}</b></div>
        <div class="metric"><small class="muted">EV / EBITDA</small><b>${mult(c.ev_ebitda)}</b></div>
        <div class="metric"><small class="muted">Employees</small><b>${num(c.employees)}</b></div>
        <div class="metric"><small class="muted">In stage</small><b>${c.days_in_stage ?? 0} days</b></div>
      </div>
    </div>
    <div class="tabs" id="tabs">${TABS.map(([k, l]) => html`<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}${counts[k] != null ? html`<span class="count">${counts[k]}</span>` : ''}</button>`)}</div>
    <div id="tab"></div>`);

  const reload = (t = tab) => renderCompany(view, id, t);
  $('#tabs', view).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    history.replaceState(null, '', `#/company/${id}/${b.dataset.tab}`);
    reload(b.dataset.tab);
  });
  $('#stepper', view).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-stage]');
    if (!b || b.dataset.stage === c.stage) return;
    try {
      await api.patch(`/api/companies/${id}`, { stage: b.dataset.stage, ...(b.dataset.stage === 'Passed' ? { status: 'Passed' } : c.status === 'Passed' ? { status: 'Active' } : {}) });
      toast(`Moved to ${b.dataset.stage}`); reload();
    } catch (err) { errToast(err); }
  });
  $('#b-edit', view).addEventListener('click', async () => { if (await companyForm(c)) reload(); });
  $('#b-meeting', view).addEventListener('click', async () => { if (await meetingForm(null, { companyId: id })) reload('meetings'); });
  $('#b-upload', view).addEventListener('click', () => uploadDialog(c, reload));
  $('#hero-logo', view).addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*,.svg';
    inp.onchange = async () => {
      if (!inp.files[0]) return;
      try {
        const updated = await api.upload(`/api/companies/${id}/logo`, inp.files[0]);
        const col = await dominantColor(updated.logo_url);
        if (col && (await confirmDialog(html`Logo updated. Use the logo's colour <span class="swatch" style="display:inline-block;vertical-align:middle;background:${col}"></span> as the brand colour?`, { ok: 'Use colour', danger: false }))) {
          await api.patch(`/api/companies/${id}`, { color: col });
        }
        reload();
      } catch (err) { errToast(err); }
    };
    inp.click();
  });

  const el = $('#tab', view);
  ({ overview, docs: docsTab, models: modelsTab, meetings: meetingsTab, people: peopleTab, timeline })[tab](el, c, reload, { docs, models });
}

// ------------------------------------------------------------------ overview
function overview(el, c, reload) {
  const kf = c.key_facts || {};
  const facts = (kf.facts || []).filter((f) => !['name', 'codename', 'description', 'sector', 'region'].includes(f.key));
  const tags = (c.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  el.innerHTML = String(html`
    <div class="grid grid-dash">
      <div class="stack">
        <div class="card card-pad">
          <h2 style="margin-bottom:8px">About</h2>
          <p class="t2">${c.description || raw('<span class="muted">No description yet — edit the company or apply facts from a CIM.</span>')}</p>
          ${tags.length ? html`<div class="chips">${tags.map((t) => html`<span class="chip">#${t}</span>`)}</div>` : ''}
        </div>
        <div class="card">
          <div class="card-head"><h2>Key facts</h2>${kf.applied_at ? html`<small class="muted">from CIM · ${ago(kf.applied_at)}</small>` : ''}</div>
          <div class="card-body">
            ${facts.length ? html`<div class="facts">${facts.map((f) => html`
              <div class="fact" title="${f.snippet || ''}"><small class="muted"><span>${f.label}</span>${f.page ? html`<span>p.${f.page}</span>` : ''}</small><b>${f.display}</b></div>`)}</div>`
              : html`<div class="empty" style="padding:16px">Upload a CIM in <a href="#/company/${c.id}/docs">CIM & documents</a> to detect key facts automatically.</div>`}
          </div>
        </div>
        ${kf.series && kf.series.revenue ? html`<div class="card"><div class="card-head"><h2>Financial profile</h2><small class="muted">${kf.currency || c.currency} millions</small></div><div class="card-body" id="fin"></div></div>` : ''}
        ${(kf.highlights || []).length || (kf.risks || []).length ? html`
          <div class="grid grid-2">
            <div class="card card-pad"><h2 style="margin-bottom:10px">Investment highlights</h2>${(kf.highlights || []).length ? html`<ul class="bullets">${kf.highlights.map((h) => html`<li>${h.text}</li>`)}</ul>` : html`<p class="muted">—</p>`}</div>
            <div class="card card-pad"><h2 style="margin-bottom:10px">Risks & diligence questions</h2>${(kf.risks || []).length ? html`<ul class="bullets">${kf.risks.map((h) => html`<li>${h.text}</li>`)}</ul>` : html`<p class="muted">—</p>`}</div>
          </div>` : ''}
        ${kf.summary ? html`<div class="card card-pad"><h2 style="margin-bottom:8px">Claude summary</h2><p class="t2">${kf.summary}</p></div>` : ''}
      </div>
      <div class="stack">
        <div class="card card-pad">
          <h2 style="margin-bottom:12px">Deal details</h2>
          <dl class="kv">
            <dt>Stage</dt><dd><span class="chip stage">${c.stage}</span></dd>
            <dt>Next step</dt><dd>${c.next_step ? html`${c.next_step}${c.next_step_date ? html` <span class="${c.next_step_date < new Date().toISOString().slice(0, 10) ? 'overdue' : 'muted'}">· ${fmtDate(c.next_step_date)}</span>` : ''}` : '—'}</dd>
            <dt>Deal lead</dt><dd>${c.deal_lead || '—'}</dd>
            <dt>Advisor</dt><dd>${c.advisor || '—'}</dd>
            <dt>Source</dt><dd>${c.source || '—'}</dd>
            <dt>Ownership</dt><dd>${c.ownership || '—'}</dd>
            <dt>Founded</dt><dd>${c.founded_year || '—'}</dd>
            <dt>Website</dt><dd>${c.website ? html`<a href="${/^https?:/.test(c.website) ? c.website : 'https://' + c.website}" target="_blank" rel="noopener">${c.website} ↗</a>` : '—'}</dd>
            <dt>EV / Revenue</dt><dd>${c.ev_revenue != null ? `${c.ev_revenue.toFixed(2)}x` : '—'}</dd>
            <dt>Added</dt><dd>${fmtDateTime(c.created_at)}</dd>
            <dt>Last updated</dt><dd>${fmtDateTime(c.updated_at)} <span class="muted">(${ago(c.updated_at)})</span></dd>
          </dl>
        </div>
        <div class="card">
          <div class="card-head"><h2>Stage history</h2></div>
          <div class="card-body"><div class="timeline">${[...c.stage_history].reverse().map((h, i, arr) => {
            const next = i > 0 ? arr[i - 1].changed_at : null;
            const days = Math.max(0, Math.round(((next ? new Date(next) : new Date()) - new Date(h.changed_at)) / 86400000));
            return html`<div class="tl-item" style="--c:${c.color}"><div class="what"><b>${h.to_stage}</b> <span class="muted">· ${days} day${days === 1 ? '' : 's'}${i === 0 ? ' so far' : ''}</span></div><div class="when">${fmtDateTime(h.changed_at)}</div></div>`;
          })}</div></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Recent meetings</h2><a class="btn sm ghost" href="#/company/${c.id}/meetings">All →</a></div>
          <div class="card-body">${c.meetings.length ? html`<div class="list">${c.meetings.slice(0, 4).map((m) => html`
            <div class="list-item" style="cursor:pointer" data-m="${m.id}">${dateBlock(m.starts_at)}<span class="grow"><span class="title">${m.title}</span><span class="meta">${m.meeting_type || ''} · ${ago(m.starts_at)}</span></span></div>`)}</div>` : html`<p class="muted">No meetings yet.</p>`}</div>
        </div>
        <button class="btn danger" id="del" style="align-self:flex-start">${ICONS.trash} Delete company</button>
      </div>
    </div>`);
  renderSeriesChart($('#fin', el), kf.series, kf.currency || c.currency);
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (m) meetingView(+m.dataset.m, { onChange: () => reload() });
  });
  $('#del', el).addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete ${c.name}? Its documents, models and history will be removed. Meetings and contacts are kept.`))) return;
    await api.del(`/api/companies/${c.id}`);
    toast(`${c.name} deleted`);
    location.hash = '#/companies';
  });
}

// ------------------------------------------------------------------ uploads
const KIND_LABEL = { cim: 'CIM', teaser: 'Teaser', model: 'Model', nda: 'NDA', diligence: 'Diligence', other: 'Other' };

function uploadDialog(c, reload, kind = 'cim') {
  modal({
    title: `Upload to ${c.name}`,
    body: html`
      <div class="field" style="margin-bottom:12px"><label>Document type</label>
        <select id="up-kind">${options(Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })), kind)}</select>
        <span class="hint">CIMs and teasers are scanned for key facts. Models (.xlsx) are versioned and IRR / MOIC are read automatically.</span></div>
      <div class="field" style="margin-bottom:12px"><label>Label (optional)</label><input type="text" id="up-label" placeholder="e.g. Banker model, Round 2 bid case"></div>
      <div class="dropzone" id="up-drop">${ICONS.upload}<b>Drop files here</b> or click to browse</div>`,
    onMount(el, close) {
      dropzone($('#up-drop', el), async (files) => {
        const kindV = $('#up-kind', el).value;
        $('#up-drop', el).innerHTML = String(html`<span class="btn ghost loading">Uploading ${files.length} file(s)…</span>`);
        let last = null;
        for (const f of files) {
          try { last = await api.upload(`/api/companies/${c.id}/documents`, f, { kind: kindV, label: $('#up-label', el).value || null }); } catch (err) { errToast(err); }
        }
        close();
        toast(`${files.length} file(s) uploaded`);
        if (last && (kindV === 'cim' || kindV === 'teaser') && last.analysis && last.analysis.facts) {
          reload('docs');
          reviewCim(last, c, { onApplied: () => reload('overview') });
        } else reload(kindV === 'model' ? 'models' : 'docs');
      }, { multiple: true });
    },
  });
}

function docRow(d, extra = '') {
  return html`
    <div class="doc">
      <div class="doc-icon ${fileExt(d.filename)}">${fileExt(d.filename).toUpperCase().slice(0, 4)}</div>
      <div class="grow">
        <b title="${d.filename}">${d.label ? html`${d.label} <span class="muted" style="font-weight:400">· ${d.filename}</span>` : d.filename}</b>
        <small class="muted">${KIND_LABEL[d.kind] || d.kind} · ${bytes(d.size)} · uploaded ${fmtDateTime(d.uploaded_at)}</small>
        ${extra}
      </div>
      <div class="btn-row">
        ${(d.kind === 'cim' || d.kind === 'teaser') && d.analysis ? html`<button class="btn sm primary" data-review="${d.id}">${ICONS.spark} Review facts</button>` : ''}
        ${fileExt(d.filename) === 'pdf' ? html`<a class="btn sm ghost" href="${d.download_url}?inline=1" target="_blank" rel="noopener" title="Open">${ICONS.ext}</a>` : ''}
        <a class="btn sm ghost" href="${d.download_url}" title="Download">${ICONS.download}</a>
        <button class="btn sm ghost" data-del="${d.id}" title="Delete">${ICONS.trash}</button>
      </div>
    </div>`;
}

function docsTab(el, c, reload, { docs }) {
  el.innerHTML = String(html`
    <div class="grid grid-dash">
      <div class="card"><div class="card-head"><h2>Documents</h2><button class="btn sm" id="up">${ICONS.upload} Upload</button></div>
        <div class="card-body">${docs.length ? docs.map((d) => docRow(d, d.analysis && d.analysis.facts ? html`<div class="outputs"><span class="out">${d.analysis.facts.length} facts detected</span>${d.analysis.ai ? html`<span class="out"><span class="badge-src claude">Claude</span> analysed</span>` : ''}${(d.analysis.stats || {}).pages ? html`<span class="out">${d.analysis.stats.pages} pages</span>` : ''}</div>` : '')) : html`<div class="dropzone" id="drop-empty">${ICONS.upload}<b>Drop a CIM here</b><br>Key facts are detected with page references for you to review.</div>`}</div>
      </div>
      <div class="card card-pad">
        <h2 style="margin-bottom:8px">How fact detection works</h2>
        <p class="t2">The built-in engine reads the CIM locally and looks for revenue, EBITDA, margins, growth, recurring revenue, retention, customers & concentration, headcount, HQ, founding year, CEO, ownership, advisor, process deadlines and financial tables.</p>
        <p class="t2">Every fact shows the sentence and page it came from, plus a confidence score. You choose what to apply.</p>
        <p class="t2">${store.meta.ai_enabled ? html`<b>Claude is enabled</b> — use “Analyze with Claude” in the review window for a deeper read, highlights, risks and a summary.` : html`Optional: add an Anthropic API key in <a href="#/settings">Settings</a> to let Claude read CIMs too (including scanned PDFs).`}</p>
      </div>
    </div>`);
  const up = $('#up', el);
  up && up.addEventListener('click', () => uploadDialog(c, reload, 'cim'));
  const de = $('#drop-empty', el);
  de && dropzone(de, async ([f]) => {
    try {
      const d = await api.upload(`/api/companies/${c.id}/documents`, f, { kind: 'cim' });
      reload('docs');
      if (d.analysis && d.analysis.facts) reviewCim(d, c, { onApplied: () => reload('overview') });
    } catch (err) { errToast(err); }
  }, { accept: '.pdf,.docx,.txt,.md' });
  bindDocActions(el, c, reload, docs, 'docs');
}

function bindDocActions(el, c, reload, docs, tab) {
  el.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-review]');
    if (r) reviewCim(docs.find((d) => d.id === +r.dataset.review), c, { onApplied: () => reload('overview') });
    const del = e.target.closest('[data-del]');
    if (del) {
      const d = docs.find((x) => x.id === +del.dataset.del);
      if (await confirmDialog(`Delete ${d.filename}? The file is removed from disk.`)) {
        await api.del(`/api/documents/${d.id}`); toast('Deleted'); reload(tab);
      }
    }
    const lab = e.target.closest('[data-label]');
    if (lab) {
      const d = docs.find((x) => x.id === +lab.dataset.label);
      const label = prompt('Version label', d.label || '');
      if (label != null) { await api.patch(`/api/documents/${d.id}`, { label }); reload(tab); }
    }
  });
}

// ------------------------------------------------------------------ models
function modelsTab(el, c, reload, { models }) {
  const latest = models[0], prev = models[1];
  const prevOut = new Map(((prev && prev.analysis && prev.analysis.outputs) || []).map((o) => [o.key, o]));
  el.innerHTML = String(html`
    <div class="grid grid-dash">
      <div class="card">
        <div class="card-head"><h2>Model versions</h2><button class="btn sm primary" id="up">${ICONS.upload} Upload new version</button></div>
        <div class="card-body">
          ${models.length ? models.map((d, i) => {
            const a = d.analysis || {};
            const nextOlder = models[i + 1];
            const olderOut = new Map(((nextOlder && nextOlder.analysis && nextOlder.analysis.outputs) || []).map((o) => [o.key, o]));
            return docRow(d, html`
              <div class="row" style="margin-top:4px;gap:6px"><span class="version">v${d.version}</span>${i === 0 ? html`<span class="chip pos">Latest</span>` : ''}<button class="btn sm ghost" data-label="${d.id}" style="padding:2px 6px">${ICONS.edit} ${d.label ? 'Rename' : 'Add label'}</button></div>
              ${a.outputs && a.outputs.length ? html`<div class="outputs">${a.outputs.map((o) => {
                const old = olderOut.get(o.key);
                const delta = old && typeof o.value === 'number' && typeof old.value === 'number' ? o.value - old.value : null;
                return html`<span class="out" title="${o.sheet}!row ${o.row} · “${o.cell_label}”">${o.label} <b>${o.display}</b>${delta ? html` <span class="delta" title="vs v${nextOlder.version}: ${old.display}">${delta > 0 ? '▲' : '▼'}</span>` : ''}</span>`;
              })}</div>` : a.note ? html`<div class="muted" style="font-size:12px;margin-top:4px">${a.note}</div>` : ''}
              ${a.sheets ? html`<div class="muted" style="font-size:12px;margin-top:4px">Sheets: ${a.sheets.map((s) => s.name).join(', ')}</div>` : ''}`);
          }) : html`<div class="dropzone" id="drop-empty">${ICONS.upload}<b>Drop your LBO / operating model</b><br>.xlsx, .xlsm, .xls, .csv — each upload becomes a new version with a timestamp.</div>`}
        </div>
      </div>
      <div class="stack">
        ${latest && latest.analysis && latest.analysis.outputs && latest.analysis.outputs.length ? html`
          <div class="card"><div class="card-head"><h2>Latest returns snapshot</h2><span class="version">v${latest.version}</span></div>
            <div class="card-body"><div class="facts">${latest.analysis.outputs.map((o) => {
              const p = prevOut.get(o.key);
              return html`<div class="fact"><small class="muted"><span>${o.label}</span>${p ? html`<span>v${prev.version}: ${p.display}</span>` : ''}</small><b>${o.display}</b></div>`;
            })}</div></div></div>` : ''}
        <div class="card card-pad"><h2 style="margin-bottom:8px">Tips</h2>
          <p class="t2">Outputs are found by scanning for labels such as <b>IRR</b>, <b>MOIC</b>, <b>Entry EV</b>, <b>Entry / Exit multiple</b>, <b>Leverage</b> and <b>Equity</b>, and reading the first number to the right.</p>
          <p class="t2">Save the workbook in Excel before uploading so calculated values are stored in the file.</p></div>
      </div>
    </div>`);
  $('#up', el).addEventListener('click', () => uploadDialog(c, reload, 'model'));
  const de = $('#drop-empty', el);
  de && dropzone(de, async (files) => {
    for (const f of files) { try { await api.upload(`/api/companies/${c.id}/documents`, f, { kind: 'model' }); } catch (err) { errToast(err); } }
    toast('Model uploaded'); reload('models');
  }, { accept: '.xlsx,.xlsm,.xls,.csv', multiple: true });
  bindDocActions(el, c, reload, models, 'models');
}

// ------------------------------------------------------------------ meetings
function meetingsTab(el, c, reload) {
  el.innerHTML = String(html`
    <div class="row" style="margin-bottom:12px"><h2 style="flex:1">${c.meetings.length} meeting${c.meetings.length === 1 ? '' : 's'}</h2><button class="btn primary" id="add">${ICONS.plus} Log meeting</button></div>
    ${c.meetings.length ? c.meetings.map((m) => html`
      <div class="card m-card" data-m="${m.id}">
        ${dateBlock(m.starts_at)}
        <div class="grow">
          <div class="title">${m.title}</div>
          <div class="meta"><span>${fmtDateTime(m.starts_at)}</span><span class="chip">${m.meeting_type || 'Meeting'}</span>${sentimentChip(m.sentiment)}${m.attendees.length ? html`<span>· ${m.attendees.map((a) => a.name).join(', ')}</span>` : ''}</div>
          ${m.takeaways || m.notes ? html`<div class="excerpt">${m.takeaways || m.notes}</div>` : ''}
        </div>
      </div>`) : html`<div class="card empty"><h3>No meetings yet</h3><p>Log management presentations, banker calls, expert calls and site visits.</p></div>`}`);
  $('#add', el).addEventListener('click', async () => { if (await meetingForm(null, { companyId: c.id })) reload('meetings'); });
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (m) meetingView(+m.dataset.m, { onChange: () => reload('meetings') });
  });
}

// ------------------------------------------------------------------ people
async function peopleTab(el, c, reload) {
  el.innerHTML = String(html`
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>People on this deal</h2>
          <div class="btn-row"><button class="btn sm" id="link">${ICONS.link} Link existing</button><button class="btn sm primary" id="add">${ICONS.plus} New contact</button></div></div>
        <div class="card-body">${c.contacts.length ? html`<div class="list">${c.contacts.map((p) => html`
          <div class="list-item" style="cursor:pointer" data-p="${p.id}">
            ${avatar(p)}
            <span class="grow"><span class="title">${p.name}</span><span class="meta">${[p.title, p.organization].filter(Boolean).join(' · ')}${p.deal_role ? ` — ${p.deal_role}` : p.is_employee ? ' — Management' : ''}</span></span>
            ${strength(p.strength)}
            <button class="icon-btn" data-unlink="${p.id}" title="Remove from deal">${ICONS.close}</button>
          </div>`)}</div>` : html`<p class="muted">Add management, bankers, experts and co-investors involved in this deal.</p>`}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Relationship map</h2><a class="btn sm ghost" href="#/network">Full network →</a></div>
        <div class="card-body"><div class="graph-wrap small card" id="ego"></div></div>
      </div>
    </div>`);
  $('#add', el).addEventListener('click', async () => { if (await contactForm(null, { companyId: c.id })) reload('people'); });
  $('#link', el).addEventListener('click', async () => {
    const all = await api.get('/api/contacts');
    const avail = all.filter((p) => !c.contacts.some((x) => x.id === p.id));
    modal({
      title: 'Link existing contact', size: 'narrow',
      body: html`<form class="stack" id="lk"><div class="field"><label>Contact</label><select name="contact_id">${options(avail.map((p) => ({ value: p.id, label: `${p.name}${p.organization ? ' — ' + p.organization : ''}` })), '', { blank: 'Choose…' })}</select></div>
        <div class="field"><label>Role on this deal</label><input type="text" name="role" placeholder="e.g. Sell-side banker, Expert, Lender"></div></form>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="lk-save">Link</button>`,
      onMount(m, close) {
        $('#lk-save', m).addEventListener('click', async () => {
          const v = formValues($('#lk', m));
          if (!v.contact_id) return toast('Choose a contact', 'err');
          await api.post(`/api/companies/${c.id}/contacts`, v); close(); reload('people');
        });
      },
    });
  });
  el.addEventListener('click', async (e) => {
    const u = e.target.closest('[data-unlink]');
    if (u) { e.stopPropagation(); await api.del(`/api/companies/${c.id}/contacts/${u.dataset.unlink}`); reload('people'); return; }
    const p = e.target.closest('[data-p]');
    if (p) contactView(+p.dataset.p, { onChange: () => reload('people') });
  });
  const g = await api.get(`/api/graph?company_id=${c.id}`);
  const wrap = $('#ego', el);
  if (!g.edges.length) { wrap.innerHTML = String(html`<div class="empty">Link people to see how they connect.</div>`); return; }
  networkGraph(wrap, g, { onOpen: (n) => (n.kind === 'company' ? (location.hash = `#/company/${n.ref}`) : contactView(n.ref, { onChange: () => reload('people') })) });
}

// ------------------------------------------------------------------ timeline
function timeline(el, c) {
  el.innerHTML = String(html`<div class="card card-pad" style="max-width:820px">
    <h2 style="margin-bottom:14px">Everything that happened on ${c.name}</h2>
    <div class="timeline">${c.activity.map((a) => html`
      <div class="tl-item" style="--c:${a.action === 'stage' ? c.color : 'var(--text-3)'}">
        <div class="what">${a.action === 'stage' ? html`<b>Stage:</b> ` : ''}${a.summary}</div>
        <div class="when">${fmtDateTime(a.created_at)} · ${ago(a.created_at)}</div>
      </div>`)}</div></div>`);
}
