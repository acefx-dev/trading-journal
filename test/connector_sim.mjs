// Simulates the MT5 connector against a running local journal (npx wrangler pages dev).
// Usage: node test/connector_sim.mjs http://127.0.0.1:8788
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://127.0.0.1:8788';
const api = async (method, path, body, headers = {}) => {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
};
const OFF = 7200; // broker server = UTC+2 (November)
const srv = (utc) => utc + OFF * 1000;
const now = Date.now();
const T0 = now - 3 * 3600000; // a trade 3 hours ago

const uniq = String(Math.floor(Math.random() * 1e6));
// earlier runs leave trades at the same times, so keep account linking off until section 21
await api('PUT', '/settings', { link_accounts: false });
const firm = await api('POST', '/firms', { name: 'Sim firm ' + uniq });
const master = await api('POST', '/accounts', { name: 'Sim Master ' + uniq, login: '7' + uniq, firm_id: firm.id, kind: 'funded', size: 50000, role: 'master', max_loss_pct: 10, daily_loss_pct: 5 });
const copy = await api('POST', '/accounts', { name: 'Sim Copy ' + uniq, login: '8' + uniq, firm_id: firm.id, kind: 'challenge', size: 100000, role: 'copy', master_account_id: master.id, profit_target_pct: 8 });
assert.equal(master.ok, true); assert.equal(copy.ok, true);
const mTok = (await api('POST', `/accounts/${master.id}/token`)).token;
const cTok = (await api('POST', `/accounts/${copy.id}/token`)).token;
const send = (tok, login, payload) => api('POST', '/ingest', { v: 1, connector: '1.00', login, server: 'Sim-Live', company: 'Sim Broker', currency: 'USD', offset_sec: OFF + 3, positions_complete: true, ...payload }, { Authorization: 'Bearer ' + tok });

// wrong token for this terminal → rejected
let r = await send(mTok, '8' + uniq, { deals: [], positions: [] });
assert.equal(r.status, 403, 'token for another login must be rejected');
r = await api('POST', '/ingest', { login: 'x' }, { Authorization: 'Bearer nope' });
assert.equal(r.status, 401);

// 1. Master opens JP225 long with S/L attached a few seconds later (deal has no S/L; live position does)
const P1 = 48120931, P2 = 48121055;
const d1 = { ticket: 51177203, order: P1, position: P1, time: srv(T0), type: 0, entry: 0, symbol: 'JPN225', volume: 1, price: 50128, profit: 0, commission: -0.35, swap: 0, fee: 0, sl: 0, tp: 0, risk: null, magic: 0, reason: 0, comment: 'RGR panel' };
r = await send(mTok, '7' + uniq, { balance: 50000, equity: 49990, deals: [d1], positions: [{ position: P1, symbol: 'JPN225', type: 0, volume: 1, price: 50128, time: srv(T0), sl: 50068, tp: 0, profit: -10, swap: 0, risk: 150, magic: 0, comment: 'RGR panel' }] });
assert.equal(r.ok, true); assert.equal(r.new_deals, 1); assert.equal(r.created, 1);
assert.equal(r.ack_server_msc, srv(T0));

// 2. resend same deal (overlap) → no duplicate
r = await send(mTok, '7' + uniq, { deals: [d1], positions: [{ position: P1, symbol: 'JPN225', type: 0, volume: 1, price: 50128, time: srv(T0), sl: 50068, tp: 0, profit: 5, swap: 0, risk: 150, comment: 'RGR panel' }] });
assert.equal(r.new_deals, 0);

// 3. copy account: copy arrives BEFORE the Master's add (waits), plus copy of P1
const c1 = { ticket: 7729901, order: 9120233, position: 9120233, time: srv(T0 + 900), type: 0, entry: 0, symbol: 'JP225.cash', volume: 2, price: 50129, profit: 0, commission: -0.7, swap: 0, fee: 0, sl: 50068, tp: 0, risk: 310, magic: 260501, reason: 0, comment: 'TC:' + P1 };
const c2 = { ticket: 7729902, order: 9120240, position: 9120240, time: srv(T0 + 12 * 60000 + 800), type: 0, entry: 0, symbol: 'JP225.cash', volume: 1.2, price: 50153, profit: 0, commission: -0.4, swap: 0, fee: 0, sl: 50112, tp: 0, risk: 120, magic: 260501, reason: 0, comment: 'TC:' + P2 };
r = await send(cTok, '8' + uniq, { balance: 100000, equity: 100000, deals: [c1, c2], positions: [] });
assert.equal(r.linked, 1, 'copy of P1 links immediately; copy of P2 waits for its Master');

