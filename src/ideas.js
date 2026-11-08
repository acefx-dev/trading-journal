// Read side: assemble trading ideas with per-account results for a chosen scope.

import { all } from './db.js';
import { netOf, round } from './build.js';

const WEEK = 7 * 86400000;

/**
 * Resolve the scope (which accounts count) from query params.
 * acct = 'all' | account id; firm = firm id. Returns {ids:Set|null, accounts}.
 */
export async function resolveScope(db, sample, q) {
  const accounts = await all(db, `SELECT a.*, f.name AS firm_name FROM accounts a LEFT JOIN prop_firms f ON f.id = a.firm_id
    WHERE a.is_sample = ? ORDER BY a.id`, sample);
  let list = accounts.filter((a) => a.status === 'active' || q.archived === '1');
  if (q.firm && q.firm !== 'all') list = list.filter((a) => String(a.firm_id) === String(q.firm));
  if (q.acct && q.acct !== 'all') list = list.filter((a) => String(a.id) === String(q.acct));
  const all_ = (!q.firm || q.firm === 'all') && (!q.acct || q.acct === 'all');
  return { ids: new Set(list.map((a) => a.id)), accounts, scoped: list, isAll: all_ };
}

/**
 * Load ideas touching [from, to) (by lead close time; open ideas always included when includeOpen).
 * Returns ideas with: lead, accounts[], net (scope), basisNet, risk, r, status, times, checklist, mistakes.
 */
export async function loadIdeas(db, { sample, scope, from = 0, to = 8.64e15, includeOpen = true, ideaIds = null }) {
  const params = [sample];
  let where = 'i.is_sample = ?';
  if (ideaIds) { where += ' AND i.id IN (SELECT value FROM json_each(?))'; params.push(JSON.stringify(ideaIds)); }
  const posWhere = ideaIds ? '' : ' AND p.open_time < ? AND (p.close_time IS NULL OR p.close_time >= ?)';
  const posParams = ideaIds ? [] : [to, from - WEEK];

  const positions = await all(db, `SELECT p.*, a.name AS account_name, a.role AS account_role, a.size AS account_size
      FROM positions p JOIN ideas i ON i.id = p.idea_id JOIN accounts a ON a.id = p.account_id
      WHERE ${where}${posWhere} ORDER BY p.open_time`, ...params, ...posParams);
  const ids = [...new Set(positions.map((p) => p.idea_id))];
  if (!ids.length) return [];
  const idsJson = JSON.stringify(ids);
  const [ideas, checks, items, mist, shots] = await Promise.all([
    all(db, `SELECT i.*, s.name AS strategy_name, a.name AS lead_name FROM ideas i LEFT JOIN strategies s ON s.id = i.strategy_id
      JOIN accounts a ON a.id = i.account_id WHERE i.id IN (SELECT value FROM json_each(?))`, idsJson),
    all(db, 'SELECT idea_id, item_id, checked FROM trade_checks WHERE idea_id IN (SELECT value FROM json_each(?))', idsJson),
    all(db, "SELECT id, strategy_id FROM checklist_items WHERE kind = 'trade' AND active = 1"),
    all(db, 'SELECT idea_id, mistake_id FROM idea_mistakes WHERE idea_id IN (SELECT value FROM json_each(?))', idsJson),
    all(db, 'SELECT idea_id, COUNT(*) AS n FROM screenshots WHERE idea_id IN (SELECT value FROM json_each(?)) GROUP BY idea_id', idsJson),
  ]);
  const itemsByStrat = {};
  for (const it of items) (itemsByStrat[it.strategy_id] ||= new Set()).add(it.id);
  const checksByIdea = {};
  for (const c of checks) if (c.checked) (checksByIdea[c.idea_id] ||= new Set()).add(c.item_id);
  const mistByIdea = {};
  for (const m of mist) (mistByIdea[m.idea_id] ||= []).push(m.mistake_id);
  const shotsByIdea = Object.fromEntries(shots.map((s) => [s.idea_id, s.n]));
  const posByIdea = {};
  for (const p of positions) (posByIdea[p.idea_id] ||= []).push(p);

  const out = [];
  for (const idea of ideas) {
    const ps = posByIdea[idea.id] || [];
    const agg = aggregate(idea, ps, scope);
    if (!agg) continue;
    if (agg.status === 'closed' && (agg.close_time < from || agg.close_time >= to)) continue;
    if (agg.status === 'open' && !includeOpen) continue;
    const stratItems = itemsByStrat[idea.strategy_id] || new Set();
    const done = [...(checksByIdea[idea.id] || [])].filter((id) => stratItems.has(id)).length;
    out.push({
      id: idea.id, symbol: idea.symbol, direction: idea.direction, lead_account_id: idea.account_id, lead_name: idea.lead_name,
      strategy_id: idea.strategy_id, strategy_name: idea.strategy_name, rating: idea.rating, emotion: idea.emotion,
      reviewed: !!idea.reviewed_at, has_notes: !!(idea.notes && idea.notes.trim()), tv_link: idea.tv_link,
      screenshots: shotsByIdea[idea.id] || 0,
      checklistTotal: stratItems.size, checklistDone: done, mistakes: mistByIdea[idea.id] || [],
      ...agg,
    });
  }
  return out.sort((a, b) => b.open_time - a.open_time);
}

export function aggregate(idea, ps, scope) {
  if (!ps.length) return null;
  const lead = ps.filter((p) => p.account_id === idea.account_id);
  const base = lead.length ? lead : ps;
  const open_time = Math.min(...base.map((p) => p.open_time));
  const status = base.some((p) => p.status === 'open') ? 'open' : 'closed';
  const close_time = status === 'closed' ? Math.max(...base.map((p) => p.close_time || 0)) : null;

  const byAcct = new Map();
  for (const p of ps) {
    if (!byAcct.has(p.account_id)) byAcct.set(p.account_id, { account_id: p.account_id, name: p.account_name, role: p.account_role, size: p.account_size, positions: 0, volume: 0, net: 0, risk: 0, riskKnown: true, floating: 0, lead: p.account_id === idea.account_id });
    const a = byAcct.get(p.account_id);
    a.positions++; a.volume += p.volume; a.net += netOf(p);
    if (p.risk > 0) a.risk += p.risk; else a.riskKnown = false;
    if (p.status === 'open') a.floating += p.floating || 0;
  }
  const accounts = [...byAcct.values()].map((a) => ({
    ...a, volume: round(a.volume, 2), net: round(a.net, 2), risk: a.riskKnown ? round(a.risk, 2) : null,
    r: a.riskKnown && a.risk > 0 ? round(a.net / a.risk, 2) : null, floating: round(a.floating, 2),
  })).sort((x, y) => (y.lead - x.lead) || x.account_id - y.account_id);

  const inScope = scope && scope.ids ? accounts.filter((a) => scope.ids.has(a.account_id)) : accounts;
  if (!inScope.length) return null;
  const basis = inScope.find((a) => a.lead) || inScope[0];
  const net = round(inScope.reduce((s, a) => s + a.net, 0), 2);
  return {
    open_time, close_time, status, accounts,
    lead_positions: lead.length, copies: ps.length - lead.length,
    net, basisNet: basis.net, basis_account_id: basis.account_id, risk: basis.risk, r: basis.r,
    floating: round(inScope.reduce((s, a) => s + a.floating, 0), 2),
  };
}
