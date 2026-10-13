// Create/edit dialogs shared across views: companies, contacts, meetings, CIM fact review.
import { api, store, loadMeta } from './api.js';
import {
  html, raw, $, $$, modal, formValues, options, toast, errToast, withBusy, dropzone, dominantColor,
  BRAND_SWATCHES, logo, money, ICONS, fmtDateTime, sentimentChip, avatar, strength, confirmDialog, toLocalInput,
  initials, esc, debounce, fmtDate, ago, ic, tkr,
} from './ui.js';
import { columns } from './charts.js';

const S = () => store.meta.settings;
const countryList = () => store.meta.countries.map((c) => c.name);

// ======================================================================= company
export function companyForm(company = null, { onSaved, prefill = {} } = {}) {
  const c = { color: BRAND_SWATCHES[Math.floor(Math.random() * 8)], stage: S().stages[0], priority: 'Medium', currency: S().base_currency, ...prefill, ...(company || {}) };
  const isNew = !company;
  let logoFile = null;
  const body = html`
    <form class="form" id="co-form" autocomplete="off">
      <div class="field full">
        <div class="logo-upload">
          <span id="logo-prev">${logo(c, 'lg')}</span>
          <div class="stack" style="gap:8px;flex:1">
            <div class="btn-row">
              <button type="button" class="btn sm" id="logo-pick">${ICONS.upload} ${c.logo_url ? 'Change logo' : 'Upload logo'}</button>
              <button type="button" class="btn sm ghost" id="logo-color" ${c.logo_url ? '' : 'hidden'}>Use logo colour</button>
              ${c.logo_url ? html`<button type="button" class="btn sm ghost danger" id="logo-remove">Remove</button>` : ''}
            </div>
            <div class="swatches" id="swatches">
              ${BRAND_SWATCHES.map((s) => html`<button type="button" class="swatch ${s === c.color ? 'on' : ''}" style="background:${s}" data-c="${s}" aria-label="${s}"></button>`)}
              <input type="color" name="color" value="${c.color}" title="Custom brand colour">
            </div>
          </div>
        </div>
      </div>
      <div class="full" id="prior" hidden></div>
      <div class="field"><label>Company name *</label><input type="text" name="name" required value="${c.name || ''}" placeholder="e.g. Northwind Analytics"></div>
      <div class="field"><label>Project codename</label><input type="text" name="codename" value="${c.codename || ''}" placeholder="e.g. Project Atlas"></div>
      <div class="field"><label>Stage</label><select name="stage">${options(S().stages, c.stage)}</select></div>
      <div class="field"><label>Sector</label><select name="sector">${options(S().sectors, c.sector, { blank: '—' })}</select></div>
      <div class="field"><label>HQ country</label><input type="text" name="country" list="dl-countries" value="${c.country || ''}" placeholder="Start typing…"></div>
      <div class="field"><label>Priority</label><select name="priority">${options(['High', 'Medium', 'Low'], c.priority)}</select></div>
      <div class="field"><label>Enterprise value (m)</label><div class="input-group"><select name="currency">${options(['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD'], c.currency)}</select><input type="number" step="any" name="ev" value="${c.ev ?? ''}" placeholder="e.g. 250"></div></div>
      <div class="field"><label>Deal type</label><select name="deal_type">${options(S().deal_types, c.deal_type, { blank: '—' })}</select></div>
      <div class="field"><label>Deal lead</label><input type="text" name="deal_lead" list="dl-team" value="${c.deal_lead || ''}" placeholder="Who owns this deal?"></div>
      <div class="field"><label>Deal team</label><input type="text" name="deal_team" value="${c.deal_team || ''}" placeholder="Others on the deal, comma separated"></div>
      <details class="more" ${isNew ? '' : 'open'}>
        <summary>More details — financials, location, process</summary>
        <div class="form">
          <div class="field"><label>Revenue (m)</label><input type="number" step="any" name="revenue" value="${c.revenue ?? ''}"></div>
          <div class="field"><label>EBITDA (m)</label><input type="number" step="any" name="ebitda" value="${c.ebitda ?? ''}"></div>
          <div class="field"><label>HQ city</label><input type="text" name="hq_city" value="${c.hq_city || ''}"></div>
          <div class="field"><label>Region</label><select name="region">${options(store.meta.regions, c.region, { blank: 'Auto from country' })}</select></div>
          <div class="field"><label>Employees</label><input type="number" name="employees" value="${c.employees ?? ''}"></div>
          <div class="field"><label>Founded</label><input type="number" name="founded_year" value="${c.founded_year ?? ''}" placeholder="YYYY"></div>
          <div class="field"><label>Website</label><input type="text" name="website" value="${c.website || ''}" placeholder="www.example.com"></div>
          <div class="field"><label>Ownership</label><input type="text" name="ownership" value="${c.ownership || ''}" placeholder="Founder-owned, sponsor…"></div>
          <div class="field"><label>Sell-side advisor</label><input type="text" name="advisor" value="${c.advisor || ''}"></div>
          <div class="field"><label>Source</label><input type="text" name="source" list="dl-sources" value="${c.source || ''}"></div>
          <div class="field"><label>NDA signed</label><input type="date" name="nda_signed_date" value="${c.nda_signed_date || ''}"></div>
          <div class="field"><label>NDA confidentiality ends</label><input type="date" name="nda_expiry_date" value="${c.nda_expiry_date || ''}"><span class="hint">You'll be reminded before it lapses.</span></div>
          <div class="field"><label>Sub-sector</label><input type="text" name="subsector" value="${c.subsector || ''}"></div>
          <div class="field"><label>Next step</label><input type="text" name="next_step" value="${c.next_step || ''}" placeholder="e.g. Submit IOI"></div>
          <div class="field"><label>Next step date</label><input type="date" name="next_step_date" value="${c.next_step_date || ''}"></div>
          <div class="field full"><label>Tags</label><input type="text" name="tags" value="${c.tags || ''}" placeholder="comma separated, e.g. platform, founder-led"></div>
          <div class="field full"><label>Description</label><textarea name="description" rows="3">${c.description || ''}</textarea></div>
          <div class="field"><label>Status</label><select name="status">${options(['Active', 'On hold', 'Passed'], c.status || 'Active')}</select></div>
        </div>
      </details>
      <datalist id="dl-team">${(S().team_members || []).map((n) => html`<option value="${n}">`)}</datalist>
      <datalist id="dl-countries">${countryList().map((n) => html`<option value="${n}">`)}</datalist>
      <datalist id="dl-sources">${['Banker', 'Proprietary', 'Network referral', 'Conference', 'Inbound', 'Portfolio add-on'].map((n) => html`<option value="${n}">`)}</datalist>
    </form>`;
  return new Promise((resolve) => {
    modal({
      title: isNew ? 'Add company' : `Edit ${c.name}`, body,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="co-save">${isNew ? 'Add company' : 'Save changes'}</button>`,
      onClose: () => resolve(null),
      onMount(el, close) {
        const form = $('#co-form', el);
        const colorInput = $('input[name=color]', form);
        const checkPrior = async () => {
          const name = $('input[name=name]', form).value.trim();
          const box = $('#prior', el);
          if (name.length < 3) { box.hidden = true; return; }
          const hits = await api.get(`/api/companies/similar?name=${encodeURIComponent(name)}${c.id ? `&exclude=${c.id}` : ''}`).catch(() => []);
          box.hidden = !hits.length;
          box.innerHTML = String(priorLooksBanner(hits));
        };
        $('input[name=name]', form).addEventListener('input', debounce(checkPrior, 300));
        if (isNew && c.name) checkPrior();
        const prev = $('#logo-prev', el);
        const setColor = (col) => {
          colorInput.value = col;
          $$('.swatch', el).forEach((s) => s.classList.toggle('on', s.dataset.c === col));
          prev.querySelector('.logo').style.setProperty('--c', col);
        };
        $('#swatches', el).addEventListener('click', (e) => { const s = e.target.closest('.swatch'); if (s) setColor(s.dataset.c); });
        colorInput.addEventListener('input', () => setColor(colorInput.value));
        const pick = async () => {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'image/*,.svg';
          inp.onchange = async () => {
            const f = inp.files[0];
            if (!f) return;
            logoFile = f;
            const url = URL.createObjectURL(f);
            prev.innerHTML = String(logo({ ...c, color: colorInput.value, logo_url: url }, 'lg'));
            $('#logo-color', el).hidden = false;
            const dc = await dominantColor(url);
            if (dc) { setColor(dc); toast('Brand colour picked from logo'); }
          };
          inp.click();
        };
        $('#logo-pick', el).addEventListener('click', pick);
        prev.addEventListener('click', pick);
        $('#logo-color', el).addEventListener('click', async () => {
          const src = logoFile ? URL.createObjectURL(logoFile) : c.logo_url;
          const dc = await dominantColor(src);
          dc ? setColor(dc) : toast('Could not find a strong colour in the logo');
        });
        const rm = $('#logo-remove', el);
        rm && rm.addEventListener('click', async () => {
          await api.del(`/api/companies/${c.id}/logo`);
          c.logo_url = null; logoFile = null;
          prev.innerHTML = String(logo({ ...c, color: colorInput.value }, 'lg'));
          rm.remove();
          toast('Logo removed');
        });
        const save = (e) => withBusy($('#co-save', el), async () => {
          e && e.preventDefault();
          const v = formValues(form);
          if (!v.name.trim()) { toast('Company name is required', 'err'); return; }
          try {
            let saved = isNew ? await api.post('/api/companies', { ...v, ...(prefill._extra || {}) }) : await api.patch(`/api/companies/${c.id}`, v);
            if (logoFile) saved = await api.upload(`/api/companies/${saved.id}/logo`, logoFile);
            toast(isNew ? `${saved.name} added` : 'Saved');
            resolve(saved);
            close();
            onSaved && onSaved(saved);
            if (isNew) offerDemoCleanup();
          } catch (err) { errToast(err); }
        });
        $('#co-save', el).addEventListener('click', save);
        form.addEventListener('submit', save);
      },
    });
  });
}

// ======================================================================= contact
export function contactForm(contact = null, { companyId, role, onSaved, prefillName } = {}) {
  const c = contact || { strength: 3, name: prefillName || '' };
  const isNew = !contact;
  return new Promise(async (resolve) => {
    const companies = await api.get('/api/companies');
    modal({
      title: isNew ? 'New contact' : `Edit ${c.name}`,
      body: html`<form class="form" id="ct-form" autocomplete="off">
        <div class="field"><label>Name *</label><input type="text" name="name" value="${c.name || ''}" required></div>
        <div class="field"><label>Type</label><select name="contact_type">${options(S().contact_types, c.contact_type, { blank: '—' })}</select></div>
        <div class="field"><label>Title</label><input type="text" name="title" value="${c.title || ''}" placeholder="e.g. Managing Director"></div>
        <div class="field"><label>Organisation</label><input type="text" name="organization" value="${c.organization || ''}" placeholder="Firm / company"></div>
        <div class="field"><label>Works at (tracked company)</label><select name="company_id">${options(companies.map((x) => ({ value: x.id, label: x.name })), c.company_id, { blank: '— not a target company —' })}</select></div>
        <div class="field"><label>Relationship owner</label><input type="text" name="owner" list="dl-owner" value="${c.owner || ''}" placeholder="Who at the firm knows them best?"><datalist id="dl-owner">${(S().team_members || []).map((n) => html`<option value="${n}">`)}</datalist></div>
        <div class="field"><label>Relationship strength</label><select name="strength">${options([1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} — ${['Cold', 'Acquainted', 'Warm', 'Strong', 'Close'][n - 1]}` })), c.strength)}</select></div>
        <div class="field"><label>Email</label><input type="email" name="email" value="${c.email || ''}"></div>
        <div class="field"><label>Phone</label><input type="text" name="phone" value="${c.phone || ''}"></div>
        <div class="field"><label>LinkedIn</label><input type="text" name="linkedin" value="${c.linkedin || ''}" placeholder="https://linkedin.com/in/…"></div>
        <div class="field"><label>City</label><input type="text" name="city" value="${c.city || ''}"></div>
        ${isNew && companyId ? html`<div class="field full"><label>Role on this deal</label><input type="text" name="role" value="${role || ''}" placeholder="e.g. Sell-side banker, CFO, Expert"></div>` : ''}
        <div class="field full"><label>Notes</label><textarea name="notes" rows="3">${c.notes || ''}</textarea></div>
      </form>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="ct-save">${isNew ? 'Add contact' : 'Save'}</button>`,
      onClose: () => resolve(null),
      onMount(el, close) {
        const form = $('#ct-form', el);
        const save = (e) => withBusy($('#ct-save', el), async () => {
          e && e.preventDefault();
          const v = formValues(form);
          if (!v.name.trim()) return toast('Name is required', 'err');
          try {
            const body = { ...v };
            if (isNew && companyId) { body.link_company_id = companyId; body.role = v.role; }
            const saved = isNew ? await api.post('/api/contacts', body) : await api.patch(`/api/contacts/${c.id}`, v);
            toast(isNew ? 'Contact added' : 'Saved');
            resolve(saved); close();
            onSaved && onSaved(saved);
          } catch (err) { errToast(err); }
        });
        $('#ct-save', el).addEventListener('click', save);
        form.addEventListener('submit', save);
      },
    });
  });
}

export async function contactView(id, { onChange } = {}) {
  const c = await api.get(`/api/contacts/${id}`);
  const all = await api.get('/api/contacts');
  modal({
    title: c.name, size: 'wide',
    body: html`
      <div class="row" style="gap:14px;margin-bottom:16px">
        ${avatar(c)}
        <div style="flex:1;min-width:0"><b style="font-size:16px">${c.name}</b><div class="t2">${[c.title, c.organization || c.company_name].filter(Boolean).join(' · ')}</div></div>
        ${strength(c.strength)}
        <span class="chip">${c.contact_type || 'Contact'}</span>
      </div>
      <div class="grid grid-2">
        <div class="stack">
          <dl class="kv">
            <dt>Email</dt><dd>${c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : '—'}</dd>
            <dt>Phone</dt><dd>${c.phone || '—'}</dd>
            <dt>LinkedIn</dt><dd>${c.linkedin ? html`<a href="${/^https?:/.test(c.linkedin) ? c.linkedin : 'https://' + c.linkedin}" target="_blank" rel="noopener" class="link">Profile</a>` : '—'}</dd>
            <dt>Owner</dt><dd>${c.owner ? html`<a href="#/team/${encodeURIComponent(c.owner)}" data-close>${c.owner}</a>` : '—'}</dd>
            <dt>City</dt><dd>${c.city || '—'}</dd>
            <dt>Works at</dt><dd>${c.company_id ? html`<a href="#/company/${c.company_id}" data-close>${c.company_name}</a>${tkr(c.company_codename)}` : c.organization || '—'}</dd>
            <dt>Added</dt><dd>${fmtDateTime(c.created_at)}</dd>
          </dl>
          ${c.notes ? html`<div class="notes-view">${c.notes}</div>` : ''}
          <div>
            <h3 style="margin-bottom:8px">Deals involved</h3>
            ${c.deals.length ? html`<div class="list">${c.deals.map((d) => html`<a class="list-item" href="#/company/${d.id}" data-close><span class="dot" style="background:${d.color}"></span><span class="grow"><span class="title">${d.name}</span><span class="meta">${d.role || 'Involved'} · ${d.stage || ''}</span></span></a>`)}</div>` : html`<p class="muted">Not linked to any deal yet.</p>`}
          </div>
        </div>
        <div class="stack">
          <div>
            <h3 style="margin-bottom:8px">Relationships</h3>
            <div class="list" id="links">${c.links.length ? c.links.map((l) => html`<div class="list-item"><span class="grow"><span class="title">${l.dir === 'out' ? `${l.relation} → ${l.name}` : `${l.name} → ${l.relation}`}</span><span class="meta">${l.organization || ''}</span></span><button class="icon-btn" data-unlink="${l.id}" title="Remove">${ICONS.close}</button></div>`) : html`<p class="muted">No relationships mapped.</p>`}</div>
            <form class="row" id="link-form" style="margin-top:8px">
              <select name="to_contact_id" style="flex:1">${options(all.filter((x) => x.id !== c.id).map((x) => ({ value: x.id, label: `${x.name}${x.organization ? ' — ' + x.organization : ''}` })), '', { blank: 'Connect to…' })}</select>
              <input type="text" name="relation" list="dl-rel" placeholder="Relation" style="width:140px">
              <button class="btn sm">Add</button>
              <datalist id="dl-rel">${['Knows', 'Former colleague', 'Reports to', 'Manages', 'Introduced', 'Advisor to', 'Co-invested before', 'Board member with'].map((r) => html`<option value="${r}">`)}</datalist>
            </form>
          </div>
          <div>
            <h3 style="margin-bottom:8px">Meetings (${c.meetings.length})</h3>
            ${c.meetings.length ? html`<div class="list">${c.meetings.map((m) => html`<div class="list-item" style="cursor:pointer" data-meeting="${m.id}"><span class="grow"><span class="title">${m.title}</span><span class="meta">${fmtDateTime(m.starts_at)} · ${m.meeting_type || ''}${m.company_name ? ' · ' + m.company_name : ''}</span></span></div>`)}</div>` : html`<p class="muted">No meetings logged.</p>`}
          </div>
        </div>
      </div>`,
    foot: html`<button class="btn danger" id="ct-del">${ICONS.trash} Delete</button><span class="spacer"></span><button class="btn" data-close>Close</button><button class="btn primary" id="ct-edit">${ICONS.edit} Edit</button>`,
    onMount(el, close) {
      $('#ct-edit', el).addEventListener('click', async () => {
        close();
        const saved = await contactForm(c);
        if (saved) { onChange && onChange(); contactView(id, { onChange }); }
      });
      $('#ct-del', el).addEventListener('click', async () => {
        if (!(await confirmDialog(`Delete ${c.name}? Meeting attendance and relationships will be removed.`))) return;
        await api.del(`/api/contacts/${id}`);
        toast('Contact deleted'); close(); onChange && onChange();
      });
      $('#link-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = formValues(e.target);
        if (!v.to_contact_id) return toast('Pick a contact', 'err');
        try { await api.post(`/api/contacts/${id}/links`, v); close(); contactView(id, { onChange }); onChange && onChange(); } catch (err) { errToast(err); }
      });
      el.addEventListener('click', async (e) => {
        const u = e.target.closest('[data-unlink]');
        if (u) { await api.del(`/api/links/${u.dataset.unlink}`); close(); contactView(id, { onChange }); onChange && onChange(); }
        const m = e.target.closest('[data-meeting]');
        if (m) { close(); meetingView(+m.dataset.meeting, { onChange }); }
      });
    },
  });
}

// ======================================================================= meeting
function attendeePicker(el, contacts, selected) {
  const sel = new Map(selected.map((p) => [p.id, p]));
  el.innerHTML = '<div class="multi"><span class="tags"></span><input type="text" placeholder="Add attendee… (type to search or create)"><div class="multi-options" hidden></div></div>';
  const tags = $('.tags', el), input = $('input', el), opts = $('.multi-options', el);
  let active = 0, list = [];
  const renderTags = () => {
    tags.innerHTML = String(html`${[...sel.values()].map((p) => html`<span class="tag">${p.name}<button type="button" data-rm="${p.id}" aria-label="Remove">×</button></span>`)}`);
  };
  const renderOpts = () => {
    const q = input.value.trim().toLowerCase();
    list = contacts.filter((p) => !sel.has(p.id) && (!q || `${p.name} ${p.organization || ''}`.toLowerCase().includes(q))).slice(0, 8);
    const create = q && !contacts.some((p) => p.name.toLowerCase() === q);
    opts.innerHTML = String(html`${list.map((p, i) => html`<button type="button" data-add="${p.id}" class="${i === active ? 'active' : ''}">${p.name} <small>${p.organization || p.title || ''}</small></button>`)}${create ? html`<button type="button" data-create="1">+ Create contact “${input.value.trim()}”</button>` : ''}`);
    opts.hidden = !list.length && !create;
  };
  el.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { sel.delete(+rm.dataset.rm); renderTags(); renderOpts(); return; }
    const add = e.target.closest('[data-add]');
    if (add) { const p = contacts.find((x) => x.id === +add.dataset.add); sel.set(p.id, p); input.value = ''; renderTags(); renderOpts(); input.focus(); return; }
    if (e.target.closest('[data-create]')) {
      const saved = await contactForm(null, { prefillName: input.value.trim() });
      if (saved) { contacts.push(saved); sel.set(saved.id, saved); input.value = ''; renderTags(); renderOpts(); }
      return;
    }
    if (e.target.closest('.multi')) input.focus();
  });
  input.addEventListener('focus', renderOpts);
  input.addEventListener('input', () => { active = 0; renderOpts(); });
  input.addEventListener('blur', () => setTimeout(() => { opts.hidden = true; }, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, list.length - 1); renderOpts(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); renderOpts(); e.preventDefault(); }
    if (e.key === 'Enter') { e.preventDefault(); const p = list[active]; if (p) { sel.set(p.id, p); input.value = ''; renderTags(); renderOpts(); } }
    if (e.key === 'Backspace' && !input.value && sel.size) { sel.delete([...sel.keys()].pop()); renderTags(); renderOpts(); }
  });
  renderTags();
  return () => [...sel.keys()];
}

