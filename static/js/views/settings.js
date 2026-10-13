import { api, store, loadMeta } from '../api.js';
import { html, $, toast, errToast, withBusy, options, ic } from '../ui.js';
import { applyBranding, setCrumbs } from '../app.js';
import { hasDemo, clearDemo, demoSummary } from '../forms.js';

const LISTS = [
  ['team_members', 'Team members', 'Deal leads and relationship owners. Used for handover packs.'],
  ['stages', 'Pipeline stages', 'In order. "Closed" and "Passed" are treated as finished deals.'],
  ['pass_reasons', 'Pass reasons', 'Asked for whenever a deal is passed on.'],
  ['sectors', 'Sectors', ''],
  ['deal_types', 'Deal types', ''],
  ['meeting_types', 'Meeting types', ''],
  ['contact_types', 'Contact types', 'The first eight get their own colour in the network diagram.'],
];

export async function renderSettings(view) {
  const m = store.meta;
  const s = m.settings;
  setCrumbs([{ label: 'Settings' }]);
  const group = (title, desc, body) => html`<section class="set-row"><div class="set-label"><h2>${title}</h2>${desc ? html`<p>${desc}</p>` : ''}</div><div class="set-body">${body}</div></section>`;
  view.innerHTML = String(html`
    <div class="page-head"><div><h1>Settings</h1><p>Everything here is stored on this computer.</p></div>
      <button class="btn primary" id="save">Save changes</button></div>
    <div class="settings">
      ${group('Workspace', 'Your firm name appears in the sidebar and on one-pagers.', html`
        <div class="field"><label>Firm or fund name</label><input type="text" id="firm_name" value="${s.firm_name || ''}"></div>
        <div class="form">
          <div class="field"><label>Base currency</label><select id="base_currency">${options(['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD'], s.base_currency)}</select></div>
          <div class="field"><label>Relationship goes cold after</label><div class="input-group suffix"><input type="number" id="cold_days" min="7" value="${s.cold_days || 60}"><span class="addon">days</span></div></div>
        </div>`)}
      ${group('Claude for CIMs', 'Optional. The built-in detector works offline; Claude adds scanned PDFs, complex tables, and drafted highlights and risks.', html`
        ${m.ai_from_env ? html`<p class="set-status">${ic('checkCircle')}Using <code>ANTHROPIC_API_KEY</code> from the environment</p>` : html`
          <div class="field"><label>Anthropic API key</label><input type="password" id="api_key" placeholder="${m.has_stored_api_key ? 'Saved. Type to replace' : 'sk-ant-…'}" autocomplete="off">
          <span class="hint">Kept in the local database. Documents leave this computer only when you choose “Analyze with Claude”.</span></div>
          ${m.has_stored_api_key ? html`<button class="btn sm ghost danger" id="clear-key" style="align-self:flex-start">Remove saved key</button>` : ''}`}
        <p class="set-status ${m.ai_enabled ? 'on' : ''}">${ic(m.ai_enabled ? 'checkCircle' : 'circle')}${m.ai_enabled ? 'Enabled' : 'Not configured'}</p>`)}
      ${group('Data & backup', 'Everything lives in the data folder. Copy it to back up or move to another computer.', html`
        <div class="field"><label>Data folder</label><code class="path" title="${m.data_dir}">${m.data_dir}</code></div>
        ${hasDemo() ? html`<div class="set-inline"><span><b>Sample data</b><small class="muted">${demoSummary()}</small></span><button class="btn sm" id="clear-demo">${ic('trash')}Clear sample data</button></div>` : ''}
        <div class="btn-row">
          <a class="btn" href="/api/export/backup.json">${ic('download')}JSON backup</a>
          <a class="btn" href="/api/export/companies.csv">${ic('download')}Companies CSV</a>
        </div>`)}
      ${LISTS.map(([key, label, hint]) => group(label, hint || 'One per line.', html`
        <textarea id="list-${key}" spellcheck="false" rows="${Math.min(10, Math.max(4, (s[key] || []).length + 1))}">${(s[key] || []).join('\n')}</textarea>`))}
    </div>`);

  $('#save', view).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const body = { firm_name: $('#firm_name', view).value.trim(), base_currency: $('#base_currency', view).value, cold_days: +$('#cold_days', view).value || 60 };
    for (const [key] of LISTS) {
      const vals = $(`#list-${key}`, view).value.split('\n').map((x) => x.trim()).filter(Boolean);
      if (!vals.length && key !== 'team_members') return toast(`${key.replace('_', ' ')} cannot be empty`, 'err');
      body[key] = [...new Set(vals)];
    }
    const k = $('#api_key', view);
    if (k && k.value.trim()) body.anthropic_api_key = k.value.trim();
    try {
      await api.put('/api/settings', body);
      await loadMeta(); applyBranding();
      toast('Settings saved', '', { icon: 'check' }); renderSettings(view);
    } catch (err) { errToast(err); }
  }));
  $('#clear-demo', view)?.addEventListener('click', async (e) => { if (await withBusy(e.currentTarget, () => clearDemo())) renderSettings(view); });
  const clr = $('#clear-key', view);
  clr && clr.addEventListener('click', async () => {
    await api.put('/api/settings', { anthropic_api_key: '' });
    await loadMeta(); toast('API key removed'); renderSettings(view);
  });
}
