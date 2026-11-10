// Read-only shared pages: /share/<token>
// Everything under /share is public (Cloudflare Access Bypass); the token decides what is visible.
// Only the one account the link was made for is ever read, and only what the link's options allow.
import { all, first, run, getSettings } from './db.js';
import { loadIdeas } from './ideas.js';
import { summary } from './stats.js';
import { loadPropStatus } from './prop.js';
import { bneDay } from './time.js';

const TOKEN = /^sh_[0-9a-f]{48}$/;
const SAFE = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',          // the token never leaks to sites the page links to
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SAFE } });
const r2 = (x) => Math.round(x * 100) / 100;

export function newShareToken() {
  const a = crypto.getRandomValues(new Uint8Array(24));
  return 'sh_' + [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleShare(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/share\/?/, '').split('/').filter(Boolean);
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Read-only' }, 405);
    if (parts[0] === 'assets') return env.ASSETS.fetch(request);
    if (parts[0] === 'api') {
      const link = await findLink(env.DB, parts[1]);
      if (!link.ok) return json({ error: link.error }, link.status);
      if (parts[2] === 'shot' && parts[3]) return shot(env, link.row, Number(parts[3]));
      if (parts.length !== 2) return json({ error: 'Not found' }, 404);
      await run(env.DB, 'UPDATE share_links SET views = views + 1, last_viewed_at = ? WHERE id = ?', Date.now(), link.row.id);
      return json(await sharedData(env.DB, link.row));
    }
    if (parts.length === 1 && TOKEN.test(parts[0])) {
      const page = await env.ASSETS.fetch(new Request(new URL('/share/assets/', url), request));
      const res = new Response(page.body, page);
      for (const [k, v] of Object.entries(SAFE)) res.headers.set(k, v);
      return res;
    }
    return new Response('Not found', { status: 404, headers: SAFE });
  } catch (e) {
    console.error(e && e.stack || e);
    return json({ error: 'Something went wrong loading this page.' }, 500);
  }
}

async function findLink(db, token) {
  if (!TOKEN.test(token || '')) return { ok: false, status: 404, error: 'This link is not valid.' };
  const row = await first(db, `SELECT s.*, a.name AS account_name, a.kind, a.phase, a.currency, a.size, a.balance, a.equity, a.status AS account_status,
      a.last_seen, a.is_sample, a.daily_loss_pct, a.max_loss_pct, a.max_loss_type, a.profit_target_pct, a.daily_reset_tz, a.daily_reset_time,
      a.daily_loss_of, a.daily_loss_from, a.server_offset_sec, a.created_at AS account_created, f.name AS firm_name
    FROM share_links s JOIN accounts a ON a.id = s.account_id LEFT JOIN prop_firms f ON f.id = a.firm_id WHERE s.token = ?`, token);
  if (!row) return { ok: false, status: 404, error: 'This link is not valid.' };
  if (row.revoked_at) return { ok: false, status: 410, error: 'This link has been turned off by its owner.' };
  if (row.expires_at && row.expires_at < Date.now()) return { ok: false, status: 410, error: 'This link has expired.' };
  return { ok: true, row };
}

async function shot(env, link, shotId) {
  if (!link.show_notes || !env.SHOTS) return json({ error: 'Not found' }, 404);
  // the screenshot must belong to an idea with a position on this account
  const s = await first(env.DB, `SELECT sc.* FROM screenshots sc WHERE sc.id = ?
    AND EXISTS (SELECT 1 FROM positions p WHERE p.idea_id = sc.idea_id AND p.account_id = ?)`, shotId, link.account_id);
  if (!s) return json({ error: 'Not found' }, 404);
  const obj = await env.SHOTS.get(s.r2_key);
  if (!obj) return json({ error: 'Not found' }, 404);
  return new Response(obj.body, { headers: { 'Content-Type': s.content_type || 'application/octet-stream', ...SAFE, 'Cache-Control': 'private, max-age=3600' } });
}