export function meetingForm(meeting = null, { companyId, onSaved } = {}) {
  const m = meeting || { company_id: companyId, starts_at: new Date().toISOString(), duration_min: 60, attendees: [] };
  const isNew = !meeting;
  return new Promise(async (resolve) => {
    const [companies, contacts] = await Promise.all([api.get('/api/companies'), api.get('/api/contacts')]);
    modal({
      title: isNew ? 'Log meeting' : 'Edit meeting', size: 'wide',
      body: html`<form class="form" id="mt-form" autocomplete="off">
        <div class="field full"><label>Title *</label><input type="text" name="title" value="${m.title || ''}" placeholder="e.g. Management presentation, Expert call on X market" required></div>
        <div class="field"><label>Type</label><select name="meeting_type">${options(S().meeting_types, m.meeting_type || S().meeting_types[0])}</select></div>
        <div class="field"><label>Company</label><select name="company_id">${options(companies.map((x) => ({ value: x.id, label: x.name })), m.company_id, { blank: '— Market / general (no company) —' })}</select></div>
        <div class="field"><label>Date & time *</label><input type="datetime-local" name="starts_at" value="${toLocalInput(m.starts_at)}" required></div>
        <div class="field"><label>Duration (min)</label><input type="number" name="duration_min" value="${m.duration_min ?? 60}" min="0" step="15"></div>
        <div class="field"><label>Location</label><input type="text" name="location" value="${m.location || ''}" placeholder="Office, Zoom, city…"></div>
        <div class="field"><label>Sentiment</label><select name="sentiment">${options(['Positive', 'Neutral', 'Negative'], m.sentiment, { blank: '—' })}</select></div>
        <div class="field full"><label>Attendees</label><div id="att"></div></div>
        <div class="field full"><label>Notes</label><textarea class="notes" name="notes" placeholder="Discussion notes… (bullets with - work nicely)">${m.notes || ''}</textarea></div>
        <div class="field"><label>Key takeaways</label><textarea name="takeaways" rows="3">${m.takeaways || ''}</textarea></div>
        <div class="field"><label>Next steps / follow-ups</label><textarea name="next_steps" rows="3">${m.next_steps || ''}</textarea></div>
        <div class="field full"><label>Tags</label><input type="text" name="tags" value="${m.tags || ''}" placeholder="comma separated"></div>
      </form>`,
      foot: html`<span class="muted" style="margin-right:auto;font-size:12px">${isNew ? '' : `Last edited ${fmtDateTime(m.updated_at)}`}</span><button class="btn" data-close>Cancel</button><button class="btn primary" id="mt-save">${isNew ? 'Save meeting' : 'Save changes'}</button>`,
      onClose: () => resolve(null),
      onMount(el, close) {
        const getAtt = attendeePicker($('#att', el), contacts, m.attendees || []);
        const form = $('#mt-form', el);
        const save = (e) => withBusy($('#mt-save', el), async () => {
          e && e.preventDefault();
          const v = formValues(form);
          if (!v.title.trim()) return toast('Title is required', 'err');
          if (!v.starts_at) return toast('Date is required', 'err');
          v.starts_at = new Date(v.starts_at).toISOString();
          v.attendee_ids = getAtt();
          try {
            const saved = isNew ? await api.post('/api/meetings', v) : await api.patch(`/api/meetings/${m.id}`, v);
            toast('Meeting saved'); resolve(saved); close();
            onSaved && onSaved(saved);
          } catch (err) { errToast(err); }
        });
        $('#mt-save', el).addEventListener('click', save);
        form.addEventListener('submit', save);
      },
    });
  });
}

