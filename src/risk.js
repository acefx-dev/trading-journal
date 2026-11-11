// Risk limits per account (as a % of account size), checked per trading idea and per Brisbane day.
// Pure functions so they can be unit-tested.
import { bneDay } from './time.js';
import { round } from './build.js';

/** ok: within the limit; tolerance: over by no more than the tolerance (e.g. slippage); over: a violation. */
export function riskLevel(used, limit, tolPct) {
  if (!(limit > 0) || used == null) return null;
  if (used <= limit + 1e-9) return 'ok';
  return used <= limit * (1 + tolPct / 100) + 1e-9 ? 'tolerance' : 'over';
}

/**
 * Adds to each idea: risk_checks [{account_id, name, risk, riskPct, limit, limitPct, level, dayUsed, dayLimit, dayLevel}],
 * risk_violation (any account over its per-idea limit) and day_violation (this idea took an account over its daily limit).
 * Daily use is cumulative in opening order, so the idea that crosses the line (and any after it) are flagged.
 * accountsById: Map id → account row (size, max_risk_trade_pct, max_risk_day_pct). onlyIds: Set of accounts to check.
 */
export function applyRiskChecks(ideas, accountsById, tolPct, onlyIds = null) {
  const dayUse = new Map();
  const ordered = [...ideas].sort((a, b) => a.open_time - b.open_time);
  for (const i of ordered) {
    i.risk_checks = [];
    for (const a of i.accounts || []) {
      if (onlyIds && !onlyIds.has(a.account_id)) continue;
      const acc = accountsById.get(a.account_id);
      if (!acc || !(acc.size > 0)) continue;
      const limit = acc.max_risk_trade_pct ? round(acc.size * acc.max_risk_trade_pct / 100, 2) : null;
      const dayLimit = acc.max_risk_day_pct ? round(acc.size * acc.max_risk_day_pct / 100, 2) : null;
      if (limit == null && dayLimit == null) continue;
      const key = a.account_id + '|' + bneDay(i.open_time);
      const used = (dayUse.get(key) || 0) + (a.risk || 0);
      dayUse.set(key, used);
      i.risk_checks.push({
        account_id: a.account_id, name: a.name, risk: a.risk, riskPct: a.risk != null ? round(a.risk / acc.size * 100, 3) : null,
        limit, limitPct: acc.max_risk_trade_pct || null, level: riskLevel(a.risk, limit, tolPct),
        dayUsed: round(used, 2), dayLimit, dayLimitPct: acc.max_risk_day_pct || null, dayLevel: riskLevel(used, dayLimit, tolPct),
      });
    }
    i.risk_violation = i.risk_checks.some((c) => c.level === 'over');
    i.day_violation = i.risk_checks.some((c) => c.dayLevel === 'over');
  }
  return ideas;
}