// 4. Master adds P2 12 minutes later → joins the same idea; the waiting copy links
const d2 = { ticket: 51177300, order: P2, position: P2, time: srv(T0 + 12 * 60000), type: 0, entry: 0, symbol: 'JPN225', volume: 0.6, price: 50152, profit: 0, commission: -0.2, swap: 0, fee: 0, sl: 50112, tp: 0, risk: 60, magic: 0, reason: 0, comment: 'RGR panel' };
r = await send(mTok, '7' + uniq, { deals: [d2], positions: [] /* closed list incomplete is fine */, positions_complete: false });
assert.equal(r.joined, 1, 'add joins the idea'); assert.equal(r.linked, 1, 'waiting copy linked');

// 5. an unrelated NAS100 short on the Master 5 minutes later → a separate idea
const d3 = { ticket: 51177400, order: 48122000, position: 48122000, time: srv(T0 + 17 * 60000), type: 1, entry: 0, symbol: 'NAS100', volume: 1, price: 21400, profit: 0, commission: 0, swap: 0, fee: 0, sl: 21430, tp: 0, risk: 30, magic: 0, reason: 0, comment: '' };
r = await send(mTok, '7' + uniq, { deals: [d3], positions_complete: false });
assert.equal(r.created, 1, 'unrelated trade is its own idea');

// 6. everything closes
const out = (ticket, pos, t, type, sym, vol, px, pf) => ({ ticket, order: ticket, position: pos, time: srv(t), type, entry: 1, symbol: sym, volume: vol, price: px, profit: pf, commission: 0, swap: 0, fee: 0, sl: 0, tp: 0, risk: null, magic: 0, reason: 4, comment: '' });
r = await send(mTok, '7' + uniq, { balance: 50380, equity: 50380, deals: [out(51178000, P1, T0 + 48 * 60000, 1, 'JPN225', 1, 50236, 270), out(51178001, P2, T0 + 48 * 60000, 1, 'JPN225', 0.6, 50236, 126), out(51178002, 48122000, T0 + 30 * 60000, 0, 'NAS100', 1, 21410, -10)], positions: [] });
r = await send(cTok, '8' + uniq, { balance: 100780, equity: 100780, deals: [out(7729990, 9120233, T0 + 48 * 60000 + 500, 1, 'JP225.cash', 2, 50236, 540), out(7729991, 9120240, T0 + 48 * 60000 + 600, 1, 'JP225.cash', 1.2, 50236, 250)], positions: [] });

// 7. check the idea
const ideas = await api('GET', `/ideas?acct=${master.id}`);
const jp = ideas.items.find((i) => i.symbol === 'JP225');
assert.ok(jp, 'JP225 idea exists');
assert.equal(jp.status, 'closed');
assert.equal(jp.lead_positions, 2);
assert.equal(jp.basisNet, 395.45); // 270 + 126 - 0.35 - 0.2
assert.equal(jp.risk, 210);        // 150 (live S/L, first seen) + 60
assert.equal(jp.r, 1.88);
const all = await api('GET', `/ideas?firm=${firm.id}`);
const jpAll = all.items.find((i) => i.id === jp.id);
assert.equal(jpAll.accounts.length, 2);
assert.equal(jpAll.net, round(395.45 + 540 + 250 - 0.7 - 0.4));
const det = await api('GET', `/ideas/${jp.id}`);
assert.equal(det.positions.length, 4);
assert.ok(det.audit.some((a) => a.action === 'Copy linked'));

// 8. manual: detach P2 into its own idea, then add it back
const p2row = det.positions.find((p) => p.position_id === P2);
r = await api('POST', `/positions/${p2row.id}/detach`);
assert.ok(r.idea_id);
const after = await api('GET', `/ideas/${jp.id}`);
assert.equal(after.positions.length, 2, 'P2 and its copy left the idea');
r = await api('POST', `/ideas/${jp.id}/positions`, { position_row_id: p2row.id });
assert.equal(r.ok, true);
const back = await api('GET', `/ideas/${jp.id}`);
assert.equal(back.positions.length, 4, 'P2 and its copy are back; empty idea removed');
// adding an unrelated trade is refused
const nas = all.items.find((i) => i.symbol === 'NAS100');
const nasDet = await api('GET', `/ideas/${nas.id}`);
r = await api('POST', `/ideas/${jp.id}/positions`, { position_row_id: nasDet.positions[0].id });
assert.equal(r.status, 400);