export async function meetingView(id, { onChange } = {}) {
  const m = await api.get(`/api/meetings/${id}`);
  modal({
    title: m.title, size: 'wide',
    body: html`
      <div class="chips" style="margin-bottom:14px">
        <span class="chip">${m.meeting_type || 'Meeting'}</span>
        <span class="chip">${ic('calendarDays')}${fmtDateTime(m.starts_at)}${m.duration_min ? ` · ${m.duration_min} min` : ''}</span>
        ${m.location ? html`<span class="chip">${ic('pin')}${m.location}</span>` : ''}
        ${m.company_id ? html`<a class="chip" href="#/company/${m.company_id}" data-close><span class="dot" style="background:${m.company_color}"></span>${m.company_name}${tkr(m.company_codename)}</a>` : html`<span class="chip">Market / general</span>`}
        ${sentimentChip(m.sentiment)}
      </div>
      ${m.attendees.length ? html`<div class="chips" style="margin-bottom:14px">${m.attendees.map((p) => html`<span class="chip" style="cursor:pointer" data-person="${p.id}">${p.name}${p.organization ? html` <small>· ${p.organization}</small>` : ''}</span>`)}</div>` : ''}
      <h3 style="margin-bottom:6px">Notes</h3>
      <div class="notes-view">${m.notes || raw('<span class="muted">No notes yet.</span>')}</div>
      <div class="grid grid-2" style="margin-top:14px">
        <div><h3 style="margin-bottom:6px">Key takeaways</h3><div class="notes-view">${m.takeaways || '—'}</div></div>
        <div><h3 style="margin-bottom:6px">Next steps</h3><div class="notes-view">${m.next_steps || '—'}</div></div>
      </div>
      <p class="muted" style="margin-top:12px;font-size:12px">Created ${fmtDateTime(m.created_at)} · last edited ${fmtDateTime(m.updated_at)}</p>`,
    foot: html`<button class="btn danger" id="mt-del">${ICONS.trash} Delete</button><span class="spacer"></span><button class="btn" data-close>Close</button><button class="btn primary" id="mt-edit">${ICONS.edit} Edit notes</button>`,
    onMount(el, close) {
      $('#mt-edit', el).addEventListener('click', async () => {
        close();
        const saved = await meetingForm(m);
        if (saved) { onChange && onChange(); meetingView(id, { onChange }); }
      });
      $('#mt-del', el).addEventListener('click', async () => {
        if (!(await confirmDialog('Delete this meeting and its notes?'))) return;
        await api.del(`/api/meetings/${id}`); toast('Meeting deleted'); close(); onChange && onChange();
      });
      el.addEventListener('click', (e) => {
        const p = e.target.closest('[data-person]');
        if (p) { close(); contactView(+p.dataset.person, { onChange }); }
      });
    },
  });
}

