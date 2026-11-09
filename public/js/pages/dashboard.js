import { html, useState, useEffect, useStore, useData, api, scopeQs, fmt, sgn, cls, Money, R, Dir, Bar, Loading, LineChart, PageHead, toast, store, setStore, reloadBoot, kindLabel, roleLabel } from '../lib.js';
import { sessionsInBrisbane, openSessions, SESSIONS, tzOffsetMs } from '../sessions.js';

const COLORS = ['#5B8CFF', '#F5A524', '#2EC4B6', '#C38BFF', '#FF8FB1'];
const DASHES = ['', '7 5', '2 4', '10 4 2 4', '4 4'];

export function SampleEmpty() {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  if (s.mode !== 'sample' || s.boot.sampleLoaded) return null;
  return html`<div class="card stack" style="max-width:640px">
    <h2 class="h2">Sample data isn't loaded</h2>
    <p class="mut" style="margin:0">It creates three made-up accounts (a Master and two copies) with about five weeks of trades. Your real data isn't touched.</p>
    <div class="hstack"><button class="btn pri" disabled=${busy} onClick=${async () => { setBusy(true); try { await api('/sample', { method: 'POST' }); await reloadBoot(); } catch (e) { toast(e.message, true); } setBusy(false); }}>${busy ? 'Loading…' : 'Load sample data'}</button>
    <button class="btn" onClick=${() => setStore({ mode: 'live' })}>Back to my data</button></div></div>`;
}

export function Dashboard() {
  const s = useStore();
  const st = useData(() => api('/dashboard?' + scopeQs()), [s.acct, s.firm]);
  const sub = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()) + ' AEST';
  return html`<${PageHead} title="Dashboard" sub=${sub}>${st.data && html`<${AlertPill} accounts=${st.data.accounts}/>`}<//>
    <${SampleEmpty}/>
    <${Loading} state=${st}>${(d) => html`<${Body} d=${d} reload=${st.reload}/>`}<//>`;
}

function Body({ d, reload }) {
  const combined = d.accounts.length > 1;
  const showToday = d.lastDay === d.today;
  const ls = d.lastDaySummary;
  const s30 = d.stats30;
  const toReview = d.recent.filter((i) => !i.reviewed).length;
  const ideas = [...d.open, ...d.recent];
  return html`
  <section class="kstrip" aria-label="Key figures">
    <${Cell} label=${showToday ? 'Today' : d.lastDay ? 'Last session · ' + fmt.date(Date.parse(d.lastDay + 'T12:00:00+10:00')).split(' ')[0].replace(',', '') : 'Last session'}
      value=${fmt.money(d.lastDayNet)} tone=${sgn(d.lastDayNet)}
      sub=${ls ? `${ls.wins}W ${ls.losses}L${combined ? ' · R-basis ' + fmt.money(d.lastDayBasis) : ''}` : 'No closed trades yet'}/>
    <${Cell} label="This month" value=${fmt.money(d.monthNet)} tone=${sgn(d.monthNet)} sub=${`${d.monthSummary.count} ideas${combined ? ' · R-basis ' + fmt.money(d.monthBasis, 0) : ''}`}/>
    <${Cell} label="Win rate · 30d" value=${fmt.rate(s30.winRate)} sub=${`${s30.wins} of ${s30.wins + s30.losses} ideas`}>
      <div class="bar" style="margin-top:6px"><i style=${`width:${Math.round((s30.winRate || 0) * 100)}%`}></i></div><//>
    <${Cell} label="Profit factor · 30d" value=${fmt.pf(s30)} sub=${`${fmt.plain(s30.grossWin, 0)} won · ${fmt.plain(s30.grossLoss, 0)} lost`}/>
    <${Cell} label="Expectancy · 30d" value=${fmt.r(s30.expectancyR)} tone=${sgn(s30.expectancyR)} sub=${`≈ ${fmt.money(s30.expectancy)} per idea`}/>
    <${Cell} label="Max drawdown" value=${d.drawdown ? fmt.pct(-d.drawdown.maxDdPct) : '—'} tone=${d.drawdown && d.drawdown.maxDdPct ? 'neg' : ''}
      sub=${d.drawdown ? `${fmt.money(-d.drawdown.maxDd)} · ${d.drawdown.account}` : '—'}/>
  </section>

  <div class="dash3 fill">
    <div class="colstack">
      <section class="panel" style="flex:0 0 42%;min-height:260px">
        <div class="ph"><h2>Return by account · this month</h2>
          <div class="hstack" style="gap:12px;font-size:11.5px;color:var(--text2)">${d.accounts.slice(0, 5).map((a, i) => html`<span class="hstack" style="gap:5px">
            <i style=${`width:14px;height:0;border-top:2px ${DASHES[i % 5] ? 'dashed' : 'solid'} ${COLORS[i % 5]};display:inline-block`}></i>${a.name}
            <b class=${cls('num', sgn(a.monthPct))}>${fmt.pct(a.monthPct)}</b></span>`)}</div></div>
        <div class="pb" style="flex:1;min-height:0;display:flex;align-items:center">
          <${LineChart} height=${230} label="Return by account this month" yFmt=${(v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%'}
            series=${d.accounts.map((a, i) => ({ name: a.name, color: COLORS[i % 5], dash: DASHES[i % 5], points: [{ x: firstOfMonth(), y: 0 }, ...a.curve.map((p) => ({ x: p.t, y: p.pct }))] }))}
            xLabels=${monthLabels()}/></div>
      </section>
      <section class="panel" style="flex:1;min-height:280px">
        <div class="ph"><h2>Recent trading ideas</h2><div class="hstack" style="gap:10px"><span class="sub">${d.open.length} open · ${toReview} to review</span><a href="#/ideas" style="font-size:12px">All ideas</a></div></div>
        <div class="scrolly" style="padding:0 6px 6px">${ideas.length ? html`<${IdeaTable} ideas=${ideas} compact/>` : html`<div class="empty">No trades yet. They appear here as soon as the MT5 connector sends them.</div>`}</div>
      </section>
    </div>

    <div class="colstack">
      <${Prep} prep=${d.prep} reload=${reload}/>
      <${Sessions}/>
      <${ProfitSplit} payouts=${d.payouts}/>
    </div>

    <div class="colstack wide2">
      <${EconCalendar}/>
      <${AccountsPanel} accounts=${d.accounts}/>
    </div>
  </div>`;
}

