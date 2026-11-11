// Thin helpers over the D1 binding.

export const all = async (db, sql, ...p) => (await db.prepare(sql).bind(...p).all()).results || [];
export const first = (db, sql, ...p) => db.prepare(sql).bind(...p).first();
export const run = (db, sql, ...p) => db.prepare(sql).bind(...p).run();
export const stmt = (db, sql, ...p) => db.prepare(sql).bind(...p);

export async function getSettings(db) {
  const rows = await all(db, 'SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    groupWindowMin: Number(s.group_window_min ?? 30),
    requireOverlap: (s.group_require_overlap ?? '1') === '1',
    copyMatchWindowSec: Number(s.copy_match_window_sec ?? 60),
    riskTolerancePct: Number(s.risk_tolerance_pct ?? 3),
    riskGraceSec: Number(s.risk_grace_sec ?? 60),
    linkAccounts: (s.link_accounts ?? '1') === '1',
    linkWindowMin: Number(s.link_window_min ?? 5),
    sentimentMarkets: String(s.sentiment_markets ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    sentimentBasis: String(s.sentiment_basis ?? 'US futures,Nikkei futures,VIX,USDJPY,Headlines').split(',').map((x) => x.trim()).filter(Boolean),
    raw: s,
  };
}

export async function getAliases(db) {
  const rows = await all(db, 'SELECT alias, canonical FROM symbol_aliases');
  return Object.fromEntries(rows.map((r) => [r.alias.toUpperCase(), r.canonical.toUpperCase()]));
}

export function audit(db, { actor = 'system', account_id = null, idea_id = null, action, detail = null, level = 'info', time = Date.now() }) {
  return stmt(db, 'INSERT INTO audit_log (time, actor, account_id, idea_id, action, detail, level) VALUES (?,?,?,?,?,?,?)',
    time, actor, account_id, idea_id, action, detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail), level);
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return 'tj_' + [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