// ======================================================================= CIM facts
const FIELD_HINT = {
  name: 'Name', codename: 'Codename', description: 'Description', founded_year: 'Founded', employees: 'Employees',
  country: 'Country', region: 'Region', sector: 'Sector', website: 'Website', ownership: 'Ownership', advisor: 'Advisor',
  deal_type: 'Deal type', revenue: 'Revenue', ebitda: 'EBITDA', hq: 'HQ city',
};
const ORDER = ['name', 'codename', 'description', 'sector', 'hq', 'country', 'region', 'revenue', 'ebitda', 'ebitda_margin', 'ebitda_margin_calc',
  'gross_margin', 'revenue_cagr', 'cagr', 'arr', 'recurring_revenue', 'net_retention', 'gross_retention', 'customers', 'concentration',
  'employees', 'founded_year', 'locations', 'countries_count', 'ceo', 'ownership', 'advisor', 'deal_type', 'bid_deadline', 'website'];

function mergedFacts(analysis) {
  const all = [...(analysis.facts || []), ...((analysis.ai && analysis.ai.facts) || [])];
  const best = new Map();
  all.forEach((f) => { const b = best.get(f.key); if (!b || f.confidence > b.confidence) best.set(f.key, f); });
  all.sort((a, b) => (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99) || b.confidence - a.confidence);
  return all.map((f) => ({ ...f, _default: best.get(f.key) === f && f.confidence >= 0.5 && f.key !== 'name' || (best.get(f.key) === f && f.key === 'name' && f.confidence >= 0.6) }));
}