function Cell({ label, value, sub, tone, children }) {
  return html`<div class="kcell"><div class="cap">${label}</div><div class=${cls('kv num', tone)}>${value}</div>${sub && html`<div class="sub">${sub}</div>`}${children}</div>`;
}

function firstOfMonth() {
  const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date()).slice(0, 8) + '01';
  return Date.parse(t + 'T00:00:00+10:00');
}
function monthLabels() {
  const s = firstOfMonth(), out = [];
  const end = Date.now();
  for (let t = s; t <= end - 86400000; t += 86400000) out.push({ x: t, label: fmt.date(t).replace(/^\w+,? /, '') });
  out.push({ x: end, label: 'now' });
  return out;
}

const LEVEL_COLOR = { ok: 'var(--pos)', warn: 'var(--amber)', danger: '#FF8A4C', breached: 'var(--neg)' };

/** Daily loss / max loss / target bars from the prop-rule monitor. */
export function PropBars({ p, wide, compact }) {
  if (!p) return null;
  if (p.missing) return html`<div class="sub">${p.missing}</div>`;
  if (compact) {
    const cells = p.rules.map((r) => ({ l: r.key === 'daily' ? 'Daily' : r.key === 'max' ? 'Max loss' : r.label, v: Math.round(r.pct) + '%', pct: r.pct, c: LEVEL_COLOR[r.level], hot: r.level !== 'ok', tip: `${r.label}: ${fmt.plain(r.used, 0)} of ${fmt.plain(r.limit, 0)} · room ${fmt.plain(r.room, 0)}` }));
    if (p.target) cells.push({ l: 'Target', v: Math.round(p.target.pct) + '%', pct: p.target.pct, c: p.target.reached ? 'var(--pos)' : 'var(--blue)', tip: `${p.target.label}: ${fmt.money(p.target.made, 0)} of ${fmt.plain(p.target.target, 0)}` });
    return html`<div style=${`display:grid;grid-template-columns:repeat(${Math.max(cells.length, 1)},minmax(0,1fr));gap:12px`}>${cells.map((c) => html`<div title=${c.tip}>
      <div class="sub" style="display:flex;justify-content:space-between;gap:6px"><span>${c.l}</span><span class="num" style=${c.hot ? `color:${c.c}` : ''}>${c.v}</span></div>
      <div class="bar" style="margin-top:5px;height:5px"><i style=${`width:${Math.max(1.5, Math.min(100, c.pct))}%;background:${c.c}`}></i></div></div>`)}</div>`;
  }
  return html`<div class=${wide ? '' : 'stack'} style=${wide ? 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 24px' : 'gap:8px'}>
    ${p.rules.map((r) => html`<div class="stack" style="gap:5px">
      <div class="spread sub"><span>${r.label}</span><span class="num">${fmt.plain(r.used, 0)} of ${fmt.plain(r.limit, 0)} · ${Math.round(r.pct)}%</span></div>
      <${Bar} pct=${r.pct} color=${LEVEL_COLOR[r.level]}/>
      ${r.level !== 'ok' && html`<div class="sub" style=${`color:${LEVEL_COLOR[r.level]}`}>Room left ${fmt.plain(r.room, 0)} · floor ${fmt.plain(r.floor, 0)}</div>`}</div>`)}
    ${p.target && html`<div class="stack" style="gap:5px"><div class="spread sub"><span>${p.target.label}</span>
      <span class="num">${fmt.money(p.target.made, 0)} of ${fmt.plain(p.target.target, 0)} · ${Math.round(p.target.pct)}%</span></div>
      <${Bar} pct=${p.target.pct} color=${p.target.reached ? 'var(--pos)' : 'var(--blue)'}/></div>`}
    ${p.stale && html`<div class="sub">Equity as of ${fmt.ago(p.last_seen)} (terminal not sending)</div>`}
  </div>`;
}