// 9. daily reconciliation: MT5 has one deal the journal never got
r = await send(mTok, '7' + uniq, { deals: [], reconcile: { from: srv(T0 - 86400000), to: srv(now + 86400000), tickets: [51177203, 51177300, 51177400, 51178000, 51178001, 51178002, 51179999] } });
assert.deepEqual(r.missing, [51179999]);

// 10. account groups: funded (the Master) vs challenge (the copy)
const funded = await api('GET', `/ideas?acct=kind:funded&firm=${firm.id}`);
const chall = await api('GET', `/ideas?acct=kind:challenge&firm=${firm.id}`);
const jpF = funded.items.find((x) => x.id === jp.id), jpC = chall.items.find((x) => x.id === jp.id);
assert.equal(jpF.net, 395.45, 'funded group = Master result');
assert.equal(jpC.net, round(540 + 250 - 0.7 - 0.4), 'challenge group = copy result');
assert.equal(jpC.r, round((540 + 250 - 0.7 - 0.4) / (310 + 120)), 'R falls back to the copy account when the lead is outside the group');
r = await api('GET', `/ideas?acct=kind:demo&firm=${firm.id}`);
assert.equal(r.items.length, 0);

// 11. costs: commission is split out, gross + costs = net
assert.equal(jpAll.commission, round(-0.35 - 0.2 - 0.7 - 0.4));
assert.equal(round(jpAll.gross + jpAll.costs), jpAll.net);

// 12. chart links with timeframe and note; only TradingView links
r = await api('POST', `/ideas/${jp.id}/links`, { url: 'https://www.tradingview.com/x/AbC123/', timeframe: 'm5', note: 'entry' });
assert.equal(r.ok, true);
const linkId = r.id;
r = await api('POST', `/ideas/${jp.id}/links`, { url: 'https://evil.example.com/x', timeframe: 'H1' });
assert.equal(r.status, 400);
r = await api('PUT', `/links/${linkId}`, { timeframe: 'H1', note: 'context' });
let det2 = await api('GET', `/ideas/${jp.id}`);
assert.equal(det2.links.length, 1); assert.equal(det2.links[0].timeframe, 'H1'); assert.equal(det2.links[0].note, 'context');
await api('POST', `/ideas/${jp.id}/links`, { url: 'https://www.tradingview.com/chart/xyz/', timeframe: 'D1' });
det2 = await api('GET', `/ideas/${jp.id}`);
assert.equal(det2.links.length, 2);
r = await api('DELETE', `/links/${linkId}`);
det2 = await api('GET', `/ideas/${jp.id}`);
assert.equal(det2.links.length, 1);

// 13. screenshot with timeframe, then change it
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'shot.png'); fd.append('timeframe', 'm15');
const up = await (await fetch(BASE + `/api/ideas/${jp.id}/screenshots`, { method: 'POST', body: fd })).json();
assert.equal(up.ok, true);
r = await api('PUT', `/screenshots/${up.id}`, { timeframe: 'H4', caption: 'after the add' });
det2 = await api('GET', `/ideas/${jp.id}`);
const sh = det2.screenshots.find((x) => x.id === up.id);
assert.equal(sh.timeframe, 'H4'); assert.equal(sh.caption, 'after the add');

// 14. default view setting
r = await api('PUT', '/settings', { default_scope: 'kind:funded' });
assert.equal(r.settings.default_scope, 'kind:funded');
r = await api('PUT', '/settings', { default_scope: 'drop table' });
assert.equal(r.status, 400);
await api('PUT', '/settings', { default_scope: 'all' });

// 15. prop-rule monitor: the Master is funded 50K, daily 5%, max 10%
await api('PUT', `/accounts/${master.id}`, { daily_reset_tz: 'UTC', daily_reset_time: '00:00', daily_loss_from: 'balance' });
r = await api('PUT', `/accounts/${master.id}`, { daily_reset_tz: 'Mars/Olympus' });
assert.equal(r.status, 400, 'bad reset time zone refused');
const prop = await api('GET', `/prop?acct=${master.id}`);
const pm = prop.items[0];
assert.equal(pm.rules.length, 2);
assert.equal(pm.rules.find((x) => x.key === 'max').floor, 45000);
assert.ok(['ok', 'warn', 'danger', 'breached'].includes(pm.level));
const dash = await api('GET', `/dashboard?acct=${master.id}`);
assert.ok(dash.accounts[0].prop, 'dashboard carries prop status');

