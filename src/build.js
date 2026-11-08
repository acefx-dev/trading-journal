// Rebuild one MT5 position from its deals. Deals are the source of truth; a position row
// is always derivable from them, so a re-sync can never drift.

export const DEAL_BUY = 0, DEAL_SELL = 1;
export const ENTRY_IN = 0, ENTRY_OUT = 1, ENTRY_INOUT = 2, ENTRY_OUT_BY = 3;
const EPS = 1e-9;

const vwap = (ds) => {
  const v = ds.reduce((a, d) => a + d.volume, 0);
  return v > EPS ? ds.reduce((a, d) => a + d.price * d.volume, 0) / v : null;
};

/**
 * deals: all deals of one position (any order). live: open-position snapshot from the
 * connector or null. Returns the position fields, or null if there is no trade deal.
 */
export function buildPosition(deals, live = null) {
  const trades = deals.filter((d) => d.type === DEAL_BUY || d.type === DEAL_SELL)
    .sort((a, b) => a.time - b.time || a.ticket - b.ticket);
  if (!trades.length && !live) return null;

  const ins = trades.filter((d) => d.entry === ENTRY_IN || d.entry === ENTRY_INOUT);
  const outs = trades.filter((d) => d.entry === ENTRY_OUT || d.entry === ENTRY_OUT_BY || d.entry === ENTRY_INOUT);
  const first = ins[0] || trades[0];

  let direction = live ? live.direction : first.type === DEAL_BUY ? 'long' : 'short';
  if (!live && first.entry !== ENTRY_IN && first.entry !== ENTRY_INOUT) {
    // history starts mid-position (only the close is in range): the close deal is opposite
    direction = first.type === DEAL_BUY ? 'short' : 'long';
  }

  const volume = ins.reduce((a, d) => a + d.volume, 0) || (live ? live.volume : 0) || outs.reduce((a, d) => a + d.volume, 0);
  const closedVolume = outs.reduce((a, d) => a + d.volume, 0);
  const sum = (k) => deals.reduce((a, d) => a + (Number(d[k]) || 0), 0);

  const insWithSl = ins.filter((d) => d.sl > 0);
  const initialSl = insWithSl.length ? insWithSl[0].sl : (live && live.sl > 0 ? live.sl : null);
  const insTp = ins.filter((d) => d.tp > 0);
  const initialTp = insTp.length ? insTp[0].tp : (live && live.tp > 0 ? live.tp : null);

  // risk: sum of each entry deal's risk if every entry has one; else the live figure
  let risk = null;
  if (ins.length && ins.every((d) => d.risk > 0)) risk = ins.reduce((a, d) => a + d.risk, 0);
  else if (live && live.risk > 0) risk = live.risk;

  const isOpen = live ? true : !(closedVolume >= volume - EPS && volume > EPS);
  const lastOut = outs.length ? outs[outs.length - 1] : null;

  return {
    symbol: (first && first.symbol) || (live && live.symbol) || '',
    direction,
    open_time: first ? first.time : live.time,
    close_time: isOpen ? null : lastOut ? lastOut.time : null,
    volume: round(volume, 8),
    closed_volume: round(closedVolume, 8),
    open_price: vwap(ins) ?? (live ? live.price : null),
    close_price: vwap(outs),
    initial_sl: initialSl,
    initial_tp: initialTp,
    sl: live ? (live.sl > 0 ? live.sl : null) : (lastOut && lastOut.sl > 0 ? lastOut.sl : initialSl),
    tp: live ? (live.tp > 0 ? live.tp : null) : initialTp,
    risk: risk != null ? round(risk, 2) : null,
    profit: round(sum('profit'), 2),
    commission: round(sum('commission'), 2),
    swap: round(sum('swap'), 2),
    fee: round(sum('fee'), 2),
    floating: live ? round(Number(live.profit) || 0, 2) : null,
    status: isOpen ? 'open' : 'closed',
    comment: (first && first.comment) || (live && live.comment) || '',
    magic: (first && first.magic) ?? (live && live.magic) ?? null,
  };
}

export function round(x, n) {
  const f = 10 ** n;
  return Math.round((Number(x) || 0) * f) / f;
}

/** Net P&L of a position row (closed: realised; open: realised so far + floating). */
export function netOf(p) {
  const realised = (p.profit || 0) + (p.commission || 0) + (p.swap || 0) + (p.fee || 0);
  return round(realised + (p.status === 'open' ? (p.floating || 0) : 0), 2);
}