const hotness = (a) => (a.prop && a.prop.rules ? Math.max(0, ...a.prop.rules.map((r) => r.pct)) : -1);

/** Short warning in the page header when an account is close to a rule. */
function AlertPill({ accounts }) {
  const hot = accounts.filter((a) => a.prop && a.prop.level && a.prop.level !== 'ok');
  if (!hot.length) return null;
  const bad = hot.some((a) => a.prop.level === 'breached' || a.prop.level === 'danger');
  const rules = hot.flatMap((a) => a.prop.rules.filter((r) => r.level !== 'ok').map((r) => ({ a, r })));
  const top = rules.sort((x, y) => y.r.pct - x.r.pct)[0];
  const text = `${top.r.label} ${Math.round(top.r.pct)}% on ${top.a.name}${rules.length > 1 ? ` (+${rules.length - 1} more)` : ''} · room ${fmt.plain(top.r.room, 0)}`;
  return html`<div role="alert" title=${rules.map((x) => `${x.a.name}: ${x.r.label} ${Math.round(x.r.pct)}% used, room ${fmt.plain(x.r.room, 0)}`).join('\n') + '\nThe journal only warns. Risk Guard Rail and the copier enforce limits in MT5.'}
    style=${`display:flex;align-items:center;gap:8px;height:34px;padding:0 12px;border-radius:10px;font-size:12.5px;min-width:0;max-width:520px;background:${bad ? '#3A1A1E' : '#2A2110'};border:1px solid ${bad ? '#6A2A31' : '#4A3A18'};color:${bad ? '#FFB3B9' : '#F5CF8A'}`}>
    <span class="dot" style=${`background:${bad ? 'var(--neg)' : 'var(--amber)'}`}></span><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${text}</span></div>`;
}

/** Banner when an account is close to a rule (used on other pages). */
export function PropBanner({ accounts }) {
  const hot = accounts.filter((a) => a.prop && a.prop.level && a.prop.level !== 'ok');
  if (!hot.length) return null;
  const worst = hot.some((a) => a.prop.level === 'breached' || a.prop.level === 'danger');
  return html`<div class=${cls('warn', worst && 'err')} role="alert"><div class="stack" style="gap:4px">
    ${hot.flatMap((a) => a.prop.rules.filter((r) => r.level !== 'ok').map((r) => html`<span><b>${a.name}:</b> ${r.label} ${Math.round(r.pct)}% used
      (${r.level === 'breached' ? 'limit reached' : 'room left ' + fmt.plain(r.room, 0)})</span>`))}
    <span class="sub" style="color:inherit;opacity:.85">The journal only warns. Risk Guard Rail and the copier enforce your limits in MT5.</span></div></div>`;
}

