import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bneDay, bneDayStart, serverToUtc, usDst, bneMonthRange, addDays } from '../src/time.js';
import { canonical, coreMatch, parseCopyComment } from '../src/symbols.js';
import { buildPosition, netOf } from '../src/build.js';
import { pickIdea, matchMaster } from '../src/grouping.js';
import { summary, drawdown, rBuckets, behaviour, sessionOf } from '../src/stats.js';
import { sessionsInBrisbane, tzOffsetMs } from '../public/js/sessions.js';

const ALIASES = { JPN225: 'JP225', JP225: 'JP225', USTEC: 'NAS100', NAS100: 'NAS100', US30: 'US30', XAUUSD: 'XAUUSD' };

test('Brisbane day boundaries', () => {
  // 13:59:59.999 UTC = 23:59:59.999 Brisbane, 14:00 UTC = next day midnight
  assert.equal(bneDay(Date.parse('2026-11-06T13:59:59.999Z')), '2026-11-06');
  assert.equal(bneDay(Date.parse('2026-11-06T14:00:00Z')), '2026-11-07');
  assert.equal(bneDayStart('2026-11-07'), Date.parse('2026-11-06T14:00:00Z'));
  assert.deepEqual(bneMonthRange('2026-12'), [Date.parse('2026-11-30T14:00:00Z'), Date.parse('2026-12-31T14:00:00Z')]);
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('US DST and server time conversion', () => {
  assert.equal(usDst(Date.parse('2026-07-01T00:00:00Z')), true);
  assert.equal(usDst(Date.parse('2026-12-01T00:00:00Z')), false);
  assert.equal(usDst(Date.parse('2026-03-08T06:59:00Z')), false); // just before 2nd Sunday March 02:00 EST
  assert.equal(usDst(Date.parse('2026-03-08T07:01:00Z')), true);
  // NY-close broker, measured offset +2 now (Nov), deal in July → server was +3
  const julyServer = Date.parse('2026-07-01T12:00:00Z'); // server clock reading 12:00
  assert.equal(serverToUtc(julyServer, 7200), Date.parse('2026-07-01T09:00:00Z'));
  const novServer = Date.parse('2026-11-06T12:00:00Z');
  assert.equal(serverToUtc(novServer, 10800), Date.parse('2026-11-06T10:00:00Z'));
  // fixed mode and other offsets are taken as-is
  assert.equal(serverToUtc(julyServer, 7200, 'fixed'), Date.parse('2026-07-01T10:00:00Z'));
  assert.equal(serverToUtc(julyServer, 0), julyServer);
});

test('symbol canonical names', () => {
  assert.equal(canonical('JPN225', ALIASES), 'JP225');
  assert.equal(canonical('jp225.cash', ALIASES), 'JP225');
  assert.equal(canonical('USTECm', ALIASES), 'NAS100');
  assert.equal(canonical('US300', ALIASES), 'US300'); // never splits a number
  assert.equal(coreMatch('US30', 'US300'), false);
  assert.equal(canonical('EURUSD.r', ALIASES), 'EURUSDR'); // unknown → core name
  assert.equal(parseCopyComment('TC:48120931'), 48120931);
  assert.equal(parseCopyComment('RGR panel 1/3'), 0);
});

const D = (o) => ({ type: 0, entry: 0, volume: 1, price: 100, profit: 0, commission: 0, swap: 0, fee: 0, sl: 0, tp: 0, risk: null, symbol: 'JP225', comment: '', magic: 0, ...o });

test('buildPosition: scale-out long, closed', () => {
  const p = buildPosition([
    D({ ticket: 1, time: 1000, type: 0, entry: 0, volume: 1, price: 100, sl: 95, risk: 50, commission: -2 }),
    D({ ticket: 2, time: 2000, type: 1, entry: 1, volume: 0.4, price: 110, profit: 40 }),
    D({ ticket: 3, time: 3000, type: 1, entry: 1, volume: 0.6, price: 105, profit: 30, commission: -1 }),
  ]);
  assert.equal(p.direction, 'long');
  assert.equal(p.status, 'closed');
  assert.equal(p.close_time, 3000);
  assert.equal(p.close_price, 107);
  assert.equal(p.initial_sl, 95);
  assert.equal(p.risk, 50);
  assert.equal(netOf(p), 67);
});

test('buildPosition: open short with live snapshot, partial close', () => {
  const p = buildPosition([
    D({ ticket: 1, time: 1000, type: 1, entry: 0, volume: 2, price: 50, sl: 52 }),
    D({ ticket: 2, time: 2000, type: 0, entry: 1, volume: 1, price: 48, profit: 20 }),
  ], { direction: 'short', volume: 1, price: 50, sl: 50, tp: 40, profit: 5, risk: 0 });
  assert.equal(p.direction, 'short');
  assert.equal(p.status, 'open');
  assert.equal(p.initial_sl, 52);
  assert.equal(p.sl, 50);
  assert.equal(p.risk, null); // no risk on the deal and none live
  assert.equal(netOf(p), 25);
});

test('buildPosition: history starting with the close deal', () => {
  const p = buildPosition([D({ ticket: 9, time: 5000, type: 0, entry: 1, volume: 1, price: 90, profit: 10 })]);
  assert.equal(p.direction, 'short');
});

const OPTS = { windowMs: 30 * 60000, requireOverlap: true };
const L = (o) => ({ account_id: 1, canon: 'JP225', direction: 'long', close_time: null, ...o });

test('grouping: adds join an open idea inside the window', () => {
  const existing = [L({ position_id: 1, open_time: 0, ideaKey: 'A' })];
  assert.equal(pickIdea(L({ position_id: 2, open_time: 12 * 60000 }), existing, OPTS), 'A');
});

test('grouping: outside window → new idea', () => {
  const existing = [L({ position_id: 1, open_time: 0, ideaKey: 'A' })];
  assert.equal(pickIdea(L({ position_id: 2, open_time: 31 * 60000 }), existing, OPTS), null);
});

test('grouping: different symbol, direction or account never combine', () => {
  const existing = [L({ position_id: 1, open_time: 0, ideaKey: 'A' })];
  assert.equal(pickIdea(L({ position_id: 2, open_time: 60000, canon: 'NAS100' }), existing, OPTS), null);
  assert.equal(pickIdea(L({ position_id: 3, open_time: 60000, direction: 'short' }), existing, OPTS), null);
  assert.equal(pickIdea(L({ position_id: 4, open_time: 60000, account_id: 2 }), existing, OPTS), null);
});

test('grouping: closed before the new one opened → new idea when overlap required', () => {
  const existing = [L({ position_id: 1, open_time: 0, close_time: 5 * 60000, ideaKey: 'A' })];
  assert.equal(pickIdea(L({ position_id: 2, open_time: 10 * 60000 }), existing, OPTS), null);
  assert.equal(pickIdea(L({ position_id: 2, open_time: 10 * 60000 }), existing, { ...OPTS, requireOverlap: false }), 'A');
});

test('grouping: window counts from the first position (no chaining all day)', () => {
  const existing = [
    L({ position_id: 1, open_time: 0, ideaKey: 'A' }),
    L({ position_id: 2, open_time: 25 * 60000, ideaKey: 'A' }),
  ];
  assert.equal(pickIdea(L({ position_id: 3, open_time: 45 * 60000 }), existing, OPTS), null);
});

test('copy matching: by comment, then by closest time', () => {
  const masters = [
    { id: 10, position_id: 500, canon: 'JP225', direction: 'long', open_time: 1000 },
    { id: 11, position_id: 501, canon: 'JP225', direction: 'long', open_time: 50000 },
  ];
  assert.equal(matchMaster({ copy_of: 501, canon: 'JP225', direction: 'long', open_time: 0 }, masters, { copyWindowMs: 60000 }).master.id, 11);
  assert.equal(matchMaster({ copy_of: 999, canon: 'JP225', direction: 'long', open_time: 0 }, masters, { copyWindowMs: 60000 }), null);
  const m = matchMaster({ copy_of: 0, canon: 'JP225', direction: 'long', open_time: 2500 }, masters, { copyWindowMs: 60000 });
  assert.equal(m.master.id, 10); assert.equal(m.link, 'match');
  assert.equal(matchMaster({ copy_of: 0, canon: 'JP225', direction: 'short', open_time: 2500 }, masters, { copyWindowMs: 60000 }), null);
  assert.equal(matchMaster({ copy_of: 0, canon: 'JP225', direction: 'long', open_time: 2500 }, masters, { copyWindowMs: 60000 }, new Set([10, 11])), null);
});

const I = (net, r, extra = {}) => ({ net, basisNet: net, r, open_time: 0, close_time: 0, mistakes: [], checklistTotal: 0, checklistDone: 0, ...extra });

test('summary: the mockup numbers', () => {
  const xs = [330, -150, -250, 525, 85, -100, 150, 450, -250].map((v) => I(v, v / 250));
  const s = summary(xs);
  assert.equal(s.count, 9); assert.equal(s.wins, 5); assert.equal(s.losses, 4);
  assert.equal(Math.round(s.winRate * 100), 56);
  assert.equal(s.profitFactor, 2.05);
  assert.equal(s.totalNet, 790);
  assert.equal(s.expectancyR, 0.35);
  assert.equal(s.avgWinR, 1.23); assert.equal(s.avgLossR, -0.75);
});

test('summary: no losses → infinite profit factor flagged, not divided by zero', () => {
  const s = summary([I(100, 1), I(50, 0.5)]);
  assert.equal(s.profitFactor, null); assert.equal(s.profitFactorInfinite, true);
});

test('drawdown on balance curve', () => {
  const d = drawdown([{ time: 1, delta: 330 }, { time: 2, delta: -150 }, { time: 3, delta: -250 }, { time: 4, delta: 525 }], 50000);
  assert.equal(d.maxDd, 400);
  assert.equal(d.maxDdPct, 0.79);
});

test('R buckets and behaviour split', () => {
  const xs = [I(-250, -1, { checklistTotal: 4, checklistDone: 4 }), I(100, 0.4, { checklistTotal: 4, checklistDone: 3, mistakes: [1] }), I(500, 2, { checklistTotal: 4, checklistDone: 4 })];
  assert.deepEqual(rBuckets(xs).map((b) => b.count), [1, 0, 1, 0, 1]);
  const b = behaviour(xs, { 1: 'FOMO' });
  assert.equal(b.checklistComplete.count, 2);
  assert.equal(b.checklistIncomplete.count, 1);
  assert.equal(b.mistakes[0].label, 'FOMO');
  assert.equal(b.afterLoss.count, 1);
});

test('sessions follow each market\'s local time (Babypips hours)', () => {
  // Monday 9 Nov 2026 (northern winter, Sydney summer)
  const at = (iso) => sessionOf(Date.parse(iso));
  assert.equal(at('2026-11-09T00:30:00Z'), 'Tokyo');      // 10:30 Brisbane: Tokyo opened 09:00 JST
  assert.equal(at('2026-11-08T23:30:00Z'), 'Sydney');     // 09:30 Brisbane: Tokyo not open yet
  assert.equal(at('2026-11-09T08:30:00Z'), 'London');     // 18:30 Brisbane: London 08:00 GMT
  assert.equal(at('2026-11-09T13:30:00Z'), 'New York');   // 23:30 Brisbane: NY 08:00 EST, overlap -> NY
  assert.equal(at('2026-07-06T07:30:00Z'), 'London');     // July: London opens 07:00 UTC (BST)
  assert.equal(at('2026-07-06T12:30:00Z'), 'New York');   // July: NY opens 12:00 UTC (EDT)
  assert.equal(tzOffsetMs('Asia/Tokyo', Date.parse('2026-11-09T00:00:00Z')), 9 * 3600000);
  const b = Object.fromEntries(sessionsInBrisbane(Date.parse('2026-11-09T02:00:00Z')).map((x) => [x.name, x.from + '-' + x.to]));
  assert.equal(b.Tokyo, '10:00-19:00');
  assert.equal(b['New York'], '23:00-08:00');
  assert.equal(b.London, '18:00-03:00');
});

import { propStatus, lastReset } from '../src/prop.js';

test('firm-day reset times', () => {
  const now = Date.parse('2026-11-09T05:00:00Z');
  // broker server UTC+2 midnight = 22:00 UTC the day before
  assert.equal(lastReset(now, { tz: 'server', serverOffsetSec: 7200 }), Date.parse('2026-11-08T22:00:00Z'));
  assert.equal(lastReset(now, { tz: 'UTC' }), Date.parse('2026-11-09T00:00:00Z'));
  // 17:00 New York (EST) = 22:00 UTC
  assert.equal(lastReset(now, { tz: 'America/New_York', time: '17:00' }), Date.parse('2026-11-08T22:00:00Z'));
  assert.equal(lastReset(now, { tz: 'Australia/Brisbane' }), Date.parse('2026-11-08T14:00:00Z'));
});

test('prop monitor: daily loss, static and trailing max loss, target', () => {
  const now = Date.parse('2026-11-09T05:00:00Z');
  const base = { id: 1, name: 'T', size: 100000, daily_loss_pct: 5, max_loss_pct: 10, max_loss_type: 'static', profit_target_pct: 8,
    daily_reset_tz: 'UTC', daily_reset_time: '00:00', last_seen: now };
  const deals = [{ time: Date.parse('2026-11-01T00:00:00Z'), net: 100000 }, { time: Date.parse('2026-11-05T00:00:00Z'), net: 3000 },
    { time: Date.parse('2026-11-09T02:00:00Z'), net: -1500 }];
  // balance 101,500 (after -1,500 today); equity 100,500 with an open loss
  const s = propStatus({ ...base, balance: 101500, equity: 100500 }, deals, [{ time: Date.parse('2026-11-09T00:05:00Z'), balance: 103000, equity: 103400 }], now, 70);
  const daily = s.rules.find((r) => r.key === 'daily');
  // start = higher of 103,000 balance / 103,400 equity = 103,400; limit 5% = 5,170; used 2,900
  assert.equal(daily.limit, 5170); assert.equal(daily.used, 2900); assert.equal(daily.level, 'ok');
  const max = s.rules.find((r) => r.key === 'max');
  assert.equal(max.floor, 90000); assert.equal(max.used, 0);
  assert.equal(s.target.pct, 18.8);
  // daily limit of the initial size, from balance only: limit 5,000, used 103,000-100,500 = 2,500
  const s2 = propStatus({ ...base, balance: 101500, equity: 100500, daily_loss_of: 'initial', daily_loss_from: 'balance' }, deals, [], now);
  assert.equal(s2.rules[0].limit, 5000); assert.equal(s2.rules[0].used, 2500);
  // trailing: highest balance 103,000 → floor 93,000; equity 97,000 → 6,000 of 10,000 used
  const s3 = propStatus({ ...base, max_loss_type: 'trailing', balance: 101500, equity: 97000 }, deals, [], now, 70);
  const m3 = s3.rules.find((r) => r.key === 'max');
  assert.equal(m3.floor, 93000); assert.equal(m3.used, 6000); assert.equal(m3.level, 'ok');
  assert.equal(s3.rules.find((r) => r.key === 'daily').level, 'breached'); // lost 6,000 > 5,150 today
});

import { readFileSync } from 'node:fs';
import { parseStatement, parseNum } from '../public/js/importer.js';

test('MT5 statement import: UTF-16 HTML report and CSV', () => {
  const ps = parseStatement(readFileSync(new URL('./fixtures/mt5_report.html', import.meta.url)), 'ReportHistory.html');
  assert.equal(ps.length, 3, 'orders section is not read as positions');
  assert.deepEqual(ps[0], { position: 48120931, symbol: 'JPN225', type: 'buy', volume: 1, open_time: Date.UTC(2026, 9, 20, 3, 14, 3),
    open_price: 50128, sl: 50068, tp: 0, close_time: Date.UTC(2026, 9, 20, 4, 2, 41), close_price: 50236, commission: -0.35, swap: 0, profit: 270 });
  assert.equal(ps[1].type, 'sell'); assert.equal(ps[1].volume, 2); assert.equal(ps[1].swap, -3.6); // hidden cell skipped
  assert.equal(ps[2].volume, 1); assert.equal(ps[2].open_price, 21400.5);
  const csv = parseStatement(readFileSync(new URL('./fixtures/positions.csv', import.meta.url)), 'p.csv');
  assert.equal(csv.length, 1); assert.equal(csv[0].sl, 1.088); assert.equal(csv[0].profit, 150);
  assert.equal(parseNum('1 234.56'), 1234.56); assert.equal(parseNum('-1,234.5'), -1234.5);
});

// ---------------------------------------------------------------- v1.5: risk limits and sentiment
import { riskLevel, applyRiskChecks } from '../src/risk.js';
import { alignOf } from '../src/sentiment.js';

test('risk limit with 3% tolerance for slippage', () => {
  assert.equal(riskLevel(300, 300, 3), 'ok');
  assert.equal(riskLevel(305, 300, 3), 'tolerance');   // $5 of slippage is not a violation
  assert.equal(riskLevel(309, 300, 3), 'tolerance');
  assert.equal(riskLevel(310, 300, 3), 'over');
  assert.equal(riskLevel(488.28, 300, 3), 'over');
  assert.equal(riskLevel(100, null, 3), null);
});

test('daily risk is cumulative in opening order, per account', () => {
  const acc = new Map([[1, { id: 1, size: 50000, max_risk_trade_pct: 0.6, max_risk_day_pct: 1.2 }], [2, { id: 2, size: 100000, max_risk_trade_pct: 1, max_risk_day_pct: 3 }]]);
  const day = Date.parse('2026-11-10T01:00:00Z');
  const ideas = [
    { id: 'a', open_time: day, accounts: [{ account_id: 1, name: 'FP', risk: 300 }, { account_id: 2, name: '5ers', risk: 1000 }] },
    { id: 'b', open_time: day + 3600e3, accounts: [{ account_id: 1, name: 'FP', risk: 300 }] },
    { id: 'c', open_time: day + 7200e3, accounts: [{ account_id: 1, name: 'FP', risk: 320 }] },
  ];
  applyRiskChecks(ideas, acc, 3);
  assert.equal(ideas[0].risk_violation, false); assert.equal(ideas[0].day_violation, false);
  assert.equal(ideas[1].day_violation, false);                       // $600 = 1.2% exactly
  assert.equal(ideas[2].risk_violation, true);                       // $320 > $309
  assert.equal(ideas[2].day_violation, true);                        // $920 > $618
  assert.equal(ideas[2].risk_checks[0].dayUsed, 920);
});

test('trading with or against the day\'s sentiment', () => {
  const s = { overall: 'bull', markets: { JP225: 'bear' } };
  assert.deepEqual(alignOf('JP225', 'short', s), { bias: 'bear', align: 'with' });   // the market's own bias wins
  assert.deepEqual(alignOf('NAS100', 'short', s), { bias: 'bull', align: 'against' });
  assert.deepEqual(alignOf('NAS100', 'long', { overall: 'neutral', markets: {} }), { bias: 'neutral', align: 'neutral' });
  assert.deepEqual(alignOf('NAS100', 'long', null), { bias: null, align: 'unset' });
});
