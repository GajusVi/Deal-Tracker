// Force-directed relationship diagram (companies, organisations, people) in plain SVG.
import { icon as svgIcon } from './icons.js';
import { esc, initials, typeColor, showTip, hideTip, html } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const R = { company: 22, org: 16, contact: 12 };

export function networkGraph(wrap, data, { onOpen, highlight } = {}) {
  wrap.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  wrap.appendChild(svg);
  const W = wrap.clientWidth || 800, H = wrap.clientHeight || 500;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const nodes = data.nodes.map((n, i) => {
    const a = (i / data.nodes.length) * Math.PI * 2;
    const rad = n.kind === 'company' ? 0.18 : 0.38;
    return { ...n, x: W / 2 + Math.cos(a) * W * rad + (Math.random() - 0.5) * 30, y: H / 2 + Math.sin(a) * H * rad + (Math.random() - 0.5) * 30, vx: 0, vy: 0, r: R[n.kind] + (n.kind === 'contact' ? (n.strength || 3) - 3 : 0) };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = data.edges.map((e) => ({ ...e, s: byId.get(e.source), t: byId.get(e.target) })).filter((e) => e.s && e.t);
  const nbrs = new Map(nodes.map((n) => [n.id, new Set([n.id])]));
  edges.forEach((e) => { nbrs.get(e.s.id).add(e.t.id); nbrs.get(e.t.id).add(e.s.id); });

  const view = document.createElementNS(NS, 'g');
  svg.appendChild(view);
  const gEdges = document.createElementNS(NS, 'g');
  const gLabels = document.createElementNS(NS, 'g');
  const gNodes = document.createElementNS(NS, 'g');
  view.append(gEdges, gLabels, gNodes);

  edges.forEach((e) => {
    e.el = document.createElementNS(NS, 'line');
    e.el.setAttribute('class', `edge ${e.kind}`);
    gEdges.appendChild(e.el);
    e.lbl = document.createElementNS(NS, 'text');
    e.lbl.setAttribute('class', 'elabel');
    e.lbl.setAttribute('text-anchor', 'middle');
    e.lbl.textContent = e.label || '';
    gLabels.appendChild(e.lbl);
  });

  nodes.forEach((n) => {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', `node ${n.kind}`);
    let inner = '';
    if (n.kind === 'company') {
      const s = n.r * 2;
      inner = `<rect class="ring" x="${-n.r - 3}" y="${-n.r - 3}" width="${s + 6}" height="${s + 6}" rx="12"/>`
        + `<rect x="${-n.r}" y="${-n.r}" width="${s}" height="${s}" rx="10" fill="${esc(n.color || '#3b5bdb')}"/>`
        + (n.logo_url
          ? `<rect x="${-n.r + 2}" y="${-n.r + 2}" width="${s - 4}" height="${s - 4}" rx="8" fill="#fff"/><image href="${esc(n.logo_url)}" x="${-n.r + 4}" y="${-n.r + 4}" width="${s - 8}" height="${s - 8}" preserveAspectRatio="xMidYMid meet"/>`
          : `<text text-anchor="middle" dy="4" style="fill:#fff;stroke:none;font-weight:700;font-size:12px">${esc(initials(n.label))}</text>`);
    } else if (n.kind === 'org') {
      inner = `<rect class="ring" x="${-n.r - 3}" y="${-n.r - 3}" width="${n.r * 2 + 6}" height="${n.r * 2 + 6}" rx="8"/>`
        + `<rect x="${-n.r}" y="${-n.r}" width="${n.r * 2}" height="${n.r * 2}" rx="6" fill="var(--ink)"/>`
        + `<text text-anchor="middle" dy="4" style="fill:var(--canvas);stroke:none;font-weight:700;font-size:10px">${esc(initials(n.label))}</text>`;
    } else {
      inner = `<circle class="ring" r="${n.r + 2}"/><circle r="${n.r}" fill="${typeColor(n.type)}"/>`;
    }
    inner += `<text text-anchor="middle" y="${n.r + 14}" style="font-weight:${n.kind === 'contact' ? 500 : 650}">${esc(n.label)}</text>`;
    g.innerHTML = inner;
    n.el = g;
    gNodes.appendChild(g);

    g.addEventListener('mouseenter', (e) => focus(n, e));
    g.addEventListener('mousemove', (e) => tip(n, e));
    g.addEventListener('mouseleave', () => { if (!dragging) unfocus(); });
    g.addEventListener('pointerdown', (e) => startDrag(e, n));
  });

  function tip(n, e) {
    const kind = n.kind === 'company' ? 'Company' : n.kind === 'org' ? 'Organisation' : (n.type || 'Contact');
    showTip(e, html`<b>${n.label}</b><br>${kind}${n.sub ? html` · ${n.sub}` : ''}<br><small>${nbrs.get(n.id).size - 1} connection(s)${n.kind !== 'org' ? ' · click to open' : ''}</small>`);
  }
  function focus(n) {
    wrap.classList.add('focus');
    const set = nbrs.get(n.id);
    nodes.forEach((m) => m.el.classList.toggle('hl', set.has(m.id)));
    edges.forEach((e) => {
      const on = e.s === n || e.t === n;
      e.el.classList.toggle('hl', on);
      e.lbl.classList.toggle('hl', on);
    });
  }
  function unfocus() {
    hideTip();
    if (highlightSet) return applyHighlight();
    wrap.classList.remove('focus');
  }

  // ------------------------------------------------------------ simulation
  let alpha = 1;
  function tick() {
    const k = Math.sqrt((W * H) / Math.max(nodes.length, 1)) * 0.7;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2);
        const f = (k * k) / d2 * 0.9;
        dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        const min = a.r + b.r + 26;
        if (d < min) { const p = (min - d) / 2; a.x += dx * p; a.y += dy * p; b.x -= dx * p; b.y -= dy * p; }
      }
    }
    edges.forEach((e) => {
      let dx = e.t.x - e.s.x, dy = e.t.y - e.s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const target = e.kind === 'relation' ? k * 0.9 : k * 0.75;
      const f = (d - target) * 0.04;
      dx /= d; dy /= d;
      e.s.vx += dx * f; e.s.vy += dy * f; e.t.vx -= dx * f; e.t.vy -= dy * f;
    });
    nodes.forEach((n) => {
      n.vx += (W / 2 - n.x) * 0.006;
      n.vy += (H / 2 - n.y) * 0.006;
      if (n.fixed) { n.vx = n.vy = 0; return; }
      n.x += Math.max(-30, Math.min(30, n.vx * alpha));
      n.y += Math.max(-30, Math.min(30, n.vy * alpha));
      n.vx *= 0.55; n.vy *= 0.55;
    });
    alpha = Math.max(0.02, alpha * 0.985);
  }
  function draw() {
    edges.forEach((e) => {
      e.el.setAttribute('x1', e.s.x); e.el.setAttribute('y1', e.s.y);
      e.el.setAttribute('x2', e.t.x); e.el.setAttribute('y2', e.t.y);
      e.lbl.setAttribute('x', (e.s.x + e.t.x) / 2); e.lbl.setAttribute('y', (e.s.y + e.t.y) / 2 - 3);
    });
    nodes.forEach((n) => n.el.setAttribute('transform', `translate(${n.x},${n.y})`));
  }
  // Pre-settle off-screen so the first frame is already readable.
  for (let i = 0; i < 220; i++) tick();
  draw();
  let running = true, frames = 0;
  function loop() {
    if (!running || !wrap.isConnected) return;
    if (alpha > 0.03 || dragging) { tick(); draw(); }
    frames++;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ------------------------------------------------------------ pan / zoom / drag
  let tx = 0, ty = 0, sc = 1, dragging = null, panning = null, moved = false;
  const apply = () => view.setAttribute('transform', `translate(${tx},${ty}) scale(${sc})`);
  const toWorld = (cx, cy) => {
    const r = svg.getBoundingClientRect();
    const vx = ((cx - r.left) / r.width) * W, vy = ((cy - r.top) / r.height) * H;
    return [(vx - tx) / sc, (vy - ty) / sc];
  };
  function startDrag(e, n) {
    e.stopPropagation();
    dragging = n; moved = false; n.fixed = true; alpha = Math.max(alpha, 0.3);
    svg.setPointerCapture(e.pointerId);
  }
  svg.addEventListener('pointerdown', (e) => {
    if (dragging) return;
    panning = { x: e.clientX, y: e.clientY, tx, ty };
    svg.classList.add('panning');
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (dragging) {
      const [x, y] = toWorld(e.clientX, e.clientY);
      if (Math.abs(x - dragging.x) + Math.abs(y - dragging.y) > 2) moved = true;
      dragging.x = x; dragging.y = y; draw();
    } else if (panning) {
      const r = svg.getBoundingClientRect();
      tx = panning.tx + ((e.clientX - panning.x) / r.width) * W;
      ty = panning.ty + ((e.clientY - panning.y) / r.height) * H;
      apply();
    }
  });
  svg.addEventListener('pointerup', () => {
    if (dragging) {
      const n = dragging;
      dragging = null;
      n.fixed = false;
      if (!moved && n.kind !== 'org' && onOpen) { hideTip(); onOpen(n); }
    }
    panning = null;
    svg.classList.remove('panning');
  });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
  }, { passive: false });
  function zoomAt(f, cx, cy) {
    const r = svg.getBoundingClientRect();
    const vx = cx != null ? ((cx - r.left) / r.width) * W : W / 2;
    const vy = cy != null ? ((cy - r.top) / r.height) * H : H / 2;
    const ns = Math.min(4, Math.max(0.25, sc * f));
    tx = vx - ((vx - tx) * ns) / sc; ty = vy - ((vy - ty) * ns) / sc; sc = ns;
    apply();
  }
  function fit() {
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    if (!xs.length) return;
    const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + 60, minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 50;
    sc = Math.min(2, W / (maxX - minX), H / (maxY - minY));
    tx = (W - (maxX + minX) * sc) / 2; ty = (H - (maxY + minY) * sc) / 2;
    apply();
  }
  fit();

  const tools = document.createElement('div');
  tools.className = 'graph-tools';
  tools.innerHTML = `<button title="Zoom in" data-z="in">${svgIcon('plus')}</button><button title="Zoom out" data-z="out">${svgIcon('minus')}</button><button title="Fit to screen" data-z="fit">${svgIcon('fit')}</button>`;
  tools.addEventListener('click', (e) => {
    const z = e.target.closest('[data-z]')?.dataset.z;
    if (z === 'in') zoomAt(1.25); else if (z === 'out') zoomAt(0.8); else if (z === 'fit') fit();
  });
  wrap.appendChild(tools);

  // ------------------------------------------------------------ highlight (search)
  let highlightSet = null;
  function applyHighlight() {
    if (!highlightSet) { wrap.classList.remove('focus'); return; }
    wrap.classList.add('focus');
    nodes.forEach((m) => m.el.classList.toggle('hl', highlightSet.has(m.id)));
    edges.forEach((e) => {
      const on = highlightSet.has(e.s.id) && highlightSet.has(e.t.id);
      e.el.classList.toggle('hl', on); e.lbl.classList.toggle('hl', false);
    });
  }
  function setHighlight(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) { highlightSet = null; applyHighlight(); return; }
    const hits = nodes.filter((n) => n.label.toLowerCase().includes(q) || (n.sub || '').toLowerCase().includes(q));
    highlightSet = new Set();
    hits.forEach((n) => nbrs.get(n.id).forEach((id) => highlightSet.add(id)));
    applyHighlight();
  }
  if (highlight) setHighlight(highlight);

  return { fit, setHighlight, stop: () => { running = false; }, frames: () => frames };
}
