// HTTP API (Cloudflare Pages Functions → functions/api/[[path]].js).

import { all, first, run, stmt, audit, getSettings, getAliases, sha256Hex, randomToken, HttpError } from './db.js';
import { requireUser } from './auth.js';
import { handleIngest, groupAccount, processUpload } from './ingest.js';
import { newShareToken } from './share.js';
import { sentimentByDay } from './sentiment.js';
import { resolveScope, loadIdeas, aggregate } from './ideas.js';
import { loadPaths } from './path.js';
import { summary, drawdown, groupSummary, rBuckets, behaviour, sessionOf } from './stats.js';
import { bneDay, bneDayStart, bneToday, addDays, bneMonthRange } from './time.js';
import { netOf, round } from './build.js';
import { canonical } from './symbols.js';
import { seedSample, clearSample } from './sample.js';
import { loadPropStatus } from './prop.js';
import { afterUpload, sendTelegram, findChat, summaryText, ruleText } from './alerts.js';

const DAY = 86400000;
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

const routes = [];
const on = (method, pattern, fn) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, fn });
};

export async function handle(request, env, ctx = null) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  try {
    if (path === '/ingest' && request.method === 'POST') {
      const result = await handleIngest(request, env);
      // alerts and summaries run after the reply, so the connector isn't kept waiting
      const job = afterUpload(env, env.DB, result.account_id).catch((e) => console.error('alerts', e));
      if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
      return json(result);
    }
    // Opening this address in a browser shows whether the connector can reach it without a login.
    if (path === '/ingest' && request.method === 'GET') return json({ ok: true, message: 'Connector endpoint reachable. If you see this without signing in, the Cloudflare Access Bypass rule works.' });
    if (path === '/health') return json({ ok: true });
    const user = await requireUser(request, env);
    for (const r of routes) {
      if (r.method !== request.method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const q = Object.fromEntries(url.searchParams);
      const ctx = { env, db: env.DB, user, params, q, request, sample: q.mode === 'sample' ? 1 : 0 };
      const res = await r.fn(ctx);
      return res instanceof Response ? res : json(res);
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e && e.stack || e);
    return json({ error: e.message || 'Server error' }, status);
  }
}

async function body(ctx) {
  try { return await ctx.request.json(); } catch { throw new HttpError(400, 'Body is not valid JSON'); }
}
const id = (x) => { const n = Number(x); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Bad id'); return n; };
const txt = (x, n = 2000) => (x == null ? null : String(x).slice(0, n));
const optNum = (x) => (x === '' || x == null ? null : isFinite(Number(x)) ? Number(x) : null);

// ------------------------------------------------------------------ bootstrap / settings

on('GET', '/me', (ctx) => ({ email: ctx.user.email, dev: !!ctx.user.dev }));

on('GET', '/bootstrap', async ({ db, sample, user, env }) => {
  const [firms, accounts, strategies, mistakes, aliases, settings, sampleCount] = await Promise.all([
    all(db, 'SELECT * FROM prop_firms WHERE is_sample = ? ORDER BY name', sample),
    all(db, `SELECT id, firm_id, name, login, server, broker, currency, kind, phase, size, role, master_account_id, daily_loss_pct,
      max_loss_pct, max_loss_type, profit_target_pct, token_hint, last_seen, last_deal_msc, connector_version, server_offset_sec,
      tz_mode, balance, equity, status, created_at, daily_reset_tz, daily_reset_time, daily_loss_of, daily_loss_from,
      profit_split_pct, last_payout_day, payout_currency, max_risk_trade_pct, max_risk_day_pct
      FROM accounts WHERE is_sample = ? ORDER BY id`, sample),
    all(db, 'SELECT * FROM strategies WHERE is_sample = ? ORDER BY archived, name', sample),
    all(db, 'SELECT * FROM mistakes ORDER BY active DESC, label'),
    all(db, 'SELECT * FROM symbol_aliases ORDER BY canonical, alias'),
    getSettings(db),
    first(db, 'SELECT COUNT(*) AS n FROM accounts WHERE is_sample = 1'),
  ]);
  const items = await all(db, `SELECT c.* FROM checklist_items c JOIN strategies s ON s.id = c.strategy_id
    WHERE s.is_sample = ? AND c.active = 1 ORDER BY c.sort, c.id`, sample);
  for (const s of strategies) s.trade = items.filter((i) => i.strategy_id === s.id && i.kind === 'trade');
  const prep = await all(db, 'SELECT id, label, sort FROM prep_items WHERE is_sample = ? AND active = 1 ORDER BY sort, id', sample);
  return { user: user.email, now: Date.now(), today: bneToday(), firms, accounts: accounts.map(maskAccount), strategies, prep, mistakes, aliases,
    settings: settings.raw, sampleLoaded: sampleCount.n > 0, telegram: !!env.TELEGRAM_BOT_TOKEN };
});

function maskAccount(a) {
  const login = String(a.login || '');
  return { ...a, login_masked: login.length > 4 ? '••••' + login.slice(-4) : login };
}

on('PUT', '/settings', async ({ db, request }) => {
  const b = await request.json();
  const allowed = { group_window_min: [1, 1440], copy_match_window_sec: [5, 3600], warn_pct: [10, 99], alert_daily_hour: [0, 23] };
  const ops = [];
  for (const [k, [lo, hi]] of Object.entries(allowed)) {
    if (b[k] == null) continue;
    const v = Number(b[k]);
    if (!isFinite(v) || v < lo || v > hi) throw new HttpError(400, `${k} must be between ${lo} and ${hi}`);
    ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, String(Math.round(v))));
  }
  if (b.default_scope != null) {
    const v = String(b.default_scope);
    if (!/^(all|kind:(funded|challenge|personal|demo)|\d+)$/.test(v)) throw new HttpError(400, 'Bad default view');
    ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'default_scope', v));
  }
  for (const k of ['alert_rules', 'alert_daily', 'alert_weekly']) {
    if (b[k] != null) ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, b[k] ? '1' : '0'));
  }
  if (b.telegram_chat_id != null) {
    const c = String(b.telegram_chat_id).trim();
    if (c && !/^-?\d{1,20}$/.test(c)) throw new HttpError(400, 'Telegram chat id is a number');
    ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'telegram_chat_id', c));
  }
  if (b.risk_tolerance_pct != null) {
    const v = Number(b.risk_tolerance_pct);
    if (!(v >= 0 && v <= 50)) throw new HttpError(400, 'Tolerance is 0 to 50%');
    ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'risk_tolerance_pct', String(v)));
  }
  if (b.risk_grace_sec != null) {
    const v = Number(b.risk_grace_sec);
    if (!(v >= 0 && v <= 900)) throw new HttpError(400, 'Grace period is 0 to 900 seconds');
    ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'risk_grace_sec', String(v)));
  }
  if (b.link_accounts != null) ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'link_accounts', b.link_accounts ? '1' : '0'));
  if (b.link_window_min != null) {
    const v = Number(b.link_window_min);
    if (!(v >= 1 && v <= 120)) throw new HttpError(400, 'Linking window is 1 to 120 minutes');
    ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'link_window_min', String(v)));
  }
  for (const k of ['sentiment_markets', 'sentiment_basis']) if (b[k] != null) {
    const list = String(b[k]).split(',').map((x) => x.trim().slice(0, 30)).filter(Boolean).slice(0, 12);
    ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, list.join(',')));
  }
  if (b.sentiment_prompt != null) ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'sentiment_prompt', String(b.sentiment_prompt).slice(0, 8000)));
  if (b.dash_layout != null) {
    const txt = JSON.stringify(b.dash_layout);
    if (txt.length > 8000 || typeof b.dash_layout !== 'object') throw new HttpError(400, 'Dashboard layout is too large');
    ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'dash_layout', txt));
  }
  if (b.saved_filters != null) {
    if (!Array.isArray(b.saved_filters) || b.saved_filters.length > 40) throw new HttpError(400, 'Up to 40 saved filters');
    const list = b.saved_filters.map((f) => ({ name: String(f && f.name || '').trim().slice(0, 60), f: f && typeof f.f === 'object' ? f.f : {} })).filter((f) => f.name);
    const v = JSON.stringify(list);
    if (v.length > 30000) throw new HttpError(400, 'Saved filters are too large');
    ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'saved_filters', v));
  }
  if (b.group_require_overlap != null) ops.push(stmt(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'group_require_overlap', b.group_require_overlap ? '1' : '0'));
  if (ops.length) {
    if (Object.keys(b).some((k) => k !== 'saved_filters')) ops.push(audit(db, { actor: 'user', action: 'Settings changed', detail: b }));
    await db.batch(ops);
  }
  return { ok: true, settings: (await getSettings(db)).raw };
});