function highlightSnippet(snippet, f) {
  if (!snippet) return '';
  const needle = String(f.display || '').split(' (')[0].replace(/[$€£]/g, '').replace(/(\d)\s*(m|bn|%)$/, '$1').trim();
  const s = esc(snippet);
  if (!needle || needle.length < 2) return raw(s);
  const n = esc(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return raw(s.replace(new RegExp(n), (x) => `<mark>${x}</mark>`));
}

function confBar(c) {
  const cls = c >= 0.75 ? '' : c >= 0.55 ? 'mid' : 'low';
  return html`<div class="conf"><span>${Math.round(c * 100)}%</span><span class="bar"><i class="${cls}" style="width:${c * 100}%"></i></span></div>`;
}

export function factsReviewHTML(analysis, { reveal = false } = {}) {
  const facts = mergedFacts(analysis);
  if (!facts.length) return html`<div class="empty">No facts detected. ${analysis.warning || ''}</div>`;
  return html`<div class="fr-list">${facts.map((f, i) => html`
    <label class="fr ${reveal ? 'reveal' : ''}" style="--i:${i}">
      <input type="checkbox" data-fi="${i}" ${f._default ? 'checked' : ''}>
      <div><div class="lbl">${f.label}<span class="badge-src ${f.source}">${f.source === 'claude' ? 'Claude' : 'Auto'}</span></div>
        ${FIELD_HINT[f.key] ? html`<small>Fills ${FIELD_HINT[f.key].toLowerCase()}</small>` : html`<small>key fact</small>`}</div>
      <div><div class="val">${f.display}</div>${f.snippet && f.key !== 'description' ? html`<div class="src">“${highlightSnippet(f.snippet, f)}”${f.page ? html` <span class="pg">p.${f.page}</span>` : ''}</div>` : f.page ? html`<div class="src">p.${f.page}</div>` : ''}</div>
      ${confBar(f.confidence)}
    </label>`)}</div>`;
}
export function selectedFacts(root, analysis) {
  const facts = mergedFacts(analysis);
  const chosen = $$('input[data-fi]', root).filter((x) => x.checked).map((x) => facts[+x.dataset.fi]);
  // one value per key: last checked wins only if no higher-confidence pick
  const byKey = new Map();
  chosen.forEach((f) => { const b = byKey.get(f.key); if (!b || f.confidence > b.confidence) byKey.set(f.key, f); });
  return [...byKey.values()].map(({ _default, ...f }) => f);
}

export function analysisSideHTML(analysis) {
  const ai = analysis.ai || {};
  const highlights = (ai.highlights && ai.highlights.length ? ai.highlights : analysis.highlights) || [];
  const risks = (ai.risks && ai.risks.length ? ai.risks : analysis.risks) || [];
  const series = analysis.series || {};
  return html`
    ${ai.summary ? html`<div class="summary-box"><b>Claude summary</b><br>${ai.summary}</div>` : ''}
    ${series.revenue ? html`<div><h3 style="margin-bottom:6px">Financials detected</h3><div id="fin-chart"></div></div>` : ''}
    ${highlights.length ? html`<div><h3 style="margin-bottom:6px">Investment highlights</h3><ul class="bullets">${highlights.map((h) => html`<li>${h.text}${h.page ? html`<small class="muted">p.${h.page}</small>` : ''}</li>`)}</ul></div>` : ''}
    ${risks.length ? html`<div><h3 style="margin-bottom:6px">${ai.risks && ai.risks.length ? 'Risks & diligence questions' : 'Risks'}</h3><ul class="bullets">${risks.map((h) => html`<li>${h.text}</li>`)}</ul></div>` : ''}
    ${(analysis.geographies || []).length ? html`<div><h3 style="margin-bottom:6px">Geographies mentioned</h3><div class="chips">${analysis.geographies.slice(0, 8).map((g) => html`<span class="chip">${g.country} <small>×${g.mentions}</small></span>`)}</div></div>` : ''}
    ${analysis.stats ? html`<p class="muted" style="font-size:12px">${analysis.stats.pages} page(s) · ${num0(analysis.stats.words)} words read</p>` : ''}`;
}
const num0 = (n) => Number(n || 0).toLocaleString();

export function renderSeriesChart(el, series, currency) {
  if (!el || !series || !series.revenue) return;
  const years = Object.keys(series.revenue).sort();
  columns(el, {
    categories: years,
    series: [{ key: 'revenue', label: 'Revenue', color: 'var(--bar)' }, ...(series.ebitda ? [{ key: 'ebitda', label: 'EBITDA', color: 'var(--accent)' }] : [])],
    rows: years.map((y) => ({ cat: y, label: series.revenue[y].projected ? `${y}E` : `${y}A`, revenue: series.revenue[y]?.value, ebitda: series.ebitda?.[y]?.value, projected: series.revenue[y].projected })),
    format: (v, axis) => (axis ? money(v, currency).replace(/\.0m$/, 'm') : money(v, currency)),
    isProjected: (r) => r.projected,
    height: 190,
  });
}

// Review modal for an already-uploaded CIM (company page).
export async function reviewCim(doc, company, { onApplied } = {}) {
  let analysis = doc.analysis || {};
  const aiEnabled = store.meta.ai_enabled;
  const m = modal({
    title: `Key facts from ${doc.filename}`, size: 'wide',
    body: html`<div id="rv"></div>`,
    foot: html`
      <button class="btn" id="rv-ai" ${aiEnabled ? '' : 'disabled'} title="${aiEnabled ? 'Have Claude read the full document' : 'Add an Anthropic API key in Settings to enable'}">${ICONS.spark} ${analysis.ai ? 'Re-run Claude analysis' : 'Analyze with Claude'}</button>
      <label class="row" style="font-size:13px;gap:6px;margin-right:auto"><input type="checkbox" id="rv-empty"> Only fill empty fields</label>
      <button class="btn" data-close>Cancel</button><button class="btn primary" id="rv-apply">Apply selected to ${company.name}</button>`,
  });
  const el = m.el;
  const render = () => {
    $('#rv', el).innerHTML = String(html`
      ${analysis.warning ? html`<div class="banner warn"><span class="ico">${ic('alert')}</span><div>${analysis.warning}</div></div>` : ''}
      <div class="fr-cols"><div>${factsReviewHTML(analysis)}</div><div class="stack">${analysisSideHTML(analysis)}</div></div>`);
    renderSeriesChart($('#fin-chart', el), analysis.series, analysis.currency);
  };
  render();
  $('#rv-ai', el).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try {
      toast('Claude is reading the whole document. This can take a minute.', '', { icon: 'spark', ms: 4000 });
      const d = await api.post(`/api/documents/${doc.id}/reanalyze?engine=claude`);
      analysis = d.analysis; render(); toast('Claude’s reading added', '', { icon: 'check' });
    } catch (err) { errToast(err); }
  }));
  $('#rv-apply', el).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const facts = selectedFacts(el, analysis);
    try {
      const updated = await api.post(`/api/companies/${company.id}/apply-facts`, { facts, document_id: doc.id, only_empty: $('#rv-empty', el).checked });
      toast(`${facts.length} fact${facts.length === 1 ? '' : 's'} added to ${company.name}`, '', { icon: 'check' }); m.close(); onApplied && onApplied(updated);
    } catch (err) { errToast(err); }
  }));
}