// 16. weekly review: stats for the week + saved notes
const rv = await api('GET', `/review?kind=week&firm=${firm.id}`);
assert.ok(rv.period.startsWith('week:'));
r = await api('PUT', '/review', { period: rv.period, goals: 'Max 2 ideas a day', improve: 'Wait for the close', rating: 4 });
assert.equal(r.ok, true);
const rv2 = await api('GET', `/review?kind=week&firm=${firm.id}`);
assert.equal(rv2.notes.goals, 'Max 2 ideas a day'); assert.equal(rv2.notes.rating, 4);
r = await api('PUT', '/review', { period: 'drop table', goals: 'x' });
assert.equal(r.status, 400);

// 17. statement import into the copy account; a real deal later replaces the imported one
const day0 = Date.parse('2026-10-15T00:00:00Z');
const imp = await api('POST', `/accounts/${copy.id}/import`, { tz_mode: 'fixed', offset_hours: 2, positions: [
  { position: 777001, symbol: 'JP225.cash', type: 'buy', volume: 2, open_time: day0 + 3 * 3600000, open_price: 50000, sl: 49950, tp: 0,
    close_time: day0 + 4 * 3600000, close_price: 50100, commission: -0.7, swap: 0, profit: 200 },
  { position: 777002, symbol: 'EURUSD', type: 'sell', volume: 1, open_time: day0 + 10 * 3600000, open_price: 1.085, sl: 1.088, tp: 0,
    close_time: day0 + 30 * 3600000, close_price: 1.082, commission: -7, swap: -2.5, profit: 300 },
  { position: 9120233, symbol: 'JP225.cash', type: 'buy', volume: 2, open_time: day0, open_price: 1, sl: 0, tp: 0, close_time: day0 + 1, close_price: 1, commission: 0, swap: 0, profit: 0 },
] });
assert.equal(imp.imported, 2); assert.equal(imp.skipped, 1, 'already-synced position skipped');
const impIdeas = await api('GET', `/ideas?acct=${copy.id}&from=2026-10-15&to=2026-10-17`);
const eu = impIdeas.items.find((x) => x.symbol === 'EURUSD');
assert.ok(eu, 'imported trade is an idea');
assert.equal(eu.r, 0.97, 'R = net 290.50 / estimated risk 300 (300 × 0.003 / 0.003)');
assert.equal(eu.swap, -2.5);
const jpImp = impIdeas.items.find((x) => x.symbol === 'JP225');
assert.equal(jpImp.net, 199.3);
// now the connector sends the real deals of 777001 → imported ones dropped, no double counting
const t0s = day0 + 3 * 3600000 + 2 * 3600000; // server time
r = await send(cTok, '8' + uniq, { deals: [
  { ticket: 7800001, order: 777001, position: 777001, time: t0s, type: 0, entry: 0, symbol: 'JP225.cash', volume: 2, price: 50000, profit: 0, commission: -0.7, swap: 0, fee: 0, sl: 49950, tp: 0, risk: 100, magic: 0, reason: 0, comment: '' },
  { ticket: 7800002, order: 777001, position: 777001, time: t0s + 3600000, type: 1, entry: 1, symbol: 'JP225.cash', volume: 2, price: 50100, profit: 200, commission: 0, swap: 0, fee: 0, sl: 0, tp: 0, risk: null, magic: 0, reason: 0, comment: '' },
], positions_complete: false });
const afterReal = await api('GET', `/ideas?acct=${copy.id}&from=2026-10-15&to=2026-10-17`);
const jpReal = afterReal.items.find((x) => x.symbol === 'JP225');
assert.equal(jpReal.net, 199.3, 'not doubled after real deals arrive');
assert.equal(jpReal.r, 1.99, 'R now from the connector\'s exact risk');
r = await api('POST', `/accounts/${copy.id}/import?mode=sample`, { positions: [{}] });
assert.equal(r.status, 400, 'no imports into sample mode');