function AccountsPanel({ accounts }) {
  const s = useStore();
  const list = [...accounts].sort((a, b) => hotness(b) - hotness(a));
  const scopeLabel = s.acct === 'all' ? 'All accounts' : s.acct.startsWith('kind:') ? kindLabel(s.acct.slice(5)) + ' accounts' : (list[0] && list[0].name) || 'Account';
  const total = list.reduce((x, a) => x + (a.balance || 0), 0);
  return html`<section class="panel" style="flex:1;min-height:240px">
    <div class="ph"><div><h2>Accounts</h2><div class="sub" style="margin-top:2px">Showing <b style="color:var(--text2)">${scopeLabel}</b> · ${list.length} · closest to a limit first</div></div><a href="#/accounts" style="font-size:12px">Manage</a></div>
    <div class="scrolly" style="padding:0 14px 6px">
      ${list.map((a, k) => html`<div class="stack" style=${`gap:8px;padding:11px 0;${k ? 'border-top:1px solid #1B212C' : ''}`}>
        <div class="spread" style="flex-wrap:nowrap"><span class="hstack" style="gap:8px;flex-wrap:nowrap;min-width:0"><b style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.name}</b>
          <span class=${cls('chip', a.kind === 'funded' ? 'b' : a.kind === 'challenge' ? 'a' : '')}>${kindLabel(a.kind)} · ${roleLabel(a)}</span></span>
          <span class="num" style="font-size:13px;font-weight:600">${fmt.plain(a.balance)}</span></div>
        ${a.prop && !a.prop.missing ? html`<${PropBars} p=${a.prop} compact/>` : html`<div class="sub">${a.prop && a.prop.missing ? a.prop.missing : 'No prop rules set'}</div>`}
        <div class="sub spread"><span>Since reset <${Money} v=${a.prop && a.prop.todayPnl != null ? a.prop.todayPnl : a.today}/></span><span>Month <${Money} v=${a.month}/></span></div>
      </div>`)}
      ${!list.length && html`<div class="empty">No accounts in this view.</div>`}
    </div>
    ${list.length > 1 && html`<div class="sub" style="border-top:1px solid #1B212C;padding:8px 14px">Combined balance <b class="num" style="color:var(--text)">${fmt.plain(total)}</b></div>`}
  </section>`;
}

const sameDay = (a, b) => fmt.date(a) === fmt.date(b);