// "New company from CIM" wizard.
export function cimWizard({ onCreated } = {}) {
  const m = modal({
    title: 'New company from CIM', size: 'wide',
    body: html`<div id="wz">
      <div class="dropzone" id="wz-drop">${ic('scan')}<b>Drop a CIM or teaser</b><br>PDF, Word or text, or click to browse
        <p class="muted" style="margin:10px auto 0;font-size:12px;max-width:46ch">Read on this computer. Revenue, EBITDA, margins, HQ, headcount, customers and highlights are found with page references, so you can check each one.</p></div>
    </div>`,
  });
  const el = m.el;
  dropzone($('#wz-drop', el), async ([file]) => {
    $('#wz', el).innerHTML = String(html`<div class="reading">
      <h3>Reading ${file.name}</h3>
      <ol>${['Reading the document', 'Finding the financials', 'Detecting key facts', 'Checking your records'].map((t, i) => html`<li class="${i ? '' : 'active'}" data-step="${i}"><span class="st"></span><span class="t">${t}</span></li>`)}</ol>
    </div>`);
    try {
      const doc = await api.upload('/api/cim/analyze', file);
      const a = doc.analysis || {};
      const pick = (k) => mergedFacts(a).filter((f) => f.key === k).sort((x, y) => y.confidence - x.confidence)[0]?.value;
      const names = [pick('name'), pick('codename')].filter(Boolean);
      const prior = Promise.all(names.map((n) => api.get(`/api/companies/similar?name=${encodeURIComponent(n)}`).catch(() => [])))
        .then((res) => [...new Map(res.flat().map((h) => [h.id, h])).values()]);
      const years = Object.keys((a.series || {}).revenue || {}).length;
      const facts = mergedFacts(a).filter((f) => f._default).length;
      // Each line reports what the analysis actually found; nothing here is a fake delay.
      const results = [
        a.stats ? `Read ${a.stats.pages} page${a.stats.pages === 1 ? '' : 's'}, ${num0(a.stats.words)} words` : 'Read the document',
        years ? `Found ${years} year${years === 1 ? '' : 's'} of revenue${(a.series || {}).ebitda ? ' and EBITDA' : ''}` : 'No financial table found',
        `Detected ${facts} key fact${facts === 1 ? '' : 's'} with page references`,
        null,
      ];
      const hits = await playSteps(el, results, prior);
      step2(doc, hits);
    } catch (err) { errToast(err); m.close(); }
  }, { accept: '.pdf,.docx,.txt,.md' });

  async function playSteps(root, results, prior) {
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lis = $$('.reading li', root);
    let hits = [];
    for (let i = 0; i < lis.length; i++) {
      lis[i].classList.add('active');
      if (i === 3) {
        hits = await prior;
        results[3] = hits.length ? `Seen before: ${hits.map((h) => h.name).slice(0, 2).join(', ')}` : 'Not seen before in your records';
      }
      if (!calm) await new Promise((r) => setTimeout(r, 160));
      lis[i].classList.replace('active', 'done');
      lis[i].querySelector('.st').innerHTML = String(ic('check'));
      lis[i].querySelector('.t').textContent = results[i];
    }
    if (!calm) await new Promise((r) => setTimeout(r, 260));
    return hits;
  }

  function step2(doc, hits = []) {
    let analysis = doc.analysis || { facts: [] };
    const pick = (k) => mergedFacts(analysis).filter((f) => f.key === k).sort((a, b) => b.confidence - a.confidence)[0]?.value;
    const color = BRAND_SWATCHES[Math.floor(Math.random() * 8)];
    const render = () => {
      $('#wz', el).innerHTML = String(html`
        <div id="wz-prior" style="margin-bottom:16px" hidden></div>
        ${analysis.warning ? html`<div class="banner warn"><span class="ico">${ic('alert')}</span><div>${analysis.warning}</div></div>` : ''}
        <form class="form" id="wz-form" style="margin-bottom:16px">
          <div class="field"><label>Company name *</label><input type="text" name="name" value="${pick('name') || ''}" required></div>
          <div class="field"><label>Codename</label><input type="text" name="codename" value="${pick('codename') || ''}"></div>
          <div class="field"><label>Stage</label><select name="stage">${options(S().stages, S().stages.includes('CIM Review') ? 'CIM Review' : S().stages[0])}</select></div>
          <div class="field"><label>Brand colour</label><div class="swatches">${BRAND_SWATCHES.slice(0, 9).map((s) => html`<button type="button" class="swatch ${s === color ? 'on' : ''}" style="background:${s}" data-c="${s}"></button>`)}<input type="color" name="color" value="${color}"></div></div>
        </form>
        <div class="fr-cols"><div><p class="muted" style="margin-bottom:10px;font-size:13px">Keep the facts you trust. They fill the profile and are saved with their page references.</p>${factsReviewHTML(analysis, { reveal: true })}</div><div class="stack">${analysisSideHTML(analysis)}</div></div>`);
      renderSeriesChart($('#fin-chart', el), analysis.series, analysis.currency);
      const box = $('#wz-prior', el);
      if (box && hits.length) { box.hidden = false; box.innerHTML = String(priorLooksBanner(hits)); }
      $('.swatches', el).addEventListener('click', (e) => {
        const s = e.target.closest('.swatch');
        if (!s) return;
        $('input[name=color]', el).value = s.dataset.c;
        $$('.swatch', el).forEach((x) => x.classList.toggle('on', x === s));
      });
    };
    render();
    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    foot.innerHTML = String(html`
      <button class="btn" id="wz-ai" ${store.meta.ai_enabled ? '' : 'disabled'} title="${store.meta.ai_enabled ? 'Have Claude read the full document' : 'Add an Anthropic API key in Settings to enable'}">${ICONS.spark} Analyze with Claude</button>
      <span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="wz-create">Create company</button>`);
    el.appendChild(foot);
    $('#wz-ai', el).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try {
        toast('Claude is reading the whole document. This can take a minute.', '', { icon: 'spark', ms: 4000 });
        const d = await api.post(`/api/documents/${doc.id}/reanalyze?engine=claude`);
        analysis = d.analysis; render(); toast('Claude’s reading added', '', { icon: 'check' });
      } catch (err) { errToast(err); }
    }));
    $('#wz-create', el).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const v = formValues($('#wz-form', el));
      if (!v.name.trim()) return toast('Company name is required', 'err');
      const facts = selectedFacts(el, analysis);
      try {
        const created = await api.post('/api/companies', { ...v, cim_document_id: doc.id, accepted_facts: facts });
        toast(`${created.name} added from its CIM`, '', { icon: 'check' }); m.close();
        offerDemoCleanup();
        onCreated ? onCreated(created) : (location.hash = `#/company/${created.id}`);
      } catch (err) { errToast(err); }
    }));
  }
}

