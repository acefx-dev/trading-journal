// Reads an MT5 "History" report (File → … / History tab → right-click → Report → HTML) or a CSV,
// and returns closed positions. Runs in the browser (and in Node for tests); no DOM needed.

/** Decode a file's bytes: MT5 saves HTML reports as UTF-16 LE with a BOM. */
export function decode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  if (u8.length > 3 && u8[1] === 0 && u8[3] === 0) return new TextDecoder('utf-16le').decode(u8); // UTF-16 without BOM
  return new TextDecoder('utf-8').decode(u8);
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const clean = (s) => s.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, (e) => ENT[e.toLowerCase()] ?? ' ').replace(/\s+/g, ' ').trim();

/** Rows of an HTML document as arrays of cell texts (colspan expanded, hidden cells dropped). */
export function htmlRows(html) {
  const rows = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = [];
    for (const m of tr.matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const attrs = m[2] || '';
      if (/class\s*=\s*["']?[^"'>]*\bhidden\b/i.test(attrs)) continue;
      const span = Number((/colspan\s*=\s*["']?(\d+)/i.exec(attrs) || [])[1] || 1);
      cells.push(clean(m[3]));
      for (let k = 1; k < span; k++) cells.push('');
    }
    rows.push(cells);
  }
  return rows;
}

/** "2026.11.06 09:14:03" (broker server time) → ms, read as if UTC (the server offset is applied later). */
export function parseTime(s) {
  const m = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : NaN;
}
/** "1 234.56" / "-12.5" / "" → number */
export const parseNum = (s) => {
  const t = String(s ?? '').replace(/[\s ']/g, '').replace(/,(?=\d{3}\b)/g, '');
  return t === '' ? 0 : Number(t.replace(',', '.'));
};

const norm = (h) => h.toLowerCase().replace(/[^a-z]/g, '');

/** Find the Positions table in an MT5 report and read its rows. */
export function parseMt5Html(html) {
  const rows = htmlRows(html);
  const start = rows.findIndex((r) => r.some((c) => /^positions$/i.test(c)));
  let h = -1;
  for (let k = Math.max(0, start); k < rows.length; k++) {
    const n = rows[k].map(norm);
    if (n.includes('position') && n.includes('symbol') && n.includes('type') && n.filter((x) => x === 'time').length >= 2) { h = k; break; }
  }
  if (h < 0) throw new Error('No “Positions” table found. In MT5: Toolbox → History → right-click → Report → HTML.');
  const head = rows[h].map(norm);
  const idx = (name, nth = 0) => { let c = -1; for (let k = 0; k <= nth; k++) c = head.indexOf(name, c + 1); return c; };
  const col = {
    openTime: idx('time', 0), position: idx('position'), symbol: idx('symbol'), type: idx('type'), volume: idx('volume'),
    openPrice: idx('price', 0), sl: idx('sl'), tp: idx('tp'), closeTime: idx('time', 1), closePrice: idx('price', 1),
    commission: idx('commission'), swap: idx('swap'), profit: idx('profit'),
  };
  const out = [];
  for (let k = h + 1; k < rows.length; k++) {
    const r = rows[k];
    if (r.length < 6) continue;
    if (r.some((c) => /^(orders|deals|working orders|results)$/i.test(c))) break;   // next section
    const p = rowToPosition((name) => r[col[name]] ?? '');
    if (p) out.push(p);
  }
  return out;
}

function rowToPosition(get) {
  const type = get('type').toLowerCase();
  if (!/^(buy|sell)/.test(type)) return null;
  const vol = String(get('volume')).split('/')[0];   // "1 / 1" on some reports
  const p = {
    position: parseNum(get('position')), symbol: get('symbol'), type: type.startsWith('buy') ? 'buy' : 'sell',
    volume: parseNum(vol), open_time: parseTime(get('openTime')), open_price: parseNum(get('openPrice')),
    sl: parseNum(get('sl')), tp: parseNum(get('tp')), close_time: parseTime(get('closeTime')), close_price: parseNum(get('closePrice')),
    commission: parseNum(get('commission')), swap: parseNum(get('swap')), profit: parseNum(get('profit')),
  };
  if (!Number.isInteger(p.position) || p.position <= 0 || !p.symbol || !isFinite(p.open_time) || !isFinite(p.close_time)) return null;
  return p;
}

/**
 * CSV with a header row. Accepted column names (any order, case-insensitive):
 * position, symbol, type, volume, open_time, open_price, sl, tp, close_time, close_price, commission, swap, profit
 */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('The CSV has no rows');
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const split = (l) => {
    const out = []; let cur = '', q = false;
    for (const ch of l) {
      if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  const head = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z_]/g, ''));
  const need = ['position', 'symbol', 'type', 'volume', 'open_time', 'open_price', 'close_time', 'close_price', 'profit'];
  const missing = need.filter((n) => !head.includes(n));
  if (missing.length) throw new Error('CSV is missing columns: ' + missing.join(', '));
  const map = { openTime: 'open_time', openPrice: 'open_price', closeTime: 'close_time', closePrice: 'close_price' };
  return lines.slice(1).map((l) => {
    const r = split(l);
    return rowToPosition((name) => r[head.indexOf(map[name] || name)] ?? '');
  }).filter(Boolean);
}

export function parseStatement(bytes, filename = '') {
  const text = decode(bytes);
  if (/\.csv$/i.test(filename) || (!/<table/i.test(text) && text.includes(','))) return parseCsv(text);
  return parseMt5Html(text);
}
