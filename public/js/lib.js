// Shared helpers and UI components.
import { h, render } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export { h, render, useState, useEffect, useRef, useCallback };

// ---------------------------------------------------------------- app state (tiny store)
const listeners = new Set();
const saved = (() => { try { return JSON.parse(localStorage.getItem('tj.state') || '{}'); } catch { return {}; } })();
export const store = {
  mode: saved.mode === 'sample' ? 'sample' : 'live',
  acct: saved.acct || 'all',
  firm: saved.firm || 'all',
  boot: null,
  toast: null,
};
export function setStore(patch) {
  Object.assign(store, patch);
  try { localStorage.setItem('tj.state', JSON.stringify({ mode: store.mode, acct: store.acct, firm: store.firm })); } catch { /* private mode */ }
  listeners.forEach((f) => f());
}
export function useStore() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((x) => x + 1); listeners.add(f); return () => listeners.delete(f); }, []);
  return store;
}
let toastTimer;
export function toast(msg, bad = false) {
  setStore({ toast: { msg, bad } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setStore({ toast: null }), bad ? 6000 : 3000);
}

// ---------------------------------------------------------------- API
export async function api(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const url = '/api' + path + (store.mode === 'sample' ? sep + 'mode=sample' : '');
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, init);
  const ct = res.headers.get('Content-Type') || '';
  if (!ct.includes('application/json')) {
    if (res.status === 401 || res.redirected || ct.includes('text/html')) throw new Error('Your sign-in has expired. Reload the page to sign in again.');
    throw new Error('Unexpected reply from the server (' + res.status + ')');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
  return data;
}
export async function reloadBoot() {
  const boot = await api('/bootstrap');
  // drop a saved filter that no longer exists in this data set
  const ids = new Set(boot.accounts.map((a) => String(a.id)));
  const firms = new Set(boot.firms.map((f) => String(f.id)));
  setStore({ boot, acct: ids.has(store.acct) ? store.acct : 'all', firm: firms.has(store.firm) ? store.firm : 'all' });
  return boot;
}

export const scopeQs = () => `acct=${encodeURIComponent(store.acct)}&firm=${encodeURIComponent(store.firm)}`;

/** Load data for a page; reloads when deps change. Returns {data, error, loading, reload}. */
export function useData(fn, deps) {
  const [st, setSt] = useState({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setSt((s) => ({ ...s, loading: true }));
    fn().then((data) => live && setSt({ data, error: null, loading: false }))
      .catch((e) => live && setSt({ data: null, error: e.message, loading: false }));
    return () => { live = false; };
  }, [...deps, n, store.mode]);
  return { ...st, reload: () => setN((x) => x + 1) };
}

// ---------------------------------------------------------------- formatting (Australia/Brisbane)
const TZ = 'Australia/Brisbane';
const fDate = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const fDateY = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const fTime = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const fTimeS = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export const fmt = {
  date: (t) => (t ? fDate.format(t) : '—'),
  dateY: (t) => (t ? fDateY.format(t) : '—'),
  time: (t) => (t ? fTime.format(t) : '—'),
  timeS: (t) => (t ? fTimeS.format(t) : '—'),
  dt: (t) => (t ? fDate.format(t) + ' ' + fTime.format(t) : '—'),
  money(v, dec = 2, sign = true) {
    if (v == null || !isFinite(v)) return '—';
    const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return (v < 0 ? '−' : sign && v > 0 ? '+' : '') + '$' + s;
  },
  plain: (v, dec = 2) => (v == null || !isFinite(v) ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })),
  r: (v) => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + 'R'),
  pct: (v, dec = 2, sign = true) => (v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : sign && v > 0 ? '+' : '') + Math.abs(v).toFixed(dec) + '%'),
  rate: (v) => (v == null ? '—' : Math.round(v * 100) + '%'),
  num: (v, dec = 2) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: dec })),
  ago(t) {
    if (!t) return 'never';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return s + ' s ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  },
  pf: (s) => (!s ? '—' : s.profitFactorInfinite ? '∞' : s.profitFactor == null ? '—' : s.profitFactor.toFixed(2)),
};
export const cls = (...xs) => xs.filter(Boolean).join(' ');
export const sgn = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
export const todayBne = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

// ---------------------------------------------------------------- icons
const P = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  ideas: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  strat: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  acct: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  ana: '<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  sync: '<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chev: '<path d="m9 6 6 6-6 6"/>', back: '<path d="m15 6-6 6 6 6"/>',
  check: '<path d="m5 12 4 4 10-10"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
};
export function Icon({ name, size = 18, fill = false }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill=${fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: P[name] || '' }}></svg>`;
}

// ---------------------------------------------------------------- components
export const Money = ({ v, dec = 2 }) => html`<span class=${cls('num', sgn(v))}>${fmt.money(v, dec)}</span>`;
export const R = ({ v }) => html`<span class=${cls('num', sgn(v))}>${fmt.r(v)}</span>`;
export const Dir = ({ d }) => html`<span class=${cls('chip', d === 'long' ? 'g' : 'r')}>${d === 'long' ? 'Long' : 'Short'}</span>`;

export function Kpi({ label, value, sub, tone }) {
  return html`<div class="card"><div class="lbl">${label}</div><div class=${cls('kv num', tone)}>${value}</div>${sub && html`<div class="sub" style="margin-top:6px">${sub}</div>`}</div>`;
}

export function Bar({ pct, color }) {
  const w = Math.max(0, Math.min(100, pct || 0));
  return html`<div class="bar"><i style=${`width:${w}%;${color ? 'background:' + color : ''}`}></i></div>`;
}

export function Loading({ state, children }) {
  if (state.error) return html`<div class="warn err">${state.error}</div>`;
  if (!state.data) return html`<div class="empty">Loading…</div>`;
  return children(state.data);
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);
  return html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="modal" role="dialog" aria-modal="true" aria-label=${title} style=${wide ? 'max-width:860px' : ''}>
      <div class="spread"><h2 class="h2" style="font-size:18px">${title}</h2>
        <button class="btn ghost sm" onClick=${onClose} aria-label="Close"><${Icon} name="x"/></button></div>
      ${children}
    </div></div>`;
}

