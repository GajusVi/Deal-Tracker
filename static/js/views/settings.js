import { api, store, loadMeta } from '../api.js';
import { html, $, toast, errToast, withBusy, options, ICONS } from '../ui.js';
import { applyBranding } from '../app.js';

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
  view.innerHTML = String(html`
    <div class="page-head"><div><h1>Settings</h1><p>Personalise your workspace. Everything is stored locally in <code>${m.data_dir}</code>.</p></div>
      <button class="btn primary" id="save">Save settings</button></div>
    <div class="settings-grid">
      <div class="card card-pad stack">
        <h2>Workspace</h2>
        <div class="field"><label>Firm / fund name</label><input type="text" id="firm_name" value="${s.firm_name || ''}"></div>
        <div class="field"><label>Base currency</label><select id="base_currency">${options(['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD'], s.base_currency)}</select></div>
        <div class="field"><label>Flag strong relationships as going cold after (days)</label><input type="number" id="cold_days" min="7" value="${s.cold_days || 60}"></div>
      </div>
      <div class="card card-pad stack">
        <h2>${ICONS.spark} Claude for CIM analysis <small class="muted">(optional)</small></h2>
        <p class="t2" style="margin:0">The built-in fact detector works offline. Add an Anthropic API key to also let Claude read CIMs — useful for scanned PDFs, complex tables, and to draft highlights, risks and a summary. Documents are sent to the Anthropic API only when you click “Analyze with Claude”.</p>
        ${m.ai_from_env ? html`<p class="chip pos">✓ Using ANTHROPIC_API_KEY from the environment</p>` : html`
          <div class="field"><label>Anthropic API key</label><input type="password" id="api_key" placeholder="${m.has_stored_api_key ? '•••••••• saved — type to replace' : 'sk-ant-…'}" autocomplete="off">
          <span class="hint">Stored in the local database on this computer.</span></div>
          ${m.has_stored_api_key ? html`<button class="btn sm danger" id="clear-key" style="align-self:flex-start">Remove saved key</button>` : ''}`}
        <p class="muted" style="margin:0;font-size:12px">Status: ${m.ai_enabled ? 'enabled' : 'not configured'}</p>
      </div>
      <div class="card card-pad stack">
        <h2>Data & backup</h2>
        <p class="t2" style="margin:0">All companies, notes, uploads and settings live in the data folder. Copy that folder to back up or move to another computer.</p>
        <div class="btn-row">
          <a class="btn" href="/api/export/backup.json">${ICONS.download} Download JSON backup</a>
          <a class="btn" href="/api/export/companies.csv">${ICONS.download} Companies CSV</a>
        </div>
      </div>
      ${LISTS.map(([key, label, hint]) => html`
        <div class="card card-pad stack">
          <h2>${label}</h2>
          ${hint ? html`<p class="muted" style="margin:0;font-size:12px">${hint}</p>` : ''}
          <textarea id="list-${key}" spellcheck="false">${(s[key] || []).join('\n')}</textarea>
          <span class="muted" style="font-size:12px">One per line.</span>
        </div>`)}
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
      toast('Settings saved'); renderSettings(view);
    } catch (err) { errToast(err); }
  }));
  const clr = $('#clear-key', view);
  clr && clr.addEventListener('click', async () => {
    await api.put('/api/settings', { anthropic_api_key: '' });
    await loadMeta(); toast('API key removed'); renderSettings(view);
  });
}