/** What a shared page may show. Dollar figures are left out entirely when show_money is off. */
export async function sharedData(db, L) {
  const money = !!L.show_money;
  const acct = { id: L.account_id, name: L.account_name, size: L.size, balance: L.balance, equity: L.equity, kind: L.kind, phase: L.phase, currency: L.currency,
    status: L.account_status, last_seen: L.last_seen, daily_loss_pct: L.daily_loss_pct, max_loss_pct: L.max_loss_pct, max_loss_type: L.max_loss_type,
    profit_target_pct: L.profit_target_pct, daily_reset_tz: L.daily_reset_tz, daily_reset_time: L.daily_reset_time, daily_loss_of: L.daily_loss_of,
    daily_loss_from: L.daily_loss_from, server_offset_sec: L.server_offset_sec };
  const scope = { ids: new Set([L.account_id]) };
  const ideas = await loadIdeas(db, { sample: L.is_sample, scope, includeOpen: !!L.show_open });
  const closed = ideas.filter((i) => i.status === 'closed').sort((a, b) => a.close_time - b.close_time);
  const size = L.size > 0 ? L.size : null;
  const pct = (v) => (size ? r2(v / size * 100) : null);

  // curve and drawdown on closed results, starting from the account size
  let cum = 0, cumR = 0, peak = 0, dd = 0, ddPct = 0;
  const curve = closed.map((i) => {
    cum += i.net; cumR += i.r || 0;
    if (cum > peak) peak = cum;
    if (peak - cum > dd) { dd = peak - cum; ddPct = size ? dd / (size + peak) * 100 : 0; }
    return { t: i.close_time, v: money ? r2(cum) : size ? pct(cum) : r2(cumR) };
  });
  const s = summary(closed);
  const now = Date.now();
  const s30 = summary(closed.filter((i) => i.close_time >= now - 30 * 864e5));
  const strip = (x) => {
    const o = { count: x.count, wins: x.wins, losses: x.losses, breakeven: x.breakeven, winRate: x.winRate, profitFactor: x.profitFactor, profitFactorInfinite: x.profitFactorInfinite,
      expectancyR: x.expectancyR, avgWinR: x.avgWinR, avgLossR: x.avgLossR, realisedRR: x.realisedRR, rCount: x.rCount, netPct: pct(x.totalNet) };
    if (money) Object.assign(o, { totalNet: x.totalNet, expectancy: x.expectancy, costs: r2(x.commission + x.swap + x.fee) });
    return o;
  };
  const months = {};
  for (const i of closed) {
    const m = bneDay(i.close_time).slice(0, 7);
    const o = (months[m] ||= { month: m, count: 0, wins: 0, losses: 0, net: 0, r: 0 });
    o.count++; o.net += i.net; o.r += i.r || 0;
    if (i.basisNet > 0) o.wins++; else if (i.basisNet < 0) o.losses++;
  }
  const monthly = Object.values(months).sort((a, b) => b.month.localeCompare(a.month)).map((o) => ({
    month: o.month, count: o.count, wins: o.wins, losses: o.losses, r: r2(o.r), pct: pct(o.net), ...(money ? { net: r2(o.net) } : {}) }));

  let trades = [];
  if (L.show_trades) {
    const list = closed.slice(-300).reverse();
    let shots = [], links = [], notes = [];
    if (L.show_notes && list.length) {
      const ids = JSON.stringify(list.map((i) => i.id));
      [shots, links, notes] = await Promise.all([
        all(db, 'SELECT id, idea_id, timeframe, caption FROM screenshots WHERE idea_id IN (SELECT value FROM json_each(?)) ORDER BY id', ids),
        all(db, 'SELECT idea_id, url, timeframe, note FROM idea_links WHERE idea_id IN (SELECT value FROM json_each(?)) ORDER BY id', ids),
        all(db, "SELECT id, notes FROM ideas WHERE id IN (SELECT value FROM json_each(?)) AND notes IS NOT NULL AND notes <> ''", ids),
      ]);
    }
    trades = list.map((i) => ({
      id: i.id, open_time: i.open_time, close_time: i.close_time, symbol: i.symbol, direction: i.direction, strategy: i.strategy_name || null,
      positions: i.lead_positions, r: i.r, pct: pct(i.net), ...(money ? { net: i.net } : {}),
      ...(L.show_notes ? { notes: (notes.find((n) => n.id === i.id) || {}).notes || null, shots: shots.filter((x) => x.idea_id === i.id).map((x) => ({ id: x.id, timeframe: x.timeframe, caption: x.caption })),
        links: links.filter((x) => x.idea_id === i.id && /^https:\/\//.test(x.url)).map((x) => ({ url: x.url, timeframe: x.timeframe, note: x.note })) } : {}),
    }));
  }
  const open = L.show_open ? ideas.filter((i) => i.status === 'open').map((i) => ({ symbol: i.symbol, direction: i.direction, open_time: i.open_time, positions: i.lead_positions,
    floatingPct: pct(i.floating), ...(money ? { floating: i.floating } : {}) })) : null;

  let prop = null;
  if (L.show_firm && (L.daily_loss_pct || L.max_loss_pct || L.profit_target_pct)) {
    const warn = Number((await getSettings(db)).raw.warn_pct) || 70;
    const [p] = await loadPropStatus(db, [acct], warn);
    if (p && !p.missing) prop = { rules: p.rules.map((x) => ({ label: x.label, pct: x.pct, level: x.level, ...(money ? { used: x.used, limit: x.limit, room: x.room } : {}) })),
      target: p.target ? { label: p.target.label, pct: p.target.pct, reached: p.target.reached, ...(money ? { made: p.target.made, target: p.target.target } : {}) } : null };
  }
  return {
    generated_at: now, money,
    account: { label: L.label, firm: L.show_firm ? L.firm_name || null : null, kind: L.kind, phase: L.show_firm ? L.phase : null, currency: L.currency,
      active: L.account_status === 'active', last_update: L.last_seen || null, since: closed.length ? closed[0].close_time : null,
      ...(money ? { size: L.size, balance: L.balance, equity: L.equity } : {}), sample: !!L.is_sample },
    show: { trades: !!L.show_trades, notes: !!L.show_notes, open: !!L.show_open, firm: !!L.show_firm },
    stats: strip(s), last30: strip(s30), drawdown: { pct: size ? r2(ddPct) : null, ...(money ? { amount: r2(dd) } : {}) },
    curve, curveUnit: money ? 'money' : size ? 'pct' : 'r', monthly, trades, open, prop,
  };
}