on('POST', '/aliases', async ({ db, request }) => {
  const b = await request.json();
  const alias = String(b.alias || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const canon = String(b.canonical || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!alias || !canon) throw new HttpError(400, 'Both names are needed');
  await run(db, 'INSERT OR REPLACE INTO symbol_aliases (alias, canonical) VALUES (?, ?)', alias, canon);
  return { ok: true };
});
on('DELETE', '/aliases/:alias', async ({ db, params }) => { await run(db, 'DELETE FROM symbol_aliases WHERE alias = ?', params.alias); return { ok: true }; });

on('POST', '/mistakes', async ({ db, request }) => {
  const b = await request.json();
  const label = txt(b.label, 80)?.trim();
  if (!label) throw new HttpError(400, 'Label needed');
  await run(db, 'INSERT INTO mistakes (label) VALUES (?) ON CONFLICT(label) DO UPDATE SET active = 1', label);
  return { ok: true };
});
on('PUT', '/mistakes/:id', async ({ db, params, request }) => {
  const b = await request.json();
  await run(db, 'UPDATE mistakes SET label = COALESCE(?, label), active = COALESCE(?, active) WHERE id = ?', txt(b.label, 80), b.active == null ? null : b.active ? 1 : 0, id(params.id));
  return { ok: true };
});

// ------------------------------------------------------------------ sample data

on('POST', '/sample', async ({ db }) => { await clearSample(db); return await seedSample(db); });
on('DELETE', '/sample', async ({ db }) => { await clearSample(db); return { ok: true }; });

// ------------------------------------------------------------------ firms & accounts

on('POST', '/firms', async ({ db, request, sample }) => {
  const b = await request.json();
  const name = txt(b.name, 80)?.trim();
  if (!name) throw new HttpError(400, 'Name needed');
  const r = await run(db, 'INSERT INTO prop_firms (name, website, notes, is_sample, created_at) VALUES (?,?,?,?,?)', name, txt(b.website, 200), txt(b.notes), sample, Date.now());
  return { ok: true, id: r.meta.last_row_id };
});
on('PUT', '/firms/:id', async ({ db, params, request }) => {
  const b = await request.json();
  await run(db, 'UPDATE prop_firms SET name = COALESCE(?, name), website = ?, notes = ? WHERE id = ?', txt(b.name, 80), txt(b.website, 200), txt(b.notes), id(params.id));
  return { ok: true };
});
on('DELETE', '/firms/:id', async ({ db, params }) => {
  const n = await first(db, 'SELECT COUNT(*) AS n FROM accounts WHERE firm_id = ?', id(params.id));
  if (n.n) throw new HttpError(409, 'Move or archive this firm\'s accounts first');
  await run(db, 'DELETE FROM prop_firms WHERE id = ?', id(params.id));
  return { ok: true };
});

const ACCOUNT_FIELDS = ['firm_id', 'name', 'login', 'server', 'currency', 'kind', 'phase', 'size', 'role', 'master_account_id',
  'daily_loss_pct', 'max_loss_pct', 'max_loss_type', 'profit_target_pct', 'tz_mode', 'status',
  'daily_reset_tz', 'daily_reset_time', 'daily_loss_of', 'daily_loss_from', 'profit_split_pct', 'last_payout_day', 'payout_currency', 'max_risk_trade_pct', 'max_risk_day_pct'];
const RESET_TZS = ['server', 'UTC', 'America/New_York', 'Europe/London', 'Europe/Prague', 'Australia/Brisbane', 'Australia/Sydney', 'Asia/Dubai', 'Asia/Jerusalem'];

function cleanAccount(b) {
  const o = {};
  for (const k of ACCOUNT_FIELDS) if (k in b) o[k] = b[k] === '' ? null : b[k];
  for (const k of ['size', 'daily_loss_pct', 'max_loss_pct', 'profit_target_pct', 'profit_split_pct', 'max_risk_trade_pct', 'max_risk_day_pct']) if (k in o) o[k] = optNum(o[k]);
  for (const k of ['max_risk_trade_pct', 'max_risk_day_pct']) if (o[k] != null && !(o[k] > 0 && o[k] <= 100)) throw new HttpError(400, 'Risk limits are a % of the account size, above 0 and up to 100');
  if (o.profit_split_pct != null && !(o.profit_split_pct >= 0 && o.profit_split_pct <= 100)) throw new HttpError(400, 'Profit split is 0 to 100%');
  if (o.last_payout_day != null && !/^\d{4}-\d{2}-\d{2}$/.test(o.last_payout_day)) throw new HttpError(400, 'Last payout date is YYYY-MM-DD');
  if ('payout_currency' in o && !['AUD', 'NZD', 'USD'].includes(o.payout_currency)) throw new HttpError(400, 'Payout currency is AUD, NZD or USD');
  for (const k of ['firm_id', 'master_account_id']) if (k in o) o[k] = o[k] == null ? null : id(o[k]);
  if (o.role && !['master', 'copy', 'standalone'].includes(o.role)) throw new HttpError(400, 'Bad role');
  if (o.kind && !['challenge', 'funded', 'personal', 'demo'].includes(o.kind)) throw new HttpError(400, 'Bad type');
  if (o.status && !['active', 'archived'].includes(o.status)) throw new HttpError(400, 'Bad status');
  if (o.tz_mode && !['auto', 'fixed'].includes(o.tz_mode)) throw new HttpError(400, 'Bad time mode');
  if (o.max_loss_type && !['static', 'trailing'].includes(o.max_loss_type)) throw new HttpError(400, 'Bad max loss type');
  if ('daily_reset_tz' in o && !RESET_TZS.includes(o.daily_reset_tz)) throw new HttpError(400, 'Bad reset time zone');
  if ('daily_reset_time' in o && !/^([01]\d|2[0-3]):[0-5]\d$/.test(o.daily_reset_time || '')) throw new HttpError(400, 'Reset time is HH:MM');
  if ('daily_loss_of' in o && !['start', 'initial'].includes(o.daily_loss_of)) throw new HttpError(400, 'Bad daily loss basis');
  if ('daily_loss_from' in o && !['higher', 'balance'].includes(o.daily_loss_from)) throw new HttpError(400, 'Bad daily loss reference');
  if ('login' in o) o.login = String(o.login || '').trim();
  if ('name' in o) o.name = String(o.name || '').trim().slice(0, 60);
  if (o.role && o.role !== 'copy') o.master_account_id = null;
  return o;
}

on('POST', '/accounts', async ({ db, request, sample }) => {
  const o = cleanAccount(await request.json());
  if (!o.name || !o.login) throw new HttpError(400, 'Name and MT5 login are needed');
  if (o.role === 'copy' && !o.master_account_id) throw new HttpError(400, 'Choose which account this one copies');
  o.is_sample = sample; o.created_at = Date.now();
  const keys = Object.keys(o);
  const r = await run(db, `INSERT INTO accounts (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => o[k]))
    .catch((e) => { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'That login and server already exist'); throw e; });
  await audit(db, { actor: 'user', account_id: r.meta.last_row_id, action: 'Account added', detail: o.name }).run();
  return { ok: true, id: r.meta.last_row_id };
});

on('PUT', '/accounts/:id', async ({ db, params, request }) => {
  const o = cleanAccount(await request.json());
  const aid = id(params.id);
  if (o.master_account_id === aid) throw new HttpError(400, 'An account cannot copy itself');
  const keys = Object.keys(o);
  if (!keys.length) return { ok: true };
  await run(db, `UPDATE accounts SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => o[k]), aid);
  await audit(db, { actor: 'user', account_id: aid, action: 'Account settings changed', detail: o }).run();
  return { ok: true };
});

on('POST', '/accounts/:id/token', async ({ db, params, sample }) => {
  if (sample) throw new HttpError(400, 'Sample accounts cannot connect to MT5');
  const aid = id(params.id);
  const token = randomToken();
  await run(db, 'UPDATE accounts SET token_hash = ?, token_hint = ? WHERE id = ?', await sha256Hex(token), token.slice(-4), aid);
  await audit(db, { actor: 'user', account_id: aid, action: 'New connector token created', detail: 'previous token no longer works', level: 'warn' }).run();
  return { ok: true, token };
});

// ------------------------------------------------------------------ dashboard

on('GET', '/dashboard', async ({ db, sample, q }) => {
  const now = Date.now();
  const today = bneToday(now);
  const [monthStart] = bneMonthRange(today.slice(0, 7));
  const from30 = bneDayStart(addDays(today, -29));
  const scope = await resolveScope(db, sample, q);
  const ideas = await loadIdeas(db, { sample, scope, from: Math.min(monthStart, from30), to: now + DAY });
  const closed = ideas.filter((i) => i.status === 'closed');
  const day = (i) => bneDay(i.close_time);
  const lastDay = closed.length ? closed.map(day).sort().pop() : null;
  const sumNet = (xs) => round(xs.reduce((a, i) => a + i.net, 0), 2);
  const sumBasis = (xs) => round(xs.reduce((a, i) => a + i.basisNet, 0), 2);
  const pick = (d) => closed.filter((i) => day(i) === d);
  const month = closed.filter((i) => i.close_time >= monthStart);
  const last30 = closed.filter((i) => i.close_time >= from30);

  // per-account month return curve and all-time drawdown
  const scoped = scope.scoped;
  const posRows = scoped.length ? await all(db, `SELECT account_id, close_time, profit + commission + swap + fee AS net FROM positions
    WHERE status = 'closed' AND account_id IN (SELECT value FROM json_each(?)) ORDER BY close_time`, JSON.stringify(scoped.map((a) => a.id))) : [];
  const accounts = scoped.map((a) => {
    const rows = posRows.filter((r) => r.account_id === a.id);
    const start = a.size || a.balance || 0;
    const dd = drawdown(rows.map((r) => ({ time: r.close_time, delta: r.net })), start);
    const monthRows = rows.filter((r) => r.close_time >= monthStart);
    const before = rows.filter((r) => r.close_time < monthStart).reduce((s, r) => s + r.net, 0);
    const monthBase = start + before;
    let cum = 0;
    const curve = monthRows.map((r) => { cum += r.net; return { t: r.close_time, pct: monthBase ? round(cum / monthBase * 100, 3) : 0 }; });
    const todayNet = round(rows.filter((r) => bneDay(r.close_time) === today).reduce((s, r) => s + r.net, 0), 2);
    const total = a.balance != null && a.size ? round(a.balance - a.size, 2) : null;
    const floor = a.size && a.max_loss_pct ? a.size * (1 - a.max_loss_pct / 100) : null;
    return {
      id: a.id, name: a.name, firm: a.firm_name, kind: a.kind, role: a.role, size: a.size, balance: a.balance, equity: a.equity,
      currency: a.currency, last_seen: a.last_seen, today: todayNet, month: round(cum, 2), monthPct: monthBase ? round(cum / monthBase * 100, 2) : null,
      total, totalPct: total != null ? round(total / a.size * 100, 2) : null,
      targetPct: a.profit_target_pct, targetProgress: total != null && a.profit_target_pct ? round(Math.max(0, total) / (a.size * a.profit_target_pct / 100) * 100, 1) : null,
      maxLossPct: a.max_loss_pct, roomToMaxLoss: floor != null && a.equity != null ? round(a.equity - floor, 2) : null,
      dailyLossPct: a.daily_loss_pct, drawdown: dd, curve,
    };
  });
  const props = await loadPropStatus(db, scoped, Number((await getSettings(db)).raw.warn_pct) || 70, now);
  for (const a of accounts) a.prop = props.find((p) => p.account_id === a.id) || null;
  // risk taken today against each account's daily limit
  for (const a of accounts) {
    const used = ideas.filter((i) => bneDay(i.open_time) === today).flatMap((i) => i.risk_checks || []).filter((c) => c.account_id === a.id);
    const last = used.reduce((m, c) => (c.dayUsed > (m ? m.dayUsed : -1) ? c : m), null);
    const acc = scope.accounts.find((x) => x.id === a.id) || {};
    a.riskToday = { used: last ? last.dayUsed : 0, limit: acc.max_risk_day_pct && acc.size ? round(acc.size * acc.max_risk_day_pct / 100, 2) : null,
      tradeLimit: acc.max_risk_trade_pct && acc.size ? round(acc.size * acc.max_risk_trade_pct / 100, 2) : null, level: last ? last.dayLevel : null };
  }
  const ddWorst = accounts.reduce((w, a) => (!w || a.drawdown.maxDdPct > w.drawdown.maxDdPct ? a : w), null);

  // today's preparation (one shared list) and what each account would pay out now
  const prep = await prepState(db, sample, today);
  const payouts = await payoutState(db, scope.accounts.filter((a) => a.status === 'active'));

  return {
    today, lastDay,
    todayNet: sumNet(pick(today)), todayBasis: sumBasis(pick(today)), todaySummary: summary(pick(today)),
    lastDayNet: lastDay ? sumNet(pick(lastDay)) : 0, lastDayBasis: lastDay ? sumBasis(pick(lastDay)) : 0, lastDaySummary: lastDay ? summary(pick(lastDay)) : null,
    monthNet: sumNet(month), monthBasis: sumBasis(month), monthSummary: summary(month),
    stats30: summary(last30),
    drawdown: ddWorst ? { account: ddWorst.name, ...ddWorst.drawdown } : null,
    open: ideas.filter((i) => i.status === 'open'),
    recent: ideas.filter((i) => i.status === 'closed').slice(0, 25),
    accounts,
    prep, payouts,
    scopeAll: scope.isAll,
  };
});

