// Rendering helpers, formatting, modals, toasts and small reusable widgets.
import { store } from './api.js';
import { icon as svgIcon } from './icons.js';

// ---------------------------------------------------------------- templating
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export function esc(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(esc).join('');
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += esc(v) + strings[i + 1]; });
  return new Raw(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function on(root, event, selector, fn) {
  root.addEventListener(event, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) fn(e, t);
  });
}

// ---------------------------------------------------------------- formatting
const SYM = { USD: '$', EUR: '€', GBP: '£', CHF: 'CHF ', CAD: 'C$', AUD: 'A$', JPY: '¥' };
export const curSym = (c) => SYM[c || store.meta?.settings?.base_currency || 'USD'] ?? `${c} `;
export function money(m, cur) {
  if (m == null || m === '' || isNaN(m)) return '—';
  const s = curSym(cur);
  const n = Number(m);
  if (Math.abs(n) >= 1000) return `${s}${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })}bn`;
  return `${s}${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 1 : 0 })}m`;
}
export const num = (n, d = 0) => (n == null || n === '' ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
export const pct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);
export const mult = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}x`);

export function parseDate(s) {
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return isNaN(d) ? null : d;
}
export function fmtDate(s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = parseDate(s);
  return d ? d.toLocaleDateString(undefined, opts) : '—';
}
export function fmtDateTime(s) {
  const d = parseDate(s);
  return d ? d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}
export function fmtTime(s) {
  const d = parseDate(s);
  return d ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
}
export function ago(s) {
  const d = parseDate(s);
  if (!d) return '';
  const sec = (Date.now() - d.getTime()) / 1000;
  const fut = sec < 0;
  const a = Math.abs(sec);
  const units = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month'], [Infinity, 'year']];
  const div = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 };
  for (const [lim, u] of units) {
    if (a < lim) {
      const v = Math.max(1, Math.round(a / div[u]));
      if (u === 'second') return fut ? 'in a moment' : 'just now';
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(fut ? v : -v, u);
    }
  }
  return '';
}
export function toLocalInput(s) {
  const d = parseDate(s) || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const initials = (name) => (name || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

// ---------------------------------------------------------------- visuals
export function logo(c, size = '') {
  const name = c.name || c.company_name || '';
  const url = c.logo_url ?? c.company_logo_url;
  const color = c.color || c.company_color || '#3b5bdb';
  if (url) return html`<span class="logo ${size} has-img" style="--c:${color}"><img src="${url}" alt="" loading="lazy"></span>`;
  return html`<span class="logo ${size}" style="--c:${color}">${initials(name)}</span>`;
}
export const TYPE_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];
export function typeColor(type) {
  const types = store.meta?.settings?.contact_types || [];
  const i = types.indexOf(type);
  return i >= 0 && i < TYPE_COLORS.length ? TYPE_COLORS[i] : '#8d8f97';
}
export function avatar(p, size = '') {
  return html`<span class="avatar ${size}" style="--c:${typeColor(p.contact_type)}" title="${p.contact_type || ''}">${initials(p.name)}</span>`;
}
export function strength(n) {
  return html`<span class="strength" title="Relationship strength ${n || 0}/5">${[1, 2, 3, 4, 5].map((i) => html`<i class="${i <= (n || 0) ? 'on' : ''}"></i>`)}</span>`;
}
export function stageChip(stage) {
  if (!stage) return '';
  return html`<span class="chip stage">${stage}</span>`;
}
export function prioChip(p) {
  if (p !== 'High') return '';
  return html`<span class="prio" title="High priority">${ic('flag', 'sm')}High</span>`;
}
export function sentimentChip(s) {
  if (!s) return '';
  const cls = s === 'Positive' ? 'pos' : s === 'Negative' ? 'neg' : '';
  return html`<span class="sent ${cls}">${s}</span>`;
}
export function dateBlock(s) {
  const d = parseDate(s);
  if (!d) return '';
  const past = d < new Date();
  return html`<div class="date-block ${past ? 'past' : ''}"><div class="m">${d.toLocaleDateString(undefined, { month: 'short' })}</div><div class="d">${d.getDate()}</div></div>`;
}

// Lucide line icons (see icons.js). ic() returns markup ready for html``.
export const ic = (name, cls = '') => raw(svgIcon(name, cls));
export const ICONS = new Proxy({}, { get: (_, name) => ic(name) });

// ---------------------------------------------------------------- toasts
// toast('Saved') · toast('Moved', '', { action: 'Undo', onAction })
export function toast(msg, type = '', { action, onAction, icon: iconName, ms } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = String(html`${iconName ? ic(iconName) : type === 'err' ? ic('alert') : ''}<span>${msg}</span>${action ? html`<button type="button">${action}</button>` : ''}`);
  const root = $('#toast-root');
  while (root.children.length > 2) root.firstElementChild.remove();
  root.appendChild(el);
  const leave = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); };
  const timer = setTimeout(leave, ms || (action ? 6000 : type === 'err' ? 6000 : 2800));
  if (action) el.querySelector('button').addEventListener('click', () => { clearTimeout(timer); leave(); onAction && onAction(); });
}
export const errToast = (e) => toast(e.message || String(e), 'err');

// ---------------------------------------------------------------- tooltip
export function showTip(e, content) {
  const tip = $('#tooltip');
  tip.innerHTML = String(content);
  tip.hidden = false;
  const pad = 14;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
export function hideTip() { $('#tooltip').hidden = true; }

// ---------------------------------------------------------------- modal
export function modal({ title, body, foot, size = '', onMount, onClose }) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = String(html`
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? html`<div class="modal-foot">${foot}</div>` : ''}
    </div>`);
  root.appendChild(wrap);
  const prevFocus = document.activeElement;
  const close = () => {
    if (wrap.classList.contains('closing')) return;
    wrap.classList.add('closing');
    setTimeout(() => wrap.remove(), 140);
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
    prevFocus && prevFocus.focus && prevFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === wrap) close(); };
  document.addEventListener('keydown', onKey);
  let downOnBackdrop = false;
  wrap.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === wrap; });
  wrap.addEventListener('click', (e) => {
    if ((e.target === wrap && downOnBackdrop) || e.target.closest('[data-close]')) close();
  });
  const el = $('.modal', wrap);
  onMount && onMount(el, close);
  const first = $('input:not([type=hidden]):not([type=checkbox]), textarea, select', el);
  first && setTimeout(() => first.focus(), 30);
  return { el, close };
}

export function confirmDialog(message, { ok = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    let result = false;
    modal({
      title: 'Please confirm', size: 'narrow', body: html`<p>${message}</p>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${ok}</button>`,
      onMount: (el, close) => $('[data-ok]', el).addEventListener('click', () => { result = true; close(); }),
      onClose: () => resolve(result),
    });
  });
}

// ---------------------------------------------------------------- forms
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}
export function options(list, selected, { blank } = {}) {
  return html`${blank != null ? html`<option value="">${blank}</option>` : ''}${(list || []).map((o) => {
    const v = typeof o === 'object' ? o.value : o;
    const l = typeof o === 'object' ? o.label : o;
    return html`<option value="${v}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${l}</option>`;
  })}${selected && !(list || []).some((o) => String(typeof o === 'object' ? o.value : o) === String(selected)) ? html`<option selected>${selected}</option>` : ''}`;
}
export async function withBusy(btn, fn) {
  btn && btn.classList.add('loading');
  try { return await fn(); } finally { btn && btn.classList.remove('loading'); }
}

// Drag-and-drop / click file picker.
export function dropzone(el, onFiles, { accept, multiple = false } = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  if (accept) input.accept = accept;
  input.multiple = multiple;
  input.hidden = true;
  el.appendChild(input);
  el.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('over');
    if (e.dataTransfer.files.length) onFiles(multiple ? [...e.dataTransfer.files] : [e.dataTransfer.files[0]]);
  });
}
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.click();
  });
}

// Most prominent saturated colour in an image (for "use logo colour").
export function dominantColor(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const S = 48;
        const c = document.createElement('canvas');
        c.width = S; c.height = S;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, S, S);
        const d = ctx.getImageData(0, 0, S, S).data;
        const buckets = new Map();
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
          if (a < 200) continue;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          if (sat < 0.25 || max < 40) continue; // skip greys, white, black
          const key = `${r >> 4},${g >> 4},${b >> 4}`;
          const bk = buckets.get(key) || { score: 0, count: 0, r: 0, g: 0, b: 0 };
          bk.score += 1 + sat; bk.count += 1; bk.r += r; bk.g += g; bk.b += b;
          buckets.set(key, bk);
        }
        let best = null;
        for (const bk of buckets.values()) if (!best || bk.score > best.score) best = bk;
        if (!best) return resolve(null);
        const h = (v) => Math.round(v / best.count).toString(16).padStart(2, '0');
        resolve(`#${h(best.r)}${h(best.g)}${h(best.b)}`);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export const BRAND_SWATCHES = ['#2563eb', '#0d9488', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#4f46e5', '#0891b2', '#475569', '#111827'];

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function fileExt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : 'file';
}
export function bytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

// Progress ring for "knowledge captured" scores (the number is always shown, colour is secondary).
export function ring(score, size = 56) {
  if (score == null) return html`<span class="ring" style="--s:${size}px"><svg viewBox="0 0 36 36"><circle class="bg" cx="18" cy="18" r="15.5" fill="none" stroke-width="3.5"/></svg><span>—</span></span>`;
  const c = 2 * Math.PI * 15.5;
  const col = score >= 75 ? 'var(--ink)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
  return html`<span class="ring" style="--s:${size}px;--k:${col}" title="${score}% captured"><svg viewBox="0 0 36 36"><circle class="bg" cx="18" cy="18" r="15.5" fill="none" stroke-width="3.5"/><circle class="fg" cx="18" cy="18" r="15.5" fill="none" stroke-width="3.5" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - score / 100)}"/></svg>${size >= 44 ? html`<span>${score}%</span>` : ''}</span>`;
}
