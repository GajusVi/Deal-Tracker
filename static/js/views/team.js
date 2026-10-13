import { api, store } from '../api.js';
import { html, $, logo, money, ago, fmtDate, toast, errToast, withBusy, confirmDialog, options, initials, strength, ic, recordBar, tkr } from '../ui.js';
import { setCrumbs } from '../app.js';
import { contactView } from '../forms.js';

export async function renderTeam(view) {
  setCrumbs([{ label: 'Team & handover' }]);
  const [team, companies] = await Promise.all([api.get('/api/team'), api.get('/api/companies')]);
  const live = companies.filter((c) => !store.meta.terminal_stages.includes(c.stage) && c.status !== 'Passed');
  const complete = live.filter((c) => !c.record.missing.length).length;
  const gaps = live.reduce((a, c) => a + c.record.missing.length, 0);
  const items = store.meta.record_items.map((it) => {
    const missing = live.filter((c) => c.record.missing.includes(it.short));
    return { ...it, have: live.length - missing.length, missing };
  });
  view.innerHTML = String(html`
    <div class="page-head">
      <div><div class="eyebrow">Firm memory</div><h1>Team & handover</h1>
        <p>When someone leaves, their deals, relationships and judgement should stay with the firm.</p></div>
      <a class="btn ghost" href="#/settings">${ic('settings')}Manage team</a>
    </div>

    <section>
      <div class="section-head"><h2>Deal records</h2><span class="aside">${complete} of ${live.length} live deals complete · ${gaps} item${gaps === 1 ? '' : 's'} missing</span></div>
      <div class="table-wrap"><table class="table coverage">
        <thead><tr><th>Item</th><th>On record</th><th>Missing on</th></tr></thead>
        <tbody>${items.map((it) => html`<tr>
          <td>${it.label}</td>
          <td class="cov"><span class="cov-bar"><i style="width:${live.length ? (it.have / live.length) * 100 : 0}%"></i></span><b>${it.have}</b><small>of ${live.length}</small></td>
          <td>${it.missing.length ? html`<span class="cov-list">${it.missing.map((c) => html`<a class="co-link" href="#/company/${c.id}"><span class="dot" style="background:${c.color}"></span>${c.name}${tkr(c.codename)}</a>`)}</span>` : html`<span class="muted">All live deals</span>`}</td>
        </tr>`)}</tbody>
      </table></div>
    </section>

    <section class="section">
      <div class="section-head"><h2>People</h2><span class="aside">Open someone to see their handover pack</span></div>
      <div class="table-wrap"><table class="table people-table">
        <thead><tr><th>Name</th><th class="r">Live deals</th><th class="r">Live EV</th><th class="r">Relationships</th><th class="r">Complete records</th><th class="r">Items missing</th><th></th></tr></thead>
        <tbody>${team.map((m) => html`<tr data-href="#/team/${encodeURIComponent(m.name)}">
          <td><div class="cell-co"><span class="avatar">${initials(m.name)}</span><b>${m.name}</b></div></td>
          <td class="r num">${m.live}<span class="muted"> / ${m.deals}</span></td>
          <td class="r num">${m.ev ? money(m.ev) : html`<span class="muted">–</span>`}</td>
          <td class="r num">${m.contacts}</td>
          <td class="r num">${m.live ? html`${m.complete}<span class="muted"> of ${m.live}</span>` : html`<span class="muted">–</span>`}</td>
          <td class="r num ${m.gaps ? 'rec-missing' : 'muted'}">${m.gaps || '–'}</td>
          <td class="r">${ic('chevronRight', 'chev')}</td>
        </tr>`)}</tbody>
      </table></div>
    </section>`);
  view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
}