// 18. alerts without a bot token: clear error, uploads unaffected
r = await api('POST', '/alerts/test', {});
assert.equal(r.status, 500); assert.match(r.error, /TELEGRAM_BOT_TOKEN/);

// 19. v1.3: one shared daily prep list, payouts per account, playbooks, saved filters
const item = await api('POST', '/prep/items', { label: 'Sim prep ' + uniq });
assert.equal(item.ok, true);
r = await api('PUT', '/prep', { item_id: item.id, checked: true });
assert.equal(r.ok, true);
let prepNow = await api('GET', '/prep');
assert.ok(prepNow.items.find((x) => x.id === item.id && x.checked), 'prep item ticked today');
r = await api('PUT', '/prep', { item_id: item.id, checked: true, day: '2020-01-01' });
assert.equal(r.status, 409, 'past days are read-only');
r = await api('PUT', `/accounts/${master.id}`, { profit_split_pct: 150 });
assert.equal(r.status, 400, 'split over 100% rejected');
r = await api('PUT', `/accounts/${master.id}`, { profit_split_pct: 80, last_payout_day: '2000-01-01', payout_currency: 'NZD' });
assert.equal(r.ok, true);
const pays = await api('GET', '/payouts');
const mp = pays.items.find((x) => x.id === master.id);
assert.equal(mp.split, 80); assert.equal(mp.currency, 'NZD');
assert.equal(mp.share, round(Math.max(0, mp.profit) * 0.8), 'share = profit since payout × split');
const strat = await api('POST', '/strategies', { name: 'Sim strategy ' + uniq, setup: 'S', entry_rules: 'E' });
await api('PUT', `/strategies/${strat.id}`, { stop_rules: 'X' });
const boot2 = await api('GET', '/bootstrap');
const sb = boot2.strategies.find((x) => x.id === strat.id);
assert.equal(sb.setup, 'S', 'a partial update keeps the other playbook fields'); assert.equal(sb.stop_rules, 'X');
assert.ok(boot2.prep.find((x) => x.id === item.id), 'shared prep list in bootstrap');
await api('DELETE', `/prep/items/${item.id}`);
r = await api('PUT', '/settings', { saved_filters: [{ name: 'Sim', f: { sym: ['JP225'] } }] });
assert.equal(r.ok, true);
const an = await api('GET', '/analytics/ideas?acct=all');
assert.ok(Array.isArray(an.ideas) && an.saved.length === 1 && an.ideas.every((i) => 'missed' in i), 'analytics feed');
await api('PUT', '/settings', { saved_filters: [] });

// 20. v1.4: read-only share links
const link = await api('POST', `/accounts/${master.id}/shares`, { label: 'Mentor view', show_money: false, show_notes: true });
assert.match(link.url, /\/share\/sh_[0-9a-f]{48}$/);
const pub = async (path) => { const res = await fetch(BASE + path); return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }; };
let shr = await pub(`/share/api/${link.token}`);
assert.equal(shr.status, 200); assert.equal(shr.body.account.label, 'Mentor view');
assert.equal(shr.headers.get('referrer-policy'), 'no-referrer');
const raw = JSON.stringify(shr.body);
assert.ok(!/"(net|totalNet|balance|equity|floating|used|amount)"/.test(raw), 'no dollar figures when dollars are hidden');
assert.ok(!raw.includes(String(master.login || 'zzz')) && !raw.includes('token_hint'), 'no login or token');
await api('PUT', `/shares/${link.id}`, { show_money: true });
shr = await pub(`/share/api/${link.token}`);
assert.ok('totalNet' in shr.body.stats, 'dollars back when turned on');
await api('PUT', `/shares/${link.id}`, { active: false });
assert.equal((await pub(`/share/api/${link.token}`)).status, 410, 'turned off');
await api('PUT', `/shares/${link.id}`, { active: true, expires_days: 1 });
assert.equal((await pub(`/share/api/${link.token}`)).status, 200, 'back on');
assert.equal((await pub('/share/api/sh_' + '0'.repeat(48))).status, 404, 'unknown token');
assert.equal((await fetch(BASE + `/share/api/${link.token}`, { method: 'POST' })).status, 405, 'read-only');
assert.equal((await pub(`/share/api/${link.token}/shot/999999`)).status, 404, 'only this account\'s screenshots');
await api('DELETE', `/shares/${link.id}`);
assert.equal((await pub(`/share/api/${link.token}`)).status, 404, 'deleted');

