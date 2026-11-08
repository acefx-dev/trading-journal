// Trade grouping: which trading idea does a position belong to?
// Pure functions (no database) so the rules can be unit-tested.
//
// Lead accounts (Master or standalone): a position joins an existing idea when
//   - same account, same instrument (canonical symbol) and same direction, and
//   - it opened within `windowMs` of the idea's FIRST position, and
//   - (if requireOverlap) at least one of the idea's positions was still open at that moment.
// Otherwise it starts a new idea. Positions moved by hand (group_mode = 'manual') are never moved
// by these rules.
//
// Copy accounts: a copy follows its Master position's idea. The link comes from the copier's
// comment "TC:<master position id>"; if the broker removed it, the closest Master position with the
// same instrument and direction opened within `copyWindowMs` is used.

/**
 * @param pos       {position_id, account_id, canon, direction, open_time}
 * @param existing  lead positions already assigned: {position_id, account_id, canon, direction,
 *                  open_time, close_time, ideaKey}
 * @returns ideaKey of the idea to join, or null for a new idea
 */
export function pickIdea(pos, existing, { windowMs, requireOverlap }) {
  const ideas = new Map();
  for (const e of existing) {
    if (e.ideaKey == null || e.position_id === pos.position_id) continue;
    if (e.account_id !== pos.account_id || e.canon !== pos.canon || e.direction !== pos.direction) continue;
    if (!ideas.has(e.ideaKey)) ideas.set(e.ideaKey, []);
    ideas.get(e.ideaKey).push(e);
  }
  let best = null, bestFirst = -Infinity;
  for (const [key, ps] of ideas) {
    const firstOpen = Math.min(...ps.map((p) => p.open_time));
    if (firstOpen > pos.open_time) continue;                    // idea started after this position
    if (pos.open_time - firstOpen > windowMs) continue;          // outside the grouping window
    if (requireOverlap) {
      const overlaps = ps.some((p) => p.open_time <= pos.open_time && (p.close_time == null || p.close_time >= pos.open_time));
      if (!overlaps) continue;
    }
    if (firstOpen > bestFirst) { best = key; bestFirst = firstOpen; }
  }
  return best;
}

/**
 * Find the Master position a copy belongs to.
 * @param copy     {copy_of, canon, direction, open_time}
 * @param masters  Master-account positions: {id, position_id, canon, direction, open_time}
 * @param taken    Set of master position row ids already linked to another copy on this account
 * @returns {master, link} or null
 */
export function matchMaster(copy, masters, { copyWindowMs }, taken = new Set()) {
  if (copy.copy_of) {
    const m = masters.find((x) => x.position_id === copy.copy_of);
    return m ? { master: m, link: 'comment' } : null;
  }
  let best = null, bestDiff = Infinity;
  for (const m of masters) {
    if (taken.has(m.id)) continue;
    if (m.canon !== copy.canon || m.direction !== copy.direction) continue;
    const diff = Math.abs(m.open_time - copy.open_time);
    if (diff <= copyWindowMs && diff < bestDiff) { best = m; bestDiff = diff; }
  }
  return best ? { master: best, link: 'match' } : null;
}
