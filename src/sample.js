// Sample data: realistic, clearly marked (is_sample = 1) and kept apart from real data.
// It goes through the same upload pipeline as the MT5 connector (deals → positions → ideas).

import { all, run, stmt, first } from './db.js';
import { processUpload } from './ingest.js';
import { bneToday, addDays, bneDayStart, bneParts } from './time.js';

const SERVER_OFFSET = 7200; // a typical "New York close" broker in the northern winter

// deterministic pseudo-random numbers so the sample is the same each time
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const SYMBOLS = {
  JP225: { base: 50100, dist: 60, vpp: 1, digits: 0, strategy: 'Tokyo Range Breakout', at: [9, 20] },
  NAS100: { base: 21350, dist: 25, vpp: 1, digits: 1, strategy: 'NY Open Pullback', at: [23, 45] },
  XAUUSD: { base: 4010, dist: 6, vpp: 100, digits: 2, strategy: 'London Liquidity Sweep', at: [17, 25] },
  USDJPY: { base: 151.2, dist: 0.25, vpp: 662, digits: 3, strategy: 'London Liquidity Sweep', at: [17, 10] },
};
// broker spellings on the copy accounts (the journal maps them back to one name)
const COPY_NAME = { JP225: 'JPN225', NAS100: 'NAS100', XAUUSD: 'XAUUSD', USDJPY: 'USDJPY' };

const STRATEGIES = [
  { name: 'Tokyo Range Breakout', description: 'Break of the Asian pre-open range on JP225 after the Tokyo cash open, with up to two adds.',
    instruments: 'JP225', sessions: '09:30 – 12:00 AEST', risk: 0.5, max: 2,
    daily: ['Economic calendar checked (JPY, USD high-impact)', 'Asian pre-open range marked on JP225', 'Risk Guard Rail: 0.5% per trade, lock level confirmed', 'Trade copier: both Slaves online', 'Max 2 ideas today, written down', 'Rested and focused, no revenge trading'],
    trade: ['Price outside the pre-open range', '5-min close beyond the range', 'S/L beyond the opposite side of the range', 'Risk 0.5% or less (Risk Guard Rail)', 'No high-impact news within 15 min', 'Waited for a close before each add'] },
  { name: 'London Liquidity Sweep', description: 'Fade a sweep of the Asian high or low in the first hour of London.',
    instruments: 'XAUUSD, USDJPY', sessions: '17:00 – 19:00 AEST', risk: 0.5, max: 2,
    daily: ['London open levels marked (Asia high/low)', 'Calendar: GBP, EUR, USD news', 'Copier: both Slaves online'],
    trade: ['Asian high/low swept', 'Rejection candle closed back inside', 'S/L beyond the sweep wick', 'Risk 0.5% or less'] },
  { name: 'NY Open Pullback', description: 'First pullback to VWAP after the New York cash open, in the direction of the opening drive.',
    instruments: 'NAS100', sessions: '23:30 – 01:30 AEST', risk: 0.5, max: 2,
    daily: ['NY open time and news checked', 'Previous day high/low marked'],
    trade: ['Opening drive over 0.4%', 'Pullback to VWAP', 'S/L beyond the pullback low/high', 'Risk 0.5% or less'] },
];

export async function clearSample(db) {
  const ideas = await all(db, 'SELECT id FROM ideas WHERE is_sample = 1');
  const ops = [
    stmt(db, 'DELETE FROM audit_log WHERE account_id IN (SELECT id FROM accounts WHERE is_sample = 1) OR idea_id IN (SELECT value FROM json_each(?))', JSON.stringify(ideas.map((i) => i.id))),
    stmt(db, 'UPDATE positions SET idea_id = NULL, master_pos = NULL WHERE account_id IN (SELECT id FROM accounts WHERE is_sample = 1)'),
    stmt(db, 'DELETE FROM ideas WHERE is_sample = 1'),
    stmt(db, 'DELETE FROM daily_checks WHERE strategy_id IN (SELECT id FROM strategies WHERE is_sample = 1)'),
    stmt(db, 'DELETE FROM strategies WHERE is_sample = 1'),
    stmt(db, 'UPDATE accounts SET master_account_id = NULL WHERE is_sample = 1'),
    stmt(db, 'DELETE FROM accounts WHERE is_sample = 1'),
    stmt(db, 'DELETE FROM prop_firms WHERE is_sample = 1'),
  ];
  await db.batch(ops);
}

