import { html, useState, useEffect, useRef, useStore, useData, api, scopeQs, store, fmt, sgn, cls, Kpi, Money, R, Dir, Loading, PageHead, Seg, Icon, Modal, toast, todayBne } from '../lib.js';
import { SampleEmpty } from './dashboard.js';

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const PERIODS = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 3 months'], ['365', 'Last 12 months'], ['all', 'All time']];
const STATUS = [['all', 'All'], ['open', 'Open'], ['todo', 'To review'], ['done', 'Reviewed']];
const statusOf = (i) => (i.status === 'open' ? 'open' : i.reviewed ? 'done' : 'todo');
const narrow = () => window.matchMedia('(max-width: 1279px)').matches;

/** Trade ideas: the list on the left, the selected idea's review on the right (stacked on smaller screens). */
export function Ideas({ id }) {
  const s = useStore();
  const [range, setRange] = useState('90');
  const [status, setStatus] = useState('all');
  const [strategy, setStrategy] = useState('');
  const [q, setQ] = useState('');
  const [rating, setRating] = useState('');
  const today = todayBne();
  const from = range === 'all' ? '' : addDays(today, -(Number(range) - 1));
  const qs = `${scopeQs()}&from=${from}&strategy=${strategy}&limit=500`;
  const st = useData(() => api('/ideas?' + qs), [qs]);
  const csv = '/api/export/ideas.csv?' + scopeQs() + (s.mode === 'sample' ? '&mode=sample' : '');
  const all = st.data ? st.data.items : [];
  const mist = Object.fromEntries(s.boot.mistakes.map((m) => [m.id, m.label]));
  const needle = q.trim().toLowerCase();
  const base = needle ? all.filter((i) => [i.symbol, i.strategy_name, i.direction, i.lead_name, ...i.mistakes.map((m) => mist[m])].join(' ').toLowerCase().includes(needle)) : all;
  const rateOk = (i) => !rating || (rating === 'none' ? !i.rating : rating === 'low' ? i.rating && i.rating <= 2 : (i.rating || 0) >= Number(rating));
  const list = base.filter((i) => (status === 'all' || statusOf(i) === status) && rateOk(i));
  const count = (k) => base.filter((i) => k === 'all' || statusOf(i) === k).length;
  const selId = id ? Number(id) : null;
  // on a wide screen, open the first idea when none is chosen
  useEffect(() => { if (!id && list.length && !narrow()) location.replace('#/ideas/' + list[0].id); }, [id, list.length && list[0].id]);
  const closed = list.filter((i) => i.status === 'closed');
  const sum = { n: list.length, w: closed.filter((i) => i.basisNet > 0).length, l: closed.filter((i) => i.basisNet < 0).length,
    r: closed.reduce((a, i) => a + (i.r || 0), 0), net: closed.reduce((a, i) => a + i.net, 0) };
  const idx = list.findIndex((i) => i.id === selId);
  const go = (k) => { const n = list[idx + k]; if (n) location.hash = '#/ideas/' + n.id; };
  const showList = !id || !narrow();
  return html`<${PageHead} title="Trade ideas" sub=${st.data ? `${base.length} ideas · ${count('todo')} to review · ${count('open')} open` : ''}>
      <a class="btn sm hide-phone" href=${csv} download><${Icon} name="dl" size=${15}/>CSV</a><//>
    <${SampleEmpty}/>
    <div class="split2 fill">
      ${showList && html`<section class="panel" style="min-height:420px">
        <div class="hstack" style="padding:12px 12px 10px;gap:8px">
          <label class="sr" for="iq">Search ideas</label>
          <input id="iq" class="inp sm" style="flex:1 1 180px;min-width:150px" placeholder="Search symbol, strategy, mistake" value=${q} onInput=${(e) => setQ(e.target.value)}/>
          <div class="seg2" role="group" aria-label="Status">${STATUS.map(([k, l]) => html`<button type="button" class=${status === k ? 'on' : ''} aria-pressed=${status === k} onClick=${() => setStatus(k)}>${l} <span class="num" style="opacity:.7">${count(k)}</span></button>`)}</div>
          <label class="sr" for="istrat">Strategy</label>
          <select id="istrat" class="inp sm" value=${strategy} onChange=${(e) => setStrategy(e.target.value)}><option value="">All strategies</option><option value="none">No strategy</option>
            ${s.boot.strategies.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select>
          <label class="sr" for="iper">Period</label>
          <select id="iper" class="inp sm" value=${range} onChange=${(e) => setRange(e.target.value)}>${PERIODS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
          <label class="sr" for="irate">Rating</label>
          <select id="irate" class="inp sm" value=${rating} onChange=${(e) => setRating(e.target.value)} title="Execution rating">
            <option value="">Any rating</option><option value="5">★★★★★ only</option><option value="4">★★★★ and up</option><option value="3">★★★ and up</option><option value="low">★★ or less</option><option value="none">Not rated</option></select>
          <a href="#/analytics" class="btn sm">More filters</a>
        </div>
        <div class="gr gh ig" style="grid-template-columns:${GRID}"><span>Opened</span><span>Idea · strategy</span><span class="r">Held</span><span class="r">R</span><span class="r">P&L</span><span class="hide-sm">Rating</span><span>Status</span></div>
        <div class="scrolly">
          ${st.error ? html`<div class="warn err" style="margin:12px">${st.error}</div>` : !st.data ? html`<div class="empty">Loading…</div>`
            : list.map((i) => html`<${Row} i=${i} on=${i.id === selId}/>`)}
          ${st.data && !list.length && html`<div class="empty">No ideas match. Clear the search${rating ? ', the rating filter' : ''} or pick another period.</div>`}
        </div>
        <div class="sub hstack" style="border-top:1px solid #1B212C;padding:9px 14px;gap:18px">
          <span><b class="num" style="color:var(--text)">${sum.n}</b> ideas</span><span>Win rate <b class="num" style="color:var(--text)">${sum.w + sum.l ? Math.round(sum.w * 100 / (sum.w + sum.l)) + '%' : '—'}</b></span>
          <span>Total <b class=${cls('num', sgn(sum.r))}>${fmt.r(sum.r)}</b></span><span>Net <b class=${cls('num', sgn(sum.net))}>${fmt.money(sum.net, 0)}</b></span></div>
      </section>`}
      ${id ? html`<section class="panel" style="min-height:420px"><${IdeaPanel} key=${id} id=${id} prev=${idx > 0 ? () => go(-1) : null} next=${idx >= 0 && idx < list.length - 1 ? () => go(1) : null} reloadList=${st.reload}/></section>`
        : !narrow() && html`<section class="panel"><div class="empty">${st.data && !list.length ? 'Nothing to show.' : 'Choose an idea to review it.'}</div></section>`}
    </div>`;
}

const GRID = '96px minmax(0,1.6fr) 56px 60px 86px 62px 84px';

function Row({ i, on }) {
  const st = statusOf(i);
  return html`<button type="button" class=${cls('gr ig', on && 'on')} style=${`grid-template-columns:${GRID}`} aria-current=${on ? 'true' : null}
    onClick=${() => { location.hash = '#/ideas/' + i.id; }}>
    <span><span style="display:block;font-weight:500;color:var(--text)">${fmt.date(i.open_time)}</span><span class="num sub">${fmt.time(i.open_time)}</span></span>
    <span><span class="hstack" style="gap:7px;flex-wrap:nowrap"><b style="color:var(--text)">${i.symbol}</b><${Dir} d=${i.direction}/>${i.lead_positions > 1 && html`<span class="sub num">×${i.lead_positions}</span>`}</span>
      <span class="sub" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${i.strategy_name || 'No strategy'}</span></span>
    <span class="num r mut">${i.status === 'open' ? 'open' : fmt.dur(i.close_time - i.open_time).replace(' min', 'm').replace(' h ', 'h ')}</span>
    <span class="r">${i.status === 'open' ? html`<span class="mut">—</span>` : html`<${R} v=${i.r}/>`}</span>
    <span class="r" style="font-weight:600">${i.status === 'open' ? html`<${Money} v=${i.floating}/>` : html`<${Money} v=${i.net} dec=${0}/>`}</span>
    <span class="num hide-sm" style="color:var(--amber);letter-spacing:1px">${i.rating ? '★'.repeat(i.rating) + '☆'.repeat(5 - i.rating) : html`<span class="mut">—</span>`}</span>
    <span><span class=${cls('chip', st === 'open' ? 'b' : st === 'done' ? 'g' : 'a')}>${st === 'open' ? 'Open' : st === 'done' ? 'Reviewed' : 'To review'}</span></span>
  </button>`;
}

// ------------------------------------------------------------------ one idea (right-hand panel)

let pendingPaste = null; // an image pasted on another tab, uploaded once the Screenshots tab opens
const TABS = [['review', 'Review'], ['path', 'Trade path'], ['chart', 'Screenshots & charts'], ['pos', 'Positions & accounts'], ['log', 'Activity']];

function IdeaPanel({ id, prev, next, reloadList }) {
  const st = useData(() => api('/ideas/' + id), [id]);
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('tj.ideaTab') || 'review'; } catch { return 'review'; } });
  const pickTab = (t) => { setTab(t); try { sessionStorage.setItem('tj.ideaTab', t); } catch { /* ignore */ } };
  useEffect(() => {
    if (tab === 'chart' || store.mode === 'sample') return;
    const onPaste = (e) => {
      const files = e.clipboardData && [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
      if (!files || !files.length || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      pendingPaste = files; pickTab('chart');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [tab, id]);
  if (st.error) return html`<div class="warn err" style="margin:14px">${st.error}</div>`;
  if (!st.data) return html`<div class="empty">Loading…</div>`;
  const d = st.data, i = d.idea;
  const reload = () => { st.reload(); reloadList(); };
  const lead = d.positions.filter((p) => p.account_id === i.account_id);
  const leadAcc = i.accounts.find((a) => a.lead) || i.accounts[0];
  const pth = leadAcc.path;
  const done = d.checklist.filter((c) => c.checked).length;
  const risk = d.risk, sent = d.sentiment;
  const twins = [...new Set(d.positions.filter((p) => p.copy_link === 'twin').map((p) => p.account_id))];
  const leadCheck = risk && risk.checks.find((c) => c.account_id === i.account_id);
  const toggleReviewed = async () => {
    try { await api('/ideas/' + i.id, { method: 'PUT', body: { reviewed: !i.reviewed_at } }); toast(i.reviewed_at ? 'Marked as not reviewed' : 'Marked as reviewed'); reload(); } catch (e) { toast(e.message, true); }
  };
  return html`
    <div style="padding:14px 16px 10px;border-bottom:1px solid #1B212C" class="stack">
      <div class="hstack" style="gap:10px">
        <a href="#/ideas" class="btn sm ghost show-narrow" aria-label="Back to the list"><${Icon} name="back" size=${15}/></a>
        <h2 style="margin:0;font-size:20px;font-weight:600;letter-spacing:-.02em">${i.symbol} ${i.direction === 'long' ? 'Long' : 'Short'}</h2>
        ${i.status === 'open' ? html`<span class="chip b">Open</span>` : i.reviewed_at ? html`<span class="chip g">Reviewed</span>` : html`<span class="chip a">To review</span>`}
        ${i.strategy_name && html`<span class="chip">${i.strategy_name}</span>`}
        ${twins.length > 0 && html`<span class="chip b" title="The same trade placed by hand on another account was linked here, so you review it once">${i.accounts.length} accounts · one review</span>`}
        ${sent && sent.align && sent.align !== 'unset' && html`<span class=${cls('chip', sent.align === 'with' ? 'g' : sent.align === 'against' ? 'r' : '')} title=${`Your ${sent.day} bias: ${BIAS[sent.bias] || 'not set'}`}>${sent.align === 'with' ? 'With bias' : sent.align === 'against' ? 'Against bias' : 'Neutral bias'}</span>`}
        ${risk && (risk.violation || risk.dayViolation) && html`<span class="chip r" title="Risk above your limit plus the slippage tolerance">${risk.violation ? 'Over risk limit' : 'Over daily risk'}</span>`}
        <div class="hstack" style="margin-left:auto;gap:6px">
          ${store.mode !== 'sample' && html`<button type="button" class="btn sm" onClick=${() => { pickTab('chart'); setTimeout(() => document.getElementById('shotfile')?.click(), 50); }}><${Icon} name="img" size=${15}/><span class="hide-sm">Add screenshot</span></button>`}
          <button type="button" class="btn sm" aria-label="Newer idea" disabled=${!prev} onClick=${prev}><${Icon} name="back" size=${15}/></button>
          <button type="button" class="btn sm" aria-label="Older idea" disabled=${!next} onClick=${next}><${Icon} name="chev" size=${15}/></button>
          ${i.status === 'closed' && html`<button type="button" class=${cls('btn sm', !i.reviewed_at && 'pri')} onClick=${toggleReviewed}>${i.reviewed_at ? 'Reviewed ✓ (undo)' : html`<${Icon} name="check" size=${15}/>Mark reviewed`}</button>`}</div></div>
      <div class="sub" style="font-size:12.5px">${fmt.dateY(i.open_time)} · ${fmt.time(i.open_time)} → ${i.close_time ? fmt.time(i.close_time) + (fmt.date(i.close_time) !== fmt.date(i.open_time) ? ' next day' : '') + ' AEST · held ' + fmt.dur(i.close_time - i.open_time) : 'still open'}
        · ${lead.length} position${lead.length > 1 ? 's' : ''} on ${i.lead_name}${i.accounts.length > 1 ? ` · copied to ${i.accounts.length - 1} account${i.accounts.length > 2 ? 's' : ''}` : ''}</div>
    </div>
    <div class="mstrip">
      <div class="kcell"><div class="cap">${i.accounts.length > 1 ? 'Combined P&L' : 'Net P&L'}</div><div class=${cls('num', sgn(i.net))} style="font-size:17px;font-weight:600;margin-top:5px">${fmt.money(i.net)}</div><div class="sub" title="Commission, swap and fees">${i.status === 'open' ? 'floating' : `after ${fmt.money(i.costs)} costs`}</div></div>
      <div class="kcell"><div class="cap">Result</div><div class=${cls('num', sgn(leadAcc.r))} style="font-size:17px;font-weight:600;margin-top:5px">${fmt.r(leadAcc.r)}</div><div class="sub">${i.lead_name}</div></div>
      <div class="kcell"><div class="cap" title=${pth && pth.peak ? 'Highest combined risk you held (stop moves counted)' : 'Sum of each position\'s first stop'}>${pth && pth.peak ? 'Risk (peak held)' : 'Initial risk'}</div><div class="num" style="font-size:17px;font-weight:600;margin-top:5px">${leadAcc.risk != null ? fmt.plain(leadAcc.risk) : '—'}</div>
        ${(() => { const nb = openRiskNow(d); const v = nb && nb.get(i.account_id); return nb && nb.has(i.account_id) ? html`<div class="sub">now ${v === 0 ? html`<span class="pos">$0 (stop at entry)</span>` : v == null ? 'unknown' : fmt.plain(v)}</div>` : ''; })()}<div class="sub">${leadAcc.risk == null ? 'no S/L seen' : leadCheck && leadCheck.limit ? html`<span style=${leadCheck.level === 'over' ? 'color:var(--neg)' : leadCheck.level === 'tolerance' ? 'color:var(--amber)' : ''}>limit ${fmt.plain(leadCheck.limit)}${leadCheck.level === 'tolerance' ? ' · within tolerance' : leadCheck.level === 'over' ? ' · over' : ''}</span>` : 'lead account'}</div></div>
      ${pth && pth.mae_r != null && html`<div class="kcell"><div class="cap" title="Worst point of the combined floating P&L while the trade was open">Drawdown</div>
        <div class="num neg" style="font-size:17px;font-weight:600;margin-top:5px">${fmt.r(Math.min(0, pth.mae_r))}</div>
        <div class="sub" title="Best point during the trade">best <span class=${sgn(pth.mfe_r)}>${fmt.r(pth.mfe_r)}</span></div></div>`}
      <div class="kcell"><div class="cap">Checklist</div><div class="num" style="font-size:17px;font-weight:600;margin-top:5px">${d.checklist.length ? done + ' / ' + d.checklist.length : '—'}</div><div class="sub">${!i.strategy_id ? 'no strategy' : d.checklist.length - done ? (d.checklist.length - done) + ' not ticked' : 'all ticked'}</div></div>
    </div>
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => html`<button type="button" role="tab" class=${cls('tab', tab === k && 'on')} aria-selected=${tab === k} onClick=${() => pickTab(k)}>${l}${k === 'chart' && d.screenshots.length + d.links.length > 0 ? html` <span class="chip num" style="height:18px;padding:0 6px;font-size:11px">${d.screenshots.length + d.links.length}</span>` : ''}</button>`)}</div>
    <div class="scrolly tabbody" style="padding:14px 16px 16px">
      ${leadAcc.risk == null && i.status === 'closed' && html`<div class="warn" style="margin-bottom:12px">R can't be worked out: at least one position had no stop-loss when the connector first saw it.</div>`}
      ${tab === 'review' && html`<${Review} d=${d} reload=${reload}/>`}
      ${tab === 'pos' && html`<div class="stack" style="gap:18px">${risk && risk.checks.length > 0 && html`<${RiskChecks} risk=${risk} nowBy=${openRiskNow(d)}/>`}<${Positions} d=${d} reload=${reload}/><${Executions} i=${i}/><${Grouping} d=${d} reload=${reload}/></div>`}
      ${tab === 'chart' && html`<${Chart} d=${d} reload=${reload}/>`}
      ${tab === 'path' && html`<${TradePath} d=${d}/>`}
      ${tab === 'log' && html`<${Audit} items=${d.audit}/>`}
    </div>`;
}

const BIAS = { bull: 'Bullish', bear: 'Bearish', neutral: 'Neutral' };
const LVL = { ok: ['g', 'Within limit'], tolerance: ['a', 'Within tolerance'], over: ['r', 'Over limit'] };

/** Risk taken on each account against that account's limits (Accounts page). */
const nowLabel = (v) => (v == null ? 'unknown' : v === 0 ? html`<span class="pos">$0 · stops at entry</span>` : fmt.plain(v));
/** Current combined risk per account for an open idea, from the connector's latest stop changes. */
function openRiskNow(d) {
  if (d.idea.status !== 'open' || !d.tradePath || !d.tradePath.length) return null;
  const m = new Map();
  for (const a of d.tradePath) if (a.steps && a.steps.length) m.set(a.account_id, a.steps[a.steps.length - 1].total);
  return m.size ? m : null;
}

function RiskChecks({ risk, nowBy }) {
  const pct = (v) => (v == null ? '' : ` (${fmt.num(v, 2)}%)`);
  return html`<section class="card flush">
    <div class="card-head"><div><h2 class="h2">Risk limits</h2><div class="sub" style="margin-top:4px">Up to ${fmt.num(risk.tolerancePct, 1)}% over a limit is allowed for slippage. Above that it counts as a violation.</div></div></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Account</th>${nowBy && html`<th class="r" title="Combined risk to the current stops">Open risk now</th>`}<th class="r">Risk on this idea</th><th class="r">Per-idea limit</th><th></th><th class="r">Risk that day</th><th class="r">Daily limit</th><th></th></tr></thead>
    <tbody>${risk.checks.map((c) => html`<tr><td><b>${c.name}</b></td>${nowBy && html`<td class="num r">${nowBy.has(c.account_id) ? nowLabel(nowBy.get(c.account_id)) : '—'}</td>`}
      <td class="num r">${c.risk != null ? fmt.plain(c.risk) + pct(c.riskPct) : html`<span class="mut">no S/L</span>`}</td>
      <td class="num r">${c.limit != null ? fmt.plain(c.limit) + pct(c.limitPct) : html`<span class="mut">not set</span>`}</td>
      <td>${c.level && LVL[c.level] ? html`<span class=${'chip ' + LVL[c.level][0]}>${LVL[c.level][1]}</span>` : ''}</td>
      <td class="num r">${c.dayUsed != null ? fmt.plain(c.dayUsed) : '—'}</td>
      <td class="num r">${c.dayLimit != null ? fmt.plain(c.dayLimit) + pct(c.dayLimitPct) : html`<span class="mut">not set</span>`}</td>
      <td>${c.dayLevel && LVL[c.dayLevel] ? html`<span class=${'chip ' + LVL[c.dayLevel][0]}>${LVL[c.dayLevel][1]}</span>` : ''}</td></tr>`)}</tbody></table></div>
    <div class="sub" style="padding:8px 14px 12px">With connector 1.02, risk is the highest combined risk you held for at least ${risk.graceSec || 60} s, so moving your first stop right after a scale-in isn't counted twice. Without it (older trades), it's the sum of each position's first stop.</div>
  </section>`;
}

const hm = (t) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', minute: '2-digit', hour12: false }).format(t);

/**
 * The trade's key points over time, in R of the risk held: entry → worst / best (in the order they happened) → exit (or now).
 * Only those points are recorded, so the line between them is a straight join, not every tick.
 */
function PathChart({ i, lead, res }) {
  const ref = useRef(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const open = i.status === 'open';
  const t0 = i.open_time, t1 = Math.max(i.close_time || Date.now(), t0 + 60000);
  const endR = res ?? 0;
  const pts = [{ t: t0, r: 0, k: 'entry' }];
  if (lead.mae_r != null && lead.mae_t) pts.push({ t: lead.mae_t, r: Math.min(0, lead.mae_r), k: 'worst' });
  if (lead.mfe_r != null && lead.mfe_t) pts.push({ t: lead.mfe_t, r: lead.mfe_r, k: 'best' });
  pts.sort((a, b) => a.t - b.t);
  pts.push({ t: t1, r: endR, k: open ? 'now' : 'exit' });
  for (const p of pts) p.t = Math.min(Math.max(p.t, t0), t1);
  // a worst/best point that is really the exit (same level, at the end) is shown once, on the exit
  const last = pts[pts.length - 1];
  for (let k = pts.length - 2; k > 0; k--) {
    const p = pts[k];
    if (Math.abs(p.r - last.r) < 0.08 && (t1 - p.t) < (t1 - t0) * 0.25) { last.also = p.k; pts.splice(k, 1); }
  }

  const H = W < 480 ? 200 : 230, L = 52, Rp = 18, T = 26, B = 30;
  const lo = Math.min(-1, ...pts.map((p) => p.r)) - 0.4, hi = Math.max(0.5, ...pts.map((p) => p.r)) + 0.35;
  const X = (t) => L + (t - t0) / (t1 - t0) * (W - L - Rp);
  const Y = (r) => T + (hi - r) / (hi - lo) * (H - T - B);
  const span = hi - lo, step = span > 6 ? 2 : span > 3 ? 1 : 0.5;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  const line = pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.r).toFixed(1)}`).join(' ');
  const area = `${X(t0).toFixed(1)},${Y(0).toFixed(1)} ${line} ${X(t1).toFixed(1)},${Y(0).toFixed(1)}`;
  const C = { worst: '#FF7A84', best: '#3DD68C', exit: '#9DB8FF', now: '#9DB8FF' };
  const name = { worst: 'Worst', best: 'Best', exit: 'Exit', now: 'Now' };
  // labels: above a high point, below a low one; flip or nudge when two would touch
  const CW = 7.1;
  const placed = [
    { left: W - Rp - 8 * CW, w: 8 * CW, y: Y(-1) - 5 },   // "Stop −1R"
    { left: W - Rp - 5 * CW, w: 5 * CW, y: Y(0) - 5 },    // "Entry"
  ];
  const labels = pts.filter((p) => p.k !== 'entry').map((p) => {
    const text = `${name[p.k]} ${fmt.r(p.r)}${p.also ? ' · ' + p.also : ''}`, w = text.length * CW + 4;
    let x = X(p.t), anchor = 'middle';
    if (x - w / 2 < L) anchor = 'start'; else if (x + w / 2 > W - Rp) anchor = 'end';
    const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    let above = p.k === 'worst' ? false : p.r >= 0;
    const yOf = (ab) => (ab ? Y(p.r) - 11 : Y(p.r) + 20);
    const hits = (ab) => placed.some((q) => Math.abs(q.y - yOf(ab)) < 17 && left < q.left + q.w + 4 && left + w + 4 > q.left);
    if (hits(above) && !hits(!above)) above = !above;
    let y = yOf(above);
    // still touching: step the label up/down until it's clear
    for (let k = 0; k < 4 && placed.some((q) => Math.abs(q.y - y) < 15 && left < q.left + q.w + 4 && left + w + 4 > q.left); k++) y += above ? -15 : 15;
    y = Math.max(12, Math.min(H - B - 4, y));
    placed.push({ left, w, y });
    return { p, text, x, y, anchor };
  });
  const dur = fmtGap(t1 - t0);
  return html`<div ref=${ref} class="pchart">
    <svg width=${W} height=${H} viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`Trade path: worst ${fmt.r(lead.mae_r)}, best ${fmt.r(lead.mfe_r)}, ${open ? 'now' : 'exit'} ${fmt.r(res)}`}>
      <defs>
        <clipPath id="pcUp"><rect x="0" y="0" width=${W} height=${Y(0)}/></clipPath>
        <clipPath id="pcDn"><rect x="0" y=${Y(0)} width=${W} height=${H}/></clipPath>
        <linearGradient id="pcG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3DD68C" stop-opacity=".28"/><stop offset="1" stop-color="#3DD68C" stop-opacity=".02"/></linearGradient>
        <linearGradient id="pcR" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FF7A84" stop-opacity=".3"/><stop offset="1" stop-color="#FF7A84" stop-opacity=".03"/></linearGradient>
      </defs>
      ${ticks.map((v) => html`<g><line x1=${L} x2=${W - Rp} y1=${Y(v)} y2=${Y(v)} stroke=${v === 0 ? '#3A4252' : '#1B212C'} stroke-width="1"/>
        <text x=${L - 8} y=${Y(v) + 4} text-anchor="end" class="pc-ax">${v === 0 ? '0R' : (v > 0 ? '+' : '−') + Math.abs(v) + 'R'}</text></g>`)}
      <line x1=${L} x2=${W - Rp} y1=${Y(-1)} y2=${Y(-1)} stroke="#FF7A84" stroke-width="1.2" stroke-dasharray="5 4" opacity=".8"/>
      <text x=${W - Rp} y=${Y(-1) - 5} text-anchor="end" class="pc-ax" fill="#FF7A84" style="fill:#FF9AA2">Stop −1R</text>
      <text x=${W - Rp} y=${Y(0) - 5} text-anchor="end" class="pc-ax">Entry</text>
      <polygon points=${area} fill="url(#pcG)" clip-path="url(#pcUp)"/>
      <polygon points=${area} fill="url(#pcR)" clip-path="url(#pcDn)"/>
      <polyline points=${line} fill="none" stroke="#C9D3E6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray=${open ? '' : ''}/>
      <circle cx=${X(t0)} cy=${Y(0)} r="3.5" fill="#0B0E13" stroke="#C9D3E6" stroke-width="1.6"/>
      ${pts.filter((p) => p.k !== 'entry').map((p) => html`<circle cx=${X(p.t)} cy=${Y(p.r)} r=${p.k === 'exit' || p.k === 'now' ? 4.5 : 4} fill=${C[p.k]} stroke="#0B0E13" stroke-width="2"/>`)}
      ${labels.map((l) => html`<text x=${l.x} y=${l.y} text-anchor=${l.anchor} class="pc-lb" style=${`fill:${C[l.p.k]}`}>${l.text}</text>`)}
      <text x=${L} y=${H - 9} class="pc-ax">${hm(t0)} entry</text>
      <text x=${(L + W - Rp) / 2} y=${H - 9} text-anchor="middle" class="pc-ax">${dur}</text>
      <text x=${W - Rp} y=${H - 9} text-anchor="end" class="pc-ax">${open ? hm(t1) + ' now' : hm(t1) + ' exit'}</text>
    </svg>
    <div class="pc-legend sub"><span><i style="background:#FF7A84"></i>worst point</span><span><i style="background:#3DD68C"></i>best point</span><span><i style="background:#9DB8FF"></i>${open ? 'now' : 'exit'}</span>
      <span>Straight lines join the recorded points; the price moved in between.</span></div>
  </div>`;
}

const fmtGap = (ms) => (ms < 60000 ? Math.round(ms / 1000) + ' s' : fmt.dur(ms));

/** How the trade moved (in R of the risk held) and how the combined risk changed as stops moved. */
function TradePath({ d }) {
  const i = d.idea, list = d.tradePath || [];
  const lead = list.find((x) => x.lead) || list[0];
  if (!lead) return html`<div class="box stack" style="gap:6px"><b>Not recorded for this trade</b>
    <div class="sub">The drawdown, best point and stop moves come from connector 1.02 on ${i.lead_name}. Install it in MT5 (Accounts & sync → MT5 connector) and new trades will show their path here. Older trades keep using the first stop of each position.</div></div>`;
  const leadAcc = i.accounts.find((a) => a.lead) || i.accounts[0];
  const R = leadAcc.risk;
  const res = leadAcc.r;
  const after = (t) => (t && i.open_time ? fmtGap(t - i.open_time) + ' after entry' : '');
  return html`<div class="stack" style="gap:16px">
    <section class="card stack" style="gap:8px">
      <div class="spread"><h2 class="h2">How the trade moved</h2><span class="sub">${lead.name} · R of ${R != null ? fmt.plain(R) : '—'} risk${lead.partial ? ' · recorded from part-way through' : ''}</span></div>
      ${lead.mae_r != null || lead.mfe_r != null ? html`<${PathChart} i=${i} lead=${lead} res=${res}/>        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:4px">
          <div class="box"><div class="cap">Worst point</div><div class="num neg" style="font-size:16px;font-weight:600;margin-top:3px">${fmt.r(Math.min(0, lead.mae_r))} <span class="sub">${fmt.money(Math.min(0, lead.mae))}</span></div><div class="sub">${lead.mae > 0 ? 'never below entry' : after(lead.mae_t)}</div></div>
          <div class="box"><div class="cap">Best point</div><div class=${cls('num', sgn(lead.mfe_r))} style="font-size:16px;font-weight:600;margin-top:3px">${fmt.r(lead.mfe_r)} <span class="sub">${fmt.money(lead.mfe)}</span></div><div class="sub">${after(lead.mfe_t)}</div></div>
          <div class="box"><div class="cap">Kept of the best</div><div class="num" style="font-size:16px;font-weight:600;margin-top:3px">${res > 0 && lead.mfe_r > 0 ? Math.round(Math.min(1, res / lead.mfe_r) * 100) + '%' : '—'}</div><div class="sub">${res > 0 && lead.mfe_r > 0 ? `gave back ${Math.max(0, lead.mfe_r - res).toFixed(2)}R` : lead.mfe_r > 0 ? `ended at a loss after +${lead.mfe_r.toFixed(2)}R` : 'never in profit'}</div></div>
          <div class="box"><div class="cap">Went against you first?</div><div style="font-size:15px;font-weight:600;margin-top:3px">${lead.mae_t && lead.mfe_t ? (lead.mae_t < lead.mfe_t ? 'Yes' : 'No') : '—'}</div><div class="sub">${lead.mae_r != null ? (lead.mae_r > -0.25 ? 'little heat (under 0.25R)' : lead.mae_r <= -0.9 ? 'close to the stop' : 'normal heat') : ''}</div></div>
        </div>` : html`<div class="sub">The drawdown and best point weren't recorded (the connector wasn't running during the trade).</div>`}
      <div class="sub">Combined floating P&L of all positions on ${lead.name}, checked every second while the trade was open.</div>
    </section>
    ${list.filter((a) => a.steps && a.steps.length).map((a) => html`<section class="card flush">
      <div class="card-head"><div><h2 class="h2">Risk while the idea was open · ${a.name}</h2>
        <div class="sub" style="margin-top:4px">Risk used: <b class="num" style="color:var(--text)">${a.peak != null ? fmt.plain(a.peak) : '—'}</b> (highest held for ${d.graceSec} s or more)${a.initial != null ? ` · first stops added up: ${fmt.plain(a.initial)}` : ''}${a.transient != null && a.transient > (a.peak || 0) + 0.01 ? ` · brief high ${fmt.plain(a.transient)} not counted` : ''}</div></div></div>
      <div class="scroll"><table class="tbl"><thead><tr><th>Time</th><th>Position</th><th>What changed</th><th class="r">S/L</th><th class="r">Lots</th><th class="r">Open risk, all positions</th></tr></thead>
      <tbody>${(() => { const prev = new Map(); return a.steps.map((st) => {
        let what = st.kind === 'open' ? 'Opened' : st.kind === 'close' ? 'Closed' : '';
        if (st.kind === 'sl') {
          const pr = prev.get(st.position_id);
          what = st.risk == null ? 'No S/L' : st.risk === 0 ? 'S/L at or past entry' : pr === undefined ? 'S/L recorded'
            : pr == null ? 'S/L added' : st.risk < pr - 0.005 ? 'S/L moved in (less risk)' : st.risk > pr + 0.005 ? 'S/L moved out or size added' : 'Size changed';
          prev.set(st.position_id, st.risk);
        }
        return html`<tr><td class="num">${fmt.timeS(st.t)}</td><td class="num">#${st.position_id}</td>
          <td>${what}${st.kind === 'sl' && st.risk > 0 ? html` <span class="sub num">${fmt.plain(st.risk)}</span>` : ''}</td>
          <td class="num r">${st.sl ? fmt.num(st.sl, 5) : '—'}</td><td class="num r">${st.volume ? fmt.num(st.volume) : '—'}</td>
          <td class="num r" style=${st.total != null && a.peak != null && st.total > a.peak + 0.01 ? 'color:var(--amber)' : ''}>${st.total != null ? fmt.plain(st.total) : 'unknown'}</td></tr>`; }); })()}</tbody></table></div>
    </section>`)}
  </div>`;
}

/** Stop now (or at the close) vs the first stop; flags break-even / locked profit. */
function slCell(p) {
  const cur = p.sl > 0 ? p.sl : null, first = p.initial_sl > 0 ? p.initial_sl : null;
  if (!cur && !first) return html`<span class="chip r">none</span>`;
  const long = p.direction === 'long';
  const safe = cur && (long ? cur >= p.open_price - 1e-9 : cur <= p.open_price + 1e-9);
  const tag = safe ? (Math.abs(cur - p.open_price) < Math.max(1e-9, p.open_price * 2e-5) ? 'break-even' : 'profit locked') : '';
  return html`${cur ? fmt.num(cur, 5) : html`<span class="chip r">removed</span>`}${tag && html` <span class="chip g" style="height:18px;font-size:10.5px">${tag}</span>`}
    ${first && cur !== first ? html`<div class="sub">first ${fmt.num(first, 5)}</div>` : ''}`;
}

function Positions({ d, reload }) {
  const i = d.idea;
  const byAcct = {};
  for (const p of d.positions) (byAcct[p.account_id] ||= []).push(p);
  const leadCount = d.positions.filter((p) => p.account_id === i.account_id).length;
  const act = async (url, msg) => { try { await api(url, { method: 'POST' }); toast(msg); reload(); } catch (e) { toast(e.message, true); } };
  return html`<section class="card flush">
    <div class="card-head"><div><h2 class="h2">Positions</h2><div class="sub" style="margin-top:4px">Original MT5 position IDs. Prices in each broker's own symbol.</div></div></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Account</th><th>Position</th><th>Opened</th><th class="r">Lots</th><th class="r">Entry</th><th class="r" title="Current stop (open) or last stop (closed); the first stop underneath">S/L</th><th class="r">Exit</th><th>Closed</th><th class="r">Gross</th><th class="r">Comm.</th><th class="r">Swap</th><th class="r">Fees</th><th class="r">Net P&L</th><th class="r">R</th><th><span class="sr">Actions</span></th></tr></thead>
    <tbody>${Object.values(byAcct).map((ps) => ps.map((p, k) => html`<tr>
      <td>${k === 0 ? html`<b>${p.account_name}</b>${p.account_id === i.account_id ? html` <span class="chip b">Lead</span>` : p.copy_link === 'twin' ? html` <span class="chip" title="Placed by hand, linked as the same trade">Same trade</span>` : ''}
        ${p.account_id !== i.account_id && !p.master_pos && html`<div><button class="btn sm" style="min-height:26px;margin-top:4px" title="This account's trade is a separate idea: move it out and review it on its own"
          onClick=${async () => { if (!confirm(`Move ${p.account_name}'s positions to a separate idea?`)) return; try { const r = await api('/ideas/' + i.id + '/unlink', { method: 'POST', body: { account_id: p.account_id } }); toast('Moved to its own idea'); reload(); if (r && r.id) location.hash = '#/ideas/' + i.id; } catch (e) { toast(e.message, true); } }}>Separate</button></div>`}` : ''}</td>
      <td class="num">#${p.position_id}${p.master_position_id && html`<div class="sub" title=${p.copy_link === 'comment' ? 'Linked by the copier comment' : p.copy_link === 'match' ? 'Linked by symbol, side and time' : 'Linked by hand'}>copy of #${p.master_position_id}</div>`}</td>
      <td class="num">${fmt.timeS(p.open_time)}<div class="sub">${p.symbol}</div></td>
      <td class="num r">${fmt.num(p.volume)}</td>
      <td class="num r">${fmt.num(p.open_price, 5)}</td>
      <td class="num r">${slCell(p)}</td>
      <td class="num r">${p.close_price != null ? html`${fmt.num(p.close_price, 5)}${p.status === 'open' && p.closed_volume > 0 ? html`<div class="sub" title="Average price of the part already closed">${fmt.num(p.closed_volume)} lots closed</div>` : ''}` : '—'}</td>
      <td class="num">${p.status === 'open' ? html`<span class="chip b">open</span>` : fmt.timeS(p.close_time)}</td>
      <td class="r"><${Money} v=${(p.profit || 0) + (p.status === 'open' ? (p.floating || 0) : 0)}/></td>
      <td class=${cls('num r', p.commission ? sgn(p.commission) : 'mut')}>${fmt.money(p.commission || 0)}</td>
      <td class=${cls('num r', p.swap ? sgn(p.swap) : 'mut')}>${fmt.money(p.swap || 0)}</td>
      <td class=${cls('num r', p.fee ? sgn(p.fee) : 'mut')}>${fmt.money(p.fee || 0)}</td>
      <td class="r">${p.status === 'open' ? html`<${Money} v=${p.net}/><div class="sub">floating</div>` : html`<${Money} v=${p.net}/>`}</td>
      <td class="r"><${R} v=${p.r}/></td>
      <td>${p.account_id === i.account_id
        ? leadCount > 1 && html`<button class="btn sm" onClick=${() => act(`/positions/${p.id}/detach`, 'Moved to a new idea')} title="Move this position (and its copies) to an idea of its own">Remove</button>`
        : p.master_pos && html`<button class="btn sm" onClick=${() => act(`/positions/${p.id}/unlink`, 'Copy unlinked')} title="This copy belongs to another trade">Unlink</button>`}</td>
    </tr>`))}</tbody></table></div></section>`;
}

function Executions({ i }) {
  if (i.accounts.length < 2) return null;
  return html`<section class="card flush">
    <div class="card-head"><div><h2 class="h2">Master idea vs account executions</h2><div class="sub" style="margin-top:4px">Each account's own deals. Totals add up to the combined P&L.</div></div></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Account</th><th class="r">Positions</th><th class="r">Lots</th><th class="r">Risk</th><th class="r">Gross</th><th class="r" title="Commission + swap + fees">Costs</th><th class="r">Net P&L</th><th class="r">R</th><th class="r">vs lead</th></tr></thead>
    <tbody>${i.accounts.map((a) => {
      const lead = i.accounts.find((x) => x.lead);
      const diff = lead && a !== lead && a.r != null && lead.r != null ? a.r - lead.r : null;
      return html`<tr><td style="font-weight:500">${a.name}${a.lead ? ' (lead)' : ''}</td><td class="num r">${a.positions}</td><td class="num r">${fmt.num(a.volume)}</td>
        <td class="num r">${a.risk != null ? fmt.plain(a.risk) : '—'}</td><td class="r"><${Money} v=${a.gross}/></td>
        <td class=${cls('num r', a.costs ? sgn(a.costs) : 'mut')} title=${`Commission ${fmt.money(a.commission)}, swap ${fmt.money(a.swap)}, fees ${fmt.money(a.fee)}`}>${fmt.money(a.costs)}</td><td class="r"><${Money} v=${a.net}/></td><td class="r"><${R} v=${a.r}/></td>
        <td class=${cls('r num', diff != null && Math.abs(diff) >= 0.05 ? 'neg' : 'mut')}>${diff == null ? '—' : (diff >= 0 ? '+' : '−') + Math.abs(diff).toFixed(2) + 'R'}</td></tr>`;
    })}</tbody>
    <tfoot><tr><td style="font-weight:600;padding:12px">Combined</td><td></td><td></td><td></td><td class="r" style="padding:12px"><${Money} v=${i.gross}/></td>
      <td class="r num" style="padding:12px">${fmt.money(i.costs)}</td><td class="r" style="padding:12px"><${Money} v=${i.net}/></td><td></td><td></td></tr></tfoot></table></div></section>`;
}

function Grouping({ d, reload }) {
  const g = d.grouping;
  const i = d.idea;
  const [show, setShow] = useState(false);
  const same = g.nearby.filter((n) => n.sameKind);
  const add = async (n) => { try { await api(`/ideas/${i.id}/positions`, { method: 'POST', body: { position_row_id: n.id } }); toast('Position added'); setShow(false); reload(); } catch (e) { toast(e.message, true); } };
  return html`<section class="card stack">
    <div class="spread"><h2 class="h2">Why these are grouped</h2><button class="btn sm" onClick=${() => setShow(true)}><${Icon} name="plus" size=${14}/>Add position</button></div>
    <div class="grid2">${[
      'Same account, instrument and direction',
      `Each opened within ${g.windowMin} min of the idea's first position`,
      g.requireOverlap ? 'Each overlapped a position that was still open' : 'Overlap not required (setting)',
      'Copies linked to their Master position by the copier (TC:) or by symbol, side and time',
    ].map((t) => html`<div class="well hstack" style="align-items:flex-start;flex-wrap:nowrap;font-size:13px"><span class="pos"><${Icon} name="check" size=${16}/></span><span>${t}</span></div>`)}</div>
    <div class="sub">Moved by hand: ${d.positions.some((p) => p.group_mode === 'manual') ? 'yes, kept as you set it' : 'no'}. Change the window on the <a href="#/settings">Settings</a> page (applies to new trades).</div>
    ${show && html`<${Modal} title="Add a position to this idea" onClose=${() => setShow(false)}>
      <div class="sub">Positions on ${i.lead_name} within 12 hours of this idea. Only ${i.symbol} ${i.direction} positions can be added; copies follow their Master automatically.</div>
      ${g.nearby.length ? html`<div class="scroll"><table class="tbl"><thead><tr><th>Position</th><th>Opened</th><th>Symbol</th><th class="r">Lots</th><th></th></tr></thead><tbody>
        ${g.nearby.map((n) => html`<tr><td class="num">#${n.position_id}</td><td class="num">${fmt.dt(n.open_time)}</td><td>${n.symbol} <${Dir} d=${n.direction}/></td><td class="num r">${fmt.num(n.volume)}</td>
          <td>${n.sameKind ? html`<button class="btn sm pri" onClick=${() => add(n)}>Add</button>` : html`<span class="sub">different trade</span>`}</td></tr>`)}
      </tbody></table></div>` : html`<div class="empty">No other positions nearby.</div>`}
      ${!same.length && g.nearby.length > 0 && html`<div class="sub">None of these match this idea's instrument and direction.</div>`}
    <//>`}
  </section>`;
}

function Audit({ items }) {
  return html`<section class="card"><h2 class="h2" style="margin-bottom:6px">Audit trail</h2>
    <ul style="list-style:none;margin:0;padding:0">${items.map((a) => html`<li style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--line2);font-size:13px">
      <span class="num mut" style="flex:0 0 120px">${fmt.date(a.time)} ${fmt.timeS(a.time)}</span>
      <span><b style="font-weight:500">${a.action}</b>${a.detail && html`<span class="mut"> · ${a.detail}</span>`}<span class="sub"> · ${a.actor}</span></span></li>`)}</ul></section>`;
}

const EMOTIONS = ['Calm', 'Confident', 'Impatient', 'Anxious', 'FOMO', 'Frustrated', 'Tired'];

function Review({ d, reload }) {
  const s = useStore();
  const i = d.idea;
  const [notes, setNotes] = useState(i.notes || '');
  const [dirty, setDirty] = useState(false);
  const [checks, setChecks] = useState(Object.fromEntries(d.checklist.map((c) => [c.id, c.checked])));
  const [mist, setMist] = useState(new Set(d.mistakes));
  const [rating, setRating] = useState(i.rating);
  const save = async (body, msg) => { try { await api('/ideas/' + i.id, { method: 'PUT', body }); if (msg) toast(msg); return true; } catch (e) { toast(e.message, true); return false; } };
  const toggleCheck = async (c) => {
    const v = !checks[c.id];
    setChecks({ ...checks, [c.id]: v });
    try { await api(`/ideas/${i.id}/checks`, { method: 'PUT', body: { item_id: c.id, checked: v } }); } catch (e) { toast(e.message, true); }
  };
  const toggleMistake = async (id) => {
    const n = new Set(mist); n.has(id) ? n.delete(id) : n.add(id); setMist(n);
    try { await api(`/ideas/${i.id}/mistakes`, { method: 'PUT', body: { ids: [...n] } }); } catch (e) { toast(e.message, true); }
  };
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(async () => { if (await save({ notes })) setDirty(false); }, 1200);
    return () => clearTimeout(t);
  }, [notes, dirty]);
  const done = d.checklist.filter((c) => checks[c.id]).length;
  return html`<div class="stack" style="gap:14px">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
      <div class="stack" style="gap:10px">
        <div class="field"><label class="lbl" for="rstrat">Strategy</label>
          <select id="rstrat" class="inp sm" style="width:100%" value=${i.strategy_id || ''} onChange=${async (e) => { if (await save({ strategy_id: e.target.value || null })) reload(); }}>
            <option value="">— choose —</option>${s.boot.strategies.filter((x) => !x.archived || x.id === i.strategy_id).map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select></div>
        ${i.strategy_id ? html`<div class="stack" style="gap:0">
          <div class="spread"><span class="lbl">Per-trade checklist</span><span class=${cls('chip num', done === d.checklist.length ? 'g' : 'a')}>${done} / ${d.checklist.length}</span></div>
          <div class="box" style="padding:2px 12px;margin-top:6px">${d.checklist.map((c) => html`<label class="ck" style="min-height:36px;font-size:13px"><input type="checkbox" checked=${!!checks[c.id]} onChange=${() => toggleCheck(c)}/><span>${c.label}</span></label>`)}
          ${!d.checklist.length && html`<div class="sub" style="padding:8px 0">This strategy has no per-trade checklist yet.</div>`}</div></div>` : html`<div class="sub">Choose a strategy to fill in its checklist.</div>`}
      </div>
      <div class="stack" style="gap:14px">
        <div class="field"><span class="lbl">Execution rating</span>
          <div class="stars" role="group" aria-label="Execution rating">${[1, 2, 3, 4, 5].map((v) => html`<button type="button" class=${v <= (rating || 0) ? 'on' : ''} aria-label=${'Rate ' + v + ' of 5'} aria-pressed=${v === rating}
            onClick=${async () => { const nv = v === rating ? null : v; setRating(nv); await save({ rating: nv }); }}><${Icon} name="star" size=${20} fill=${v <= (rating || 0)}/></button>`)}</div></div>
        <div class="field"><span class="lbl">Mistakes</span><div class="hstack" style="gap:6px">
          ${s.boot.mistakes.filter((m) => m.active || mist.has(m.id)).map((m) => html`<button type="button" class=${cls('pill', mist.has(m.id) && 'on')} style=${mist.has(m.id) ? 'background:#3A1A1E;border-color:#6A2A31;color:#FF9AA2' : ''} aria-pressed=${mist.has(m.id)} onClick=${() => toggleMistake(m.id)}>${m.label}</button>`)}</div></div>
        <div class="field"><label class="lbl" for="emo">How you felt</label>
          <select id="emo" class="inp sm" value=${i.emotion || ''} onChange=${(e) => save({ emotion: e.target.value || null })}><option value="">—</option>${EMOTIONS.map((x) => html`<option>${x}</option>`)}</select></div>
      </div>
    </div>
    <div class="field"><label class="lbl" for="notes">Notes ${dirty ? html`<span class="sub">· saving…</span>` : ''}</label>
      <textarea id="notes" class="inp" value=${notes} onInput=${(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="What did you see? What did you do? What would you do differently?"></textarea></div>
  </div>`;
}

const TFS = ['M1', 'M3', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'];

/** TradingView snapshot links (tradingview.com/x/ID/) have a public image we can show as a preview. */
function tvPreview(url) {
  const m = /tradingview\.com\/x\/([A-Za-z0-9]+)/.exec(url || '');
  return m ? `https://s3.tradingview.com/snapshots/${m[1][0].toLowerCase()}/${m[1]}.png` : null;
}

function TfSelect({ id, value, onChange }) {
  const custom = value && !TFS.includes(value);
  return html`<select id=${id} class="inp" value=${value || ''} onChange=${(e) => onChange(e.target.value)}>
    <option value="">Timeframe…</option>${TFS.map((t) => html`<option value=${t}>${t}</option>`)}${custom && html`<option value=${value}>${value}</option>`}</select>`;
}

function Chart({ d, reload }) {
  const i = d.idea;
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState(null);
  const [tfUpload, setTfUpload] = useState('');
  const fileRef = useRef();
  const upload = async (files) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setBusy(true);
    for (const f of list) {
      const fd = new FormData(); fd.append('file', f, f.name || 'screenshot.png');
      if (tfUpload) fd.append('timeframe', tfUpload);
      try { await api(`/ideas/${i.id}/screenshots`, { method: 'POST', body: fd }); } catch (e) { toast(e.message, true); }
    }
    setBusy(false); toast('Screenshot added'); reload();
  };
  useEffect(() => { if (pendingPaste) { const f = pendingPaste; pendingPaste = null; upload(f); } }, []);
  useEffect(() => {
    const onPaste = (e) => { if (e.clipboardData && e.clipboardData.files.length && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) upload(e.clipboardData.files); };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [i.id, tfUpload]);
  const sample = store.mode === 'sample';
  return html`<section class="stack" style="gap:18px">
    <div class="stack" style="gap:10px">
      <span class="lbl">Screenshots</span>
      ${d.screenshots.length > 0 && html`<div class="shots">${d.screenshots.map((sh) => html`<${Shot} sh=${sh} onOpen=${() => setBig(sh.id)} reload=${reload}/>`)}</div>`}
      ${sample ? html`<div class="sub">Screenshots are turned off for sample data. Switch to “My data” to add them.</div>` : html`
      <div class="hstack"><label class="lbl" for="tfu">Timeframe for new uploads</label><${TfSelect} id="tfu" value=${tfUpload} onChange=${setTfUpload}/></div>
      <div class=${cls('drop', over && 'over')} onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
        onDrop=${(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}>
        ${busy ? 'Uploading…' : html`Drop chart screenshots here, paste one (Ctrl+V), or <button class="btn sm" onClick=${() => fileRef.current.click()}>choose files</button>`}
        <input id="shotfile" ref=${fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange=${(e) => upload(e.target.files)}/></div>`}
    </div>
    <div style="border-top:1px solid var(--line2);padding-top:14px"><${Links} d=${d} reload=${reload}/></div>
    ${big && html`<div class="lightbox" onClick=${() => setBig(null)}><img src=${'/api/screenshots/' + big} alt="Screenshot"/></div>`}
  </section>`;
}

function Shot({ sh, onOpen, reload }) {
  const [tf, setTf] = useState(sh.timeframe || '');
  const [cap, setCap] = useState(sh.caption || '');
  const save = async (patch) => { try { await api('/screenshots/' + sh.id, { method: 'PUT', body: { timeframe: tf, caption: cap, ...patch } }); } catch (e) { toast(e.message, true); } };
  return html`<div class="stack" style="gap:6px">
    <div class="shot"><img src=${'/api/screenshots/' + sh.id} alt=${(sh.timeframe ? sh.timeframe + ' ' : '') + (sh.caption || sh.filename || 'Screenshot')} loading="lazy" onClick=${onOpen}/>
      ${sh.timeframe && html`<span class="chip b" style="position:absolute;left:6px;top:6px">${sh.timeframe}</span>`}
      <button class="btn sm" aria-label="Delete screenshot" onClick=${async () => { if (!confirm('Delete this screenshot?')) return; try { await api('/screenshots/' + sh.id, { method: 'DELETE' }); reload(); } catch (e) { toast(e.message, true); } }}><${Icon} name="trash" size=${14}/></button></div>
    <div class="hstack" style="flex-wrap:nowrap;gap:6px"><label class="sr" for=${'stf' + sh.id}>Timeframe</label>
      <${TfSelect} id=${'stf' + sh.id} value=${tf} onChange=${(v) => { setTf(v); save({ timeframe: v }); }}/>
      <label class="sr" for=${'scap' + sh.id}>Note</label><input id=${'scap' + sh.id} class="inp" placeholder="Note" value=${cap} onInput=${(e) => setCap(e.target.value)} onBlur=${() => cap !== (sh.caption || '') && save({ caption: cap })}/></div>
  </div>`;
}

function Links({ d, reload }) {
  const i = d.idea;
  const blank = { url: '', timeframe: '', note: '' };
  const [n, setN] = useState(blank);
  const [edit, setEdit] = useState(null);
  const add = async (e) => {
    e.preventDefault();
    try { await api(`/ideas/${i.id}/links`, { method: 'POST', body: n }); setN(blank); toast('Chart link added'); reload(); } catch (err) { toast(err.message, true); }
  };
  const saveEdit = async (e) => {
    e.preventDefault();
    try { await api('/links/' + edit.id, { method: 'PUT', body: edit }); setEdit(null); reload(); } catch (err) { toast(err.message, true); }
  };
  const del = async (l) => { if (!confirm('Delete this link?')) return; try { await api('/links/' + l.id, { method: 'DELETE' }); reload(); } catch (err) { toast(err.message, true); } };
  return html`<div class="stack" style="gap:10px">
    <span class="lbl">TradingView links</span>
    ${d.links.map((l) => edit && edit.id === l.id ? html`<form class="well stack" style="gap:8px" onSubmit=${saveEdit}>
        <input class="inp" aria-label="Link" value=${edit.url} onInput=${(e) => setEdit({ ...edit, url: e.target.value })}/>
        <div class="hstack" style="flex-wrap:nowrap"><${TfSelect} id=${'etf' + l.id} value=${edit.timeframe} onChange=${(v) => setEdit({ ...edit, timeframe: v })}/>
          <input class="inp" aria-label="Note" placeholder="Note" value=${edit.note || ''} onInput=${(e) => setEdit({ ...edit, note: e.target.value })}/></div>
        <div class="hstack"><button class="btn sm pri" type="submit">Save</button><button class="btn sm" type="button" onClick=${() => setEdit(null)}>Cancel</button></div></form>`
      : html`<div class="well hstack" style="flex-wrap:nowrap;align-items:flex-start;gap:12px">
        ${tvPreview(l.url) && html`<a href=${l.url} target="_blank" rel="noopener noreferrer" style="flex:0 0 120px"><img src=${tvPreview(l.url)} alt="Chart preview" loading="lazy" style="width:120px;border-radius:8px;display:block" onError=${(e) => { e.target.style.display = 'none'; }}/></a>`}
        <div class="stack" style="gap:4px;flex:1;min-width:0">
          <div class="hstack" style="gap:8px">${l.timeframe ? html`<span class="chip b">${l.timeframe}</span>` : html`<span class="chip">No timeframe</span>`}
            <a href=${l.url} target="_blank" rel="noopener noreferrer" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${l.url.replace(/^https:\/\/(www\.)?/, '')}</a></div>
          ${l.note && html`<span class="sub" style="font-size:13px;color:var(--text2)">${l.note}</span>`}</div>
        <div class="hstack" style="flex-wrap:nowrap"><button class="btn sm ghost" aria-label="Edit link" onClick=${() => setEdit({ id: l.id, url: l.url, timeframe: l.timeframe || '', note: l.note || '' })}><${Icon} name="edit" size=${14}/></button>
          <button class="btn sm ghost" aria-label="Delete link" onClick=${() => del(l)}><${Icon} name="trash" size=${14}/></button></div></div>`)}
    <form class="stack" style="gap:8px" onSubmit=${add}>
      <label class="sr" for="tvn">TradingView link</label>
      <input id="tvn" class="inp" placeholder="https://www.tradingview.com/x/…" value=${n.url} onInput=${(e) => setN({ ...n, url: e.target.value })}/>
      <div class="hstack" style="flex-wrap:nowrap"><${TfSelect} id="tvtf" value=${n.timeframe} onChange=${(v) => setN({ ...n, timeframe: v })}/>
        <label class="sr" for="tvnote">Note</label><input id="tvnote" class="inp" placeholder="Note (e.g. entry, context)" value=${n.note} onInput=${(e) => setN({ ...n, note: e.target.value })}/>
        <button class="btn" type="submit" disabled=${!n.url.trim()}>Add</button></div>
      <div class="sub">In TradingView: camera icon → “Copy link to the chart image”. Snapshot links show a preview.</div>
    </form>
  </div>`;
}
