// Performance statistics over closed trading ideas. Pure functions.
//
// Each idea passed in:
//   { id, open_time, close_time, net, basisNet, r, strategy_id, canon, checklistTotal,
//     checklistDone, mistakes: [ids], rating }
//   net      = P&L of the idea in the chosen scope (e.g. all accounts combined), money
//   basisNet = P&L on the R-basis account (the Master/lead account, or the chosen account)
//   r        = basisNet / risk at the initial S/L on that account, or null if unknown
// Win / loss is decided by basisNet so that a combined view and a Master view agree.

import { bneParts, bneDay } from './time.js';
import { round } from './build.js';

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summary(ideas) {
  const wins = ideas.filter((i) => i.basisNet > 0);
  const losses = ideas.filter((i) => i.basisNet < 0);
  const grossWin = ideas.reduce((a, i) => a + (i.net > 0 ? i.net : 0), 0);
  const grossLoss = ideas.reduce((a, i) => a + (i.net < 0 ? -i.net : 0), 0);
  const withR = ideas.filter((i) => i.r != null && isFinite(i.r));
  const winR = withR.filter((i) => i.r > 0).map((i) => i.r);
  const lossR = withR.filter((i) => i.r < 0).map((i) => i.r);
  const totalNet = ideas.reduce((a, i) => a + i.net, 0);
  const decided = wins.length + losses.length;
  const avgWinR = avg(winR), avgLossR = avg(lossR);
  return {
    count: ideas.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: ideas.length - decided,
    winRate: decided ? wins.length / decided : null,
    totalNet: round(totalNet, 2),
    grossWin: round(grossWin, 2),
    grossLoss: round(grossLoss, 2),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : grossWin > 0 ? null : null,
    profitFactorInfinite: grossLoss === 0 && grossWin > 0,
    expectancy: ideas.length ? round(totalNet / ideas.length, 2) : null,
    expectancyR: withR.length ? round(avg(withR.map((i) => i.r)), 2) : null,
    rCount: withR.length,
    avgWinR: avgWinR != null ? round(avgWinR, 2) : null,
    avgLossR: avgLossR != null ? round(avgLossR, 2) : null,
    realisedRR: avgWinR != null && avgLossR ? round(avgWinR / Math.abs(avgLossR), 2) : null,
    best: ideas.length ? round(Math.max(...ideas.map((i) => i.net)), 2) : null,
    worst: ideas.length ? round(Math.min(...ideas.map((i) => i.net)), 2) : null,
  };
}

/**
 * Max drawdown on a closed-P&L balance curve.
 * points: [{time, delta}] in any order; start: balance before the first point.
 */
export function drawdown(points, start) {
  const ps = [...points].sort((a, b) => a.time - b.time);
  let bal = start, peak = start, maxDd = 0, maxDdPct = 0, at = null;
  for (const p of ps) {
    bal += p.delta;
    if (bal > peak) peak = bal;
    const dd = peak - bal;
    if (dd > maxDd) { maxDd = dd; maxDdPct = peak > 0 ? dd / peak : 0; at = p.time; }
  }
  return { maxDd: round(maxDd, 2), maxDdPct: round(maxDdPct * 100, 2), at, end: round(bal, 2), peak: round(peak, 2) };
}

export function groupSummary(ideas, keyFn) {
  const m = new Map();
  for (const i of ideas) {
    const k = keyFn(i);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  }
  return [...m.entries()].map(([key, xs]) => ({ key, ...summary(xs) }));
}

/** Session by Brisbane open hour. Approximate: London and New York shift with their DST. */
export function sessionOf(utcMs) {
  const { hour } = bneParts(utcMs);
  if (hour >= 8 && hour < 16) return 'Tokyo';
  if (hour >= 16 && hour < 22) return 'London';
  if (hour >= 22 || hour < 6) return 'New York';
  return 'Off-hours';
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function rBuckets(ideas) {
  const b = [
    { label: '≤ −1R', test: (r) => r <= -1 },
    { label: '−1R to 0', test: (r) => r > -1 && r < 0 },
    { label: '0 to 1R', test: (r) => r >= 0 && r < 1 },
    { label: '1R to 2R', test: (r) => r >= 1 && r < 2 },
    { label: '≥ 2R', test: (r) => r >= 2 },
  ];
  return b.map(({ label, test }) => ({ label, count: ideas.filter((i) => i.r != null && test(i.r)).length }));
}

export function behaviour(ideas, mistakeLabels = {}) {
  const sorted = [...ideas].sort((a, b) => a.open_time - b.open_time);
  const withList = sorted.filter((i) => i.checklistTotal > 0);
  const complete = withList.filter((i) => i.checklistDone >= i.checklistTotal);
  const incomplete = withList.filter((i) => i.checklistDone < i.checklistTotal);

  const mistakes = {};
  for (const i of sorted) for (const m of i.mistakes || []) (mistakes[m] ||= []).push(i);
  const mistakeRows = Object.entries(mistakes).map(([id, xs]) => ({
    id: Number(id), label: mistakeLabels[id] || 'Mistake ' + id, ...summary(xs),
  })).sort((a, b) => b.count - a.count);
  const clean = sorted.filter((i) => !(i.mistakes || []).length);

  // the idea right after a losing idea (same Brisbane day or later)
  const afterLoss = [];
  for (let k = 1; k < sorted.length; k++) if (sorted[k - 1].basisNet < 0) afterLoss.push(sorted[k]);

  // ideas per day vs. results: was the day's 3rd+ idea worse?
  const byDay = {};
  for (const i of sorted) (byDay[bneDay(i.open_time)] ||= []).push(i);
  const laterInDay = Object.values(byDay).flatMap((xs) => xs.slice(2));

  return {
    checklistComplete: summary(complete),
    checklistIncomplete: summary(incomplete),
    noChecklist: sorted.length - withList.length,
    mistakes: mistakeRows,
    clean: summary(clean),
    afterLoss: summary(afterLoss),
    thirdPlusOfDay: summary(laterInDay),
    byWeekday: groupSummary(sorted, (i) => DOW[bneParts(i.open_time).weekday]),
    bySession: groupSummary(sorted, (i) => sessionOf(i.open_time)),
    byRating: groupSummary(sorted.filter((i) => i.rating), (i) => i.rating),
  };
}
