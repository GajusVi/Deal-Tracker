import { api, store } from '../api.js';
import {
  html, raw, $, $$, logo, money, mult, pct, num, ago, fmtDate, fmtDateTime, toast, errToast, withBusy, confirmDialog,
  dropzone, dominantColor, ICONS, ic, fileExt, bytes, avatar, strength, sentimentChip, dateBlock, prioChip, modal, options, formValues, ring,
} from '../ui.js';
import { companyForm, contactForm, meetingForm, meetingView, contactView, reviewCim, renderSeriesChart, moveStage, priorLooksBanner } from '../forms.js';
import { networkGraph } from '../graph.js';
import { setCrumbs } from '../app.js';

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
  if (tab === 'onepager') return renderOnePager(view, c);
  if (!TABS.some(([k]) => k === tab)) tab = 'overview';

  setCrumbs([{ label: 'Companies', href: '#/companies' }, { label: c.name }]);
  view.innerHTML = String(html`
    <div class="hero" style="--c:${c.color}">
      <div class="hero-main">
        <span id="hero-logo" title="Change logo">${logo(c, 'lg')}</span>
        <div class="hero-title">
          ${c.codename || c.is_demo ? html`<span class="eyebrow">${[c.codename, c.is_demo ? 'Sample' : ''].filter(Boolean).join(' · ')}</span>` : ''}
          <h1>${c.name}</h1>
          <div class="meta-line">
            ${c.sector ? html`<span>${c.sector}</span>` : ''}
            ${c.country ? html`<span>${[c.hq_city, c.country].filter(Boolean).join(', ')}</span>` : ''}
            ${c.deal_type ? html`<span>${c.deal_type}</span>` : ''}
            ${c.deal_lead ? html`<span>Led by ${c.deal_lead}</span>` : ''}
            ${c.priority === 'High' ? html`<span>${prioChip(c.priority)}</span>` : ''}
            ${c.status && c.status !== 'Active' ? html`<span>${c.status}</span>` : ''}
          </div>
        </div>
        <div class="btn-row">
          <button class="btn" id="b-meeting">${ic('meetings')}Log meeting</button>
          <button class="btn" id="b-upload">${ic('upload')}Upload</button>
          <a class="btn" href="#/company/${c.id}/onepager">${ic('file')}One-pager</a>
          <button class="btn primary" id="b-edit">${ic('edit')}Edit</button>
        </div>
      </div>
      <div class="stepper" id="stepper">
        ${flow.map((st, i) => html`<button data-stage="${st}" class="${st === c.stage ? 'current' : i < curIdx ? 'done' : ''}" title="Move to ${st}">${st}</button>`)}
        <span class="sep"></span>
        ${terminal.filter((t) => s.stages.includes(t)).map((t) => html`<button data-stage="${t}" class="term ${t === c.stage ? 'current' : ''} ${t === 'Passed' ? 'passed' : 'closed'}">${t}</button>`)}
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
      if (await moveStage(c, b.dataset.stage, { onUndo: () => reload() })) reload();
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
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = String(html`
    ${c.prior_looks && c.prior_looks.length ? priorLooksBanner(c.prior_looks) : ''}
    <div class="grid grid-dash">
      <div>
        ${c.pass_reason ? html`<div class="record" style="margin-bottom:40px">
          <span class="eyebrow">Decision record</span>
          <h2>Passed: ${c.pass_reason}</h2>
          ${c.pass_notes ? html`<p class="prose t2">${c.pass_notes}</p>` : ''}
          <div class="meta-line">${c.revisit_date ? html`<span>Revisit ${fmtDate(c.revisit_date)}</span>` : ''}${c.deal_lead ? html`<span>Lead ${c.deal_lead}</span>` : ''}</div>
        </div>` : ''}
        <div class="section">
          <div class="section-head"><h2>About</h2></div>
          <p class="prose">${c.description || raw('<span class="muted">No description yet. Edit the company or apply facts from a CIM.</span>')}</p>
          ${tags.length ? html`<div class="chips">${tags.map((t) => html`<span class="chip">${t}</span>`)}</div>` : ''}
        </div>
        <div class="section">
          <div class="section-head"><h2>Key facts</h2>${kf.applied_at ? html`<span class="aside">from CIM, ${ago(kf.applied_at)}</span>` : ''}</div>
          ${facts.length ? html`<div class="facts">${facts.map((f) => html`
            <div class="fact" title="${f.snippet || ''}"><small class="muted"><span>${f.label}</span>${f.page ? html`<span>p. ${f.page}</span>` : ''}</small><b>${f.display}</b></div>`)}</div>`
            : html`<div class="panel empty">${ic('scan')}<p style="margin:0">Upload a CIM in <a class="link" href="#/company/${c.id}/docs">CIM &amp; documents</a> and key facts are found for you.</p></div>`}
        </div>
        ${kf.series && kf.series.revenue ? html`<div class="section"><div class="section-head"><h2>Financial profile</h2><span class="aside">${kf.currency || c.currency} millions</span></div><div id="fin"></div></div>` : ''}
        ${(kf.highlights || []).length || (kf.risks || []).length ? html`
          <div class="grid grid-2 section">
            <div><div class="section-head"><h2>Investment highlights</h2></div>${(kf.highlights || []).length ? html`<ul class="bullets">${kf.highlights.map((h) => html`<li>${h.text}</li>`)}</ul>` : html`<p class="muted">None recorded.</p>`}</div>
            <div><div class="section-head"><h2>Risks and open questions</h2></div>${(kf.risks || []).length ? html`<ul class="bullets">${kf.risks.map((h) => html`<li>${h.text}</li>`)}</ul>` : html`<p class="muted">None recorded.</p>`}</div>
          </div>` : ''}
        ${kf.summary ? html`<div class="section"><div class="section-head"><h2>Claude's summary</h2></div><p class="prose t2">${kf.summary}</p></div>` : ''}
      </div>
      <div>
        <div class="panel panel-pad">
          <div class="row" style="gap:16px;margin-bottom:16px">${ring(c.knowledge.score, 60)}
            <div><h2>Deal memory</h2><p class="muted" style="margin:3px 0 0;font-size:12.5px">What a successor would inherit if ${c.deal_lead || 'the team'} moved on tomorrow.</p></div></div>
          <ul class="checklist">${c.knowledge.checks.map((k) => html`<li class="${k.done ? '' : 'off'}"><span class="ck ${k.done ? 'on' : 'off'}">${k.done ? ic('check') : ''}</span>${k.label}</li>`)}</ul>
        </div>
        <div class="section">
          <div class="section-head"><h2>Deal details</h2></div>
          <dl class="kv">
            <dt>Next step</dt><dd>${c.next_step ? html`${c.next_step}${c.next_step_date ? html` <span class="${c.next_step_date < today ? 'overdue' : 'muted'}">· ${fmtDate(c.next_step_date)}</span>` : ''}` : html`<span class="muted">None recorded</span>`}</dd>
            <dt>Deal lead</dt><dd>${c.deal_lead ? html`<a class="link" href="#/team/${encodeURIComponent(c.deal_lead)}">${c.deal_lead}</a>` : html`<span class="overdue">Unassigned</span>`}</dd>
            ${c.deal_team ? html`<dt>Deal team</dt><dd>${c.deal_team}</dd>` : ''}
            ${c.nda_signed_date ? html`<dt>NDA</dt><dd>Signed ${fmtDate(c.nda_signed_date)}${c.nda_expiry_date ? html`<br><span class="${c.nda_expiry_date < today ? 'overdue' : 'muted'}">Confidentiality ends ${fmtDate(c.nda_expiry_date)}</span>` : ''}</dd>` : ''}
            ${c.advisor ? html`<dt>Advisor</dt><dd>${c.advisor}</dd>` : ''}
            ${c.source ? html`<dt>Source</dt><dd>${c.source}</dd>` : ''}
            ${c.ownership ? html`<dt>Ownership</dt><dd>${c.ownership}</dd>` : ''}
            ${c.founded_year ? html`<dt>Founded</dt><dd>${c.founded_year}</dd>` : ''}
            ${c.website ? html`<dt>Website</dt><dd><a class="link" href="${/^https?:/.test(c.website) ? c.website : 'https://' + c.website}" target="_blank" rel="noopener">${c.website.replace(/^https?:\/\//, '')}</a></dd>` : ''}
            ${c.ev_revenue != null ? html`<dt>EV / Revenue</dt><dd class="num">${c.ev_revenue.toFixed(2)}x</dd>` : ''}
            <dt>Added</dt><dd>${fmtDateTime(c.created_at)}</dd>
            <dt>Updated</dt><dd>${ago(c.updated_at)}</dd>
          </dl>
        </div>
        <div class="section">
          <div class="section-head"><h2>Stage history</h2></div>
          <div class="timeline">${[...c.stage_history].reverse().map((h, i, arr) => {
            const next = i > 0 ? arr[i - 1].changed_at : null;
            const days = Math.max(0, Math.round(((next ? new Date(next) : new Date()) - new Date(h.changed_at)) / 86400000));
            return html`<div class="tl-item" style="--c:${i === 0 ? 'var(--ink)' : 'var(--ink-3)'}"><div class="what">${h.to_stage} <span class="muted">· ${days} day${days === 1 ? '' : 's'}${i === 0 ? ' so far' : ''}</span></div><div class="when">${fmtDate(h.changed_at)}</div></div>`;
          })}</div>
        </div>
        <div class="section">
          <div class="section-head"><h2>Recent meetings</h2><a class="aside link" href="#/company/${c.id}/meetings">All</a></div>
          ${c.meetings.length ? html`<div class="list">${c.meetings.slice(0, 4).map((m) => html`
            <div class="list-item" data-m="${m.id}">${dateBlock(m.starts_at)}<span class="grow"><span class="title">${m.title}</span><span class="meta">${m.meeting_type || ''} · ${ago(m.starts_at)}</span></span></div>`)}</div>` : html`<p class="muted">No meetings yet.</p>`}
        </div>
        <div class="section"><button class="btn ghost danger" id="del">${ic('trash')}Delete company</button></div>
      </div>
    </div>`);
  renderSeriesChart($('#fin', el), kf.series, kf.currency || c.currency);
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (m) meetingView(+m.dataset.m, { onChange: () => reload() });
  });
  $('#del', el).addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete ${c.name}? Its documents, models and history are removed. Meetings and contacts are kept.`))) return;
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
      <section>
        <div class="section-head"><h2>Documents</h2><button class="btn sm" id="up">${ic('upload')}Upload</button></div>
        <div class="doc-list">${docs.length ? docs.map((d) => docRow(d, d.analysis && d.analysis.facts ? html`<div class="outputs"><span class="out">${d.analysis.facts.length} facts found</span>${d.analysis.ai ? html`<span class="out"><span class="badge-src claude">Claude</span> read it</span>` : ''}${(d.analysis.stats || {}).pages ? html`<span class="out">${d.analysis.stats.pages} pages</span>` : ''}</div>` : '')) : html`<div class="dropzone" id="drop-empty">${ic('upload')}<b>Drop a CIM here</b><br>Key facts are found with page references, for you to review.</div>`}</div>
      </section>
      <aside class="aside-notes">
        <h3>How fact detection works</h3>
        <p>The CIM is read on this computer. Revenue, EBITDA, margins, growth, recurring revenue, retention, customer concentration, headcount, HQ, founding year, CEO, ownership, advisor, deadlines and financial tables are picked out.</p>
        <p>Every fact shows the sentence and page it came from, with a confidence score. Nothing is applied until you choose it.</p>
        <p>${store.meta.ai_enabled ? html`Claude is enabled. Use “Analyze with Claude” in the review window for highlights, risks and a summary.` : html`Add an Anthropic API key in <a class="link" href="#/settings">Settings</a> to let Claude read CIMs too, including scanned PDFs.`}</p>
      </aside>
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
      <section>
        <div class="section-head"><h2>Model versions</h2><button class="btn sm" id="up">${ic('upload')}Upload new version</button></div>
        <div class="doc-list">
          ${models.length ? models.map((d, i) => {
            const a = d.analysis || {};
            const nextOlder = models[i + 1];
            const olderOut = new Map(((nextOlder && nextOlder.analysis && nextOlder.analysis.outputs) || []).map((o) => [o.key, o]));
            return docRow(d, html`
              <div class="row" style="margin-top:4px;gap:6px"><span class="version">v${d.version}</span>${i === 0 ? html`<span class="muted" style="font-size:12px">Latest</span>` : ''}<button class="btn sm ghost" data-label="${d.id}" style="padding:2px 6px">${ic('edit')}${d.label ? 'Rename' : 'Add label'}</button></div>
              ${a.outputs && a.outputs.length ? html`<div class="outputs">${a.outputs.map((o) => {
                const old = olderOut.get(o.key);
                const delta = old && typeof o.value === 'number' && typeof old.value === 'number' ? o.value - old.value : null;
                return html`<span class="out" title="${o.sheet}!row ${o.row} · “${o.cell_label}”">${o.label} <b>${o.display}</b>${delta ? html` <span class="delta" title="vs v${nextOlder.version}: ${old.display}">${ic(delta > 0 ? 'arrowUp' : 'arrowDown', 'sm')}</span>` : ''}</span>`;
              })}</div>` : a.note ? html`<div class="muted" style="font-size:12px;margin-top:4px">${a.note}</div>` : ''}
              ${a.sheets ? html`<div class="muted" style="font-size:12px;margin-top:4px">Sheets: ${a.sheets.map((s) => s.name).join(', ')}</div>` : ''}`);
          }) : html`<div class="dropzone" id="drop-empty">${ic('upload')}<b>Drop your LBO or operating model</b><br>.xlsx, .xlsm, .xls or .csv. Each upload becomes a new, time-stamped version.</div>`}
        </div>
      </section>
      <div class="stack" style="gap:36px">
        ${latest && latest.analysis && latest.analysis.outputs && latest.analysis.outputs.length ? html`
          <section><div class="section-head"><h2>Returns snapshot</h2><span class="version">v${latest.version}</span></div>
            <div class="facts">${latest.analysis.outputs.map((o) => {
              const p = prevOut.get(o.key);
              return html`<div class="fact"><small class="muted"><span>${o.label}</span>${p ? html`<span>v${prev.version}: ${p.display}</span>` : ''}</small><b>${o.display}</b></div>`;
            })}</div></section>` : ''}
        <aside class="aside-notes"><h3>How outputs are read</h3>
          <p>The workbook is scanned for labels such as IRR, MOIC, Entry EV, entry and exit multiples, leverage and equity, and the first number to the right is taken.</p>
          <p>Save the workbook in Excel before uploading so calculated values are stored in the file.</p></aside>
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
    <div class="section-head"><h2>${c.meetings.length} meeting${c.meetings.length === 1 ? '' : 's'}</h2><button class="btn sm" id="add">${ic('plus')}Log meeting</button></div>
    ${c.meetings.length ? html`<div class="stagger">${c.meetings.map((m, i) => html`
      <div class="m-card" data-m="${m.id}" style="--i:${i}">
        ${dateBlock(m.starts_at)}
        <div class="grow">
          <div class="title">${m.title}</div>
          <div class="meta-line"><span>${new Date(m.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span><span>${m.meeting_type || 'Meeting'}</span>${m.attendees.length ? html`<span>${m.attendees.map((a) => a.name).join(', ')}</span>` : ''}${m.sentiment ? html`<span>${sentimentChip(m.sentiment)}</span>` : ''}</div>
          ${m.takeaways || m.notes ? html`<div class="excerpt">${m.takeaways || m.notes}</div>` : ''}
        </div>
      </div>`)}</div>` : html`<div class="empty">${ic('meetings')}<h3>No meetings yet</h3><p>Log management presentations, banker calls, expert calls and site visits.</p></div>`}`);
  $('#add', el).addEventListener('click', async () => { if (await meetingForm(null, { companyId: c.id })) reload('meetings'); });
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (m) meetingView(+m.dataset.m, { onChange: () => reload('meetings') });
  });
}

// ------------------------------------------------------------------ people
async function peopleTab(el, c, reload) {
  el.innerHTML = String(html`
    <div class="grid grid-2" style="gap:40px">
      <section>
        <div class="section-head"><h2>People on this deal</h2>
          <div class="btn-row"><button class="btn sm ghost" id="link">${ic('link')}Link existing</button><button class="btn sm" id="add">${ic('userPlus')}New contact</button></div></div>
        <div>${c.contacts.length ? html`<div class="list">${c.contacts.map((p) => html`
          <div class="list-item" style="cursor:pointer" data-p="${p.id}">
            ${avatar(p)}
            <span class="grow"><span class="title">${p.name}</span><span class="meta">${[p.title, p.organization, p.deal_role || (p.is_employee ? 'Management' : '')].filter(Boolean).join(' · ')}</span></span>
            ${strength(p.strength)}
            <button class="icon-btn" data-unlink="${p.id}" title="Remove from deal">${ic('close')}</button>
          </div>`)}</div>` : html`<p class="muted">Add the management, bankers, experts and co-investors involved in this deal.</p>`}</div>
      </section>
      <section>
        <div class="section-head"><h2>Relationship map</h2><a class="btn sm ghost" href="#/network">Full network ${ic('arrowRight')}</a></div>
        <div class="graph-wrap small" id="ego"></div>
      </section>
    </div>`);
  $('#add', el).addEventListener('click', async () => { if (await contactForm(null, { companyId: c.id })) reload('people'); });
  $('#link', el).addEventListener('click', async () => {
    const all = await api.get('/api/contacts');
    const avail = all.filter((p) => !c.contacts.some((x) => x.id === p.id));
    modal({
      title: 'Link existing contact', size: 'narrow',
      body: html`<form class="stack" id="lk"><div class="field"><label>Contact</label><select name="contact_id">${options(avail.map((p) => ({ value: p.id, label: `${p.name}${p.organization ? ', ' + p.organization : ''}` })), '', { blank: 'Choose…' })}</select></div>
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
  el.innerHTML = String(html`<div style="max-width:720px">
    <div class="section-head"><h2>Everything that happened on ${c.name}</h2><span class="aside">${c.activity.length} entries</span></div>
    <div class="timeline">${c.activity.map((a) => html`
      <div class="tl-item" style="--c:${a.action === 'stage' ? 'var(--ink)' : 'var(--ink-3)'}">
        <div class="what">${a.action === 'stage' ? html`<b>Stage</b> ` : ''}${a.summary.replace(' → ', ' to ')}</div>
        <div class="when">${fmtDateTime(a.created_at)} · ${ago(a.created_at)}</div>
      </div>`)}</div></div>`);
}

// ------------------------------------------------------------------ one-pager
function renderOnePager(view, c) {
  setCrumbs([{ label: 'Companies', href: '#/companies' }, { label: c.name, href: `#/company/${c.id}` }, { label: 'One-pager' }]);
  const kf = c.key_facts || {};
  const facts = (kf.facts || []).filter((f) => !['name', 'codename', 'description', 'sector', 'region', 'country', 'hq', 'revenue', 'ebitda', 'ebitda_margin_calc', 'website'].includes(f.key)).slice(0, 10);
  const takeaways = c.meetings.filter((m) => m.takeaways || m.notes).slice(0, 3);
  const firm = store.meta.settings.firm_name;
  view.innerHTML = String(html`
    <div class="print-bar">
      <span class="muted" style="font-size:13px">Generated from everything captured on this deal.</span>
      <div class="btn-row"><a class="btn ghost" href="#/company/${c.id}">${ic('back')}Back to ${c.name}</a><button class="btn primary" id="print">${ic('printer')}Save as PDF</button></div>
    </div>
    <div class="card onepager" style="--c:${c.color}">
      <div class="op-head">
        ${logo(c, 'lg')}
        <div style="flex:1;min-width:0">
          <div class="eyebrow">${c.codename || 'Company profile'}</div>
          <h1>${c.name}</h1>
          <div class="t2">${[c.sector, [c.hq_city, c.country].filter(Boolean).join(', '), c.deal_type].filter(Boolean).join(' · ')}</div>
        </div>
        <div style="text-align:right"><span class="chip stage">${c.stage}</span><div class="muted" style="font-size:12px;margin-top:6px">${fmtDate(new Date().toISOString())}</div></div>
      </div>
      <div class="op-metrics">
        <div><small>Enterprise value</small><b>${money(c.ev, c.currency)}</b></div>
        <div><small>Revenue</small><b>${money(c.revenue, c.currency)}</b></div>
        <div><small>EBITDA · margin</small><b>${money(c.ebitda, c.currency)}</b> <span class="muted">${pct(c.ebitda_margin)}</span></div>
        <div><small>EV / EBITDA</small><b>${mult(c.ev_ebitda)}</b></div>
      </div>
      <div class="op-grid">
        <div>
          <h3>Business overview</h3>
          <p>${c.description || '—'}</p>
          ${(kf.highlights || []).length ? html`<h3>Investment highlights</h3><ul class="bullets">${kf.highlights.slice(0, 6).map((h) => html`<li>${h.text}</li>`)}</ul>` : ''}
          ${(kf.risks || []).length ? html`<h3>Key risks & diligence questions</h3><ul class="bullets">${kf.risks.slice(0, 5).map((h) => html`<li>${h.text}</li>`)}</ul>` : ''}
          ${takeaways.length ? html`<h3>What we've learned</h3>${takeaways.map((m) => html`<p><b>${fmtDate(m.starts_at)} · ${m.meeting_type || 'Meeting'}:</b> ${m.takeaways || m.notes}</p>`)}` : ''}
          ${c.pass_reason ? html`<h3>Decision record</h3><p><b>Passed — ${c.pass_reason}.</b> ${c.pass_notes || ''}${c.revisit_date ? html` <span class="muted">Revisit ${fmtDate(c.revisit_date)}.</span>` : ''}</p>` : ''}
        </div>
        <div>
          ${kf.series && kf.series.revenue ? html`<h3>Financial profile (${kf.currency || c.currency}m)</h3><div id="op-fin"></div>` : ''}
          <h3>Deal snapshot</h3>
          <dl class="kv">
            <dt>Lead / team</dt><dd>${[c.deal_lead, c.deal_team].filter(Boolean).join(', ') || '—'}</dd>
            <dt>Advisor</dt><dd>${c.advisor || '—'}</dd>
            <dt>Source</dt><dd>${c.source || '—'}</dd>
            <dt>Ownership</dt><dd>${c.ownership || '—'}</dd>
            <dt>Founded</dt><dd>${c.founded_year || '—'}</dd>
            <dt>Employees</dt><dd>${num(c.employees)}</dd>
            <dt>Next step</dt><dd>${c.next_step ? html`${c.next_step}${c.next_step_date ? ` · ${fmtDate(c.next_step_date)}` : ''}` : '—'}</dd>
            <dt>NDA ends</dt><dd>${c.nda_expiry_date ? fmtDate(c.nda_expiry_date) : '—'}</dd>
          </dl>
          ${facts.length ? html`<h3>Key facts</h3><dl class="kv">${facts.map((f) => html`<dt>${f.label}</dt><dd>${f.display}${f.page ? html` <span class="muted">p.${f.page}</span>` : ''}</dd>`)}</dl>` : ''}
          ${c.contacts.length ? html`<h3>Key people</h3><dl class="kv">${c.contacts.slice(0, 6).map((p) => html`<dt>${p.name}</dt><dd>${[p.title, p.organization].filter(Boolean).join(', ')}${p.owner ? html` <span class="muted">· ${p.owner}</span>` : ''}</dd>`)}</dl>` : ''}
        </div>
      </div>
      <div class="op-foot"><span>${firm ? `${firm} · ` : ''}Confidential — prepared with Deal Tracker</span><span>Deal memory ${c.knowledge.score}% captured</span></div>
    </div>`);
  renderSeriesChart($('#op-fin', view), kf.series, kf.currency || c.currency);
  $('#print', view).addEventListener('click', () => window.print());
}
