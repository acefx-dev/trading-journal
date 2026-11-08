// MT5 connector uploads → deals → positions → trading ideas.
// The connector only READS the terminal; nothing here can send anything back to MT5 except
// an acknowledgement (newest deal time received, and any deal tickets the journal is missing).

import { all, first, run, stmt, getSettings, getAliases, audit, sha256Hex, HttpError } from './db.js';
import { serverToUtc, roundOffset } from './time.js';
import { buildPosition, round } from './build.js';
import { canonical, parseCopyComment } from './symbols.js';
import { pickIdea, matchMaster } from './grouping.js';

const MAX_DEALS = 1000;
const SNAPSHOT_EVERY_MS = 5 * 60000;
const STANDALONE_COPY_AFTER_MS = 15 * 60000;

const num = (x) => (x == null || x === '' || !isFinite(Number(x)) ? null : Number(x));
const int = (x) => (x == null || x === '' || !isFinite(Number(x)) ? null : Math.trunc(Number(x)));
const str = (x, n = 64) => (x == null ? null : String(x).slice(0, n));

/** HTTP handler for POST /api/ingest (Bearer token = the account's connector token). */
export async function handleIngest(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(\S+)$/.exec(auth);
  if (!m) throw new HttpError(401, 'Missing connector token');
  const hash = await sha256Hex(m[1]);
  const account = await first(env.DB, "SELECT * FROM accounts WHERE token_hash = ? AND is_sample = 0", hash);
  if (!account) throw new HttpError(401, 'Unknown connector token. Create one on the Accounts page.');
  if (account.status !== 'active') throw new HttpError(403, 'This account is archived in the journal.');

  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > 4_000_000) throw new HttpError(413, 'Upload too large; send fewer deals per request.');
  let body;
  try { body = await request.json(); } catch { throw new HttpError(400, 'Body is not valid JSON'); }
  if (String(body.login) !== String(account.login)) {
    await audit(env.DB, { actor: 'connector', account_id: account.id, action: 'Rejected upload', level: 'error',
      detail: `Token belongs to login ${account.login}, but the terminal is logged in to ${body.login}` }).run();
    throw new HttpError(403, `This token is for login ${account.login}; the terminal is logged in to ${body.login}.`);
  }
  const result = await processUpload(env.DB, account, body);
  result.account_id = account.id;
  return result;
}

/**
 * Process one upload for an account. Also used to load sample data, so the sample goes
 * through exactly the same pipeline as live data.
 */