export function Seg({ options, value, onChange, label }) {
  return html`<div class="seg" role="group" aria-label=${label}>${options.map(([v, l]) => html`
    <button type="button" class=${value === v ? 'on' : ''} aria-pressed=${value === v} onClick=${() => onChange(v)}>${l}</button>`)}</div>`;
}

/** Multi-series line chart. series: [{name, color, dash, points:[{x, y}]}], x numeric. */
export function LineChart({ series, height = 220, yFmt = (v) => v, xLabels = [], zero = true, label }) {
  const W = 640, H = height, L = 52, Rm = 12, T = 12, B = 28;
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return html`<div class="empty">No closed trades in this period yet.</div>`;
  let lo = Math.min(...pts.map((p) => p.y), zero ? 0 : Infinity), hi = Math.max(...pts.map((p) => p.y), zero ? 0 : -Infinity);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const xs = pts.map((p) => p.x); const x0 = Math.min(...xs), x1 = Math.max(...xs) || 1;
  const X = (x) => L + (W - L - Rm) * (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0));
  const Y = (y) => T + (H - T - B) * (hi - y) / (hi - lo);
  const ticks = niceTicks(lo, hi, 4);
  return html`<svg viewBox=${`0 0 ${W} ${H}`} width="100%" role="img" aria-label=${label || 'Chart'}>
    ${ticks.map((v) => html`<line x1=${L} x2=${W - Rm} y1=${Y(v)} y2=${Y(v)} stroke=${v === 0 ? '#2A3242' : '#1A1F29'}/>
      <text x=${L - 8} y=${Y(v) + 4} fill="#97A0AE" font-size="11" text-anchor="end" font-family="JetBrains Mono, monospace">${yFmt(v)}</text>`)}
    ${xLabels.map((l, k) => html`<text x=${X(l.x)} y=${H - 8} fill="#97A0AE" font-size="11" text-anchor=${X(l.x) < L + 30 ? 'start' : X(l.x) > W - Rm - 30 ? 'end' : 'middle'}>${l.label}</text>`)}
    ${series.map((s) => html`<path d=${s.points.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ')}
      fill="none" stroke=${s.color} stroke-width=${s.dash ? 2 : 2.5} stroke-dasharray=${s.dash || ''} stroke-linejoin="round" stroke-linecap="round"/>`)}
  </svg>`;
}
function niceTicks(lo, hi, n) {
  const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export function HBar({ label, sub, value, max, fmtv = (v) => fmt.money(v, 0) }) {
  const w = max ? Math.abs(value) / max * 100 : 0;
  return html`<div class="hbar"><span>${label}${sub && html`<span class="sub" style="display:block">${sub}</span>`}</span>
    <div class="bar" style="height:10px"><i style=${`width:${w}%;background:${value >= 0 ? 'var(--pos)' : 'var(--neg)'}`}></i></div>
    <span class=${cls('num r', sgn(value))}>${fmtv(value)}</span></div>`;
}

export function SampleChip() {
  const s = useStore();
  return s.mode === 'sample' ? html`<span class="chip a">Sample data · not your trades</span>` : null;
}

/** Account / firm filter used at the top of the data pages. */
export function ScopeFilter() {
  const s = useStore();
  const b = s.boot;
  if (!b) return null;
  const accounts = b.accounts.filter((a) => a.status === 'active');
  return html`<div class="hstack">
    <label class="sr" for="firmf">Prop firm</label>
    <select id="firmf" class="inp" value=${s.firm} onChange=${(e) => setStore({ firm: e.target.value, acct: 'all' })}>
      <option value="all">All firms</option>${b.firms.map((f) => html`<option value=${f.id}>${f.name}</option>`)}</select>
    <label class="sr" for="acctf">Account</label>
    <select id="acctf" class="inp" value=${s.acct} onChange=${(e) => setStore({ acct: e.target.value })}>
      <option value="all">All accounts (combined)</option>
      ${accounts.filter((a) => s.firm === 'all' || String(a.firm_id) === s.firm).map((a) => html`<option value=${a.id}>${a.name}${a.role === 'master' ? ' · Master' : a.role === 'copy' ? ' · Copy' : ''}</option>`)}
    </select></div>`;
}

export function PageHead({ title, sub, children, filter = true }) {
  return html`<header class="spread" style="align-items:flex-start">
    <div class="stack" style="gap:4px"><h1 class="h1">${title}</h1>${sub && html`<div class="sub" style="font-size:13px">${sub}</div>`}</div>
    <div class="hstack"><${SampleChip}/>${children}${filter && html`<${ScopeFilter}/>`}</div></header>`;
}

export const roleLabel = (a) => (a.role === 'master' ? 'Master' : a.role === 'copy' ? 'Copy' : 'Standalone');
export const kindLabel = (k) => ({ challenge: 'Challenge', funded: 'Funded', personal: 'Personal', demo: 'Demo' }[k] || k);
export const online = (a) => a.last_seen && Date.now() - a.last_seen < 3 * 60000;