// 21. v1.5: same trade placed by hand on two accounts → one idea; separate; risk limits; sentiment
await api('PUT', '/settings', { link_accounts: true });
const fpA = await api('POST', '/accounts', { name: 'Sim FP ' + uniq, login: '5' + uniq, firm_id: firm.id, kind: 'funded', size: 50000, role: 'standalone', max_risk_trade_pct: 0.6, max_risk_day_pct: 1.5 });
const tokFP = (await api('POST', `/accounts/${fpA.id}/token`)).token;
const T1 = now - (35 + Number(uniq) % 120) * 60000; // differs per run, so earlier runs' trades don't link
const usM = { ticket: 61177203, order: 68120931, position: 68120931, time: srv(T1), type: 1, entry: 0, symbol: 'US100', volume: 1, price: 21500, profit: 0, commission: 0, swap: 0, fee: 0, sl: 21520, tp: 0, risk: 200, magic: 0, reason: 0, comment: '' };
await send(mTok, '7' + uniq, { deals: [usM], positions: [{ position: usM.position, symbol: 'US100', type: 1, volume: 1, price: 21500, sl: 21520, tp: 0, time: srv(T1), profit: 5, swap: 0, risk: 200, comment: '' }] });
// FundingPips: same symbol (other broker name), same side, 2 minutes later, risk 305 on a 300 limit → within the 3% tolerance
const usF = { ...usM, ticket: 71177203, order: 78120931, position: 78120931, time: srv(T1 + 120000), symbol: 'NAS100', price: 21502, sl: 21522, risk: 305 };
const sF = await send(tokFP, '5' + uniq, { deals: [usF], positions: [{ position: usF.position, symbol: 'NAS100', type: 1, volume: 1, price: 21502, sl: 21522, tp: 0, time: srv(T1 + 120000), profit: 4, swap: 0, risk: 305, comment: '' }] });
assert.equal(sF.ok, true);
const fl = await api('GET', `/ideas?firm=${firm.id}&limit=500`);
const twin = fl.items.filter((x) => x.symbol === 'NAS100' && x.status === 'open' && x.open_time >= T1 - 1000);
assert.equal(twin.length, 1, 'one idea for the same trade on two accounts');
const tw = await api('GET', `/ideas/${twin[0].id}`);
assert.ok(tw.positions.some((p) => p.account_id === fpA.id && p.copy_link === 'twin'), 'FP position linked as the same trade');
const fpCheck = tw.risk.checks.find((c) => c.account_id === fpA.id);
assert.equal(fpCheck.limit, 300); assert.equal(fpCheck.level, 'tolerance', '305 on 300 is within 3% (309)');
assert.equal(tw.risk.violation, false);
// separate it again
const sep = await api('POST', `/ideas/${twin[0].id}/unlink`, { account_id: fpA.id });
assert.ok(sep.id && sep.id !== twin[0].id);
const sepD = await api('GET', `/ideas/${sep.id}`);
assert.ok(sepD.positions.every((p) => p.account_id === fpA.id), 'separated idea holds FP only');
assert.equal((await api('GET', `/ideas/${twin[0].id}`)).positions.some((p) => p.account_id === fpA.id), false);
// a second FP trade the same day, risk 320 → over (above 309)
const usF2 = { ...usF, ticket: 71177300, order: 78121000, position: 78121000, time: srv(T1 + 30 * 60000), symbol: 'JP225', price: 50100, sl: 50140, risk: 320 };
await send(tokFP, '5' + uniq, { deals: [usF2], positions: [{ position: usF.position, symbol: 'NAS100', type: 1, volume: 1, price: 21502, sl: 21522, tp: 0, time: srv(T1 + 120000), profit: 4, swap: 0, risk: 305, comment: '' }, { position: usF2.position, symbol: 'JP225', type: 1, volume: 1, price: 50100, sl: 50140, tp: 0, time: srv(T1 + 30 * 60000), profit: 0, swap: 0, risk: 320, comment: '' }] });
const fpIdeas = await api('GET', `/ideas?acct=${fpA.id}&limit=50`);
const over = fpIdeas.items.find((x) => x.symbol === 'JP225');
const overD = await api('GET', `/ideas/${over.id}`);
assert.equal(overD.risk.violation, true, '320 on a 300 limit is a violation');
// sentiment: bullish NAS100 makes a short "against"
const prep = await api('PUT', '/prep/sentiment', { overall: 'bull', markets: { NAS100: 'bull', JP225: 'bear' }, basis: ['VIX'] });
assert.equal(prep.ok, true);
assert.equal((await api('GET', `/ideas/${sep.id}`)).sentiment.align, 'against');
assert.equal((await api('GET', `/ideas/${over.id}`)).sentiment.align, 'with', 'JP225 bearish, trade short');
await api('PUT', '/prep/sentiment', { overall: null, markets: {}, basis: [] });
const dsh = await api('GET', `/dashboard?acct=${fpA.id}`);
assert.ok(dsh.accounts[0].riskToday && dsh.accounts[0].riskToday.limit === 750, 'daily risk on the dashboard');

