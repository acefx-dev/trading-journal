// Prop-firm rule monitor: daily loss used since the firm's reset, room to the max-loss floor,
// and progress to the profit target. Display and warnings only; Risk Guard Rail and the
// Trade Copier enforce the limits in MT5.

import { all } from './db.js';
import { round } from './build.js';
import { tzOffsetMs } from '../public/js/sessions.js';

const DAY = 86400000;

/** UTC ms of the most recent daily reset at or before `now`. */
export function lastReset(now, { tz = 'server', time = '00:00', serverOffsetSec = 0 }) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  const resetMin = (h || 0) * 60 + (m || 0);
  const off = tz === 'server' ? (Number(serverOffsetSec) || 0) * 1000 : tz === 'UTC' ? 0 : tzOffsetMs(tz, now);
  const local = now + off - resetMin * 60000;
  return Math.floor(local / DAY) * DAY + resetMin * 60000 - off;
}

/**
 * @param a       account row (size, balance, equity, rules, reset settings, server_offset_sec, last_seen)
 * @param deals   [{time, net}] every deal of the account (trades and balance operations), any order
 * @param snaps   [{time, balance, equity}] snapshots (used for the equity at the reset)
 * @param warnPct warning level in % of a limit
 */
export function propStatus(a, deals, snaps, now = Date.now(), warnPct = 70) {
  const out = { account_id: a.id, name: a.name, kind: a.kind, size: a.size, balance: a.balance, equity: a.equity, last_seen: a.last_seen, rules: [] };
  if (a.balance == null || !a.size) { out.missing = 'Needs the account size and a connected terminal'; return out; }
  const equity = a.equity ?? a.balance;
  const reset = lastReset(now, { tz: a.daily_reset_tz || 'server', time: a.daily_reset_time, serverOffsetSec: a.server_offset_sec });
  out.reset = reset;
  out.nextReset = reset + DAY;

  const sorted = [...deals].sort((x, y) => x.time - y.time);
  const after = sorted.filter((d) => d.time >= reset).reduce((s, d) => s + d.net, 0);
  const balAtReset = a.balance - after;
  const snapAtReset = snaps.filter((s) => s.time >= reset && s.time <= reset + 15 * 60000).sort((x, y) => x.time - y.time)[0];
  const eqAtReset = snapAtReset ? snapAtReset.equity : null;
  out.todayPnl = round(equity - balAtReset, 2);

  const level = (pct) => (pct >= 100 ? 'breached' : pct >= 90 ? 'danger' : pct >= warnPct ? 'warn' : 'ok');

  // daily loss
  if (a.daily_loss_pct > 0) {
    const from = a.daily_loss_from === 'balance' ? balAtReset : Math.max(balAtReset, eqAtReset ?? balAtReset);
    const limit = a.daily_loss_pct / 100 * (a.daily_loss_of === 'initial' ? a.size : from);
    const used = Math.max(0, from - equity);
    const pct = limit > 0 ? used / limit * 100 : 0;
    out.rules.push({
      key: 'daily', label: `Daily loss ${a.daily_loss_pct}%`, used: round(used, 2), limit: round(limit, 2), pct: round(pct, 1),
      floor: round(from - limit, 2), room: round(equity - (from - limit), 2), level: level(pct),
      note: (a.daily_loss_from === 'balance' ? 'from the balance' : 'from the higher of balance and equity') + ' at the reset' +
        (a.daily_loss_from !== 'balance' && eqAtReset == null ? ' (equity at the reset unknown: balance used)' : ''),
    });
  }

  // max loss
  if (a.max_loss_pct > 0) {
    let peak = a.size;
    if (a.max_loss_type === 'trailing') {
      // rebuild the balance curve backwards from the current balance
      let bal = a.balance; peak = bal;
      for (let k = sorted.length - 1; k >= 0; k--) { bal -= sorted[k].net; if (k > 0 && bal > peak) peak = bal; }
      peak = Math.max(a.size, peak);
    }
    const lossMoney = a.size * a.max_loss_pct / 100;
    const floor = a.max_loss_type === 'trailing' ? Math.min(a.size, peak - lossMoney) : a.size - lossMoney;
    const used = Math.max(0, (floor + lossMoney) - equity);
    const pct = used / lossMoney * 100;
    out.rules.push({
      key: 'max', label: `Max loss ${a.max_loss_pct}% ${a.max_loss_type === 'trailing' ? 'trailing' : 'static'}`, used: round(used, 2), limit: round(lossMoney, 2),
      pct: round(pct, 1), floor: round(floor, 2), room: round(equity - floor, 2), level: level(pct),
      note: a.max_loss_type === 'trailing' ? `from the highest balance ${round(peak, 2)}, never above the initial size` : 'from the initial account size',
    });
  }

  // profit target
  if (a.profit_target_pct > 0) {
    const target = a.size * a.profit_target_pct / 100;
    const made = a.balance - a.size;
    out.target = { label: `Target ${a.profit_target_pct}%`, made: round(made, 2), target: round(target, 2), pct: round(Math.max(0, made) / target * 100, 1), reached: made >= target };
  }

  const order = ['ok', 'warn', 'danger', 'breached'];
  out.level = out.rules.reduce((w, r) => (order.indexOf(r.level) > order.indexOf(w) ? r.level : w), 'ok');
  out.stale = !a.last_seen || now - a.last_seen > 5 * 60000;
  return out;
}

/** Load what propStatus needs for these accounts (3 queries in total). */
export async function loadPropStatus(db, accounts, warnPct, now = Date.now()) {
  if (!accounts.length) return [];
  const ids = JSON.stringify(accounts.map((a) => a.id));
  const since = now - 2 * DAY;
  const [deals, snaps] = await Promise.all([
    all(db, `SELECT account_id, time, profit + commission + swap + fee AS net FROM deals WHERE account_id IN (SELECT value FROM json_each(?))`, ids),
    all(db, `SELECT account_id, time, balance, equity FROM snapshots WHERE account_id IN (SELECT value FROM json_each(?)) AND time >= ?`, ids, since),
  ]);
  return accounts.map((a) => propStatus(a, deals.filter((d) => d.account_id === a.id), snaps.filter((s) => s.account_id === a.id), now, warnPct));
}