export async function processUpload(db, account, body, now = Date.now()) {
  const offset = roundOffset(body.offset_sec);
  const tzMode = account.tz_mode || 'auto';
  const toUtc = (serverMs) => serverToUtc(Number(serverMs), offset, tzMode);

  // ---- 1. deals (insert-only, idempotent by ticket) ----
  const deals = (Array.isArray(body.deals) ? body.deals : []).slice(0, MAX_DEALS).map((d) => ({
    ticket: int(d.ticket), order: int(d.order), position: int(d.position) || 0,
    time: toUtc(d.time), server_time: int(d.time), type: int(d.type), entry: int(d.entry) ?? 0,
    symbol: str(d.symbol, 32), volume: num(d.volume) || 0, price: num(d.price) || 0, profit: num(d.profit) || 0,
    commission: num(d.commission) || 0, swap: num(d.swap) || 0, fee: num(d.fee) || 0,
    sl: num(d.sl), tp: num(d.tp), risk: num(d.risk), magic: int(d.magic), reason: int(d.reason), comment: str(d.comment, 64),
  })).filter((d) => d.ticket != null && d.type != null && isFinite(d.time));

  let newDeals = [];
  if (deals.length) {
    await run(db, `INSERT OR IGNORE INTO deals (account_id, ticket, order_ticket, position_id, time, server_time, type, entry,
        symbol, volume, price, profit, commission, swap, fee, sl, tp, risk, magic, reason, comment, imported_at)
      SELECT ?1, j.value->>'ticket', j.value->>'order', j.value->>'position', j.value->>'time', j.value->>'server_time',
        j.value->>'type', j.value->>'entry', j.value->>'symbol', j.value->>'volume', j.value->>'price', j.value->>'profit',
        j.value->>'commission', j.value->>'swap', j.value->>'fee', j.value->>'sl', j.value->>'tp', j.value->>'risk',
        j.value->>'magic', j.value->>'reason', j.value->>'comment', ?2
      FROM json_each(?3) j`, account.id, now, JSON.stringify(deals));
    newDeals = await all(db, `SELECT ticket, position_id, type, entry, symbol, volume FROM deals
      WHERE account_id = ? AND imported_at = ? AND ticket IN (SELECT value->>'ticket' FROM json_each(?))`,
      account.id, now, JSON.stringify(deals));
  }

  // History imported from an MT5 statement uses negative tickets. Once the real deals of such a
  // position arrive from the connector, the imported ones are dropped so nothing is counted twice.
  const realPos = [...new Set(newDeals.filter((d) => d.ticket > 0 && d.position_id > 0).map((d) => d.position_id))];
  if (realPos.length) {
    await run(db, 'DELETE FROM deals WHERE account_id = ? AND ticket < 0 AND position_id IN (SELECT value FROM json_each(?))', account.id, JSON.stringify(realPos));
  }

  // ---- 2. which positions need rebuilding ----
  const live = new Map();
  const complete = body.positions_complete !== false && Array.isArray(body.positions);
  for (const p of Array.isArray(body.positions) ? body.positions : []) {
    const id = int(p.position);
    if (!id) continue;
    live.set(id, {
      direction: int(p.type) === 1 ? 'short' : 'long', symbol: str(p.symbol, 32), volume: num(p.volume) || 0,
      price: num(p.price), time: toUtc(p.time), sl: num(p.sl) || 0, tp: num(p.tp) || 0,
      profit: (num(p.profit) || 0) + (num(p.swap) || 0), risk: num(p.risk), comment: str(p.comment, 64), magic: int(p.magic),
    });
  }
  const affected = new Set(newDeals.filter((d) => d.position_id > 0).map((d) => d.position_id));
  for (const id of live.keys()) affected.add(id);
  if (complete) {
    const openRows = await all(db, "SELECT position_id FROM positions WHERE account_id = ? AND status = 'open'", account.id);
    for (const r of openRows) affected.add(r.position_id);
  }

  // ---- 3. rebuild positions from all their deals ----
  const changed = [];
  if (affected.size) {
    const ids = JSON.stringify([...affected]);
    const dealRows = await all(db, 'SELECT * FROM deals WHERE account_id = ? AND position_id IN (SELECT value FROM json_each(?))', account.id, ids);
    const existing = await all(db, 'SELECT position_id, initial_sl, risk, status FROM positions WHERE account_id = ? AND position_id IN (SELECT value FROM json_each(?))', account.id, ids);
    const exMap = new Map(existing.map((r) => [r.position_id, r]));
    const byPos = new Map();
    for (const d of dealRows) {
      if (!byPos.has(d.position_id)) byPos.set(d.position_id, []);
      byPos.get(d.position_id).push(d);
    }
    const rows = [];
    for (const pid of affected) {
      const lv = live.get(pid) || null;
      const built = buildPosition(byPos.get(pid) || [], lv);
      if (!built) continue;
      const ex = exMap.get(pid);
      // keep the first S/L and risk ever seen (the connector may have seen it live before the deal history had it)
      if (ex && ex.initial_sl != null && built.initial_sl == null) built.initial_sl = ex.initial_sl;
      if (ex && ex.risk != null && built.risk == null) built.risk = ex.risk;
      const copyOf = parseCopyComment(built.comment);
      rows.push({ position_id: pid, ...built, copy_of: copyOf || null });
      if (!ex || ex.status !== built.status) changed.push({ pid, status: built.status, symbol: built.symbol, isNew: !ex });
    }
    if (rows.length) {
      await run(db, `INSERT INTO positions (account_id, position_id, symbol, direction, open_time, close_time, volume, closed_volume,
          open_price, close_price, initial_sl, initial_tp, sl, tp, risk, profit, commission, swap, fee, floating, status, comment, magic,
          copy_of, updated_at)
        SELECT ?1, v->>'position_id', v->>'symbol', v->>'direction', v->>'open_time', v->>'close_time', v->>'volume', v->>'closed_volume',
          v->>'open_price', v->>'close_price', v->>'initial_sl', v->>'initial_tp', v->>'sl', v->>'tp', v->>'risk', v->>'profit',
          v->>'commission', v->>'swap', v->>'fee', v->>'floating', v->>'status', v->>'comment', v->>'magic', v->>'copy_of', ?2
        FROM (SELECT value AS v FROM json_each(?3)) WHERE true
        ON CONFLICT (account_id, position_id) DO UPDATE SET
          symbol = excluded.symbol, direction = excluded.direction, open_time = excluded.open_time, close_time = excluded.close_time,
          volume = excluded.volume, closed_volume = excluded.closed_volume, open_price = excluded.open_price,
          close_price = excluded.close_price, initial_sl = excluded.initial_sl, initial_tp = excluded.initial_tp, sl = excluded.sl,
          tp = excluded.tp, risk = excluded.risk, profit = excluded.profit, commission = excluded.commission, swap = excluded.swap,
          fee = excluded.fee, floating = excluded.floating, status = excluded.status, comment = excluded.comment,
          magic = excluded.magic,
          copy_of = CASE WHEN positions.copy_link = 'manual' THEN positions.copy_of ELSE excluded.copy_of END,
          updated_at = excluded.updated_at`, account.id, now, JSON.stringify(rows));
    }
  }

  // ---- 4. group new positions into ideas ----
  const grouped = affected.size ? await groupAccount(db, account, [...affected], now) : { created: 0, joined: 0, linked: 0 };

  // ---- 5. account status, snapshot, audit ----
  const maxServer = deals.reduce((a, d) => Math.max(a, d.ticket > 0 ? d.server_time || 0 : 0), 0);
  const balance = num(body.balance), equity = num(body.equity);
  if (!body.import) await run(db, `UPDATE accounts SET last_seen = ?, balance = COALESCE(?, balance), equity = COALESCE(?, equity),
      server_offset_sec = ?, connector_version = COALESCE(?, connector_version),
      last_deal_msc = MAX(COALESCE(last_deal_msc, 0), ?),
      server = COALESCE(server, ?), broker = COALESCE(broker, ?), currency = COALESCE(?, currency)
    WHERE id = ?`, now, balance, equity, offset, str(body.connector, 16), maxServer,
    str(body.server, 64), str(body.company, 64), str(body.currency, 8), account.id);

  if (balance != null && !body.import) {
    const last = await first(db, 'SELECT MAX(time) AS t FROM snapshots WHERE account_id = ?', account.id);
    if (!last || !last.t || now - last.t >= SNAPSHOT_EVERY_MS || newDeals.length) {
      await run(db, 'INSERT OR REPLACE INTO snapshots (account_id, time, balance, equity) VALUES (?,?,?,?)', account.id, now, balance, equity);
    }
  }

  const logs = [];
  if (newDeals.length && !body.import) {
    const list = (xs) => xs.length > 8 ? xs.slice(0, 8).join(', ') + ` and ${xs.length - 8} more` : xs.join(', ');
    const closed = list(changed.filter((c) => c.status === 'closed').map((c) => '#' + c.pid));
    const opened = list(changed.filter((c) => c.isNew && c.status === 'open').map((c) => '#' + c.pid));
    logs.push(audit(db, { actor: 'connector', account_id: account.id, action: `Imported ${newDeals.length} deal${newDeals.length > 1 ? 's' : ''}`,
      detail: [opened ? 'opened ' + opened : '', closed ? 'closed ' + closed : '',
        grouped.created ? `${grouped.created} new idea(s)` : '', grouped.joined ? `${grouped.joined} added to ideas` : '',
        grouped.linked ? `${grouped.linked} copies linked` : ''].filter(Boolean).join(' · ') || null, time: now }));
  }

  // ---- 6. reconciliation: the connector sends every deal ticket in a period ----
  let missing = [];
  if (body.reconcile && Array.isArray(body.reconcile.tickets)) {
    const from = int(body.reconcile.from), to = int(body.reconcile.to);
    const theirs = new Set(body.reconcile.tickets.map(Number));
    const ours = await all(db, 'SELECT ticket FROM deals WHERE account_id = ? AND ticket > 0 AND server_time >= ? AND server_time <= ?', account.id, from, to);
    const oursSet = new Set(ours.map((r) => r.ticket));
    missing = [...theirs].filter((t) => !oursSet.has(t)).slice(0, 5000);
    const extra = [...oursSet].filter((t) => !theirs.has(t));
    logs.push(audit(db, { actor: 'connector', account_id: account.id, time: now,
      action: 'Reconciliation', level: missing.length || extra.length ? 'warn' : 'info',
      detail: `${theirs.size} deals in MT5 vs ${oursSet.size} in journal · ${missing.length} missing (requested) · ${extra.length} not in MT5 history` }));
  }
  if (logs.length) await db.batch(logs);

  const ack = await first(db, 'SELECT MAX(server_time) AS t FROM deals WHERE account_id = ? AND ticket > 0', account.id);
  return { ok: true, account: account.name, new_deals: newDeals.length, ack_server_msc: (ack && ack.t) || 0, missing, ...grouped };
}