export async function renderHandover(view, member) {
  const [h, team] = await Promise.all([api.get(`/api/handover?member=${encodeURIComponent(member)}`), api.get('/api/team')]);
  const s = h.summary;
  const others = team.map((t) => t.name).filter((n) => n !== member);
  setCrumbs([{ label: 'Team & handover', href: '#/team' }, { label: member }]);
  view.innerHTML = String(html`
    <div class="print-bar">
      <span></span>
      <div class="btn-row">
        <select id="to" class="compact">${options(others, '', { blank: 'Hand everything to…' })}</select>
        <button class="btn" id="reassign">${ic('handshake')}Reassign</button>
        <button class="btn primary" id="print">${ic('printer')}Save as PDF</button>
      </div></div>
    <div class="ho-head">
      <span class="avatar lg" style="width:72px;height:72px;font-size:26px">${initials(member)}</span>
      <div style="flex:1;min-width:240px"><div class="eyebrow">Handover pack</div><h1 style="margin-top:4px">${member}</h1>
        <p class="muted" style="margin-top:6px">Everything ${member} owns, in one place. Generated ${fmtDate(h.generated_at)}.</p></div>
      <div class="ho-stats">
        <div><small class="muted">Live deals</small><b>${s.live}</b></div>
        <div><small class="muted">Relationships</small><b>${s.contacts}</b></div>
        <div><small class="muted">Strong (4–5)</small><b>${s.strong_relationships}</b></div>
        <div><small class="muted">Complete records</small><b>${s.complete}<span class="of"> of ${s.live}</span></b></div>
        <div><small class="muted">Items missing</small><b class="${s.gaps ? 'rec-missing' : ''}">${s.gaps}</b></div>
      </div>
    </div>

    ${h.gaps.length ? html`<div class="banner warn" style="align-items:flex-start"><span class="ico">${ic('alert')}</span><div><b>Close these gaps before the handover</b>
      ${h.gaps.map((g) => html`<p><a href="#/company/${g.id}">${g.deal}</a>: missing ${g.missing.join(', ')}</p>`)}</div></div>` : ''}

    <div class="section-head" style="margin-top:36px"><h2>Deals</h2><span class="aside">${h.deals.length}</span></div>
    ${h.deals.length ? h.deals.map((d) => html`
      <div class="ho-deal" style="--c:${d.color}">
        <div class="head">${logo(d)}<div style="flex:1;min-width:0"><h3><a href="#/company/${d.id}" style="color:inherit">${d.name}</a>${tkr(d.codename)}</h3>
          <div class="muted" style="font-size:13px">${[d.role, d.stage, d.advisor ? `via ${d.advisor}` : null].filter(Boolean).join(' · ')}</div></div>
          <div class="ho-rec" title="Deal record">${recordBar(d.knowledge.done, d.knowledge.total)}<span>${d.knowledge.done} of ${d.knowledge.total}</span></div></div>
        ${d.description ? html`<p class="prose" style="color:var(--ink-2)">${d.description}</p>` : ''}
        <div class="ho-grid">
          <div><h4>Where it stands</h4><ul>
            <li>${d.pass_reason ? html`Passed: <b>${d.pass_reason}</b>${d.pass_notes ? html`: ${d.pass_notes}` : ''}` : d.next_step ? html`Next: <b>${d.next_step}</b>${d.next_step_date ? ` (${fmtDate(d.next_step_date)})` : ''}` : 'No next step recorded'}</li>
            ${d.revisit_date ? html`<li>Revisit ${fmtDate(d.revisit_date)}</li>` : ''}
            ${d.nda_expiry_date ? html`<li>NDA ends ${fmtDate(d.nda_expiry_date)}</li>` : ''}
            <li>Last touch ${d.last_touch ? ago(d.last_touch) : 'never'}</li>
            ${d.deal_team ? html`<li>Team: ${d.deal_team}</li>` : ''}</ul>
            ${d.risks.length ? html`<h4 style="margin-top:12px">Open questions</h4><ul>${d.risks.map((r) => html`<li>${r.text}</li>`)}</ul>` : ''}</div>
          <div><h4>What we've learned</h4>${d.meetings.filter((m) => m.takeaways || m.notes).length ? html`<ul>${d.meetings.filter((m) => m.takeaways || m.notes).map((m) => html`<li><b>${fmtDate(m.starts_at)}</b> ${m.takeaways || m.notes}</li>`)}</ul>` : html`<p class="muted">No meeting notes logged.</p>`}</div>
          <div><h4>Who to call</h4>${d.people.length ? html`<ul>${d.people.slice(0, 5).map((p) => html`<li><b>${p.name}</b>, ${[p.title, p.organization].filter(Boolean).join(', ')}${p.role ? ` · ${p.role}` : ''}</li>`)}</ul>` : html`<p class="muted">No people mapped.</p>`}</div>
        </div>
      </div>`) : html`<div class="empty"><p>No deals on ${member}'s plate.</p></div>`}

    <div class="section-head" style="margin-top:36px"><h2>Relationships to transfer</h2><span class="aside">${h.contacts.length}</span></div>
    ${h.contacts.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Person</th><th>Organisation</th><th>Strength</th><th>Last met</th><th>Deals</th><th>Notes</th></tr></thead>
      <tbody>${h.contacts.map((p) => html`<tr data-p="${p.id}">
        <td><b>${p.name}</b><br><small class="muted">${p.title || ''}</small></td>
        <td>${p.organization || p.company_name || html`<span class="muted">–</span>`}</td><td>${strength(p.strength)}</td>
        <td class="${p.last_met ? '' : 'muted'}">${p.last_met ? ago(p.last_met) : 'never'}</td>
        <td>${p.deals.join(', ') || html`<span class="muted">–</span>`}</td><td style="max-width:280px">${p.notes || html`<span class="muted">–</span>`}</td></tr>`)}</tbody></table></div>`
      : html`<div class="empty"><p>No relationships owned by ${member}.</p></div>`}`);

  $('#print', view).addEventListener('click', () => window.print());
  view.querySelector('tbody')?.addEventListener('click', (e) => { const r = e.target.closest('[data-p]'); if (r) contactView(+r.dataset.p); });
  $('#reassign', view).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const to = $('#to', view).value;
    if (!to) return toast('Choose who takes over', 'err');
    if (!(await confirmDialog(`Make ${to} the owner of all of ${member}'s deals and relationships? Each deal's timeline records the handover.`, { ok: 'Hand over', danger: false }))) return;
    try {
      const r = await api.post('/api/handover/reassign', { from: member, to });
      toast(`${r.deals} deal${r.deals === 1 ? '' : 's'} and ${r.contacts} relationship${r.contacts === 1 ? '' : 's'} now with ${to}`, '', { icon: 'check' });
      location.hash = `#/team/${encodeURIComponent(to)}`;
    } catch (err) { errToast(err); }
  }));
}