/** Ideas table. compact = dashboard version (opened, closed, held, idea, strategy, R, P&L, status). */
export function IdeaTable({ ideas, open, compact, costs }) {
  const multi = (store.boot?.accounts || []).length > 1;
  if (compact) {
    return html`<table class="mtbl"><thead><tr><th>Opened</th><th>Closed</th><th class="r">Held</th><th>Idea</th><th class="hide-sm">Strategy</th><th class="r">R</th><th class="r">P&L</th><th class="hide-sm">Status</th></tr></thead>
      <tbody>${ideas.map((i) => html`<tr class="click" onClick=${() => { location.hash = '#/ideas/' + i.id; }}>
        <td><span style="font-weight:500">${fmt.date(i.open_time).split(' ').slice(0, 2).join(' ')}</span> <span class="num mut">${fmt.time(i.open_time)}</span></td>
        <td class="num">${i.status === 'open' ? html`<span class="mut">open</span>` : html`${fmt.time(i.close_time)}${!sameDay(i.open_time, i.close_time) ? html` <span class="sub">+1d</span>` : ''}`}</td>
        <td class="num r mut">${fmt.dur((i.close_time || Date.now()) - i.open_time).replace(' min', 'm').replace(' h ', 'h ')}</td>
        <td><a href=${'#/ideas/' + i.id} class="hstack" style="color:var(--text);font-weight:600;flex-wrap:nowrap;gap:7px" onClick=${(e) => e.stopPropagation()}>${i.symbol} <${Dir} d=${i.direction}/></a></td>
        <td class="mut hide-sm" style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${i.strategy_name || '—'}</td>
        <td class="r">${i.status === 'open' ? html`<span class="mut">—</span>` : html`<${R} v=${i.r}/>`}</td>
        <td class="r" style="font-weight:600">${i.status === 'open' ? html`<${Money} v=${i.floating}/><span class="sub"> float</span>` : html`<${Money} v=${i.net}/>`}</td>
        <td class="hide-sm">${i.status === 'open' ? html`<span class="chip b">Open</span>` : i.reviewed ? html`<span class="chip g">Reviewed</span>` : html`<span class="chip a">To review</span>`}</td></tr>`)}</tbody></table>`;
  }
  return html`<div class="scroll"><table class="tbl">
    <thead><tr><th>Opened</th>${!open && html`<th>Closed</th><th class="r">Duration</th>`}<th>Idea</th><th class="hide-sm">Strategy</th><th class="r hide-sm">Positions</th>${multi && html`<th class="hide-sm">Accounts</th>`}
      <th class="r">${open ? 'Floating' : 'R'}</th>${costs && html`<th class="r" title="Commission + swap + fees">Costs</th>`}<th class="r">P&L${multi ? ' (scope)' : ''}</th><th class="hide-sm">Review</th></tr></thead>
    <tbody>${ideas.map((i) => html`<tr class="click" onClick=${() => { location.hash = '#/ideas/' + i.id; }}>
      <td><div style="font-weight:500">${fmt.date(i.open_time)}</div><div class="sub num">${fmt.time(i.open_time)}</div></td>
      ${!open && (i.close_time ? html`<td>${sameDay(i.open_time, i.close_time) ? html`<div class="sub">same day</div>` : html`<div style="font-weight:500">${fmt.date(i.close_time)}</div>`}<div class="sub num">${fmt.time(i.close_time)}</div></td>
        <td class="num r">${fmt.dur(i.close_time - i.open_time)}</td>`
        : html`<td><span class="chip b">Open</span></td><td class="num r mut">${fmt.dur(Date.now() - i.open_time)}</td>`)}
      <td><a href=${'#/ideas/' + i.id} class="hstack" style="color:var(--text);font-weight:600;flex-wrap:nowrap" onClick=${(e) => e.stopPropagation()}>${i.symbol} <${Dir} d=${i.direction}/></a></td>
      <td class="mut hide-sm">${i.strategy_name || '—'}</td>
      <td class="num r hide-sm">${i.lead_positions}</td>
      ${multi && html`<td class="hide-sm"><span class="chip b">${i.accounts.length} account${i.accounts.length > 1 ? 's' : ''}</span></td>`}
      <td class="r">${open ? html`<${Money} v=${i.floating}/>` : html`<${R} v=${i.r}/>`}</td>
      ${costs && html`<td class="r num">${i.costs ? html`<span class=${i.costs < 0 ? 'neg' : 'pos'}>${fmt.money(i.costs)}</span>` : html`<span class="mut">$0.00</span>`}</td>`}
      <td class="r"><${Money} v=${i.net}/></td>
      <td class="hide-sm">${i.status === 'open' ? html`<span class="chip b">Open</span>` : i.reviewed ? html`<span class="chip g">Reviewed</span>` : html`<span class="chip a">Needs review</span>`}</td>
    </tr>`)}</tbody></table></div>`;
}

// ------------------------------------------------------------------ daily preparation (one list for all strategies)