export { initials };


// ======================================================================= memory
export function priorLooksBanner(hits) {
  if (!hits || !hits.length) return '';
  return html`<div class="banner" style="margin:0">
    <span class="ico">${ic('history')}</span>
    <div style="flex:1;min-width:0"><b>You've looked at this before.</b>
      ${hits.slice(0, 3).map((h) => html`<p><a href="#/company/${h.id}" data-close>${h.name}</a>${h.codename ? ` (${h.codename})` : ''} — ${h.pass_reason ? html`passed: <b>${h.pass_reason}</b>` : h.stage}${h.deal_lead ? ` · lead ${h.deal_lead}` : ''} · first seen ${fmtDate(h.created_at)}${h.last_meeting ? ` · last met ${ago(h.last_meeting)}` : ''}${h.pass_notes ? html`<br><span class="muted">“${h.pass_notes}”</span>` : ''}</p>`)}
    </div></div>`;
}

// Ask why when a deal is passed on, so the reasoning outlives the people in the room.
export function passDialog(company) {
  return new Promise((resolve) => {
    let result = null;
    modal({
      title: `Pass on ${company.name}`, size: 'narrow',
      body: html`<p class="t2" style="margin-top:-4px">Record why, so whoever sees this company next knows what you knew.</p>
        <form class="stack" id="pass-form" style="gap:14px">
          <div class="field"><label>Main reason</label><select name="pass_reason">${options(S().pass_reasons || [], company.pass_reason || (S().pass_reasons || [])[0])}</select></div>
          <div class="field"><label>What would change our mind?</label><textarea name="pass_notes" rows="4" placeholder="e.g. Seller wants 16x, we're at 11x. Would re-engage below 12x.">${company.pass_notes || ''}</textarea></div>
          <div class="field"><label>Revisit on</label><input type="date" name="revisit_date" value="${company.revisit_date || ''}"><span class="hint">Optional — it will resurface under Needs attention.</span></div>
        </form>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" id="pass-ok">Pass and record</button>`,
      onMount(el, close) {
        $('#pass-ok', el).addEventListener('click', () => { result = formValues($('#pass-form', el)); close(); });
      },
      onClose: () => resolve(result),
    });
  });
}

