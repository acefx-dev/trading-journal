// Trade path (connector 1.02): combined open risk over time from stop-loss changes, and the
// drawdown (MAE) and best point (MFE) of the combined floating P&L. Pure functions + one loader.
import { all } from './db.js';
import { round } from './build.js';

/**
 * Peak combined open risk of one account's positions in one idea, ignoring short spikes.
 * positions: [{position_id, open_time, close_time, risk}] (risk = initial risk from the entry deal)
 * events:    [{position_id, t, risk}] (risk null = no S/L at that moment)
 * Returns {peak, initial, transient, steps} or null when the connector didn't record every position.
 *  - peak:      highest combined risk that lasted at least graceMs (if nothing lasted that long, the longest-lasting level)
 *  - initial:   sum of each position's initial risk (the old measure)
 *  - transient: highest combined risk at any moment (including short spikes)
 *  - steps:     [{t, total, known, position_id, kind}] the combined risk after each change, for the timeline
 */
export function peakRisk(positions, events, graceMs = 60000, now = Date.now()) {
  if (!positions.length) return null;
  const evBy = new Map();
  for (const e of events) (evBy.get(e.position_id) || evBy.set(e.position_id, []).get(e.position_id)).push(e);
  if (!positions.every((p) => evBy.has(p.position_id))) return null;
  for (const list of evBy.values()) list.sort((a, b) => a.t - b.t);

  const changes = [];
  for (const p of positions) {
    changes.push({ t: p.open_time, position_id: p.position_id, kind: 'open' });
    for (const e of evBy.get(p.position_id)) if (e.t >= p.open_time && (!p.close_time || e.t <= p.close_time)) changes.push({ t: e.t, position_id: p.position_id, kind: 'sl', sl: e.sl, volume: e.volume, risk: e.risk });
    if (p.close_time) changes.push({ t: p.close_time, position_id: p.position_id, kind: 'close' });
  }
  changes.sort((a, b) => a.t - b.t || (a.kind === 'close') - (b.kind === 'close'));

  // risk of a position at time t: the last event at or before t; before its first event, its initial risk
  const riskAt = (p, t) => {
    if (t < p.open_time || (p.close_time && t >= p.close_time)) return 0;
    let v = p.risk > 0 ? p.risk : null, seen = false;
    for (const e of evBy.get(p.position_id)) { if (e.t <= t) { v = e.risk; seen = true; } else break; }
    if (!seen && !(p.risk > 0)) return null;
    return v == null ? null : Math.max(0, v);
  };
  const end = Math.max(...positions.map((p) => p.close_time || now));
  const times = [...new Set(changes.map((c) => c.t))].sort((a, b) => a - b);
  const segs = [];
  times.forEach((t, k) => {
    const t2 = k + 1 < times.length ? times[k + 1] : end;
    if (t2 <= t && k + 1 < times.length) return;
    let total = 0, known = true;
    for (const p of positions) { const r = riskAt(p, t); if (r == null) known = false; else total += r; }
    const prev = segs[segs.length - 1];
    if (prev && prev.known === known && Math.abs(prev.total - total) < 0.005) prev.t2 = t2;   // same level: one segment
    else segs.push({ t, t2, total: round(total, 2), known });
  });
  const known = segs.filter((s) => s.known && s.total > 0);
  if (!known.length) return null;
  const long = known.filter((s) => s.t2 - s.t >= graceMs);
  const peak = long.length ? Math.max(...long.map((s) => s.total)) : known.reduce((a, s) => (s.t2 - s.t > a.t2 - a.t ? s : a)).total;
  const steps = changes.map((c) => {
    let total = 0, ok = true;
    for (const p of positions) { const r = riskAt(p, c.t); if (r == null) ok = false; else total += r; }
    return { ...c, total: ok ? round(total, 2) : null };
  });
  return {
    peak: round(peak, 2), transient: round(Math.max(...known.map((s) => s.total)), 2),
    initial: positions.every((p) => p.risk > 0) ? round(positions.reduce((a, p) => a + p.risk, 0), 2) : null, steps,
  };
}

/** Combine the connector's episodes for one account's positions: lowest and highest combined floating P&L. */
export function combineEpisodes(eps) {
  if (!eps.length) return null;
  let mae = null, mfe = null;
  for (const e of eps) {
    if (e.mae != null && (mae == null || e.mae < mae.v)) mae = { v: e.mae, t: e.mae_t };
    if (e.mfe != null && (mfe == null || e.mfe > mfe.v)) mfe = { v: e.mfe, t: e.mfe_t };
  }
  return { mae: mae ? round(mae.v, 2) : null, mae_t: mae && mae.t, mfe: mfe ? round(mfe.v, 2) : null, mfe_t: mfe && mfe.t,
    partial: eps.some((e) => e.partial), open: eps.some((e) => !e.end_t) };
}

/**
 * Load the trade path for a set of positions (rows with idea_id, account_id, position_id, open_time, close_time, risk).
 * Returns Map `${idea_id}|${account_id}` → {peak, initial, transient, steps, mae, mae_t, mfe, mfe_t, partial}.
 */
export async function loadPaths(db, positions, graceSec = 60, withSteps = false) {
  const out = new Map();
  if (!positions.length) return out;
  const accIds = [...new Set(positions.map((p) => p.account_id))];
  const minT = Math.min(...positions.map((p) => p.open_time)) - 60000;
  const maxT = Math.max(...positions.map((p) => p.close_time || Date.now())) + 60000;
  const [events, eps] = await Promise.all([
    all(db, `SELECT account_id, position_id, t, sl, volume, risk FROM sl_events WHERE account_id IN (SELECT value FROM json_each(?)) AND t >= ? AND t <= ?`,
      JSON.stringify(accIds), minT, maxT),
    all(db, `SELECT * FROM path_episodes WHERE account_id IN (SELECT value FROM json_each(?)) AND start_t <= ? AND (end_t IS NULL OR end_t >= ?)`,
      JSON.stringify(accIds), maxT, minT),
  ]);
  if (!events.length && !eps.length) return out;
  const groups = new Map();
  for (const p of positions) { const k = p.idea_id + '|' + p.account_id; (groups.get(k) || groups.set(k, []).get(k)).push(p); }
  const evKey = new Map();
  for (const e of events) { const k = e.account_id + '|' + e.position_id; (evKey.get(k) || evKey.set(k, []).get(k)).push(e); }
  for (const [k, ps] of groups) {
    const acct = ps[0].account_id;
    const ev = ps.flatMap((p) => evKey.get(acct + '|' + p.position_id) || []);
    const pr = ev.length ? peakRisk(ps, ev, graceSec * 1000) : null;
    const ids = new Set(ps.map((p) => p.position_id));
    const mine = eps.filter((e) => e.account_id === acct && JSON.parse(e.position_ids || '[]').some((id) => ids.has(id)));
    const ex = combineEpisodes(mine);
    if (!pr && !ex) continue;
    const v = { ...(pr || {}), ...(ex || {}) };
    if (!withSteps) delete v.steps;
    out.set(k, v);
  }
  return out;
}
