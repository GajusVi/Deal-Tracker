// Small dependency-free charts: horizontal bars and grouped columns, with hover tooltips.
import { html, esc, showTip, hideTip } from './ui.js';

// items: [{label, value, sub?, href?, tip?}] - single series, magnitude => one hue.
export function hbars(el, items, { format = (v) => v, empty = 'No data yet', max } = {}) {
  if (!items.length || items.every((i) => !i.value)) {
    el.innerHTML = String(html`<div class="empty">${empty}</div>`);
    return;
  }
  const top = max ?? Math.max(...items.map((i) => i.value || 0), 1);
  el.innerHTML = String(html`<div class="hbars">${items.map((it, idx) => html`
    <div class="hbar" data-i="${idx}" ${it.href ? html`style="cursor:pointer"` : ''}>
      <span class="lbl" title="${it.label}">${it.label}</span>
      <span class="track"><span class="fill" style="width:${Math.max(0.5, ((it.value || 0) / top) * 100)}%"></span></span>
      <span class="val">${format(it.value)}${it.sub ? html`<small class="muted">${it.sub}</small>` : ''}</span>
    </div>`)}</div>`);
  el.querySelectorAll('.hbar').forEach((row) => {
    const it = items[+row.dataset.i];
    row.addEventListener('mousemove', (e) => showTip(e, it.tip || html`<b>${it.label}</b><br>${format(it.value)}${it.sub ? ` · ${esc(it.sub)}` : ''}`));
    row.addEventListener('mouseleave', hideTip);
    if (it.href) row.addEventListener('click', () => { hideTip(); location.hash = it.href; });
  });
}

// categories: ['2022', ...]; series: [{key,label,color}]; rows: [{cat, [key]: value, projected?}]
export function columns(el, { categories, series, rows, height = 220, format = (v) => v, isProjected }) {
  const W = Math.max(el.clientWidth || 520, 280);
  const H = height;
  const m = { t: 18, r: 8, b: 26, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxV = Math.max(1, ...rows.flatMap((r) => series.map((s) => r[s.key] || 0)));
  const ticks = niceTicks(maxV);
  const top = ticks[ticks.length - 1];
  const band = iw / categories.length;
  const gap = 2;
  const groupW = Math.min(band * 0.72, 26 * series.length + gap * (series.length - 1));
  const barW = (groupW - gap * (series.length - 1)) / series.length;
  const y = (v) => m.t + ih - (v / top) * ih;
  const id = `hatch${Math.random().toString(36).slice(2, 8)}`;

  const svg = [];
  svg.push(`<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">`);
  svg.push(`<defs>${series.map((s, j) => `<pattern id="${id}-${j}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--surface)"/><line x1="0" y1="0" x2="0" y2="6" stroke="${s.color}" stroke-width="3"/></pattern>`).join('')}</defs>`);
  ticks.forEach((t) => {
    svg.push(`<line class="${t === 0 ? 'baseline' : 'gridline'}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`);
    svg.push(`<text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${esc(format(t, true))}</text>`);
  });
  const step = Math.ceil(categories.length / Math.floor(iw / 44));
  rows.forEach((r, i) => {
    const gx = m.l + band * i + (band - groupW) / 2;
    const proj = isProjected ? isProjected(r) : false;
    svg.push(`<g class="col-group" data-i="${i}"><rect class="hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"/>`);
    series.forEach((s, j) => {
      const v = r[s.key] || 0;
      if (!v) return;
      const x = gx + j * (barW + gap);
      const h = Math.max(1, (v / top) * ih);
      const yy = m.t + ih - h;
      const rr = Math.min(4, barW / 2, h);
      // rounded data-end (top), square at the baseline
      const d = `M${x},${m.t + ih}V${yy + rr}Q${x},${yy} ${x + rr},${yy}H${x + barW - rr}Q${x + barW},${yy} ${x + barW},${yy + rr}V${m.t + ih}Z`;
      svg.push(proj
        ? `<path d="${d}" fill="url(#${id}-${j})" stroke="${s.color}" stroke-width="1"/>`
        : `<path d="${d}" fill="${s.color}"/>`);
    });
    if (i % step === 0) svg.push(`<text x="${m.l + band * i + band / 2}" y="${H - 8}" text-anchor="middle">${esc(r.label ?? r.cat)}</text>`);
    svg.push('</g>');
  });
  svg.push('</svg>');
  const legend = series.length > 1 || isProjected
    ? `<div class="legend" style="margin-top:6px">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}${isProjected && rows.some(isProjected) ? '<span><i style="background:repeating-linear-gradient(45deg,var(--text-3) 0 2px,transparent 2px 4px);border:1px solid var(--text-3)"></i>Projected</span>' : ''}</div>`
    : '';
  el.innerHTML = svg.join('') + legend;
  el.querySelectorAll('.col-group').forEach((g) => {
    const r = rows[+g.dataset.i];
    g.addEventListener('mousemove', (e) => showTip(e,
      `<b>${esc(r.tipTitle ?? r.label ?? r.cat)}${isProjected && isProjected(r) ? ' (projected)' : ''}</b><br>` +
      series.map((s) => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-right:6px"></span>${esc(s.label)}: <b>${esc(format(r[s.key] || 0))}</b>`).join('<br>')));
    g.addEventListener('mouseleave', hideTip);
  });
}

function niceTicks(max, count = 4) {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(+v.toFixed(6));
  if (out[out.length - 1] < max) out.push(+(out[out.length - 1] + step).toFixed(6));
  return out;
}