// ------------------------------------------------------------------ ideas

on('GET', '/ideas', async ({ db, sample, q }) => {
  const scope = await resolveScope(db, sample, q);
  const from = q.from ? bneDayStart(q.from) : 0;
  const to = q.to ? bneDayStart(addDays(q.to, 1)) : 8.64e15;
  let ideas = await loadIdeas(db, { sample, scope, from, to, includeOpen: q.status !== 'closed' });
  if (q.status === 'open') ideas = ideas.filter((i) => i.status === 'open');
  if (q.strategy) ideas = ideas.filter((i) => String(i.strategy_id ?? 'none') === q.strategy);
  if (q.symbol) ideas = ideas.filter((i) => i.symbol === q.symbol.toUpperCase());
  if (q.review === 'todo') ideas = ideas.filter((i) => !i.reviewed && i.status === 'closed');
  if (q.result === 'win') ideas = ideas.filter((i) => i.basisNet > 0);
  if (q.result === 'loss') ideas = ideas.filter((i) => i.basisNet < 0);
  const limit = Math.min(Number(q.limit) || 100, 500), offset = Number(q.offset) || 0;
  return { total: ideas.length, summary: summary(ideas.filter((i) => i.status === 'closed')), items: ideas.slice(offset, offset + limit) };
});

on('GET', '/ideas/:id', async ({ db, params, sample }) => {
  const ideaId = id(params.id);
  const idea = await first(db, `SELECT i.*, a.name AS lead_name, a.role AS lead_role FROM ideas i JOIN accounts a ON a.id = i.account_id
    WHERE i.id = ? AND i.is_sample = ?`, ideaId, sample);
  if (!idea) throw new HttpError(404, 'Idea not found');
  const settings = await getSettings(db);
  const [positions, checks, items, mist, shots, log] = await Promise.all([
    all(db, `SELECT p.*, a.name AS account_name, a.role AS account_role, a.size AS account_size, a.currency,
        mp.position_id AS master_position_id
      FROM positions p JOIN accounts a ON a.id = p.account_id LEFT JOIN positions mp ON mp.id = p.master_pos
      WHERE p.idea_id = ? ORDER BY p.account_id = ? DESC, p.account_id, p.open_time`, ideaId, idea.account_id),
    all(db, 'SELECT * FROM trade_checks WHERE idea_id = ?', ideaId),
    idea.strategy_id ? all(db, "SELECT * FROM checklist_items WHERE strategy_id = ? AND kind = 'trade' AND active = 1 ORDER BY sort, id", idea.strategy_id) : [],
    all(db, 'SELECT mistake_id FROM idea_mistakes WHERE idea_id = ?', ideaId),
    all(db, 'SELECT id, filename, content_type, size, caption, timeframe, created_at FROM screenshots WHERE idea_id = ? ORDER BY id', ideaId),
    all(db, 'SELECT * FROM audit_log WHERE idea_id = ? ORDER BY time, id', ideaId),
  ]);
  const links = await all(db, 'SELECT * FROM idea_links WHERE idea_id = ? ORDER BY id', ideaId);
  const paths = await loadPaths(db, positions, settings.riskGraceSec, true);
  const agg = aggregate(idea, positions, null, paths);
  // trade path per account: risk steps (stop moves) for the timeline
  const tradePath = [...paths.entries()].map(([k, v]) => {
    const acct = Number(k.split('|')[1]);
    const a = agg && agg.accounts.find((x) => x.account_id === acct);
    return { account_id: acct, name: a ? a.name : '', lead: acct === idea.account_id, ...(a && a.path ? a.path : {}), steps: v.steps || [] };
  }).sort((x, y) => y.lead - x.lead);
  let riskInfo = { checks: [], violation: false, dayViolation: false }, sentimentInfo = { bias: null, align: 'unset', day: null };
  if (agg) {
    const dayStart = bneDayStart(bneDay(agg.open_time));
    const sameDay = (await all(db, `SELECT DISTINCT p.idea_id FROM positions p JOIN ideas i ON i.id = p.idea_id
      WHERE i.is_sample = ? AND p.open_time >= ? AND p.open_time < ?`, sample, dayStart, dayStart + DAY)).map((r) => r.idea_id);
    const dayIdeas = await loadIdeas(db, { sample, scope: await resolveScope(db, sample, { archived: '1' }), ideaIds: [...new Set([...sameDay, ideaId])] });
    const me = dayIdeas.find((x) => x.id === ideaId);
    if (me) {
      riskInfo = { checks: me.risk_checks || [], violation: !!me.risk_violation, dayViolation: !!me.day_violation, tolerancePct: settings.riskTolerancePct, graceSec: settings.riskGraceSec };
      sentimentInfo = { bias: me.bias, align: me.align, day: bneDay(agg.open_time),
        sentiment: (await sentimentByDay(db, sample, bneDay(agg.open_time), bneDay(agg.open_time))).get(bneDay(agg.open_time)) || null };
    }
  }
  const lead = positions.filter((p) => p.account_id === idea.account_id);
  // nearby lead positions on the same account that are NOT in this idea (for "Add position")
  const t0 = agg ? agg.open_time : Date.now();
  const nearby = await all(db, `SELECT p.id, p.position_id, p.symbol, p.direction, p.open_time, p.close_time, p.volume, p.idea_id, p.status
    FROM positions p WHERE p.account_id = ? AND (p.idea_id IS NULL OR p.idea_id != ?) AND p.open_time BETWEEN ? AND ?
    ORDER BY p.open_time`, idea.account_id, ideaId, t0 - 12 * 3600000, t0 + 12 * 3600000);
  const aliases = await getAliases(db);
  const checked = new Set(checks.filter((c) => c.checked).map((c) => c.item_id));
  return {
    idea: { ...idea, ...agg },
    risk: riskInfo, sentiment: sentimentInfo, tradePath, graceSec: settings.riskGraceSec,
    positions: positions.map((p) => ({ ...p, net: netOf(p), r: p.risk > 0 ? round(netOf(p) / p.risk, 2) : null })),
    checklist: items.map((it) => ({ id: it.id, label: it.label, checked: checked.has(it.id) })),
    mistakes: mist.map((m) => m.mistake_id),
    screenshots: shots,
    links,
    audit: log,
    grouping: {
      windowMin: settings.groupWindowMin, requireOverlap: settings.requireOverlap,
      leadCount: lead.length,
      nearby: nearby.map((n) => ({ ...n, sameKind: canonical(n.symbol, aliases) === idea.symbol && n.direction === idea.direction })),
    },
  };
});

