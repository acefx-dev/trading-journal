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

console.log('connector simulation: all checks passed');
function round(x) { return Math.round(x * 100) / 100; }