/** Assign ungrouped positions of this account (and copies waiting for them) to ideas. */
export async function groupAccount(db, account, positionIds, now = Date.now()) {
  const settings = await getSettings(db);
  const aliases = await getAliases(db);
  const out = { created: 0, joined: 0, linked: 0 };
  const isCopy = account.role === 'copy' && account.master_account_id;

  const pending = await all(db, `SELECT * FROM positions WHERE account_id = ? AND idea_id IS NULL AND group_mode = 'auto'
    AND position_id IN (SELECT value FROM json_each(?)) ORDER BY open_time, position_id`, account.id, JSON.stringify(positionIds));

  let lead = pending;
  if (isCopy) {
    const r = await linkCopies(db, account, pending, settings, aliases, now);
    out.linked += r.linked;
    lead = r.standalone; // copy-account trades that are not copies (opened by hand on that account)
  }
  if (lead.length) {
    const r = await groupLead(db, account, lead, settings, aliases, now);
    out.created += r.created; out.joined += r.joined;
  }
  if (!isCopy) {
    // copies on other accounts that were waiting for these Master positions
    const followers = await all(db, "SELECT * FROM accounts WHERE master_account_id = ? AND role = 'copy' AND status = 'active'", account.id);
    for (const f of followers) {
      const waiting = await all(db, `SELECT * FROM positions WHERE account_id = ? AND idea_id IS NULL AND group_mode = 'auto' ORDER BY open_time`, f.id);
      if (!waiting.length) continue;
      const r = await linkCopies(db, f, waiting, settings, aliases, now);
      out.linked += r.linked;
      if (r.standalone.length) {
        const g = await groupLead(db, f, r.standalone, settings, aliases, now);
        out.created += g.created;
      }
    }
  }
  return out;
}