// 22. v1.6 trade path (connector 1.02): a scale-in whose first stop is moved 20 s later → risk = peak held, not the sum
const T2 = now - (200 + Number(uniq) % 100) * 60000;
const pA = 88100000 + Number(uniq) % 1000, pB = pA + 1;
const dA = { ticket: 91000000 + Number(uniq) % 1000, order: pA, position: pA, time: srv(T2), type: 0, entry: 0, symbol: 'JP225', volume: 1, price: 50000, profit: 0, commission: 0, swap: 0, fee: 0, sl: 49700, tp: 0, risk: 300, magic: 0, reason: 0, comment: '' };
const dB = { ...dA, ticket: dA.ticket + 1, order: pB, position: pB, time: srv(T2 + 600000), volume: 0.6, price: 50100, sl: 49790, risk: 188.28 };
const outA = out(dA.ticket + 2, pA, T2 + 3600000, 1, 'JP225', 1, 50400, 400), outB = out(dA.ticket + 3, pB, T2 + 3600000, 1, 'JP225', 0.6, 50400, 180);
const ev = [{ position: pA, t: srv(T2 + 1000), sl: 49700, volume: 1, risk: 300 }, { position: pB, t: srv(T2 + 601000), sl: 49790, volume: 0.6, risk: 188.28 },
  { position: pA, t: srv(T2 + 620000), sl: 49888.28, volume: 1, risk: 111.72 }];
const ep = [{ symbol: 'JP225', type: 0, start: srv(T2), end: srv(T2 + 3600000), ids: [pA, pB], mae: -75, mae_t: srv(T2 + 300000), mfe: 650, mfe_t: srv(T2 + 3000000), partial: 0 }];
r = await api('POST', '/ingest', { v: 1, connector: '1.02', login: '5' + uniq, server: 'Sim-Live', company: 'Sim Broker', currency: 'USD', offset_sec: OFF + 3, positions_complete: false,
  deals: [dA, dB, outA, outB], positions: [], path: { events: ev, episodes: ep } }, { Authorization: 'Bearer ' + tokFP });
assert.equal(r.ok, true);
const scaled = (await api('GET', `/ideas?acct=${fpA.id}&limit=50`)).items.find((x) => x.symbol === 'JP225' && x.open_time < T2 + 1000 && x.open_time > T2 - 1000);
assert.ok(scaled, 'scale-in idea');
const sd = await api('GET', `/ideas/${scaled.id}`);
const la = sd.idea.accounts[0];
assert.equal(la.risk, 300, 'risk = peak held (the 20 s spike to 488.28 is ignored)');
assert.equal(la.initialRisk, 488.28);
assert.equal(la.r, round(580 / 300));
assert.equal(la.path.mae_r, -0.25); assert.equal(la.path.mfe_r, round(650 / 300));
assert.equal(sd.risk.violation, false, '300 on a 300 limit is fine');
assert.ok(sd.tradePath[0].steps.length >= 5, 'risk timeline');
// resending the same path doesn't duplicate, and a lower mae later wins
r = await api('POST', '/ingest', { v: 1, connector: '1.02', login: '5' + uniq, offset_sec: OFF + 3, positions_complete: false, deals: [], positions: [],
  path: { events: ev, episodes: [{ ...ep[0], mae: -90, mae_t: srv(T2 + 400000) }] } }, { Authorization: 'Bearer ' + tokFP });
assert.equal((await api('GET', `/ideas/${scaled.id}`)).idea.accounts[0].path.mae_r, -0.3);

console.log('connector simulation: all checks passed');
function round(x) { return Math.round(x * 100) / 100; }
