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
  const today = todayBne();
  const from = range === 'all' ? '' : addDays(today, -(Number(range) - 1));
  const qs = `${scopeQs()}&from=${from}&strategy=${strategy}&limit=500`;
  const st = useData(() => api('/ideas?' + qs), [qs]);
  const csv = '/api/export/ideas.csv?' + scopeQs() + (s.mode === 'sample' ? '&mode=sample' : '');
  const all = st.data ? st.data.items : [];
  const mist = Object.fromEntries(s.boot.mistakes.map((m) => [m.id, m.label]));
  const needle = q.trim().toLowerCase();
  const base = needle ? all.filter((i) => [i.symbol, i.strategy_name, i.direction, i.lead_name, ...i.mistakes.map((m) => mist[m])].join(' ').toLowerCase().includes(needle)) : all;
  const list = base.filter((i) => status === 'all' || statusOf(i) === status);
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
          <a href="#/analytics" class="btn sm">More filters</a>
        </div>
        <div class="gr gh ig" style="grid-template-columns:${GRID}"><span>Opened</span><span>Idea · strategy</span><span class="r">Held</span><span class="r">R</span><span class="r">P&L</span><span class="hide-sm">Rating</span><span>Status</span></div>
        <div class="scrolly">
          ${st.error ? html`<div class="warn err" style="margin:12px">${st.error}</div>` : !st.data ? html`<div class="empty">Loading…</div>`
            : list.map((i) => html`<${Row} i=${i} on=${i.id === selId}/>`)}
          ${st.data && !list.length && html`<div class="empty">No ideas match. Clear the search or pick another period.</div>`}
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

const TABS = [['review', 'Review'], ['pos', 'Positions & accounts'], ['chart', 'Charts & links'], ['log', 'Activity']];