async function groupLead(db, account, rows, settings, aliases, now) {
  const windowMs = settings.groupWindowMin * 60000;
  const minOpen = Math.min(...rows.map((r) => r.open_time));
  const maxOpen = Math.max(...rows.map((r) => r.open_time));
  const existing = (await all(db, `SELECT p.id, p.position_id, p.account_id, p.direction, p.open_time, p.close_time, p.idea_id, i.symbol AS canon
      FROM positions p JOIN ideas i ON i.id = p.idea_id
      WHERE p.account_id = ? AND i.account_id = p.account_id AND p.open_time >= ? AND p.open_time <= ?`,
    account.id, minOpen - windowMs, maxOpen)).map((e) => ({ ...e, ideaKey: 'i' + e.idea_id }));

  const fresh = []; // new ideas: {key, canon, direction, first}
  const assign = []; // {id, key}
  for (const r of rows) {
    const pos = { position_id: r.position_id, account_id: r.account_id, canon: canonical(r.symbol, aliases), direction: r.direction, open_time: r.open_time };
    let key = pickIdea(pos, existing, { windowMs, requireOverlap: settings.requireOverlap });
    if (!key) {
      key = 'n' + fresh.length;
      fresh.push({ key, canon: pos.canon, direction: r.direction });
    }
    existing.push({ ...pos, close_time: r.close_time, ideaKey: key });
    assign.push({ id: r.id, key, position_id: r.position_id });
  }

  const keyToId = {};
  if (fresh.length) {
    const res = await db.batch(fresh.map((f) => stmt(db,
      'INSERT INTO ideas (account_id, symbol, direction, is_sample, created_at, updated_at) VALUES (?,?,?,?,?,?) RETURNING id',
      account.id, f.canon, f.direction, account.is_sample, now, now)));
    fresh.forEach((f, i) => { keyToId[f.key] = res[i].results[0].id; });
  }
  const resolved = assign.map((a) => ({ id: a.id, idea: a.key.startsWith('i') ? Number(a.key.slice(1)) : keyToId[a.key], position_id: a.position_id, isNew: a.key.startsWith('n') }));
  await run(db, `UPDATE positions SET idea_id = (SELECT value->>'idea' FROM json_each(?1) WHERE value->>'id' = positions.id)
    WHERE id IN (SELECT value->>'id' FROM json_each(?1))`, JSON.stringify(resolved));

  const logs = [];
  const seenNew = new Set();
  for (const a of resolved) {
    if (a.isNew && !seenNew.has(a.idea)) {
      seenNew.add(a.idea);
      logs.push(audit(db, { actor: 'system', account_id: account.id, idea_id: a.idea, time: now, action: 'Idea created', detail: `from position #${a.position_id}` }));
    } else {
      logs.push(audit(db, { actor: 'system', account_id: account.id, idea_id: a.idea, time: now, action: 'Position auto-added',
        detail: `#${a.position_id}: same account, symbol and direction, within ${settings.groupWindowMin} min${settings.requireOverlap ? ', overlapping' : ''}` }));
    }
  }
  if (logs.length) await db.batch(logs);
  return { created: fresh.length, joined: resolved.length - seenNew.size };
}