function Prep({ prep, reload }) {
  const [local, setLocal] = useState({});
  const h = useData(() => api('/prep/history?days=14'), []);
  const items = prep.items.map((i) => ({ ...i, checked: local[i.id] ?? i.checked }));
  const done = items.filter((i) => i.checked).length;
  const toggle = async (it) => {
    setLocal({ ...local, [it.id]: !it.checked });
    try { await api('/prep', { method: 'PUT', body: { item_id: it.id, checked: !it.checked, day: prep.day } }); h.reload(); }
    catch (e) { toast(e.message, true); setLocal({ ...local, [it.id]: it.checked }); reload(); }
  };
  const full = h.data ? h.data.rows.filter((r) => r.day !== prep.day && r.total > 0 && r.done >= r.total).length : null;
  return html`<section class="panel" style="flex:1;min-height:170px">
    <div class="ph"><div><h2>Daily preparation</h2><div class="sub" style="margin-top:2px">All strategies · resets 12:00 AM Brisbane</div></div>
      <span class=${cls('chip num', items.length && done === items.length ? 'g' : 'b')}>${done} / ${items.length}</span></div>
    ${items.length > 0 && html`<div style="margin:0 14px 6px"><${Bar} pct=${done / items.length * 100}/></div>`}
    <div class="scrolly" style="padding:0 14px 6px">
      ${items.map((it) => html`<label class=${cls('ck', it.checked && 'done')} style="min-height:34px;font-size:12.5px;gap:10px"><input type="checkbox" checked=${it.checked} onChange=${() => toggle(it)} style="width:16px;height:16px;flex:0 0 16px"/><span>${it.label}</span></label>`)}
      ${!items.length && html`<div class="sub" style="padding:8px 0">No daily items yet. Add them on the <a href="#/strategies">Strategies</a> page.</div>`}
    </div>
    <div class="sub spread" style="border-top:1px solid #1B212C;padding:8px 14px"><span>${full == null ? '' : `Last 14 days: ${full} complete`}</span><a href="#/strategies" style="font-size:12px">Edit checklist</a></div>
  </section>`;
}

// ------------------------------------------------------------------ market sessions (today, in Brisbane time)

const SESS_COLORS = { Sydney: '#2EC4B6', Tokyo: '#5B8CFF', London: '#F5A524', 'New York': '#C38BFF' };

