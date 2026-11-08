// Market sessions, each in its own city's local time, so daylight saving is handled
// automatically. Shared by the API (src/stats.js) and the app (Analytics page).

export const SESSIONS = [
  { name: 'Sydney', tz: 'Australia/Sydney', open: 7, close: 16 },
  { name: 'Tokyo', tz: 'Asia/Tokyo', open: 9, close: 18 },
  { name: 'London', tz: 'Europe/London', open: 8, close: 17 },
  { name: 'New York', tz: 'America/New_York', open: 8, close: 17 },
];

const fmts = {};
/** Offset of an IANA time zone from UTC at a given instant, in ms (e.g. Asia/Tokyo → +9 h). */
export function tzOffsetMs(tz, utcMs) {
  const f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }));
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Local hour (with fraction) in a time zone, and its weekday (0 = Sunday). */
export function localTime(tz, utcMs) {
  const d = new Date(utcMs + tzOffsetMs(tz, utcMs));
  return { hour: d.getUTCHours() + d.getUTCMinutes() / 60, weekday: d.getUTCDay() };
}

/** Sessions open at this instant (weekdays in that city only). */
export function openSessions(utcMs) {
  return SESSIONS.filter((s) => {
    const { hour, weekday } = localTime(s.tz, utcMs);
    return weekday >= 1 && weekday <= 5 && hour >= s.open && hour < s.close;
  });
}

/**
 * The session a trade belongs to. Where sessions overlap, the one that opened most recently wins
 * (a trade at the London/New York overlap counts as New York; Sydney/Tokyo as Tokyo).
 */
export function sessionOf(utcMs) {
  const open = openSessions(utcMs);
  if (!open.length) return 'Off-hours';
  let best = null, bestStart = -Infinity;
  for (const s of open) {
    const { hour } = localTime(s.tz, utcMs);
    const startedAt = utcMs - (hour - s.open) * 3600000;
    if (startedAt > bestStart) { best = s; bestStart = startedAt; }
  }
  return best.name;
}

/** Today's session hours in Brisbane time, e.g. [{name:'Tokyo', from:'10:00', to:'19:00'}]. */
export function sessionsInBrisbane(now = Date.now()) {
  const hm = (ms) => new Date(ms + 10 * 3600000).toISOString().slice(11, 16);
  return SESSIONS.map((s) => {
    const off = tzOffsetMs(s.tz, now);
    const local = new Date(now + off);
    const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    return { name: s.name, from: hm(day + s.open * 3600000 - off), to: hm(day + s.close * 3600000 - off) };
  });
}