// Move a company to a stage; passing asks for the decision record first.
// Moves are instant and reversible: the toast offers Undo instead of asking "are you sure?".
// Undo removes the move from history entirely, so a slip leaves no trace in the record.
export async function moveStage(company, stage, { onUndo } = {}) {
  const body = { stage };
  const before = { stage: company.stage, status: company.status || 'Active' };
  if (stage === 'Passed') {
    const why = await passDialog(company);
    if (!why) return null;
    Object.assign(body, why, { status: 'Passed' });
  } else if (company.status === 'Passed') {
    body.status = 'Active';
  }
  const updated = await api.patch(`/api/companies/${company.id}`, body);
  toast(html`<b>${company.name}</b> moved to ${stage}`, '', {
    icon: 'check',
    action: 'Undo',
    onAction: async () => {
      try {
        await api.post(`/api/companies/${company.id}/undo-stage`, { status: before.status });
        toast(html`<b>${company.name}</b> is back in ${before.stage}`, '', { icon: 'undo' });
        onUndo && onUndo();
      } catch (err) { errToast(err); }
    },
  });
  if (stage === 'Closed') closedMoment(updated);
  return updated;
}

// The peak-end moment: closing a deal is rare and earned, so mark it once, quietly,
// with the facts of the journey rather than confetti.
function closedMoment(c) {
  const first = c.stage_history?.[0]?.changed_at || c.created_at;
  const days = Math.max(1, Math.round((Date.now() - new Date(first)) / 864e5));
  const people = new Set([...(c.contacts || []).map((x) => x.id), ...(c.meetings || []).flatMap((m) => (m.attendees || []).map((a) => a.id ?? a))]).size;
  const m = modal({
    title: '',
    size: 'narrow',
    body: html`<div class="moment">
      <div class="seal">${ic('award')}</div>
      <h2>${c.name} is closed</h2>
      <p>${c.deal_lead ? `${c.deal_lead} and the team` : 'The team'} took it from first look to signing.</p>
      <div class="facts-row">
        <div><b>${days}</b><small class="muted">days since first look</small></div>
        <div><b>${(c.meetings || []).length}</b><small class="muted">meetings held</small></div>
        <div><b>${people}</b><small class="muted">people involved</small></div>
      </div>
      <p class="muted" style="font-size:13px">Everything on this deal stays on record for the next one.</p>
    </div>`,
    foot: html`<a class="btn" href="#/company/${c.id}/onepager">${ic('file')}One-pager</a><button class="btn primary" data-close>Done</button>`,
  });
  return m;
}

// ======================================================================= sample data
export const demoCounts = () => store.meta?.demo || { companies: 0, contacts: 0, meetings: 0 };
export const hasDemo = () => Object.values(demoCounts()).some((n) => n > 0);

export function demoSummary() {
  const d = demoCounts();
  const part = (n, one, many) => (n ? `${n} ${n === 1 ? one : many}` : null);
  return [part(d.companies, 'company', 'companies'), part(d.contacts, 'contact', 'contacts'), part(d.meetings, 'meeting', 'meetings')].filter(Boolean).join(', ');
}

// Remove only records created by "Explore with demo data"; the user's own work stays.
export async function clearDemo({ ask = true } = {}) {
  if (ask && !(await confirmDialog(html`Remove the sample data (${demoSummary()})? Companies, contacts and meetings you added yourself are kept.`, { ok: 'Remove sample data' }))) return false;
  try {
    await api.del('/api/demo');
    await loadMeta();
    toast('Sample data removed');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    api.get('/api/dashboard').then((d) => {
      const badge = document.getElementById('attn-badge');
      const n = d.attention.filter((a) => a.severity >= 3).length;
      if (badge) { badge.hidden = !n; badge.textContent = n; }
    }).catch(() => {});
    return true;
  } catch (err) { errToast(err); return false; }
}

// After the user's first real company, offer once per session to clear the samples.
export async function offerDemoCleanup() {
  await loadMeta().catch(() => {});
  if (!hasDemo()) return;
  try { if (sessionStorage.getItem('dt-demo-offered')) return; sessionStorage.setItem('dt-demo-offered', '1'); } catch { /* storage unavailable */ }
  const yes = await confirmDialog(html`You've started adding your own deals. Remove the sample data now? <span class="muted">(${demoSummary()})</span> Your own records are kept.`, { ok: 'Remove sample data', danger: false });
  if (yes) clearDemo({ ask: false });
}
