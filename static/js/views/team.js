import { api, store } from '../api.js';
import { html, $, logo, money, ago, fmtDate, ring, toast, errToast, withBusy, confirmDialog, options, initials, strength, ic } from '../ui.js';
import { setCrumbs } from '../app.js';
import { contactView } from '../forms.js';

export async function renderTeam(view) {
  setCrumbs([{ label: 'Team & handover' }]);
  const [team, companies] = await Promise.all([api.get('/api/team'), api.get('/api/companies')]);
  const live = companies.filter((c) => !store.meta.terminal_stages.includes(c.stage) && c.status !== 'Passed');
  const firmScore = live.length ? Math.round(live.reduce((a, c) => a + c.knowledge, 0) / live.length) : null;
  const weakest = [...live].sort((a, b) => a.knowledge - b.knowledge).slice(0, 5);
  view.innerHTML = String(html`
    <div class="page-head">
      <div><div class="eyebrow">Firm memory</div><h1>Team & handover</h1>
        <p>When someone leaves, their deals, relationships and judgement should stay with the firm.</p></div>
      <a class="btn ghost" href="#/settings">${ic('settings')}Manage team</a>
    </div>
    <div class="memory">
      <div class="memory-figure">
        <div class="big">${firmScore ?? '–'}<small>%</small></div>
        <p>of what a successor would need is on record across ${live.length} live deal${live.length === 1 ? '' : 's'}.</p>
        <p class="muted">Each deal is checked for a lead, a description, CIM facts, a model, meeting notes, mapped people and a next step or pass reason. Anything missing lives only in someone's head or inbox.</p>
      </div>
      <div>
        <div class="section-head"><h2>Most exposed</h2><span class="aside">lowest coverage first</span></div>
        <div class="list">${weakest.map((c) => html`
          <a class="list-item" href="#/company/${c.id}">${logo(c, 'sm')}<span class="grow"><span class="title">${c.name}</span><span class="meta">${c.deal_lead || 'No lead'} · ${c.stage}</span></span>${ring(c.knowledge, 22)}<b class="num" style="width:38px;text-align:right">${c.knowledge}%</b></a>`)}</div>
      </div>
    </div>
    <section class="section">
      <div class="section-head"><h2>People</h2><span class="aside">Open a person to see their handover pack</span></div>
      <div class="people stagger">${team.map((m, i) => html`
        <a class="person" href="#/team/${encodeURIComponent(m.name)}" style="--i:${i}">
          <span class="avatar lg">${initials(m.name)}</span>
          <span class="who"><b>${m.name}</b><small class="muted">${m.ev ? `${money(m.ev)} live EV` : 'No live deals'}</small></span>
          <span class="n"><b>${m.live}</b><small>live</small></span>
          <span class="n"><b>${m.deals}</b><small>all deals</small></span>
          <span class="n"><b>${m.contacts}</b><small>relationships</small></span>
          <span class="n mem">${ring(m.knowledge, 22)}<b>${m.knowledge ?? '–'}${m.knowledge != null ? '%' : ''}</b></span>
          ${ic('chevronRight', 'chev')}
        </a>`)}</div>
    </section>`);
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
        ${ring(s.knowledge, 64)}
      </div>
    </div>

    ${h.gaps.length ? html`<div class="banner warn" style="align-items:flex-start"><span class="ico">${ic('alert')}</span><div><b>Close these gaps before the handover</b>
      ${h.gaps.map((g) => html`<p><a href="#/company/${g.id}">${g.deal}</a>: missing ${g.missing.join(', ')}</p>`)}</div></div>` : ''}

    <div class="section-head" style="margin-top:36px"><h2>Deals</h2><span class="aside">${h.deals.length}</span></div>
    ${h.deals.length ? h.deals.map((d) => html`
      <div class="ho-deal" style="--c:${d.color}">
        <div class="head">${logo(d)}<div style="flex:1;min-width:0"><h3><a href="#/company/${d.id}" style="color:inherit">${d.name}</a></h3>
          <div class="muted" style="font-size:13px">${[d.codename, d.role, d.stage, d.advisor ? `via ${d.advisor}` : null].filter(Boolean).join(' · ')}</div></div>
          ${ring(d.knowledge.score, 48)}</div>
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