function IdeaPanel({ id, prev, next, reloadList }) {
  const st = useData(() => api('/ideas/' + id), [id]);
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('tj.ideaTab') || 'review'; } catch { return 'review'; } });
  const pickTab = (t) => { setTab(t); try { sessionStorage.setItem('tj.ideaTab', t); } catch { /* ignore */ } };
  if (st.error) return html`<div class="warn err" style="margin:14px">${st.error}</div>`;
  if (!st.data) return html`<div class="empty">Loading…</div>`;
  const d = st.data, i = d.idea;
  const reload = () => { st.reload(); reloadList(); };
  const lead = d.positions.filter((p) => p.account_id === i.account_id);
  const leadAcc = i.accounts.find((a) => a.lead) || i.accounts[0];
  const done = d.checklist.filter((c) => c.checked).length;
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
        <div class="hstack" style="margin-left:auto;gap:6px">
          <button type="button" class="btn sm" aria-label="Newer idea" disabled=${!prev} onClick=${prev}><${Icon} name="back" size=${15}/></button>
          <button type="button" class="btn sm" aria-label="Older idea" disabled=${!next} onClick=${next}><${Icon} name="chev" size=${15}/></button>
          ${i.status === 'closed' && html`<button type="button" class=${cls('btn sm', !i.reviewed_at && 'pri')} onClick=${toggleReviewed}>${i.reviewed_at ? 'Reviewed ✓ (undo)' : html`<${Icon} name="check" size=${15}/>Mark reviewed`}</button>`}</div></div>
      <div class="sub" style="font-size:12.5px">${fmt.dateY(i.open_time)} · ${fmt.time(i.open_time)} → ${i.close_time ? fmt.time(i.close_time) + (fmt.date(i.close_time) !== fmt.date(i.open_time) ? ' next day' : '') + ' AEST · held ' + fmt.dur(i.close_time - i.open_time) : 'still open'}
        · ${lead.length} position${lead.length > 1 ? 's' : ''} on ${i.lead_name}${i.accounts.length > 1 ? ` · copied to ${i.accounts.length - 1} account${i.accounts.length > 2 ? 's' : ''}` : ''}</div>
    </div>
    <div class="mstrip">
      <div class="kcell"><div class="cap">${i.accounts.length > 1 ? 'Combined P&L' : 'Net P&L'}</div><div class=${cls('num', sgn(i.net))} style="font-size:17px;font-weight:600;margin-top:5px">${fmt.money(i.net)}</div><div class="sub">${i.status === 'open' ? 'floating' : 'after costs'}</div></div>
      <div class="kcell"><div class="cap">Result</div><div class=${cls('num', sgn(leadAcc.r))} style="font-size:17px;font-weight:600;margin-top:5px">${fmt.r(leadAcc.r)}</div><div class="sub">${i.lead_name}</div></div>
      <div class="kcell"><div class="cap">Initial risk</div><div class="num" style="font-size:17px;font-weight:600;margin-top:5px">${leadAcc.risk != null ? fmt.plain(leadAcc.risk) : '—'}</div><div class="sub">${leadAcc.risk == null ? 'no S/L seen' : 'lead account'}</div></div>
      <div class="kcell"><div class="cap">Costs</div><div class=${cls('num', sgn(i.costs))} style="font-size:17px;font-weight:600;margin-top:5px">${fmt.money(i.costs)}</div><div class="sub">comm. · swap · fees</div></div>
      <div class="kcell"><div class="cap">Checklist</div><div class="num" style="font-size:17px;font-weight:600;margin-top:5px">${d.checklist.length ? done + ' / ' + d.checklist.length : '—'}</div><div class="sub">${!i.strategy_id ? 'no strategy' : d.checklist.length - done ? (d.checklist.length - done) + ' not ticked' : 'all ticked'}</div></div>
    </div>
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => html`<button type="button" role="tab" class=${cls('tab', tab === k && 'on')} aria-selected=${tab === k} onClick=${() => pickTab(k)}>${l}</button>`)}</div>
    <div class="scrolly tabbody" style="padding:14px 16px 16px">
      ${leadAcc.risk == null && i.status === 'closed' && html`<div class="warn" style="margin-bottom:12px">R can't be worked out: at least one position had no stop-loss when the connector first saw it.</div>`}
      ${tab === 'review' && html`<${Review} d=${d} reload=${reload}/>`}
      ${tab === 'pos' && html`<div class="stack" style="gap:18px"><${Positions} d=${d} reload=${reload}/><${Executions} i=${i}/><${Grouping} d=${d} reload=${reload}/></div>`}
      ${tab === 'chart' && html`<${Chart} d=${d} reload=${reload}/>`}
      ${tab === 'log' && html`<${Audit} items=${d.audit}/>`}
    </div>`;
}

function Positions({ d, reload }) {
  const i = d.idea;
  const byAcct = {};
  for (const p of d.positions) (byAcct[p.account_id] ||= []).push(p);
  const leadCount = d.positions.filter((p) => p.account_id === i.account_id).length;
  const act = async (url, msg) => { try { await api(url, { method: 'POST' }); toast(msg); reload(); } catch (e) { toast(e.message, true); } };
  return html`<section class="card flush">
    <div class="card-head"><div><h2 class="h2">Positions</h2><div class="sub" style="margin-top:4px">Original MT5 position IDs. Prices in each broker's own symbol.</div></div></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Account</th><th>Position</th><th>Opened</th><th class="r">Lots</th><th class="r">Entry</th><th class="r">Initial S/L</th><th class="r">Exit</th><th>Closed</th><th class="r">Gross</th><th class="r">Comm.</th><th class="r">Swap</th><th class="r">Fees</th><th class="r">Net P&L</th><th class="r">R</th><th><span class="sr">Actions</span></th></tr></thead>
    <tbody>${Object.values(byAcct).map((ps) => ps.map((p, k) => html`<tr>
      <td>${k === 0 ? html`<b>${p.account_name}</b>${p.account_id === i.account_id ? html` <span class="chip b">Lead</span>` : ''}` : ''}</td>
      <td class="num">#${p.position_id}${p.master_position_id && html`<div class="sub" title=${p.copy_link === 'comment' ? 'Linked by the copier comment' : p.copy_link === 'match' ? 'Linked by symbol, side and time' : 'Linked by hand'}>copy of #${p.master_position_id}</div>`}</td>
      <td class="num">${fmt.timeS(p.open_time)}<div class="sub">${p.symbol}</div></td>
      <td class="num r">${fmt.num(p.volume)}</td>
      <td class="num r">${fmt.num(p.open_price, 5)}</td>
      <td class="num r">${p.initial_sl ? fmt.num(p.initial_sl, 5) : html`<span class="chip r">none</span>`}</td>
      <td class="num r">${p.close_price != null ? fmt.num(p.close_price, 5) : '—'}</td>
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
  useEffect(() => {
    const onPaste = (e) => { if (e.clipboardData && e.clipboardData.files.length && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) upload(e.clipboardData.files); };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [i.id, tfUpload]);
  const sample = store.mode === 'sample';
  return html`<section class="stack">
    <${Links} d=${d} reload=${reload}/>
    <div class="stack" style="gap:10px;border-top:1px solid var(--line2);padding-top:14px">
      <span class="lbl">Screenshots</span>
      ${d.screenshots.length > 0 && html`<div class="shots">${d.screenshots.map((sh) => html`<${Shot} sh=${sh} onOpen=${() => setBig(sh.id)} reload=${reload}/>`)}</div>`}
      ${sample ? html`<div class="sub">Screenshots are turned off for sample data.</div>` : html`
      <div class="hstack"><label class="lbl" for="tfu">Timeframe for new uploads</label><${TfSelect} id="tfu" value=${tfUpload} onChange=${setTfUpload}/></div>
      <div class=${cls('drop', over && 'over')} onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
        onDrop=${(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}>
        ${busy ? 'Uploading…' : html`Drop chart screenshots here, paste one (Ctrl+V), or <button class="btn sm" onClick=${() => fileRef.current.click()}>choose files</button>`}
        <input ref=${fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange=${(e) => upload(e.target.files)}/></div>`}
    </div>
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