export async function seedSample(db, now = Date.now()) {
  const t = now;
  const firmRes = await db.batch([
    stmt(db, 'INSERT INTO prop_firms (name, website, notes, is_sample, created_at) VALUES (?,?,?,1,?) RETURNING id', 'FundingPips (sample)', 'https://fundingpips.com', 'Sample firm', t),
    stmt(db, 'INSERT INTO prop_firms (name, website, notes, is_sample, created_at) VALUES (?,?,?,1,?) RETURNING id', 'The5ers (sample)', 'https://the5ers.com', 'Sample firm', t),
  ]);
  const fp = firmRes[0].results[0].id, t5 = firmRes[1].results[0].id;
  const ins = (firm, name, login, kind, phase, size, role, master, target) => stmt(db,
    `INSERT INTO accounts (firm_id, name, login, server, broker, currency, kind, phase, size, role, master_account_id, daily_loss_pct, max_loss_pct,
      max_loss_type, profit_target_pct, is_sample, created_at, last_seen, server_offset_sec, connector_version)
     VALUES (?,?,?,?,?,'USD',?,?,?,?,?,5,10,'static',?,1,?,?,?,?) RETURNING *`,
    firm, name, login, 'Sample-Server', 'Sample broker', kind, phase, size, role, master, target, t, t, SERVER_OFFSET, 'sample');
  const m = (await db.batch([ins(fp, 'FundingPips 50K', '90004821', 'funded', null, 50000, 'master', null, null)]))[0].results[0];
  const cs = await db.batch([
    ins(t5, 'The5ers 100K #1', '90001042', 'challenge', 'Phase 1', 100000, 'copy', m.id, 8),
    ins(t5, 'The5ers 100K #2', '90001077', 'challenge', 'Phase 1', 100000, 'copy', m.id, 8),
  ]);
  const c1 = cs[0].results[0], c2 = cs[1].results[0];

  // strategies + checklists
  const stratIds = {};
  for (const s of STRATEGIES) {
    const r = await db.batch([stmt(db, `INSERT INTO strategies (name, description, instruments, sessions, default_risk_pct, max_ideas_per_day, is_sample, created_at, updated_at)
      VALUES (?,?,?,?,?,?,1,?,?) RETURNING id`, s.name, s.description, s.instruments, s.sessions, s.risk, s.max, t, t)]);
    const sid = r[0].results[0].id;
    stratIds[s.name] = sid;
    await db.batch([...s.daily.map((l, i) => stmt(db, "INSERT INTO checklist_items (strategy_id, kind, label, sort, created_at) VALUES (?, 'daily', ?, ?, ?)", sid, l, i, t)),
      ...s.trade.map((l, i) => stmt(db, "INSERT INTO checklist_items (strategy_id, kind, label, sort, created_at) VALUES (?, 'trade', ?, ?, ?)", sid, l, i, t))]);
  }

  // ---- generate trades over the last ~5 weeks of weekdays (Brisbane) ----
  const rand = rng(20261107);
  const today = bneToday(now);
  const days = [];
  for (let k = 36; k >= 1; k--) {
    const d = addDays(today, -k);
    const wd = bneParts(bneDayStart(d) + 12 * 3600000).weekday;
    if (wd >= 1 && wd <= 5) days.push(d);
  }
  const OUTCOMES = [1.32, -0.6, -1.0, 2.1, 0.34, -0.4, 0.6, 1.8, -1.0, 1.1, -1.0, 0.8, 2.4, -0.5, -1.0, 1.5, 0.2, -1.0, 1.9, 0.9, -0.3, 1.2, -1.0, 2.0, 0.5, -0.8, 1.4, -1.0, 0.7, 1.6, -1.0, 0.4, 2.2, -0.6, 1.0, -1.0];
  const master = { deals: [], ticket: 51170000, pos: 48100000 };
  const copies = [{ acct: c1, deals: [], ticket: 7720000, pos: 9110000, slip: 0 }, { acct: c2, deals: [], ticket: 7730000, pos: 9120000, slip: 1 }];
  const reviews = [];
  let o = 0;
  const masterRisk = 250; // 0.5% of 50K

  for (const d of days) {
    const plan = [];
    plan.push(rand() < 0.75 ? 'JP225' : null);
    plan.push(rand() < 0.35 ? (rand() < 0.6 ? 'XAUUSD' : 'USDJPY') : null);
    plan.push(rand() < 0.3 ? 'NAS100' : null);
    for (const sym of plan.filter(Boolean)) {
      const spec = SYMBOLS[sym];
      const R0 = OUTCOMES[o++ % OUTCOMES.length];
      const R = R0 > 0 ? Math.round(R0 * 0.8 * 100) / 100 : R0;
      const dir = rand() < 0.6 ? 1 : -1;
      const [h, mi] = spec.at;
      const openUtc = bneDayStart(d) + (h * 60 + mi + Math.floor(rand() * 20)) * 60000 + Math.floor(rand() * 59000);
      const nPos = rand() < 0.35 ? (rand() < 0.5 ? 3 : 2) : 1;
      const shares = nPos === 1 ? [1] : nPos === 2 ? [0.65, 0.35] : [0.6, 0.25, 0.15];
      const base = spec.base * (1 + (rand() - 0.5) * 0.02);
      const exitUtc = openUtc + (20 + Math.floor(rand() * 70)) * 60000;
      const entry0 = base;
      const exitPx = entry0 + dir * R * spec.dist;
      const mPositions = [];
      for (let k = 0; k < nPos; k++) {
        const entry = entry0 + dir * k * spec.dist * 0.35;
        const sl = entry - dir * (k === 0 ? spec.dist : spec.dist * 0.7);
        const risk = masterRisk * shares[k];
        const lots = Math.max(0.01, Math.round(risk / (Math.abs(entry - sl) * spec.vpp) * 100) / 100);
        const tOpen = openUtc + k * (8 + Math.floor(rand() * 9)) * 60000;
        mPositions.push({ id: master.pos++, entry, sl, lots, tOpen, risk: Math.round(Math.abs(entry - sl) * spec.vpp * lots * 100) / 100 });
      }
      for (const p of mPositions) {
        const pf = Math.round((exitPx - p.entry) * dir * p.lots * spec.vpp * 100) / 100;
        master.deals.push(deal(master.ticket++, p.id, p.tOpen, dir > 0 ? 0 : 1, 0, sym, p.lots, p.entry, 0, -round2(p.lots * 0.35), p.sl, p.risk, 'RGR panel', spec.digits));
        master.deals.push(deal(master.ticket++, p.id, exitUtc, dir > 0 ? 1 : 0, 1, sym, p.lots, exitPx, pf, -round2(p.lots * 0.35), 0, null, '', spec.digits));
      }
      // copies on the two challenge accounts (2x size); #2 sometimes misses a copy (news filter)
      for (const c of copies) {
        if (c.slip && rand() < 0.03) continue;
        for (const p of mPositions) {
          const lots = round2(p.lots * 2);
          const slipPx = c.slip * spec.dist * 0.02 * dir;
          const entry = p.entry + slipPx;
          const cid = c.pos++;
          const pf = Math.round((exitPx - slipPx * 0.5 - entry) * dir * lots * spec.vpp * 100) / 100;
          const name = COPY_NAME[sym];
          c.deals.push(deal(c.ticket++, cid, p.tOpen + 700 + Math.floor(rand() * 900), dir > 0 ? 0 : 1, 0, name, lots, entry, 0, -round2(lots * 0.35), p.sl, round2(p.risk * 2 + Math.abs(slipPx) * lots * spec.vpp), 'TC:' + p.id, spec.digits));
          c.deals.push(deal(c.ticket++, cid, exitUtc + 400 + Math.floor(rand() * 900), dir > 0 ? 1 : 0, 1, name, lots, exitPx - slipPx * 0.5, pf, -round2(lots * 0.35), 0, null, '', spec.digits));
        }
      }
      reviews.push({ firstPos: mPositions[0].id, sym, R, nPos, day: d, strategy: spec.strategy });
    }
  }
  // one trade placed by hand on a copy account (not a copy): becomes its own idea
  const mDay = days[days.length - 3];
  const handOpen = bneDayStart(mDay) + (11 * 60 + 5) * 60000;
  copies[0].deals.push(deal(copies[0].ticket++, copies[0].pos, handOpen, 1, 0, 'NAS100', 2, 21410, 0, -0.7, 21440, 60, '', 1));
  copies[0].deals.push(deal(copies[0].ticket++, copies[0].pos++, handOpen + 35 * 60000, 0, 1, 'NAS100', 2, 21395, 30, -0.7, 0, null, '', 1));

  const net = (ds) => ds.reduce((a, x) => a + x.profit + x.commission, 0);
  const upload = async (acct, deals, size) => {
    // send in chunks like the connector does
    for (let k = 0; k < deals.length; k += 200) {
      await processUpload(db, acct, { login: acct.login, offset_sec: SERVER_OFFSET, deals: deals.slice(k, k + 200), positions: [], positions_complete: true }, now);
    }
    const bal = round2(size + net(deals));
    await run(db, 'UPDATE accounts SET balance = ?, equity = ?, last_seen = ? WHERE id = ?', bal, bal, now - 4000, acct.id);
  };
  await upload(m, master.deals, 50000);
  for (const c of copies) await upload(c.acct, c.deals, 100000);

  // ---- reviews: strategy, checklist, rating, mistakes, notes ----
  const ideaRows = await all(db, `SELECT p.position_id, p.idea_id FROM positions p WHERE p.account_id = ?`, m.id);
  const ideaOf = Object.fromEntries(ideaRows.map((r) => [r.position_id, r.idea_id]));
  const items = await all(db, "SELECT c.* FROM checklist_items c JOIN strategies s ON s.id = c.strategy_id WHERE s.is_sample = 1 AND c.kind = 'trade' ORDER BY c.sort");
  const mistakes = await all(db, 'SELECT * FROM mistakes');
  const mId = (label) => (mistakes.find((x) => x.label === label) || {}).id;
  const ops = [];
  reviews.forEach((rv, k) => {
    const ideaId = ideaOf[rv.firstPos];
    if (!ideaId) return;
    const recent = k >= reviews.length - 2; // leave the last two to be reviewed
    if (recent) { ops.push(stmt(db, 'UPDATE ideas SET strategy_id = ? WHERE id = ?', stratIds[rv.strategy], ideaId)); return; }
    const sid = stratIds[rv.strategy];
    const its = items.filter((i) => i.strategy_id === sid);
    const sloppy = rv.R < 0 && k % 3 === 0;
    const rating = rv.R > 1 ? 4 + (k % 2) : rv.R > 0 ? 3 + (k % 2) : sloppy ? 2 : 3;
    const notes = rv.R >= 1.8 ? 'Clean break with volume; exit at the planned level.'
      : sloppy ? 'Entered before the candle closed. Should have waited.'
      : rv.R < 0 ? 'Valid setup, stopped out. Nothing to change.' : '';
    ops.push(stmt(db, 'UPDATE ideas SET strategy_id = ?, rating = ?, notes = ?, reviewed_at = ?, emotion = ? WHERE id = ?',
      sid, rating, notes || null, now - 3600000, sloppy ? 'Impatient' : 'Calm', ideaId));
    its.forEach((it, j) => {
      const checked = sloppy && j === 1 ? 0 : (rv.nPos === 3 && j === its.length - 1 && k % 2 === 0) ? 0 : 1;
      ops.push(stmt(db, 'INSERT OR REPLACE INTO trade_checks (idea_id, item_id, checked, label, checked_at) VALUES (?,?,?,?,?)', ideaId, it.id, checked, it.label, now));
    });
    if (sloppy) ops.push(stmt(db, 'INSERT OR IGNORE INTO idea_mistakes (idea_id, mistake_id) VALUES (?, ?)', ideaId, mId('Entered before candle close')));
    if (rv.nPos === 3 && k % 2 === 0) ops.push(stmt(db, 'INSERT OR IGNORE INTO idea_mistakes (idea_id, mistake_id) VALUES (?, ?)', ideaId, mId('Added position late')));
    if (rv.sym === 'JP225' && rv.R > 1) ops.push(stmt(db, 'UPDATE ideas SET tv_link = ? WHERE id = ?', 'https://www.tradingview.com/chart/', ideaId));
  });
  // daily preparation history (last 14 days), today left empty
  const dailyItems = await all(db, "SELECT c.* FROM checklist_items c JOIN strategies s ON s.id = c.strategy_id WHERE s.is_sample = 1 AND c.kind = 'daily'");
  for (let k = 14; k >= 1; k--) {
    const d = addDays(today, -k);
    const miss = k === 5 || k === 11;
    for (const it of dailyItems) {
      const checked = miss && it.sort >= 3 ? 0 : 1;
      ops.push(stmt(db, 'INSERT OR REPLACE INTO daily_checks (item_id, strategy_id, day, checked, label, checked_at) VALUES (?,?,?,?,?,?)', it.id, it.strategy_id, d, checked, it.label, bneDayStart(d) + 8 * 3600000));
    }
  }
  for (let k = 0; k < ops.length; k += 90) await db.batch(ops.slice(k, k + 90));
  const n = await first(db, 'SELECT COUNT(*) AS n FROM ideas WHERE is_sample = 1');
  return { ok: true, ideas: n.n };
}

const round2 = (x) => Math.round(x * 100) / 100;

function deal(ticket, position, utcMs, type, entry, symbol, volume, price, profit, commission, sl, risk, comment, digits) {
  return {
    ticket, order: ticket + 1, position, time: utcMs + SERVER_OFFSET * 1000, type, entry, symbol,
    volume, price: Number(price.toFixed(digits)), profit, commission, swap: 0, fee: 0,
    sl: sl ? Number(sl.toFixed(digits)) : 0, tp: 0, risk, magic: comment.startsWith('TC:') ? 260501 : 0, reason: 0, comment,
  };
}
