// Daily market sentiment (from daily preparation) and whether an idea traded with or against it.
import { all } from './db.js';
import { canonical } from './symbols.js';

const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export async function sentimentByDay(db, sample, fromDay, toDay) {
  const rows = await all(db, 'SELECT * FROM prep_sentiment WHERE is_sample = ? AND day >= ? AND day <= ?', sample, fromDay, toDay);
  return new Map(rows.map((r) => [r.day, { overall: r.overall, markets: parse(r.markets, {}), basis: parse(r.basis, []), note: r.note }]));
}

/**
 * The bias that applies to an idea: the market's own bias if one was set (e.g. JP225), else the overall one.
 * align: with | against | neutral | unset.
 */
export function alignOf(symbol, direction, s, aliases = {}) {
  if (!s) return { bias: null, align: 'unset' };
  let bias = null;
  for (const [m, v] of Object.entries(s.markets || {})) {
    if (v && canonical(m, aliases) === canonical(symbol, aliases)) bias = v;
  }
  bias = bias || s.overall || null;
  if (!bias) return { bias: null, align: 'unset' };
  if (bias === 'neutral') return { bias, align: 'neutral' };
  return { bias, align: (bias === 'bull') === (direction === 'long') ? 'with' : 'against' };
}
