import { api, store } from '../api.js';
import { html, $, logo, money, ago, fmtDate, ring, toast, errToast, withBusy, confirmDialog, options, initials, strength, ICONS } from '../ui.js';
import { contactView } from '../forms.js';

export async function renderTeam(view) {
  const [team, companies] = await Promise.all([api.get('/api/team'), api.get('/api/companies')]);
  const live = companies.filter((c) => !store.meta.terminal_stages.includes(c.stage) && c.status !== 'Passed');
  const firmScore = live.length ? Math.round(live.reduce((a, c) => a + c.knowledge, 0) / live.length) : null;
  const weakest = [...live].sort((a, b) => a.knowledge - b.knowledge).slice(0, 6);
  view.innerHTML = String(html`
    <div class="page-head">
      <div><div class="eyebrow">Firm memory</div><h1 style="margin-top:6px">Team & handover</h1>
        <p>When someone leaves, their deals, relationships and judgement shouldn't leave with them.</p></div>
      <a class="btn" href="#/settings">Manage team</a>
    </div>
    <div class="grid grid-dash" style="margin-bottom:28px;align-items:start">
      <div class="card card-pad row" style="gap:24px;align-items:center">
        ${ring(firmScore, 104)}
        <div>
          <h2>Firm knowledge captured</h2>
          <p class="t2" style="margin:6px 0 0">Across ${live.length} live deals: is there a lead, a description, CIM facts, a model, meeting notes, mapped people and a recorded next step or pass reason? Each missing item is something that today lives only in someone's head or inbox.</p>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Most at risk</h2><span class="muted" style="font-size:12px">lowest coverage</span></div>
        <div class="card-body"><div class="list">${weakest.map((c) => html`
          <a class="list-item" href="#/company/${c.id}">${logo(c, 'sm')}<span class="grow"><span class="title">${c.name}</span><span class="meta">${c.deal_lead || 'No lead'} · ${c.stage}</span></span><b class="num">${c.knowledge}%</b></a>`)}</div></div>
      </div>
    </div>
    <div class="team-cards">${team.map((m) => html`
      <a class="card team-card" href="#/team/${encodeURIComponent(m.name)}">
        <div class="top"><span class="avatar lg" style="--c:var(--series-${(m.name.length % 7) + 1})">${initials(m.name)}</span><div style="flex:1"><b>${m.name}</b><small class="muted">${money(m.ev)} live EV</small></div>${ring(m.knowledge, 46)}</div>
        <div class="stats"><div><b>${m.live}</b><small class="muted">live deals</small></div><div><b>${m.deals}</b><small class="muted">all deals</small></div><div><b>${m.contacts}</b><small class="muted">relationships</small></div></div>
        <span class="btn sm" style="align-self:flex-start">Open handover pack</span>
      </a>`)}</div>`);
}