on('PUT', '/ideas/:id', async ({ db, params, request, sample }) => {
  const ideaId = id(params.id);
  const b = await request.json();
  const idea = await first(db, 'SELECT * FROM ideas WHERE id = ? AND is_sample = ?', ideaId, sample);
  if (!idea) throw new HttpError(404, 'Idea not found');
  const set = {};
  if ('strategy_id' in b) set.strategy_id = b.strategy_id == null || b.strategy_id === '' ? null : id(b.strategy_id);
  if ('rating' in b) { const r = b.rating == null ? null : Number(b.rating); if (r != null && !(r >= 1 && r <= 5)) throw new HttpError(400, 'Rating is 1 to 5'); set.rating = r; }
  if ('emotion' in b) set.emotion = txt(b.emotion, 40);
  if ('notes' in b) set.notes = txt(b.notes, 20000);
  if ('reviewed' in b) set.reviewed_at = b.reviewed ? Date.now() : null;
  const keys = Object.keys(set);
  if (!keys.length) return { ok: true };
  set.updated_at = Date.now();
  const ks = Object.keys(set);
  await db.batch([
    stmt(db, `UPDATE ideas SET ${ks.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...ks.map((k) => set[k]), ideaId),
    audit(db, { actor: 'user', idea_id: ideaId, account_id: idea.account_id, action: 'Review updated',
      detail: keys.map((k) => k === 'notes' ? 'notes' : `${k}: ${set[k] ?? '—'}`).join(', ') }),
  ]);
  return { ok: true };
});

on('PUT', '/ideas/:id/checks', async ({ db, params, request }) => {
  const ideaId = id(params.id);
  const b = await request.json();
  const item = await first(db, "SELECT * FROM checklist_items WHERE id = ? AND kind = 'trade'", id(b.item_id));
  if (!item) throw new HttpError(404, 'Checklist item not found');
  await run(db, 'INSERT OR REPLACE INTO trade_checks (idea_id, item_id, checked, label, checked_at) VALUES (?,?,?,?,?)',
    ideaId, item.id, b.checked ? 1 : 0, item.label, Date.now());
  return { ok: true };
});

on('PUT', '/ideas/:id/mistakes', async ({ db, params, request }) => {
  const ideaId = id(params.id);
  const b = await request.json();
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(id);
  await db.batch([
    stmt(db, 'DELETE FROM idea_mistakes WHERE idea_id = ?', ideaId),
    ...ids.map((m) => stmt(db, 'INSERT OR IGNORE INTO idea_mistakes (idea_id, mistake_id) VALUES (?, ?)', ideaId, m)),
  ]);
  return { ok: true };
});

// Move one Master/lead position (and its copies) into this idea.
on('POST', '/ideas/:id/positions', async ({ db, params, request, sample }) => {
  const ideaId = id(params.id);
  const b = await request.json();
  const idea = await first(db, 'SELECT * FROM ideas WHERE id = ? AND is_sample = ?', ideaId, sample);
  const pos = await first(db, 'SELECT * FROM positions WHERE id = ?', id(b.position_row_id));
  if (!idea || !pos) throw new HttpError(404, 'Not found');
  if (pos.account_id !== idea.account_id) throw new HttpError(400, 'Only positions from the idea\'s own account can be added (copies follow automatically)');
  const aliases = await getAliases(db);
  if (canonical(pos.symbol, aliases) !== idea.symbol || pos.direction !== idea.direction)
    throw new HttpError(400, `Not added: this is ${pos.symbol} ${pos.direction}; the idea is ${idea.symbol} ${idea.direction}. Unrelated trades are never combined.`);
  const oldIdea = pos.idea_id;
  await db.batch([
    stmt(db, "UPDATE positions SET idea_id = ?, group_mode = 'manual' WHERE id = ? OR master_pos = ?", ideaId, pos.id, pos.id),
    audit(db, { actor: 'user', idea_id: ideaId, account_id: pos.account_id, action: 'Position added by hand', detail: `#${pos.position_id}` + (oldIdea ? ` (from idea ${oldIdea})` : '') }),
  ]);
  if (oldIdea) await cleanupIdea(db, oldIdea, ideaId);
  return { ok: true };
});

// Take a position (and its copies) out of its idea into a new idea of its own.
on('POST', '/positions/:id/detach', async ({ db, params, sample }) => {
  const pos = await first(db, 'SELECT p.*, i.symbol AS canon, i.account_id AS lead FROM positions p JOIN ideas i ON i.id = p.idea_id WHERE p.id = ? AND i.is_sample = ?', id(params.id), sample);
  if (!pos) throw new HttpError(404, 'Position not found');
  if (pos.account_id !== pos.lead) throw new HttpError(400, 'Copies follow their Master position. Detach the Master position instead, or use “Unlink copy”.');
  const n = await first(db, 'SELECT COUNT(*) AS n FROM positions WHERE idea_id = ? AND account_id = ?', pos.idea_id, pos.account_id);
  if (n.n <= 1) throw new HttpError(400, 'It is the only position in this idea');
  const now = Date.now();
  const res = await db.batch([stmt(db, 'INSERT INTO ideas (account_id, symbol, direction, is_sample, created_at, updated_at) VALUES (?,?,?,?,?,?) RETURNING id',
    pos.account_id, pos.canon, pos.direction, sample, now, now)]);
  const newId = res[0].results[0].id;
  await db.batch([
    stmt(db, "UPDATE positions SET idea_id = ?, group_mode = 'manual' WHERE id = ? OR master_pos = ?", newId, pos.id, pos.id),
    audit(db, { actor: 'user', idea_id: pos.idea_id, account_id: pos.account_id, action: 'Position removed by hand', detail: `#${pos.position_id} → new idea ${newId}` }),
    audit(db, { actor: 'user', idea_id: newId, account_id: pos.account_id, action: 'Idea created by hand', detail: `from #${pos.position_id} (was in idea ${pos.idea_id})` }),
  ]);
  return { ok: true, idea_id: newId };
});

// A copy that was linked to the wrong Master position: unlink it (it becomes its own idea).
on('POST', '/positions/:id/unlink', async ({ db, params, sample }) => {
  const pos = await first(db, 'SELECT p.*, a.is_sample FROM positions p JOIN accounts a ON a.id = p.account_id WHERE p.id = ?', id(params.id));
  if (!pos || pos.is_sample !== sample) throw new HttpError(404, 'Position not found');
  if (!pos.master_pos) throw new HttpError(400, 'This position is not a linked copy');
  const aliases = await getAliases(db);
  const now = Date.now();
  const res = await db.batch([stmt(db, 'INSERT INTO ideas (account_id, symbol, direction, is_sample, created_at, updated_at) VALUES (?,?,?,?,?,?) RETURNING id',
    pos.account_id, canonical(pos.symbol, aliases), pos.direction, sample, now, now)]);
  const newId = res[0].results[0].id;
  await db.batch([
    stmt(db, "UPDATE positions SET idea_id = ?, master_pos = NULL, copy_link = 'manual', copy_of = NULL, group_mode = 'manual' WHERE id = ?", newId, pos.id),
    audit(db, { actor: 'user', idea_id: pos.idea_id, account_id: pos.account_id, action: 'Copy unlinked by hand', detail: `#${pos.position_id} → idea ${newId}` }),
  ]);
  return { ok: true, idea_id: newId };
});

// Merge idea :other into idea :id (same account, symbol, direction).
// Take one account out of a linked idea (the same trade placed by hand on another account): its positions,
// and their copies, become an idea of their own.
on('POST', '/ideas/:id/unlink', async ({ db, params, request, sample }) => {
  const b = await request.json();
  const ideaId = id(params.id), acct = id(b.account_id);
  const idea = await first(db, 'SELECT * FROM ideas WHERE id = ? AND is_sample = ?', ideaId, sample);
  if (!idea) throw new HttpError(404, 'Idea not found');
  if (idea.account_id === acct) throw new HttpError(400, 'That is the lead account. Unlink the other accounts instead.');
  const own = await all(db, 'SELECT id, position_id FROM positions WHERE idea_id = ? AND account_id = ? AND master_pos IS NULL', ideaId, acct);
  if (!own.length) throw new HttpError(400, 'That account has no positions of its own in this idea (copies follow their Master).');
  const now = Date.now();
  const r = await run(db, 'INSERT INTO ideas (account_id, symbol, direction, is_sample, created_at, updated_at) VALUES (?,?,?,?,?,?)', acct, idea.symbol, idea.direction, sample, now, now);
  const newId = r.meta.last_row_id, ids = JSON.stringify(own.map((p) => p.id));
  await db.batch([
    stmt(db, "UPDATE positions SET idea_id = ?, copy_link = NULL, group_mode = 'manual' WHERE id IN (SELECT value FROM json_each(?))", newId, ids),
    stmt(db, 'UPDATE positions SET idea_id = ? WHERE idea_id = ? AND master_pos IN (SELECT value FROM json_each(?))', newId, ideaId, ids),
    audit(db, { actor: 'user', account_id: acct, idea_id: ideaId, action: 'Account unlinked', detail: `${own.length} position(s) moved to idea #${newId}` }),
    audit(db, { actor: 'user', account_id: acct, idea_id: newId, action: 'Idea created', detail: `unlinked from idea #${ideaId}` }),
  ]);
  return { ok: true, id: newId };
});

on('POST', '/ideas/:id/merge', async ({ db, params, request, sample }) => {
  const ideaId = id(params.id);
  const b = await request.json();
  const other = id(b.other_id);
  const [a, c] = await Promise.all([first(db, 'SELECT * FROM ideas WHERE id = ? AND is_sample = ?', ideaId, sample), first(db, 'SELECT * FROM ideas WHERE id = ? AND is_sample = ?', other, sample)]);
  if (!a || !c) throw new HttpError(404, 'Idea not found');
  if (a.account_id !== c.account_id || a.symbol !== c.symbol || a.direction !== c.direction) throw new HttpError(400, 'Only ideas with the same account, symbol and direction can be merged');
  await db.batch([
    stmt(db, "UPDATE positions SET idea_id = ?, group_mode = 'manual' WHERE idea_id = ?", ideaId, other),
    audit(db, { actor: 'user', idea_id: ideaId, account_id: a.account_id, action: 'Ideas merged', detail: `idea ${other} merged into this one` }),
  ]);
  await cleanupIdea(db, other, ideaId);
  return { ok: true };
});

/** Remove an idea that has no positions left; keep its review by moving it to `into`. */
async function cleanupIdea(db, ideaId, into) {
  const n = await first(db, 'SELECT COUNT(*) AS n FROM positions WHERE idea_id = ?', ideaId);
  if (n.n) return;
  const old = await first(db, 'SELECT * FROM ideas WHERE id = ?', ideaId);
  const ops = [
    stmt(db, 'UPDATE screenshots SET idea_id = ? WHERE idea_id = ?', into, ideaId),
    stmt(db, 'UPDATE idea_links SET idea_id = ? WHERE idea_id = ?', into, ideaId),
    stmt(db, 'UPDATE audit_log SET idea_id = ? WHERE idea_id = ?', into, ideaId),
  ];
  if (old && old.notes && old.notes.trim()) {
    ops.push(stmt(db, "UPDATE ideas SET notes = TRIM(COALESCE(notes, '') || char(10) || char(10) || ?) WHERE id = ?", `[From merged idea ${ideaId}] ${old.notes}`, into));
  }
  ops.push(stmt(db, 'DELETE FROM ideas WHERE id = ?', ideaId));
  await db.batch(ops);
}

// ------------------------------------------------------------------ screenshots (R2)

const IMG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

on('POST', '/ideas/:id/screenshots', async ({ db, env, params, request, sample }) => {
  if (!env.SHOTS) throw new HttpError(500, 'Screenshot storage (R2 binding SHOTS) is not set up');
  const ideaId = id(params.id);
  const idea = await first(db, 'SELECT id, account_id FROM ideas WHERE id = ? AND is_sample = ?', ideaId, sample);
  if (!idea) throw new HttpError(404, 'Idea not found');
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'No file');
  const ext = IMG_TYPES[file.type];
  if (!ext) throw new HttpError(400, 'Use a PNG, JPG, WebP or GIF image');
  if (file.size > 10 * 1024 * 1024) throw new HttpError(413, 'Image is larger than 10 MB');
  const key = `ideas/${ideaId}/${crypto.randomUUID()}.${ext}`;
  await env.SHOTS.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  const r = await run(db, 'INSERT INTO screenshots (idea_id, r2_key, filename, content_type, size, caption, timeframe, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ideaId, key, txt(file.name, 120), file.type, file.size, txt(form.get('caption'), 300), cleanTf(form.get('timeframe')), Date.now());
  await audit(db, { actor: 'user', idea_id: ideaId, account_id: idea.account_id, action: 'Screenshot added', detail: txt(file.name, 120) }).run();
  return { ok: true, id: r.meta.last_row_id };
});

on('GET', '/screenshots/:id', async ({ db, env, params }) => {
  const s = await first(db, 'SELECT * FROM screenshots WHERE id = ?', id(params.id));
  if (!s || !env.SHOTS) throw new HttpError(404, 'Not found');
  const obj = await env.SHOTS.get(s.r2_key);
  if (!obj) throw new HttpError(404, 'File missing from storage');
  return new Response(obj.body, { headers: { 'Content-Type': s.content_type || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' } });
});

on('PUT', '/screenshots/:id', async ({ db, params, request }) => {
  const b = await request.json();
  const s = await first(db, 'SELECT id FROM screenshots WHERE id = ?', id(params.id));
  if (!s) throw new HttpError(404, 'Not found');
  await run(db, 'UPDATE screenshots SET timeframe = ?, caption = ? WHERE id = ?', cleanTf(b.timeframe), txt(b.caption, 300), s.id);
  return { ok: true };
});

// ------------------------------------------------------------------ TradingView links (several per idea)

const cleanTf = (x) => { const t = txt(x, 12)?.trim(); return t ? t.toUpperCase() : null; };
function cleanTvUrl(u) {
  const link = txt(u, 500)?.trim();
  if (!link) throw new HttpError(400, 'Paste a TradingView link');
  if (!/^https:\/\/([a-z0-9-]+\.)*tradingview\.com\//i.test(link)) throw new HttpError(400, 'Use a https://www.tradingview.com/… link');
  return link;
}

on('POST', '/ideas/:id/links', async ({ db, params, request, sample }) => {
  const ideaId = id(params.id);
  const idea = await first(db, 'SELECT id, account_id FROM ideas WHERE id = ? AND is_sample = ?', ideaId, sample);
  if (!idea) throw new HttpError(404, 'Idea not found');
  const b = await request.json();
  const n = await first(db, 'SELECT COUNT(*) AS n FROM idea_links WHERE idea_id = ?', ideaId);
  if (n.n >= 30) throw new HttpError(400, 'Up to 30 links per idea');
  const r = await run(db, 'INSERT INTO idea_links (idea_id, url, timeframe, note, created_at) VALUES (?,?,?,?,?)',
    ideaId, cleanTvUrl(b.url), cleanTf(b.timeframe), txt(b.note, 500), Date.now());
  await audit(db, { actor: 'user', idea_id: ideaId, account_id: idea.account_id, action: 'Chart link added', detail: cleanTf(b.timeframe) }).run();
  return { ok: true, id: r.meta.last_row_id };
});

on('PUT', '/links/:id', async ({ db, params, request }) => {
  const b = await request.json();
  const l = await first(db, 'SELECT * FROM idea_links WHERE id = ?', id(params.id));
  if (!l) throw new HttpError(404, 'Link not found');
  await run(db, 'UPDATE idea_links SET url = ?, timeframe = ?, note = ? WHERE id = ?',
    'url' in b ? cleanTvUrl(b.url) : l.url, 'timeframe' in b ? cleanTf(b.timeframe) : l.timeframe, 'note' in b ? txt(b.note, 500) : l.note, l.id);
  return { ok: true };
});

on('DELETE', '/links/:id', async ({ db, params }) => {
  const l = await first(db, 'SELECT * FROM idea_links WHERE id = ?', id(params.id));
  if (!l) throw new HttpError(404, 'Link not found');
  await db.batch([stmt(db, 'DELETE FROM idea_links WHERE id = ?', l.id),
    audit(db, { actor: 'user', idea_id: l.idea_id, action: 'Chart link deleted', detail: l.timeframe })]);
  return { ok: true };
});

on('DELETE', '/screenshots/:id', async ({ db, env, params }) => {
  const s = await first(db, 'SELECT * FROM screenshots WHERE id = ?', id(params.id));
  if (!s) throw new HttpError(404, 'Not found');
  if (env.SHOTS) await env.SHOTS.delete(s.r2_key);
  await db.batch([stmt(db, 'DELETE FROM screenshots WHERE id = ?', s.id),
    audit(db, { actor: 'user', idea_id: s.idea_id, action: 'Screenshot deleted', detail: s.filename })]);
  return { ok: true };
});

// ------------------------------------------------------------------ calendar

on('GET', '/calendar', async ({ db, sample, q }) => {
  const month = /^\d{4}-\d{2}$/.test(q.month || '') ? q.month : bneToday().slice(0, 7);
  const [from, to] = bneMonthRange(month);
  const scope = await resolveScope(db, sample, q);
  const ideas = await loadIdeas(db, { sample, scope, from, to, includeOpen: false });
  const prepRows = await all(db, `SELECT c.day, SUM(c.checked) AS done, COUNT(*) AS total FROM prep_checks c JOIN prep_items p ON p.id = c.item_id
    WHERE p.is_sample = ? AND c.day >= ? AND c.day < ? GROUP BY c.day`, sample, bneDay(from), bneDay(to));
  const prep = Object.fromEntries(prepRows.map((r) => [r.day, { done: r.done, total: r.total }]));
  const days = {};
  for (const i of ideas) {
    const d = bneDay(i.close_time);
    const x = (days[d] ||= { day: d, net: 0, ideas: 0, wins: 0, losses: 0, accounts: {} });
    x.net += i.net; x.ideas++;
    if (i.basisNet > 0) x.wins++; else if (i.basisNet < 0) x.losses++;
    for (const a of i.accounts) if (!scope.ids || scope.ids.has(a.account_id)) x.accounts[a.name] = round((x.accounts[a.name] || 0) + a.net, 2);
  }
  for (const d of Object.values(days)) d.net = round(d.net, 2);
  const list = Object.values(days);
  const best = list.reduce((b, d) => (!b || d.net > b.net ? d : b), null);
  const worst = list.reduce((b, d) => (!b || d.net < b.net ? d : b), null);
  return { month, days, prep, summary: summary(ideas), tradingDays: list.length, greenDays: list.filter((d) => d.net > 0).length,
    redDays: list.filter((d) => d.net < 0).length, best, worst };
});

// ------------------------------------------------------------------ analytics

on('GET', '/analytics', async ({ db, sample, q }) => {
  const today = bneToday();
  const range = q.range || '90d';
  let fromDay = null, toDay = today;
  if (range === '30d') fromDay = addDays(today, -29);
  else if (range === '90d') fromDay = addDays(today, -89);
  else if (range === 'month') fromDay = today.slice(0, 8) + '01';
  else if (range === 'ytd') fromDay = today.slice(0, 5) + '01-01';
  else if (range === 'custom') { fromDay = q.from; toDay = q.to || today; }
  const from = fromDay ? bneDayStart(fromDay) : 0;
  const to = bneDayStart(addDays(toDay, 1));
  const scope = await resolveScope(db, sample, q);
  const ideas = (await loadIdeas(db, { sample, scope, from, to, includeOpen: false })).sort((a, b) => a.close_time - b.close_time);
  const strategies = Object.fromEntries((await all(db, 'SELECT id, name FROM strategies')).map((s) => [s.id, s.name]));
  const mistakes = Object.fromEntries((await all(db, 'SELECT id, label FROM mistakes')).map((m) => [m.id, m.label]));

  // per-account performance (each account's own result in the ideas it took part in)
  const acc = {};
  for (const i of ideas) for (const a of i.accounts) {
    if (scope.ids && !scope.ids.has(a.account_id)) continue;
    (acc[a.account_id] ||= { name: a.name, role: a.role, size: a.size, xs: [] }).xs.push({ ...i, net: a.net, basisNet: a.net, r: a.r });
  }
  const byAccount = Object.entries(acc).map(([aid, v]) => {
    const dd = drawdown(v.xs.map((x) => ({ time: x.close_time, delta: x.net })), v.size || 0);
    return { account_id: Number(aid), name: v.name, role: v.role, ...summary(v.xs), drawdownPct: dd.maxDdPct, drawdown: dd.maxDd };
  });

  let cumR = 0, cum = 0;
  const curve = ideas.map((i) => { cum += i.net; cumR += i.r || 0; return { t: i.close_time, net: round(cum, 2), r: round(cumR, 2) }; });
  const months = groupSummary(ideas, (i) => bneDay(i.close_time).slice(0, 7));
  return {
    range, from: fromDay, to: toDay, count: ideas.length,
    summary: summary(ideas),
    byStrategy: groupSummary(ideas, (i) => i.strategy_id ?? 0).map((g) => ({ ...g, name: g.key ? strategies[g.key] || 'Strategy ' + g.key : 'No strategy' })),
    bySymbol: groupSummary(ideas, (i) => i.symbol),
    byDirection: groupSummary(ideas, (i) => i.direction),
    bySession: groupSummary(ideas, (i) => sessionOf(i.open_time)),
    byAccount, byMonth: months.sort((a, b) => a.key.localeCompare(b.key)),
    rBuckets: rBuckets(ideas), behaviour: behaviour(ideas, mistakes), curve,
    rKnown: ideas.filter((i) => i.r != null).length,
  };
});

/**
 * Every closed idea in the scope, in a compact form, so the Analytics page can filter and group
 * them in the browser (date, symbol, market, strategy, session, weekday, hour, hold time, rules …).
 */
on('GET', '/analytics/ideas', async ({ db, sample, q }) => {
  const scope = await resolveScope(db, sample, q);
  const ideas = (await loadIdeas(db, { sample, scope, includeOpen: false })).sort((a, b) => a.close_time - b.close_time);
  const [mistakes, items, saved] = await Promise.all([
    all(db, 'SELECT id, label FROM mistakes ORDER BY label'),
    all(db, "SELECT c.id, c.label, c.strategy_id FROM checklist_items c JOIN strategies s ON s.id = c.strategy_id WHERE c.kind = 'trade' AND s.is_sample = ?", sample),
    first(db, "SELECT value FROM settings WHERE key = 'saved_filters'"),
  ]);
  return {
    ideas: ideas.map((i) => ({
      id: i.id, open_time: i.open_time, close_time: i.close_time, symbol: i.symbol, direction: i.direction,
      strategy_id: i.strategy_id, strategy: i.strategy_name || 'No strategy', r: i.r, net: i.net, basisNet: i.basisNet, costs: i.costs,
      rating: i.rating, mistakes: i.mistakes, reviewed: i.reviewed, positions: i.lead_positions,
      ckTotal: i.checklistTotal, ckDone: i.checklistDone, missed: [...(i.checklistMissed || []), ...(i.risk_violation ? ['risk_trade'] : []), ...(i.day_violation ? ['risk_day'] : [])],
      autoViolation: !!(i.risk_violation || i.day_violation), align: i.align, bias: i.bias,
      mae: i.path ? i.path.mae_r : null, mfe: i.path ? i.path.mfe_r : null, maeFirst: i.path && i.path.mae_t && i.path.mfe_t ? i.path.mae_t < i.path.mfe_t : null,
    })),
    mistakes, rules: [...items, { id: 'risk_trade', label: 'Risk per idea within limit (auto)' }, { id: 'risk_day', label: 'Daily risk within limit (auto)' }], saved: (() => { try { return JSON.parse(saved?.value || '[]'); } catch { return []; } })(),
  };
});

// ------------------------------------------------------------------ strategies & checklists

on('POST', '/strategies', async ({ db, request, sample }) => {
  const b = await request.json();
  const name = txt(b.name, 80)?.trim();
  if (!name) throw new HttpError(400, 'Name needed');
  const now = Date.now();
  const r = await run(db, `INSERT INTO strategies (name, description, instruments, sessions, default_risk_pct, max_ideas_per_day, setup, entry_rules, stop_rules, exit_rules,
    is_sample, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, name, txt(b.description), txt(b.instruments, 200), txt(b.sessions, 200),
    optNum(b.default_risk_pct), optNum(b.max_ideas_per_day), txt(b.setup), txt(b.entry_rules), txt(b.stop_rules), txt(b.exit_rules), sample, now, now);
  const sid = r.meta.last_row_id;
  if (b.copy_from) {
    const items = await all(db, "SELECT kind, label, sort FROM checklist_items WHERE strategy_id = ? AND kind = 'trade' AND active = 1", id(b.copy_from));
    if (items.length) await db.batch(items.map((it) => stmt(db, 'INSERT INTO checklist_items (strategy_id, kind, label, sort, created_at) VALUES (?,?,?,?,?)', sid, it.kind, it.label, it.sort, now)));
  }
  return { ok: true, id: sid };
});

on('PUT', '/strategies/:id', async ({ db, params, request }) => {
  const b = await request.json();
  const sid = id(params.id);
  const cur = await first(db, 'SELECT * FROM strategies WHERE id = ?', sid);
  if (!cur) throw new HttpError(404, 'Strategy not found');
  // only the fields sent are changed
  const keep = (k, n = 2000) => (k in b ? txt(b[k], n) : cur[k]);
  const keepNum = (k) => (k in b ? optNum(b[k]) : cur[k]);
  await run(db, `UPDATE strategies SET name = COALESCE(?, name), description = ?, instruments = ?, sessions = ?, default_risk_pct = ?,
    max_ideas_per_day = ?, setup = ?, entry_rules = ?, stop_rules = ?, exit_rules = ?, archived = COALESCE(?, archived), updated_at = ? WHERE id = ?`,
    txt(b.name, 80), keep('description'), keep('instruments', 200), keep('sessions', 200), keepNum('default_risk_pct'), keepNum('max_ideas_per_day'),
    keep('setup'), keep('entry_rules'), keep('stop_rules'), keep('exit_rules'),
    b.archived == null ? null : b.archived ? 1 : 0, Date.now(), sid);
  return { ok: true };
});

on('DELETE', '/strategies/:id', async ({ db, params }) => {
  const sid = id(params.id);
  const used = await first(db, 'SELECT COUNT(*) AS n FROM ideas WHERE strategy_id = ?', sid);
  const checks = await first(db, 'SELECT COUNT(*) AS n FROM trade_checks t JOIN checklist_items c ON c.id = t.item_id WHERE c.strategy_id = ?', sid);
  if (used.n || checks.n) { // keep history: archive instead of deleting
    await run(db, 'UPDATE strategies SET archived = 1, updated_at = ? WHERE id = ?', Date.now(), sid);
    return { ok: true, archived: true };
  }
  await run(db, 'DELETE FROM strategies WHERE id = ?', sid);
  return { ok: true, deleted: true };
});

on('POST', '/strategies/:id/items', async ({ db, params, request }) => {
  const b = await request.json();
  const label = txt(b.label, 200)?.trim();
  if (!label) throw new HttpError(400, 'Label needed');
  const sid = id(params.id);
  const max = await first(db, "SELECT COALESCE(MAX(sort), 0) AS m FROM checklist_items WHERE strategy_id = ? AND kind = 'trade'", sid);
  const r = await run(db, "INSERT INTO checklist_items (strategy_id, kind, label, sort, created_at) VALUES (?,'trade',?,?,?)", sid, label, max.m + 1, Date.now());
  return { ok: true, id: r.meta.last_row_id };
});

on('PUT', '/items/:id', async ({ db, params, request }) => {
  const b = await request.json();
  await run(db, 'UPDATE checklist_items SET label = COALESCE(?, label), sort = COALESCE(?, sort) WHERE id = ?', txt(b.label, 200), optNum(b.sort), id(params.id));
  return { ok: true };
});

// "Delete" keeps the item for history (past days and past trade reviews still show it).
on('DELETE', '/items/:id', async ({ db, params }) => { await run(db, 'UPDATE checklist_items SET active = 0 WHERE id = ?', id(params.id)); return { ok: true }; });

// ------------------------------------------------------------------ daily preparation (one list for every strategy)

async function prepState(db, sample, day) {
  const [items, checks] = await Promise.all([
    all(db, 'SELECT id, label FROM prep_items WHERE is_sample = ? AND active = 1 ORDER BY sort, id', sample),
    all(db, 'SELECT c.item_id, c.checked FROM prep_checks c JOIN prep_items p ON p.id = c.item_id WHERE c.day = ? AND p.is_sample = ?', day, sample),
  ]);
  const checked = new Set(checks.filter((c) => c.checked).map((c) => c.item_id));
  const its = items.map((i) => ({ id: i.id, label: i.label, checked: checked.has(i.id) }));
  const settings = await getSettings(db);
  const sent = (await sentimentByDay(db, sample, day, day)).get(day) || null;
  const done = its.filter((i) => i.checked).length;
  return { day, items: its, done, total: its.length, sentiment: sent,
    sentimentOptions: { markets: settings.sentimentMarkets, basis: settings.sentimentBasis, prompt: settings.raw.sentiment_prompt || '' },
    ready: done === its.length && !!(sent && sent.overall) };
}

on('PUT', '/prep/sentiment', async ({ db, request, sample }) => {
  const b = await request.json();
  const today = bneToday();
  if (b.day && b.day !== today) throw new HttpError(409, `Past days are read-only. Today in Brisbane is ${today}.`);
  const ok = (v) => v == null || ['bull', 'neutral', 'bear'].includes(v);
  if (!ok(b.overall)) throw new HttpError(400, 'Sentiment is bull, neutral or bear');
  const markets = {};
  for (const [k, v] of Object.entries(b.markets || {})) { if (!ok(v)) throw new HttpError(400, 'Sentiment is bull, neutral or bear'); if (v) markets[String(k).slice(0, 30)] = v; }
  const basis = Array.isArray(b.basis) ? b.basis.map((x) => String(x).slice(0, 40)).slice(0, 20) : [];
  await run(db, `INSERT INTO prep_sentiment (day, is_sample, overall, markets, basis, note, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT (day, is_sample) DO UPDATE SET overall = excluded.overall, markets = excluded.markets, basis = excluded.basis, note = excluded.note, updated_at = excluded.updated_at`,
    today, sample, b.overall || null, JSON.stringify(markets), JSON.stringify(basis), txt(b.note, 500), Date.now());
  return { ok: true, day: today };
});

on('GET', '/prep', async ({ db, sample, q }) => {
  const today = bneToday();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q.day || '') ? q.day : today;
  if (day === today) return { ...(await prepState(db, sample, day)), today, editable: true };
  const sentiment = (await sentimentByDay(db, sample, day, day)).get(day) || null;
  // a past day: exactly what was recorded that day (labels as they were), read-only
  const rows = await all(db, `SELECT c.item_id, c.label, c.checked FROM prep_checks c JOIN prep_items p ON p.id = c.item_id
    WHERE c.day = ? AND p.is_sample = ? ORDER BY p.sort, p.id`, day, sample);
  const its = rows.map((r) => ({ id: r.item_id, label: r.label, checked: !!r.checked }));
  return { day, today, editable: false, items: its, done: its.filter((i) => i.checked).length, total: its.length, sentiment };
});

on('PUT', '/prep', async ({ db, request, sample }) => {
  const b = await request.json();
  const today = bneToday();
  if (b.day && b.day !== today) throw new HttpError(409, `Past days are read-only. Today in Brisbane is ${today}.`);
  const item = await first(db, 'SELECT * FROM prep_items WHERE id = ? AND is_sample = ? AND active = 1', id(b.item_id), sample);
  if (!item) throw new HttpError(404, 'Checklist item not found');
  // write today's row for every active item, so the day's record is complete
  const items = await all(db, 'SELECT * FROM prep_items WHERE is_sample = ? AND active = 1', sample);
  const now = Date.now();
  await db.batch([
    ...items.map((it) => stmt(db, 'INSERT OR IGNORE INTO prep_checks (item_id, day, checked, label, checked_at) VALUES (?,?,0,?,?)', it.id, today, it.label, now)),
    stmt(db, 'UPDATE prep_checks SET checked = ?, label = ?, checked_at = ? WHERE item_id = ? AND day = ?', b.checked ? 1 : 0, item.label, now, item.id, today),
  ]);
  return { ok: true, day: today };
});

on('POST', '/prep/items', async ({ db, request, sample }) => {
  const b = await request.json();
  const label = txt(b.label, 200)?.trim();
  if (!label) throw new HttpError(400, 'Label needed');
  const max = await first(db, 'SELECT COALESCE(MAX(sort), 0) AS m FROM prep_items WHERE is_sample = ? AND active = 1', sample);
  const r = await run(db, 'INSERT INTO prep_items (label, sort, is_sample, created_at) VALUES (?,?,?,?)', label, max.m + 1, sample, Date.now());
  return { ok: true, id: r.meta.last_row_id };
});

on('PUT', '/prep/items/:id', async ({ db, params, request, sample }) => {
  const b = await request.json();
  await run(db, 'UPDATE prep_items SET label = COALESCE(?, label), sort = COALESCE(?, sort) WHERE id = ? AND is_sample = ?', txt(b.label, 200), optNum(b.sort), id(params.id), sample);
  return { ok: true };
});

// "Delete" keeps the item for history (past days still show it).
on('DELETE', '/prep/items/:id', async ({ db, params, sample }) => {
  await run(db, 'UPDATE prep_items SET active = 0 WHERE id = ? AND is_sample = ?', id(params.id), sample);
  return { ok: true };
});

on('GET', '/prep/history', async ({ db, sample, q }) => {
  const days = Math.min(Number(q.days) || 30, 366);
  const today = bneToday();
  const fromDay = addDays(today, -(days - 1));
  const rows = await all(db, `SELECT c.day, SUM(c.checked) AS done, COUNT(*) AS total FROM prep_checks c JOIN prep_items p ON p.id = c.item_id
    WHERE p.is_sample = ? AND c.day >= ? GROUP BY c.day`, sample, fromDay);
  const list = [];
  for (let k = 0; k < days; k++) list.push(addDays(fromDay, k));
  return { days: list, rows };
});

// ------------------------------------------------------------------ read-only share links (one account each)

const SHARE_OPTS = ['show_money', 'show_trades', 'show_notes', 'show_open', 'show_firm'];
const shareOut = (r, origin) => ({ ...r, url: `${origin}/share/${r.token}`, active: !r.revoked_at && !(r.expires_at && r.expires_at < Date.now()) });
const expiry = (days) => (days == null || days === '' || Number(days) <= 0 ? null : Date.now() + Math.min(Number(days), 3650) * 864e5);

on('GET', '/accounts/:id/shares', async ({ db, params, request }) => {
  const rows = await all(db, 'SELECT * FROM share_links WHERE account_id = ? ORDER BY revoked_at IS NOT NULL, id DESC', id(params.id));
  return { items: rows.map((r) => shareOut(r, new URL(request.url).origin)) };
});

on('POST', '/accounts/:id/shares', async ({ db, params, request }) => {
  const b = await request.json();
  const acct = await first(db, 'SELECT * FROM accounts WHERE id = ?', id(params.id));
  if (!acct) throw new HttpError(404, 'Account not found');
  const n = await first(db, 'SELECT COUNT(*) AS n FROM share_links WHERE account_id = ? AND revoked_at IS NULL', acct.id);
  if (n.n >= 20) throw new HttpError(400, 'Up to 20 active links per account. Turn one off first.');
  const label = (txt(b.label, 80) || acct.name).trim();
  const opt = (k, d) => (b[k] == null ? d : b[k] ? 1 : 0);
  const token = newShareToken(), now = Date.now();
  const r = await run(db, `INSERT INTO share_links (token, account_id, label, show_money, show_trades, show_notes, show_open, show_firm, expires_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, token, acct.id, label, opt('show_money', 1), opt('show_trades', 1), opt('show_notes', 0), opt('show_open', 0), opt('show_firm', 1), expiry(b.expires_days), now);
  await audit(db, { actor: 'user', account_id: acct.id, action: 'Share link created', detail: { label, expires_days: b.expires_days || null } }).run();
  const row = await first(db, 'SELECT * FROM share_links WHERE id = ?', r.meta.last_row_id);
  return shareOut(row, new URL(request.url).origin);
});

on('PUT', '/shares/:id', async ({ db, params, request }) => {
  const b = await request.json();
  const cur = await first(db, 'SELECT * FROM share_links WHERE id = ?', id(params.id));
  if (!cur) throw new HttpError(404, 'Link not found');
  const v = { label: b.label != null ? (txt(b.label, 80) || cur.label).trim() : cur.label };
  for (const k of SHARE_OPTS) v[k] = b[k] == null ? cur[k] : b[k] ? 1 : 0;
  v.expires_at = 'expires_days' in b ? expiry(b.expires_days) : cur.expires_at;
  v.revoked_at = b.active === false ? cur.revoked_at || Date.now() : b.active === true ? null : cur.revoked_at;
  await run(db, `UPDATE share_links SET label = ?, show_money = ?, show_trades = ?, show_notes = ?, show_open = ?, show_firm = ?, expires_at = ?, revoked_at = ? WHERE id = ?`,
    v.label, v.show_money, v.show_trades, v.show_notes, v.show_open, v.show_firm, v.expires_at, v.revoked_at, cur.id);
  if (b.active === false && !cur.revoked_at) await audit(db, { actor: 'user', account_id: cur.account_id, action: 'Share link turned off', detail: { label: cur.label } }).run();
  return shareOut(await first(db, 'SELECT * FROM share_links WHERE id = ?', cur.id), new URL(request.url).origin);
});

on('DELETE', '/shares/:id', async ({ db, params }) => {
  const cur = await first(db, 'SELECT * FROM share_links WHERE id = ?', id(params.id));
  if (!cur) return { ok: true };
  await run(db, 'DELETE FROM share_links WHERE id = ?', cur.id);
  await audit(db, { actor: 'user', account_id: cur.account_id, action: 'Share link deleted', detail: { label: cur.label } }).run();
  return { ok: true };
});

// ------------------------------------------------------------------ payouts

/** Profit each account has made since its last payout (closed trades, after costs). */
async function payoutState(db, accounts) {
  if (!accounts.length) return [];
  const rows = await all(db, `SELECT account_id, close_time, profit + commission + swap + fee AS net FROM positions
    WHERE status = 'closed' AND account_id IN (SELECT value FROM json_each(?))`, JSON.stringify(accounts.map((a) => a.id)));
  return accounts.map((a) => {
    const since = a.last_payout_day ? bneDayStart(addDays(a.last_payout_day, 1)) : 0;
    const profit = round(rows.filter((r) => r.account_id === a.id && r.close_time >= since).reduce((s, r) => s + r.net, 0), 2);
    return { id: a.id, name: a.name, kind: a.kind, split: a.profit_split_pct, currency: a.payout_currency || 'AUD',
      last_payout_day: a.last_payout_day, profit, share: a.profit_split_pct != null ? round(Math.max(0, profit) * a.profit_split_pct / 100, 2) : null };
  });
}

/**
 * USD → AUD / NZD reference rate for the profit split calculator (European Central Bank daily rate
 * via Frankfurter). Cached for 6 hours. If it can't be fetched the app asks for a rate instead.
 */
on('GET', '/fx', async ({ db }) => {
  const row = await first(db, "SELECT value FROM settings WHERE key = 'fx_cache'");
  let cache = null;
  try { cache = row ? JSON.parse(row.value) : null; } catch { cache = null; }
  if (cache && Date.now() - cache.fetched < 6 * 3600000) return cache;
  for (const url of ['https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD,NZD', 'https://api.frankfurter.app/latest?from=USD&to=AUD,NZD']) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) continue;
      const j = await r.json();
      if (!(j.rates && j.rates.AUD > 0 && j.rates.NZD > 0)) continue;
      const out = { AUD: j.rates.AUD, NZD: j.rates.NZD, date: j.date, source: 'European Central Bank (via Frankfurter)', fetched: Date.now() };
      await run(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'fx_cache', JSON.stringify(out));
      return out;
    } catch { /* try the next source */ }
  }
  if (cache) return { ...cache, stale: true };
  return { AUD: null, NZD: null, error: 'Live rate unavailable. Enter a rate.' };
});

on('GET', '/payouts', async ({ db, sample }) => {
  const accts = await all(db, "SELECT * FROM accounts WHERE is_sample = ? AND status = 'active' ORDER BY id", sample);
  return { items: await payoutState(db, accts) };
});

// ------------------------------------------------------------------ sync log / export

on('GET', '/sync/log', async ({ db, sample, q }) => {
  const limit = Math.min(Number(q.limit) || 100, 500);
  const rows = await all(db, `SELECT l.*, a.name AS account_name FROM audit_log l LEFT JOIN accounts a ON a.id = l.account_id
    WHERE (a.id IS NULL OR a.is_sample = ?) ${q.actor ? 'AND l.actor = ?' : ''} ORDER BY l.time DESC, l.id DESC LIMIT ?`,
    ...(q.actor ? [sample, q.actor, limit] : [sample, limit]));
  return { items: rows };
});

on('GET', '/export/ideas.csv', async ({ db, sample, q }) => {
  const scope = await resolveScope(db, sample, q);
  const ideas = (await loadIdeas(db, { sample, scope, includeOpen: false })).sort((a, b) => a.close_time - b.close_time);
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['idea_id', 'opened_brisbane', 'closed_brisbane', 'duration_min', 'symbol', 'direction', 'strategy', 'lead_account', 'positions', 'copies',
    'gross_scope', 'commission_scope', 'swap_scope', 'fees_scope', 'net_scope', 'net_lead', 'risk_lead', 'r', 'rating', 'mistakes', 'reviewed'];
  const fmt = (t) => new Date(t + 10 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  const lines = [head.join(',')].concat(ideas.map((i) => [i.id, fmt(i.open_time), fmt(i.close_time), Math.round((i.close_time - i.open_time) / 60000),
    i.symbol, i.direction, i.strategy_name, i.lead_name, i.lead_positions, i.copies, i.gross, i.commission, i.swap, i.fee, i.net, i.basisNet, i.risk, i.r, i.rating, i.mistakes.length, i.reviewed ? 'yes' : 'no'].map(esc).join(',')));
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="trade-ideas.csv"' } });
});

on('POST', '/accounts/:id/regroup-pending', async ({ db, params }) => {
  // run grouping again for this account's positions that are still waiting (e.g. after fixing roles)
  const acct = await first(db, 'SELECT * FROM accounts WHERE id = ?', id(params.id));
  if (!acct) throw new HttpError(404, 'Account not found');
  const rows = await all(db, "SELECT position_id FROM positions WHERE account_id = ? AND idea_id IS NULL", acct.id);
  const r = rows.length ? await groupAccount(db, acct, rows.map((x) => x.position_id)) : { created: 0, joined: 0, linked: 0 };
  return { ok: true, ...r, waiting: rows.length };
});


// ------------------------------------------------------------------ prop-rule monitor

on('GET', '/prop', async ({ db, sample, q }) => {
  const scope = await resolveScope(db, sample, q);
  const set = (await getSettings(db)).raw;
  return { warnPct: Number(set.warn_pct) || 70, items: await loadPropStatus(db, scope.scoped, Number(set.warn_pct) || 70) };
});

// ------------------------------------------------------------------ alerts (Telegram)

on('POST', '/alerts/find-chat', async ({ db, env }) => {
  const c = await findChat(env);
  await run(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'telegram_chat_id', c.id);
  await sendTelegram(env, c.id, '<b>Trade Journal</b>\nConnected. Alerts will come to this chat.');
  return { ok: true, chat: c };
});

on('POST', '/alerts/test', async ({ db, env, request }) => {
  const b = await request.json().catch(() => ({}));
  const chat = (await getSettings(db)).raw.telegram_chat_id;
  const now = Date.now(), today = bneToday(now);
  let text;
  if (b.kind === 'daily') {
    const y = addDays(today, -1);
    text = await summaryText(db, 'Trade Journal · yesterday (' + y + ')', bneDayStart(y), bneDayStart(today));
  } else if (b.kind === 'week') {
    text = await summaryText(db, 'Trade Journal · last 7 days', bneDayStart(addDays(today, -6)), now);
  } else if (b.kind === 'rules') {
    const accts = await all(db, "SELECT * FROM accounts WHERE is_sample = 0 AND status = 'active'");
    const st = await loadPropStatus(db, accts, Number((await getSettings(db)).raw.warn_pct) || 70, now);
    const lines = st.flatMap((x) => (x.rules || []).map((r) => `${x.name}: ${r.label} ${r.pct.toFixed(0)}% used (room $${Math.round(r.room).toLocaleString('en-US')})`));
    text = '<b>Trade Journal · rule check</b>\n' + (lines.join('\n') || 'No accounts with rules set.');
  } else text = '<b>Trade Journal</b>\nTest message. Alerts are working.';
  await sendTelegram(env, chat, text);
  return { ok: true };
});

// ------------------------------------------------------------------ weekly / monthly review

function periodRange(q) {
  if (q.kind === 'month') {
    const m = /^\d{4}-\d{2}$/.test(q.month || '') ? q.month : bneToday().slice(0, 7);
    const [from, to] = bneMonthRange(m);
    return { period: 'month:' + m, from, to, label: m };
  }
  let start = /^\d{4}-\d{2}-\d{2}$/.test(q.start || '') ? q.start : bneToday();
  const wd = new Date(start + 'T00:00:00Z').getUTCDay();
  start = addDays(start, -((wd + 6) % 7)); // back to Monday
  return { period: 'week:' + start, from: bneDayStart(start), to: bneDayStart(addDays(start, 7)), label: start };
}

on('GET', '/review', async ({ db, sample, q }) => {
  const pr = periodRange(q);
  const scope = await resolveScope(db, sample, q);
  const ideas = (await loadIdeas(db, { sample, scope, from: pr.from, to: pr.to, includeOpen: false })).sort((a, b) => a.close_time - b.close_time);
  const mistakes = Object.fromEntries((await all(db, 'SELECT id, label FROM mistakes')).map((m) => [m.id, m.label]));
  const byDay = {};
  for (const i of ideas) {
    const d = bneDay(i.close_time);
    const x = (byDay[d] ||= { day: d, net: 0, ideas: 0, wins: 0, losses: 0 });
    x.net = round(x.net + i.net, 2); x.ideas++; if (i.basisNet > 0) x.wins++; else if (i.basisNet < 0) x.losses++;
  }
  const withR = ideas.filter((i) => i.r != null);
  const withList = ideas.filter((i) => i.checklistTotal > 0);
  const prepRows = await all(db, `SELECT c.day, SUM(c.checked) AS done, COUNT(*) AS total FROM prep_checks c JOIN prep_items p ON p.id = c.item_id
    WHERE p.is_sample = ? AND c.day >= ? AND c.day < ? GROUP BY c.day`, sample, bneDay(pr.from), bneDay(pr.to));
  const notes = await first(db, 'SELECT * FROM reviews WHERE period = ? AND is_sample = ?', pr.period, sample);
  const pick = (i) => ({ id: i.id, symbol: i.symbol, direction: i.direction, r: i.r, net: i.net, close_time: i.close_time, strategy_name: i.strategy_name });
  const mcount = {};
  for (const i of ideas) for (const m of i.mistakes) mcount[m] = (mcount[m] || 0) + 1;
  return {
    ...pr, summary: summary(ideas), days: Object.values(byDay),
    best: [...withR].sort((a, b) => b.r - a.r).slice(0, 3).map(pick),
    worst: [...withR].sort((a, b) => a.r - b.r).slice(0, 3).map(pick),
    unreviewed: ideas.filter((i) => !i.reviewed).length,
    checklist: { ideas: withList.length, complete: withList.filter((i) => i.checklistDone >= i.checklistTotal).length },
    prep: { days: prepRows.length, complete: prepRows.filter((r) => r.total > 0 && r.done >= r.total).length },
    mistakes: Object.entries(mcount).map(([id, n]) => ({ id: Number(id), label: mistakes[id] || 'Mistake', count: n })).sort((a, b) => b.count - a.count),
    bySymbol: groupSummary(ideas, (i) => i.symbol), byStrategy: groupSummary(ideas, (i) => i.strategy_name || 'No strategy'),
    notes: notes || null,
  };
});

on('PUT', '/review', async ({ db, request, sample }) => {
  const b = await request.json();
  if (!/^(week:\d{4}-\d{2}-\d{2}|month:\d{4}-\d{2})$/.test(b.period || '')) throw new HttpError(400, 'Bad period');
  const rating = b.rating == null || b.rating === '' ? null : Number(b.rating);
  if (rating != null && !(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Rating is 1 to 5');
  await run(db, `INSERT INTO reviews (period, is_sample, goals, went_well, improve, rating, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT (period, is_sample) DO UPDATE SET goals = excluded.goals, went_well = excluded.went_well, improve = excluded.improve,
    rating = excluded.rating, updated_at = excluded.updated_at`,
    b.period, sample, txt(b.goals, 5000), txt(b.went_well, 5000), txt(b.improve, 5000), rating, Date.now());
  return { ok: true };
});

// ------------------------------------------------------------------ import an MT5 statement

on('POST', '/accounts/:id/import', async ({ db, params, request, sample }) => {
  if (sample) throw new HttpError(400, 'Switch to “My data” to import a statement');
  const acct = await first(db, 'SELECT * FROM accounts WHERE id = ? AND is_sample = 0', id(params.id));
  if (!acct) throw new HttpError(404, 'Account not found');
  const b = await request.json();
  const list = Array.isArray(b.positions) ? b.positions : [];
  if (!list.length) throw new HttpError(400, 'No positions to import');
  if (list.length > 5000) throw new HttpError(400, 'Up to 5,000 positions per import; split the statement');
  const offset = Math.round((Number(b.offset_hours) || 0) * 3600);
  const mode = b.tz_mode === 'fixed' ? 'fixed' : 'auto';

  // skip positions the connector already sent (real deals)
  const have = new Set((await all(db, 'SELECT DISTINCT position_id FROM deals WHERE account_id = ? AND ticket > 0', acct.id)).map((r) => r.position_id));
  const deals = [];
  let skipped = 0;
  for (const p of list) {
    const pos = Number(p.position);
    if (!Number.isInteger(pos) || pos <= 0 || !p.symbol || !isFinite(p.open_time) || !isFinite(p.close_time)) { skipped++; continue; }
    if (have.has(pos)) { skipped++; continue; }
    const long = String(p.type).toLowerCase().startsWith('buy');
    const vol = Number(p.volume) || 0, op = Number(p.open_price) || 0, cp = Number(p.close_price) || 0, sl = Number(p.sl) || 0;
    const profit = Number(p.profit) || 0;
    // money at risk at the S/L, estimated from this trade's own P&L per price unit
    let risk = null;
    if (sl > 0 && Math.abs(cp - op) > 0 && profit !== 0 && ((long && sl < op) || (!long && sl > op))) {
      risk = Math.round(Math.abs(profit) * Math.abs(op - sl) / Math.abs(cp - op) * 100) / 100;
    }
    const base = { position: pos, symbol: String(p.symbol).slice(0, 32), volume: vol, magic: 0, reason: 0, fee: 0 };
    deals.push({ ...base, ticket: -(pos * 2), order: pos, time: Number(p.open_time), type: long ? 0 : 1, entry: 0, price: op, profit: 0,
      commission: Number(p.commission) || 0, swap: 0, sl, tp: Number(p.tp) || 0, risk, comment: 'imported' });
    deals.push({ ...base, ticket: -(pos * 2 + 1), order: pos, time: Number(p.close_time), type: long ? 1 : 0, entry: 1, price: cp, profit,
      commission: 0, swap: Number(p.swap) || 0, sl: 0, tp: 0, risk: null, comment: 'imported' });
  }
  const before = await first(db, 'SELECT COUNT(*) AS n FROM ideas WHERE account_id = ?', acct.id);
  const acctForImport = { ...acct, tz_mode: mode };
  for (let k = 0; k < deals.length; k += 300) {
    await processUpload(db, acctForImport, { login: acct.login, offset_sec: offset, deals: deals.slice(k, k + 300), positions: [], positions_complete: false, import: true });
  }
  // keep the live balance/equity from the connector (an import doesn't send any)
  const after = await first(db, 'SELECT COUNT(*) AS n FROM ideas WHERE account_id = ?', acct.id);
  await audit(db, { actor: 'user', account_id: acct.id, action: 'Statement imported',
    detail: `${deals.length / 2} positions imported, ${skipped} skipped (already synced or unreadable); server time ${mode === 'fixed' ? 'UTC' + (offset >= 0 ? '+' : '') + offset / 3600 : 'auto (+2/+3)'}` }).run();
  return { ok: true, imported: deals.length / 2, skipped, ideas: after.n - before.n };
});
