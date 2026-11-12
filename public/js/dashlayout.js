// Customisable dashboard layout: panels in columns, per screen size (desktop / tablet / phone).
// Stored in settings.dash_layout as { desktop: L, tablet: L, phone: L }, where
// L = { cols: [[{ id, size }]], widths: [fr...], hidden: [id...] }.
// size: 'auto' (fits its content) | 's' | 'm' | 'l' (share of the column height on one-screen desktops,
// fixed heights when the page scrolls).
import { useState, useEffect } from 'preact/hooks';

export const PANELS = {
  kpis: 'Key figures',
  chart: 'Return by account',
  ideas: 'Recent trading ideas',
  calendar: 'Economic calendar',
  hours: 'Market hours',
  split: 'Profit split',
  prep: 'Daily preparation',
  accounts: 'Accounts',
};
const COLUMN_IDS = Object.keys(PANELS).filter((k) => k !== 'kpis');
export const SIZES = [['auto', 'Fit'], ['s', 'S'], ['m', 'M'], ['l', 'L']];

const P = (id, size) => ({ id, size });
export const DEFAULTS = {
  desktop: { cols: [[P('chart', 'm'), P('ideas', 'l')], [P('calendar', 'l'), P('hours', 'auto'), P('split', 'auto')], [P('prep', 'auto'), P('accounts', 'l')]], widths: [1.3, 1, 1], hidden: [] },
  tablet: { cols: [[P('prep', 'auto'), P('chart', 'auto'), P('ideas', 'm')], [P('accounts', 'auto'), P('calendar', 'l'), P('hours', 'auto'), P('split', 'auto')]], widths: [1, 1], hidden: [] },
  phone: { cols: [[P('prep', 'auto'), P('accounts', 'auto'), P('chart', 'auto'), P('ideas', 'm'), P('calendar', 'l'), P('hours', 'auto'), P('split', 'auto')]], widths: [1], hidden: [] },
};

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Make a stored layout safe: known panels only, each once, missing ones appended to the shortest column. */
export function normalise(l, bp) {
  const def = DEFAULTS[bp];
  if (!l || !Array.isArray(l.cols) || !l.cols.length) return clone(def);
  const seen = new Set();
  const cols = l.cols.slice(0, 4).map((c) => (Array.isArray(c) ? c : []).filter((p) => p && COLUMN_IDS.includes(p.id) && !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ id: p.id, size: SIZES.some(([k]) => k === p.size) ? p.size : 'auto' })));
  for (const id of COLUMN_IDS) {
    if (seen.has(id)) continue;
    const fromDef = def.cols.flat().find((p) => p.id === id) || P(id, 'auto');
    const shortest = cols.reduce((a, c, k) => (c.length < cols[a].length ? k : a), 0);
    cols[shortest].push({ ...fromDef });
  }
  const widths = cols.map((_, k) => { const w = Number((l.widths || [])[k]); return w >= 0.5 && w <= 3 ? Math.round(w * 10) / 10 : 1; });
  const hidden = (Array.isArray(l.hidden) ? l.hidden : []).filter((id) => id in PANELS);
  return { cols, widths, hidden };
}

export function bpOf(w) { return w >= 1280 ? 'desktop' : w > 760 ? 'tablet' : 'phone'; }

/** Current screen size class and whether the page is in one-screen mode (panels share the height). */
export function useScreen() {
  const get = () => ({ bp: bpOf(window.innerWidth), fit: window.innerWidth >= 1280 && window.innerHeight >= 720 });
  const [v, setV] = useState(get);
  useEffect(() => {
    let t;
    const on = () => { clearTimeout(t); t = setTimeout(() => { const n = get(); setV((o) => (o.bp === n.bp && o.fit === n.fit ? o : n)); }, 120); };
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('resize', on); clearTimeout(t); };
  }, []);
  return v;
}

// ---- edits (all return a new layout) ----
export function movePanel(l, id, toCol, toIdx) {
  const n = clone(l);
  let item;
  n.cols = n.cols.map((c) => c.filter((p) => (p.id === id ? ((item = p), false) : true)));
  if (!item) item = { id, size: 'auto' };
  const col = n.cols[Math.max(0, Math.min(toCol, n.cols.length - 1))];
  col.splice(Math.max(0, Math.min(toIdx, col.length)), 0, item);
  n.hidden = n.hidden.filter((h) => h !== id);
  return n;
}
export function where(l, id) {
  for (let c = 0; c < l.cols.length; c++) { const i = l.cols[c].findIndex((p) => p.id === id); if (i >= 0) return [c, i]; }
  return null;
}
export function nudge(l, id, dir) {
  const w = where(l, id); if (!w) return l;
  const [c, i] = w;
  if (dir === 'up') return i > 0 ? movePanel(l, id, c, i - 1) : l;
  if (dir === 'down') return i < l.cols[c].length - 1 ? movePanel(l, id, c, i + 1) : l;
  if (dir === 'left') return c > 0 ? movePanel(l, id, c - 1, Math.min(i, l.cols[c - 1].length)) : l;
  if (dir === 'right') return c < l.cols.length - 1 ? movePanel(l, id, c + 1, Math.min(i, l.cols[c + 1].length)) : l;
  return l;
}
export function setSize(l, id, size) {
  const n = clone(l);
  for (const c of n.cols) for (const p of c) if (p.id === id) p.size = size;
  return n;
}
export function setHidden(l, id, hide) {
  const n = clone(l);
  n.hidden = hide ? [...new Set([...n.hidden, id])] : n.hidden.filter((h) => h !== id);
  return n;
}
export function setColumns(l, count) {
  const n = clone(l);
  count = Math.max(1, Math.min(4, count));
  while (n.cols.length > count) { const last = n.cols.pop(); n.widths.pop(); n.cols[n.cols.length - 1].push(...last); }
  while (n.cols.length < count) { n.cols.push([]); n.widths.push(1); }
  // move the last panel of the fullest column into each new empty column
  for (const c of n.cols) if (!c.length) { const full = n.cols.reduce((a, x) => (x.length > a.length ? x : a)); if (full.length > 1) c.push(full.pop()); }
  return n;
}
export function setWidth(l, col, delta) {
  const n = clone(l);
  n.widths[col] = Math.max(0.5, Math.min(3, Math.round((n.widths[col] + delta) * 10) / 10));
  return n;
}