export async function renderHandover(view, member) {
  const [h, team] = await Promise.all([api.get(`/api/handover?member=${encodeURIComponent(member)}`), api.get('/api/team')]);
  const s = h.summary;
  const others = team.map((t) => t.name).filter((n) => n !== member);
  view.innerHTML = String(html`
    <div class="print-bar"><a class="btn" href="#/team">‹ Team</a>
      <div class="btn-row">
        <select id="to" style="width:auto;border-radius:980px">${options(others, '', { blank: 'Hand everything to…' })}</select>
        <button class="btn" id="reassign">Reassign</button>
        <button class="btn primary" id="print">Print / Save as PDF</button>
      </div></div>
    <div class="card card-pad ho-head" style="margin-bottom:24px">
      <span class="avatar lg" style="--c:var(--series-${(member.length % 7) + 1});width:72px;height:72px;font-size:24px">${initials(member)}</span>
      <div style="flex:1;min-width:240px"><div class="eyebrow">Handover pack</div><h1 style="margin-top:4px">${member}</h1>
        <p class="t2" style="margin:6px 0 0">Everything ${member} owns, in one place — generated ${fmtDate(h.generated_at)}.</p></div>
      <div class="row" style="gap:28px;flex-wrap:wrap">
        <div><div class="muted" style="font-size:12px">Live deals</div><b style="font-size:26px">${s.live}</b></div>
        <div><div class="muted" style="font-size:12px">Relationships</div><b style="font-size:26px">${s.contacts}</b></div>
        <div><div class="muted" style="font-size:12px">Strong (4–5)</div><b style="font-size:26px">${s.strong_relationships}</b></div>
        ${ring(s.knowledge, 72)}
      </div>
    </div>

    ${h.gaps.length ? html`<div class="banner"><span class="ico">!</span><div><b>Close these gaps before the handover</b>
      ${h.gaps.map((g) => html`<p><a href="#/company/${g.id}">${g.deal}</a> — missing ${g.missing.join(' · ')}</p>`)}</div></div>` : ''}

    <div class="section-head" style="margin-top:8px"><h2>Deals</h2><span class="muted">${h.deals.length}</span></div>
    ${h.deals.length ? h.deals.map((d) => html`
      <div class="card ho-deal" style="--c:${d.color}">
        <div class="head">${logo(d)}<div style="flex:1;min-width:0"><h3><a href="#/company/${d.id}" style="color:inherit">${d.name}</a></h3>
          <div class="muted" style="font-size:13px">${[d.codename, d.role, d.stage, d.advisor ? `via ${d.advisor}` : null].filter(Boolean).join(' · ')}</div></div>
          ${ring(d.knowledge.score, 48)}</div>
        ${d.description ? html`<p class="t2">${d.description}</p>` : ''}
        <div class="ho-grid">
          <div><h4>Where it stands</h4><ul>
            <li>${d.pass_reason ? html`Passed — <b>${d.pass_reason}</b>${d.pass_notes ? html`: ${d.pass_notes}` : ''}` : d.next_step ? html`Next: <b>${d.next_step}</b>${d.next_step_date ? ` (${fmtDate(d.next_step_date)})` : ''}` : 'No next step recorded'}</li>
            ${d.revisit_date ? html`<li>Revisit ${fmtDate(d.revisit_date)}</li>` : ''}
            ${d.nda_expiry_date ? html`<li>NDA ends ${fmtDate(d.nda_expiry_date)}</li>` : ''}
            <li>Last touch ${d.last_touch ? ago(d.last_touch) : '—'}</li>
            ${d.deal_team ? html`<li>Team: ${d.deal_team}</li>` : ''}</ul>
            ${d.risks.length ? html`<h4 style="margin-top:12px">Open questions</h4><ul>${d.risks.map((r) => html`<li>${r.text}</li>`)}</ul>` : ''}</div>
          <div><h4>What we've learned</h4>${d.meetings.filter((m) => m.takeaways || m.notes).length ? html`<ul>${d.meetings.filter((m) => m.takeaways || m.notes).map((m) => html`<li><b>${fmtDate(m.starts_at)}</b> ${m.takeaways || m.notes}</li>`)}</ul>` : html`<p class="muted">No meeting notes logged.</p>`}</div>
          <div><h4>Who to call</h4>${d.people.length ? html`<ul>${d.people.slice(0, 5).map((p) => html`<li><b>${p.name}</b> — ${[p.title, p.organization].filter(Boolean).join(', ')}${p.role ? ` · ${p.role}` : ''}</li>`)}</ul>` : html`<p class="muted">No people mapped.</p>`}</div>
        </div>
      </div>`) : html`<div class="card empty">No deals on ${member}'s plate.</div>`}

    <div class="section-head"><h2>Relationships to transfer</h2><span class="muted">${h.contacts.length}</span></div>
    ${h.contacts.length ? html`<div class="card table-wrap"><table class="table">
      <thead><tr><th>Person</th><th>Organisation</th><th>Strength</th><th>Last met</th><th>Deals</th><th>Notes</th></tr></thead>
      <tbody>${h.contacts.map((p) => html`<tr data-p="${p.id}">
        <td><b>${p.name}</b><br><small class="muted">${p.title || ''}</small></td>
        <td>${p.organization || p.company_name || '—'}</td><td>${strength(p.strength)}</td>
        <td class="${p.last_met ? '' : 'muted'}">${p.last_met ? ago(p.last_met) : 'never'}</td>
        <td>${p.deals.join(', ') || '—'}</td><td style="max-width:280px">${p.notes || html`<span class="muted">—</span>`}</td></tr>`)}</tbody></table></div>`
      : html`<div class="card empty">No relationships owned by ${member}.</div>`}`);

  $('#print', view).addEventListener('click', () => window.print());
  view.querySelector('tbody')?.addEventListener('click', (e) => { const r = e.target.closest('[data-p]'); if (r) contactView(+r.dataset.p); });
  $('#reassign', view).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const to = $('#to', view).value;
    if (!to) return toast('Choose who takes over', 'err');
    if (!(await confirmDialog(`Make ${to} the owner of all of ${member}'s deals and relationships? Each deal's timeline records the handover.`, { ok: 'Hand over', danger: false }))) return;
    try {
      const r = await api.post('/api/handover/reassign', { from: member, to });
      toast(`${r.deals} deal(s) and ${r.contacts} relationship(s) handed to ${to}`);
      location.hash = `#/team/${encodeURIComponent(to)}`;
    } catch (err) { errToast(err); }
  }));
}
