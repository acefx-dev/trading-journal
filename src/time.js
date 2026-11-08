// Time helpers. Everything is stored as UTC epoch ms; the journal's "day" is the
// Australia/Brisbane calendar day (UTC+10, no daylight saving).

export const BNE_OFFSET_MS = 10 * 3600 * 1000;
const DAY = 86400000;

/** 'YYYY-MM-DD' of the Brisbane day containing utcMs. */
export function bneDay(utcMs) {
  return new Date(utcMs + BNE_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC ms at 00:00 Brisbane on the given 'YYYY-MM-DD'. */
export function bneDayStart(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('bad day: ' + day);
  return Date.parse(day + 'T00:00:00Z') - BNE_OFFSET_MS;
}

export function bneToday(now = Date.now()) { return bneDay(now); }

/** Add n days to a 'YYYY-MM-DD'. */
export function addDays(day, n) {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
}

/** Brisbane hour (0-23) and weekday (0=Sun) of a UTC ms. */
export function bneParts(utcMs) {
  const d = new Date(utcMs + BNE_OFFSET_MS);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay() };
}

/** Month 'YYYY-MM' → [startUtcMs, endUtcMs) in Brisbane days. */
export function bneMonthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('bad month: ' + month);
  const [y, m] = month.split('-').map(Number);
  const start = bneDayStart(month + '-01');
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return [start, bneDayStart(next)];
}

// ---- broker server time → UTC ------------------------------------------------
// Most MT5 brokers run "New York close" time: UTC+2 in the northern winter and UTC+3
// while the US is on daylight saving. The connector tells us the server's offset *now*;
// for older deals we work out which of the two applied on that date.

function nthSundayUtc(year, month, n) { // month 0-11
  const first = new Date(Date.UTC(year, month, 1));
  const firstSun = 1 + ((7 - first.getUTCDay()) % 7);
  return Date.UTC(year, month, firstSun + 7 * (n - 1));
}

/** True if US daylight saving is in force at this UTC instant. */
export function usDst(utcMs) {
  const y = new Date(utcMs).getUTCFullYear();
  const start = nthSundayUtc(y, 2, 2) + 7 * 3600000;  // 2nd Sun March, 02:00 EST = 07:00 UTC
  const end = nthSundayUtc(y, 10, 1) + 6 * 3600000;   // 1st Sun Nov, 02:00 EDT = 06:00 UTC
  return utcMs >= start && utcMs < end;
}

/**
 * Convert a broker server timestamp (ms) to UTC ms.
 * offsetSec: server - UTC as measured by the connector now.
 * mode: 'auto' → if the offset is +2h or +3h, assume the broker follows US DST;
 *       'fixed' → always use offsetSec.
 */
export function serverToUtc(serverMs, offsetSec, mode = 'auto') {
  const off = Number(offsetSec) || 0;
  if (mode !== 'fixed' && (off === 7200 || off === 10800)) {
    const approx = serverMs - 7200000;
    return serverMs - (usDst(approx) ? 10800000 : 7200000);
  }
  return serverMs - off * 1000;
}

/** Round an offset measured by the terminal (may be off by a few seconds) to 15 minutes. */
export function roundOffset(sec) {
  return Math.round((Number(sec) || 0) / 900) * 900;
}

export function fmtBne(utcMs) {
  const d = new Date(utcMs + BNE_OFFSET_MS);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