function Sessions() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  const rows = sessionsInBrisbane(now);
  const open = openSessions(now).map((s) => s.name);
  const bne = new Date(now + 10 * 3600000);
  const nowH = bne.getUTCHours() + bne.getUTCMinutes() / 60;
  const toH = (hm) => +hm.slice(0, 2) + +hm.slice(3) / 60;
  // the next session to open (a weekday in its own city)
  let next = null;
  for (const s of SESSIONS) {
    if (open.includes(s.name)) continue;
    const off = tzOffsetMs(s.tz, now), loc = new Date(now + off);
    for (let k = 0; k < 5; k++) {
      const day = new Date(Date.UTC(loc.getUTCFullYear(), loc.getUTCMonth(), loc.getUTCDate() + k));
      const wd = day.getUTCDay();
      if (wd < 1 || wd > 5) continue;
      const t = day.getTime() + s.open * 3600000 - tzOffsetMs(s.tz, day.getTime() + s.open * 3600000 - off);
      if (t > now) { const m = Math.round((t - now) / 60000); if (!next || m < next.m) next = { name: s.name, m }; break; }
    }
  }
  const W = 340, L = 62, Rr = 4, rowH = 20, top = 18, span = W - L - Rr, X = (h) => L + span * h / 24, H = top + rows.length * rowH;
  const nextTxt = next ? `${next.name} in ${next.m < 60 ? next.m + ' min' : Math.floor(next.m / 60) + ' h ' + String(next.m % 60).padStart(2, '0')}` : '';
  return html`<section class="panel">
    <div class="ph"><h2 title="Brisbane time. Each session follows its own city's hours, so daylight saving is handled.">Market sessions <span class="sub" style="font-weight:400">· Brisbane time</span></h2><span class=${cls('chip', open.length ? 'g' : '')}>${open.length ? html`<span class="dot" style="background:var(--pos)"></span>${open.join(' + ')} open` : 'All closed'}${nextTxt ? ' · ' + nextTxt : ''}</span></div>
    <div class="pb"><svg viewBox=${`0 0 ${W} ${H + 2}`} width="100%" role="img" aria-label=${'Sessions today in Brisbane time: ' + rows.map((r) => `${r.name} ${r.from} to ${r.to}`).join(', ')}>
      ${[0, 6, 12, 18, 24].map((h) => html`<line x1=${X(h)} x2=${X(h)} y1=${top - 4} y2=${H} stroke="#171C25"/>
        <text x=${X(h)} y="10" fill="#7F8897" font-size="10" text-anchor=${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'} font-family="JetBrains Mono, monospace">${String(h).padStart(2, '0')}</text>`)}
      ${rows.map((r, i) => {
        const y = top + i * rowH, a = toH(r.from), b = toH(r.to);
        const spans = a < b ? [[a, b]] : [[a, 24], [0, b]];
        return html`<text x="0" y=${y + 11} fill="#C3CAD6" font-size="11.5">${r.name}</text>
          ${spans.map(([p, q]) => html`<rect x=${X(p)} y=${y + 2} width=${Math.max(1, X(q) - X(p))} height="10" rx="5" fill=${SESS_COLORS[r.name]} opacity=${open.includes(r.name) ? 1 : 0.5}/>`)}`;
      })}
      <line x1=${X(nowH)} x2=${X(nowH)} y1=${top - 6} y2=${H} stroke="#FFFFFF" stroke-width="1.4"/><circle cx=${X(nowH)} cy=${top - 6} r="3" fill="#FFFFFF"/>
    </svg></div>
  </section>`;
}

// ------------------------------------------------------------------ profit split calculator

function useFx() {
  const [fx, setFx] = useState(null);
  useEffect(() => { api('/fx').then(setFx).catch(() => setFx({ AUD: null, NZD: null, error: 'Live rate unavailable. Enter a rate.' })); }, []);
  return fx;
}

function ProfitSplit({ payouts }) {
  const list = payouts || [];
  const fx = useFx();
  const first = list.find((p) => p.kind === 'funded') || list[0];
  const [acct, setAcct] = useState(first ? String(first.id) : 'any');
  const cur = list.find((p) => String(p.id) === acct);
  const [amount, setAmount] = useState(cur ? String(Math.max(0, cur.profit).toFixed(2)) : '');
  const [split, setSplit] = useState(cur && cur.split != null ? String(cur.split) : '80');
  const [ccy, setCcy] = useState(cur ? cur.currency === 'USD' ? 'AUD' : cur.currency : 'AUD');
  const [manual, setManual] = useState({});
  const pick = (v) => {
    setAcct(v);
    const p = list.find((x) => String(x.id) === v);
    if (p) { setAmount(String(Math.max(0, p.profit).toFixed(2))); if (p.split != null) setSplit(String(p.split)); if (p.currency && p.currency !== 'USD') setCcy(p.currency); }
  };
  const amt = Number(String(amount).replace(/[^0-9.]/g, '')) || 0;
  const sp = Math.min(100, Math.max(0, Number(split) || 0));
  const usd = amt * sp / 100;
  const liveRate = fx && fx[ccy];
  const rate = manual[ccy] != null && manual[ccy] !== '' ? Number(manual[ccy]) : liveRate;
  const local = rate ? usd * rate : null;
  const sym = ccy === 'AUD' ? 'A$' : 'NZ$';
  const presets = [...new Set([80, 85, 90, 100, ...(cur && cur.split != null ? [cur.split] : [])])].sort((a, b) => a - b);
  const note = cur ? cur.split == null ? 'No split set for this account (Accounts → Payouts)' : String(cur.split) === String(split) ? `Split ${cur.split}% from account settings` : `Account setting ${cur.split}% · changed here`
    : 'Any amount';
  return html`<section class="panel">
    <div class="ph"><h2>Profit split</h2><div class="seg2" role="group" aria-label="Payout currency">${['AUD', 'NZD'].map((c) => html`<button type="button" class=${ccy === c ? 'on' : ''} aria-pressed=${ccy === c} onClick=${() => setCcy(c)}>${c}</button>`)}</div></div>
    <div class="pb stack" style="gap:9px">
      <div class="hstack" style="flex-wrap:nowrap;gap:8px">
        <label class="sr" for="psacct">Account</label>
        <select id="psacct" class="inp sm" style="flex:1;min-width:0" value=${acct} onChange=${(e) => pick(e.target.value)}>
          ${list.map((p) => html`<option value=${p.id}>${p.name} · ${p.kind === 'funded' ? (p.last_payout_day ? 'since payout' : 'profit so far') : 'not funded yet'}</option>`)}
          <option value="any">Any amount</option></select>
        <label class="sr" for="psamt">Profit in USD</label>
        <div style="position:relative;width:140px;flex:0 0 140px"><span class="mut" style="position:absolute;left:10px;top:9px;font-size:12px">USD</span>
          <input id="psamt" class="inp sm num" style="padding-left:40px" inputmode="decimal" value=${amount} onInput=${(e) => setAmount(e.target.value)}/></div></div>
      <div class="hstack" style="flex-wrap:nowrap;gap:8px"><div class="seg2" role="group" aria-label="Profit split" style="flex-wrap:nowrap;flex:0 0 auto">${presets.map((v) => html`<button type="button" class=${String(v) === String(split) ? 'on' : ''} aria-pressed=${String(v) === String(split)} onClick=${() => setSplit(String(v))}>${v}%</button>`)}</div>
        <span class="sub" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title=${note}>${note}</span></div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:8px">
        <div class="box"><div class="cap">Your share</div><div class="num" style="font-size:15px;font-weight:600;margin-top:4px">${fmt.plain(usd)}</div><div class="sub">Firm keeps ${fmt.plain(amt - usd)}</div></div>
        <div class="box" style="background:#0F2A1C;border-color:#1D4A32" title="Before any firm fees or transfer charges. Your bank's rate on the day will differ a little."><div class="cap" style="color:#8FE3B6">You receive</div>
          <div class="num" style="font-size:19px;font-weight:700;color:#5BE3A0;margin-top:2px">${local != null ? sym + local.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</div>
          <div class="sub hstack" style="color:#8FE3B6;gap:4px;flex-wrap:nowrap"><label for="psrate" class="sr">USD to ${ccy} rate</label>@
            <input id="psrate" class="num" style="width:62px;background:transparent;border:0;border-bottom:1px dashed #3A6B50;color:#8FE3B6;font-size:12px;padding:0" inputmode="decimal"
              value=${manual[ccy] ?? (liveRate ? liveRate.toFixed(4) : '')} placeholder="rate" onInput=${(e) => setManual({ ...manual, [ccy]: e.target.value })}/>
            <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title=${fx && fx.source ? `${fx.source}, ${fx.date}` : ''}>${manual[ccy] != null && manual[ccy] !== '' ? 'your rate' : fx && fx.AUD ? `ECB ${fx.date}${fx.stale ? ' (old)' : ''}` : fx ? 'enter a rate' : 'loading…'}</span></div></div>
      </div>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ economic calendar (Myfxbook widget)

const MYFX = 'https://widget.mfbcdn.net/widget/calendar.html?lang=en&impacts=3&symbols=AUD,CAD,CHF,EUR,GBP,JPY,NZD,USD';

function EconCalendar() {
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('tj.calDark') !== '0'; } catch { return true; } });
  const flip = () => { const v = !dark; setDark(v); try { localStorage.setItem('tj.calDark', v ? '1' : '0'); } catch { /* ignore */ } };
  return html`<section class="panel" style="flex:1;min-height:300px">
    <div class="ph"><div><h2>Economic calendar</h2><div class="sub" style="margin-top:2px">High impact · 8 currencies</div></div>
      <div class="hstack" style="gap:6px"><button type="button" class="btn sm ghost" onClick=${flip} title="Switch the widget's colours">${dark ? 'Light' : 'Dark'}</button>
        <a href="https://www.myfxbook.com/forex-economic-calendar" target="_blank" rel="noopener" style="font-size:12px">Open</a></div></div>
    <div style="flex:1;min-height:0;border-top:1px solid #1B212C;overflow:hidden;background:${dark ? '#10141B' : '#fff'}">
      <iframe src=${MYFX} title="Economic calendar by Myfxbook" loading="lazy" style=${`width:100%;height:100%;min-height:240px;border:0;display:block;${dark ? 'filter:invert(.9) hue-rotate(180deg)' : ''}`}></iframe></div>
    <div style="padding:7px 14px;border-top:1px solid #1B212C;font-size:11px;color:#7F8897;display:flex;justify-content:space-between;gap:8px">
      <span>Times follow the widget's own time zone setting</span>
      <span><a href="https://www.myfxbook.com/forex-economic-calendar?utm_source=widget13&utm_medium=link&utm_campaign=copyright" title="Economic Calendar" target="_blank" rel="noopener" style="color:#C3CAD6;font-weight:600">Economic Calendar</a> by Myfxbook.com</span></div>
  </section>`;
}
