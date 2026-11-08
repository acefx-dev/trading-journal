// Symbol names differ by broker ("JPN225", "JP225.cash", "USTECm"). Grouping, copy
// matching and analytics use one canonical name per instrument.

/** Upper-case letters and digits only: "jp225.cash" → "JP225CASH". */
export function core(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const isDigit = (c) => c >= '0' && c <= '9';

/**
 * a contains b (or b contains a) with at most 5 extra characters as a prefix or suffix,
 * and the match never splits a number ("US30" does not match "US300").
 * Same rule as the Trade Copier's symbol matching.
 */
export function coreMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const lo = a.length >= b.length ? a : b;
  const sh = a.length >= b.length ? b : a;
  if (lo.length - sh.length > 5 || sh.length < 3) return false;
  if (lo.startsWith(sh)) {
    const next = lo[sh.length];
    return !(isDigit(next) && isDigit(sh[sh.length - 1]));
  }
  if (lo.endsWith(sh)) {
    const prev = lo[lo.length - sh.length - 1];
    return !(isDigit(prev) && isDigit(sh[0]));
  }
  return false;
}

/**
 * Canonical name using the alias table (alias → canonical, keys upper case).
 * Tries the exact core name, then any alias that core-matches (broker suffixes/prefixes).
 */
export function canonical(sym, aliases = {}) {
  const c = core(sym);
  if (!c) return '';
  if (aliases[c]) return aliases[c];
  let best = null;
  for (const k of Object.keys(aliases)) {
    if (coreMatch(c, k) && (!best || k.length > best.length)) best = k;
  }
  return best ? aliases[best] : c;
}

/** Master position id from a Trade Copier comment "TC:<id>", else 0. */
export function parseCopyComment(comment) {
  const m = /^TC:(\d+)/.exec(String(comment || ''));
  return m ? Number(m[1]) : 0;
}