async function linkCopies(db, account, rows, settings, aliases, now) {
  const copyWindowMs = settings.copyMatchWindowSec * 1000;
  const minOpen = Math.min(...rows.map((r) => r.open_time));
  const maxOpen = Math.max(...rows.map((r) => r.open_time));
  const ids = rows.map((r) => r.copy_of).filter(Boolean);
  const masters = (await all(db, `SELECT id, position_id, symbol, direction, open_time, idea_id FROM positions
      WHERE account_id = ? AND (position_id IN (SELECT value FROM json_each(?)) OR (open_time >= ? AND open_time <= ?))`,
    account.master_account_id, JSON.stringify(ids), minOpen - copyWindowMs, maxOpen + copyWindowMs))
    .map((m) => ({ ...m, canon: canonical(m.symbol, aliases) }));
  const takenRows = await all(db, 'SELECT master_pos FROM positions WHERE account_id = ? AND master_pos IS NOT NULL', account.id);
  const taken = new Set(takenRows.map((r) => r.master_pos));

  const updates = [], standalone = [], logs = [];
  for (const r of rows) {
    const c = { copy_of: r.copy_of || 0, canon: canonical(r.symbol, aliases), direction: r.direction, open_time: r.open_time };
    const hit = matchMaster(c, masters, { copyWindowMs }, taken);
    if (hit && hit.master.idea_id) {
      taken.add(hit.master.id);
      updates.push({ id: r.id, idea: hit.master.idea_id, master: hit.master.id, link: hit.link });
      logs.push(audit(db, { actor: 'system', account_id: account.id, idea_id: hit.master.idea_id, time: now, action: 'Copy linked',
        detail: `#${r.position_id} → Master #${hit.master.position_id} (${hit.link === 'comment' ? 'copier comment TC:' + r.copy_of : 'same symbol, side and time'})` }));
    } else if (!r.copy_of && (now - r.open_time > STANDALONE_COPY_AFTER_MS || r.status === 'closed')) {
      standalone.push(r); // a trade placed by hand on the copy account
    }
    // else: a copy whose Master position hasn't arrived yet; tried again on the next upload
  }
  if (updates.length) {
    await run(db, `UPDATE positions SET
        idea_id = (SELECT value->>'idea' FROM json_each(?1) WHERE value->>'id' = positions.id),
        master_pos = (SELECT value->>'master' FROM json_each(?1) WHERE value->>'id' = positions.id),
        copy_link = (SELECT value->>'link' FROM json_each(?1) WHERE value->>'id' = positions.id)
      WHERE id IN (SELECT value->>'id' FROM json_each(?1))`, JSON.stringify(updates));
  }
  if (logs.length) await db.batch(logs);
  return { linked: updates.length, standalone };
}

export { round };
