import { html, useState, useEffect, useStore, useData, api, scopeQs, fmt, sgn, cls, Money, R, Dir, Bar, Loading, LineChart, PageHead, toast, store, setStore, reloadBoot, kindLabel, roleLabel, Icon } from '../lib.js';
import { sessionsInBrisbane, openSessions, SESSIONS, tzOffsetMs } from '../sessions.js';
import { PANELS, SIZES, DEFAULTS, normalise, useScreen, movePanel, nudge, setSize, setHidden, setColumns, setWidth } from '../dashlayout.js';

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
  const [edit, setEdit] = useState(false);
  const sub = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()) + ' AEST';
  return html`<${PageHead} title="Dashboard" sub=${sub}>${st.data && html`<${AlertPill} accounts=${st.data.accounts}/>`}
      <button type="button" class=${cls('btn sm', edit && 'pri')} onClick=${() => setEdit(!edit)} aria-pressed=${edit} title="Move, resize and hide panels">${edit ? 'Done' : 'Customise'}</button><//>
    <${SampleEmpty}/>
    <${Loading} state=${st}>${(d) => html`<${Body} d=${d} reload=${st.reload} edit=${edit} setEdit=${setEdit}/>`}<//>`;
}

function Body({ d, reload, edit, setEdit }) {
  const s = useStore();
  const { bp, fit } = useScreen();
  const all = (() => { try { return JSON.parse(s.boot.settings.dash_layout || '{}'); } catch { return {}; } })();
  const [layout, setLayoutState] = useState(() => normalise(all[bp], bp));
  useEffect(() => { setLayoutState(normalise(all[bp], bp)); }, [bp, s.boot.settings.dash_layout]);
  const save = async (l) => {
    setLayoutState(l);
    const next = { ...all, [bp]: l };
    try { await api('/settings', { method: 'PUT', body: { dash_layout: next } }); s.boot.settings.dash_layout = JSON.stringify(next); }
    catch (e) { toast(e.message, true); }
  };

  const combined = d.accounts.length > 1;
  const showToday = d.lastDay === d.today;
  const ls = d.lastDaySummary;
  const s30 = d.stats30;
  const toReview = d.recent.filter((i) => !i.reviewed).length;
  const ideas = [...d.open, ...d.recent];
  const panels = {
    chart: () => html`<section class="panel" style="min-height:240px">
        <div class="ph"><h2>Return by account · this month</h2>
          <div class="hstack" style="gap:12px;font-size:11.5px;color:var(--text2)">${d.accounts.slice(0, 5).map((a, i) => html`<span class="hstack" style="gap:5px">
            <i style=${`width:14px;height:0;border-top:2px ${DASHES[i % 5] ? 'dashed' : 'solid'} ${COLORS[i % 5]};display:inline-block`}></i>${a.name}
            <b class=${cls('num', sgn(a.monthPct))}>${fmt.pct(a.monthPct)}</b></span>`)}</div></div>
        <div class="pb" style="flex:1;min-height:0;display:flex;align-items:center">
          <${LineChart} height=${230} label="Return by account this month" yFmt=${(v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%'}
            series=${d.accounts.map((a, i) => ({ name: a.name, color: COLORS[i % 5], dash: DASHES[i % 5], points: [{ x: firstOfMonth(), y: 0 }, ...a.curve.map((p) => ({ x: p.t, y: p.pct }))] }))}
            xLabels=${monthLabels()}/></div>
      </section>`,
    ideas: () => html`<section class="panel" style="min-height:200px">
        <div class="ph"><h2>Recent trading ideas</h2><div class="hstack" style="gap:10px"><span class="sub">${d.open.length} open · ${toReview} to review</span><a href="#/ideas" style="font-size:12px">All ideas</a></div></div>
        <div class="scrolly" style="padding:0 6px 6px;overflow-x:auto">${ideas.length ? html`<${IdeaTable} ideas=${ideas} compact/>` : html`<div class="empty">No trades yet. They appear here as soon as the MT5 connector sends them.</div>`}</div>
      </section>`,
    calendar: () => html`<${EconCalendar}/>`,
    hours: () => html`<${Sessions}/>`,
    split: () => html`<${ProfitSplit} payouts=${d.payouts}/>`,
    prep: () => html`<${Prep} prep=${d.prep} reload=${reload}/>`,
    accounts: () => html`<${AccountsPanel} accounts=${d.accounts}/>`,
  };
  const hidden = new Set(layout.hidden);
  const showKpis = !hidden.has('kpis');
  return html`
  ${edit && html`<${EditBar} layout=${layout} bp=${bp} save=${save} done=${() => setEdit(false)}/>`}
  ${(showKpis || edit) && html`<div class=${cls(edit && 'dedit-k', !showKpis && 'dhidden')}>${edit && html`<div class="dtools"><b>Key figures</b><button type="button" class="btn sm" onClick=${() => save(setHidden(layout, 'kpis', showKpis))}>${showKpis ? 'Hide' : 'Show'}</button></div>`}
  ${showKpis && html`<section class="kstrip" aria-label="Key figures">
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
  </section>`}</div>`}

  <${Grid} layout=${layout} panels=${panels} fit=${fit} edit=${edit} save=${save}/>`;
}

const SIZE_FLEX = { s: 1, m: 2, l: 3 };
const SIZE_PX = { s: 260, m: 400, l: 560 };

/** The panel columns. In one-screen mode panels share each column's height by size; otherwise S/M/L are fixed heights. */
function Grid({ layout, panels, fit, edit, save }) {
  const [drag, setDrag] = useState(null);
  const hidden = new Set(layout.hidden);
  const drop = (c, i) => (e) => { e.preventDefault(); const id = drag || e.dataTransfer.getData('text/plain'); setDrag(null); if (id) save(movePanel(layout, id, c, i)); };
  const over = (e) => { if (drag) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } };
  return html`<div class=${cls('dgrid', fit && 'fill', edit && 'editing')} style=${`grid-template-columns:${layout.widths.map((w) => `minmax(0,${w}fr)`).join(' ')}`}>
    ${layout.cols.map((col, c) => html`<div class="colstack" onDragOver=${over} onDrop=${drop(c, col.length)}>
      ${edit && layout.cols.length > 1 && html`<div class="dcolbar" aria-label=${`Column ${c + 1} width`}><span class="sub">Column ${c + 1}</span>
        <span class="hstack" style="gap:4px"><button type="button" class="btn sm" onClick=${() => save(setWidth(layout, c, -0.1))} aria-label="Narrower">−</button><span class="num sub">${layout.widths[c].toFixed(1)}</span><button type="button" class="btn sm" onClick=${() => save(setWidth(layout, c, 0.1))} aria-label="Wider">+</button></span></div>`}
      ${col.filter((p) => edit || !hidden.has(p.id)).map((p, i) => {
        const hid = hidden.has(p.id);
        const style = hid ? '' : fit ? (p.size === 'auto' ? 'flex:0 0 auto' : `flex:${SIZE_FLEX[p.size]} 1 0;min-height:150px`) : (p.size === 'auto' ? '' : `height:${SIZE_PX[p.size]}px`);
        return html`<div class=${cls('dpanel', p.size === 'auto' && 'auto', hid && 'dhidden', drag === p.id && 'dragging')} style=${style} key=${p.id}
          onDragOver=${over} onDrop=${(e) => { e.stopPropagation(); drop(c, col.findIndex((x) => x.id === p.id))(e); }}>
          ${edit && html`<${PanelTools} p=${p} hid=${hid} layout=${layout} save=${save} onDragStart=${(e) => { setDrag(p.id); e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd=${() => setDrag(null)}/>`}
          ${!hid && panels[p.id]()}
        </div>`;
      })}
      ${edit && html`<div class="ddrop sub" onDragOver=${over} onDrop=${drop(c, col.length)}>${col.length ? 'Drop here to move to the end' : 'Drop a panel here'}</div>`}
    </div>`)}
  </div>`;
}

function PanelTools({ p, hid, layout, save, onDragStart, onDragEnd }) {
  const mv = (dir) => save(nudge(layout, p.id, dir));
  return html`<div class="dtools" draggable="true" onDragStart=${onDragStart} onDragEnd=${onDragEnd}>
    <span class="dgrip" aria-hidden="true" title="Drag to move">⠿</span><b>${PANELS[p.id]}</b>
    <span class="hstack" style="gap:3px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end">
      ${!hid && html`<div class="seg2" role="group" aria-label=${PANELS[p.id] + ' size'}>${SIZES.map(([k, l]) => html`<button type="button" class=${p.size === k ? 'on' : ''} aria-pressed=${p.size === k} onClick=${() => save(setSize(layout, p.id, k))} title=${k === 'auto' ? 'Fit the content' : 'Size ' + l}>${l}</button>`)}</div>`}
      <button type="button" class="btn sm" onClick=${() => mv('up')} aria-label="Move up">↑</button>
      <button type="button" class="btn sm" onClick=${() => mv('down')} aria-label="Move down">↓</button>
      ${layout.cols.length > 1 && html`<button type="button" class="btn sm" onClick=${() => mv('left')} aria-label="Move to the left column">←</button>
        <button type="button" class="btn sm" onClick=${() => mv('right')} aria-label="Move to the right column">→</button>`}
      <button type="button" class="btn sm" onClick=${() => save(setHidden(layout, p.id, !hid))}>${hid ? 'Show' : 'Hide'}</button></span>
  </div>`;
}

function EditBar({ layout, bp, save, done }) {
  const name = { desktop: 'desktop', tablet: 'tablet', phone: 'phone' }[bp];
  return html`<div class="dedit-bar" role="region" aria-label="Customise the dashboard">
    <div><b>Customising the ${name} layout</b><div class="sub">${bp === 'desktop' ? 'Drag a panel by its bar, or use the arrows.' : 'Use the arrows to move a panel.'} S/M/L set its height; Fit sizes it to its content. ${bp === 'desktop' ? 'Tablet and phone' : 'Other screen sizes'} keep their own layout.</div></div>
    <div class="hstack" style="gap:6px">
      ${bp !== 'phone' && html`<label class="hstack sub" style="gap:6px">Columns
        <select class="inp sm" value=${layout.cols.length} onChange=${(e) => save(setColumns(layout, Number(e.target.value)))}>${(bp === 'desktop' ? [2, 3, 4] : [1, 2, 3]).map((n) => html`<option value=${n}>${n}</option>`)}</select></label>`}
      <button type="button" class="btn sm" onClick=${() => { if (confirm('Reset the ' + name + ' layout to the default?')) save(JSON.parse(JSON.stringify(DEFAULTS[bp]))); }}>Reset</button>
      <button type="button" class="btn sm pri" onClick=${done}>Done</button></div>
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
        ${a.riskToday && a.riskToday.limit ? html`<div class="sub spread" title="Risk taken on trades opened today vs your daily risk limit (Accounts page)">
          <span>Risk today <b class=${cls('num', a.riskToday.level === 'over' ? 'neg' : '')} style=${a.riskToday.level === 'tolerance' ? 'color:var(--amber)' : ''}>${fmt.plain(a.riskToday.used)}</b> / ${fmt.plain(a.riskToday.limit)}</span>
          <span>${a.riskToday.level === 'over' ? html`<span class="chip r">Over daily limit</span>` : a.riskToday.tradeLimit ? `Per idea ${fmt.plain(a.riskToday.tradeLimit)}` : ''}</span></div>` : ''}
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
        <td class="mut hide-sm" style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title=${i.strategy_name || ''}>${i.strategy_name || '—'}</td>
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

const SENT = [['bear', 'Bear', '▼', 'r'], ['neutral', 'Neutral', '–', ''], ['bull', 'Bull', '▲', 'g']];
const SENT_STYLE = { bear: 'background:#3A1A1E;border-color:#6A2A31;color:#FF9AA2', neutral: 'background:#1A2030;border-color:#36405A;color:var(--text)', bull: 'background:#12301F;border-color:#1D5A38;color:#5BE3A0' };

/** Step 1 of daily prep: overall sentiment, a bias per market, what you checked, and the Copy prompt button. */
export function SentimentBlock({ prep, editable = true, onSaved }) {
  const opts = prep.sentimentOptions || { markets: [], basis: [], prompt: '' };
  const init = prep.sentiment || { overall: null, markets: {}, basis: [] };
  const [v, setV] = useState({ overall: init.overall || null, markets: init.markets || {}, basis: init.basis || [] });
  const save = async (next) => {
    setV(next);
    try { await api('/prep/sentiment', { method: 'PUT', body: { ...next, day: prep.day } }); onSaved && onSaved(next); } catch (e) { toast(e.message, true); }
  };
  const copy = async () => {
    const text = (opts.prompt || '').replaceAll('{date}', new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()))
      .replaceAll('{markets}', opts.markets.join(', '));
    try { await navigator.clipboard.writeText(text); toast('Prompt copied'); } catch { prompt('Copy your prompt', text); }
  };
  const row = (label, cur, onPick, aria) => html`<div style=${`display:grid;grid-template-columns:${label ? '62px ' : ''}repeat(3,minmax(0,1fr));gap:4px;align-items:center`} role="group" aria-label=${aria}>
    ${label && html`<span style="font-size:12px;font-weight:600">${label}</span>`}
    ${SENT.map(([k, l, ic]) => { const on = cur === k; return html`<button type="button" class="btn sm" disabled=${!editable} aria-pressed=${on} style=${`min-height:26px;padding:0 4px;justify-content:center;font-size:11.5px;${on ? SENT_STYLE[k] : 'color:var(--mut)'}`}
      onClick=${() => onPick(on ? null : k)}>${ic} ${l}</button>`; })}</div>`;
  return html`<div class="stack" style="gap:4px">
    <div class="spread"><span class="cap" style="color:#C9D8FF">1 · Market sentiment</span>
      ${opts.prompt ? html`<button type="button" class="btn sm ghost" style="min-height:22px;padding:0 6px;font-size:11.5px;color:#9DB8FF" onClick=${copy} title="Copy your sentiment prompt to paste into Claude"><${Icon} name="copy" size=${13}/>Copy prompt</button>`
        : html`<a href="#/strategies" style="font-size:11.5px" title="Save the prompt you use to check sentiment">Add your prompt</a>`}</div>
    ${row(opts.markets.length ? 'Overall' : null, v.overall, (k) => save({ ...v, overall: k }), 'Overall market sentiment')}
    ${opts.markets.map((mk) => row(mk, v.markets[mk], (k) => save({ ...v, markets: { ...v.markets, [mk]: k } }), mk + ' bias'))}
  </div>`;
}

function Prep({ prep, reload }) {
  const [local, setLocal] = useState({});
  const [overall, setOverall] = useState(prep.sentiment ? prep.sentiment.overall : null);
  const h = useData(() => api('/prep/history?days=14'), []);
  const items = prep.items.map((i) => ({ ...i, checked: local[i.id] ?? i.checked }));
  const done = items.filter((i) => i.checked).length;
  const left = items.length - done + (overall ? 0 : 1);
  const toggle = async (it) => {
    setLocal({ ...local, [it.id]: !it.checked });
    try { await api('/prep', { method: 'PUT', body: { item_id: it.id, checked: !it.checked, day: prep.day } }); h.reload(); }
    catch (e) { toast(e.message, true); setLocal({ ...local, [it.id]: it.checked }); reload(); }
  };
  const full = h.data ? h.data.rows.filter((r) => r.day !== prep.day && r.total > 0 && r.done >= r.total).length : null;
  const dayLabel = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
  return html`<section class="panel prep-panel" aria-labelledby="preph">
    <div class="ph"><div><h2 id="preph" style="font-size:14px">Daily preparation</h2><div class="sub" style="margin-top:2px">${dayLabel} · before your first trade</div></div>
      <span class=${cls('chip', left ? 'a' : 'g')} style="white-space:nowrap" title=${left ? `${left} step${left > 1 ? 's' : ''} left before trading` : 'All done'}>${left ? `${left} left` : '✓ Ready to trade'}</span></div>
    <div class="stack" style="padding:0 14px 12px;gap:10px">
      <${SentimentBlock} prep=${prep} onSaved=${(v) => setOverall(v.overall)}/>
      <div><div class="spread"><span class="cap" style="color:#C9D8FF">2 · Checklist</span><span class="sub num">${done} / ${items.length}</span></div>
        ${items.map((it) => html`<label class=${cls('ck', it.checked && 'done')} style="min-height:28px;font-size:12.5px;gap:10px;padding-top:3px;padding-bottom:3px"><input type="checkbox" checked=${it.checked} onChange=${() => toggle(it)} style="width:16px;height:16px;flex:0 0 16px"/><span>${it.label}</span></label>`)}
        ${!items.length && html`<div class="sub" style="padding:8px 0">No daily items yet. Add them on the <a href="#/strategies">Strategies</a> page.</div>`}</div>
      <${Bar} pct=${items.length ? done / items.length * 100 : 0} color=${left ? 'var(--blue)' : 'var(--pos)'}/>
      <div class="sub spread"><span>${full == null ? '' : `Last 14 days: ${full} complete`}</span><a href="#/strategies" style="font-size:12px">Edit</a></div>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ market hours (today, Brisbane time, draggable)

const SESS_COLORS = { Sydney: '#2EC4B6', Tokyo: '#5B8CFF', London: '#F5A524', 'New York': '#C38BFF' };
const hhmm = (m) => String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String(((m % 60) + 60) % 60).padStart(2, '0');
const short = (n) => (n === 'New York' ? 'NY' : n);
const dur = (k) => (k < 60 ? k + ' min' : Math.floor(k / 60) + ' h' + (k % 60 ? ' ' + String(k % 60).padStart(2, '0') : ''));

function Sessions() {
  const [now, setNow] = useState(Date.now());
  const [scrub, setScrub] = useState(null); // minutes after Brisbane midnight, or null = now
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const dayStart = Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(now) + 'T00:00:00+10:00');
  const nowMin = Math.floor((now - dayStart) / 60000);
  const m = scrub == null ? nowMin : scrub;
  const at = dayStart + m * 60000;
  const rows = sessionsInBrisbane(now);
  const open = openSessions(at).map((x) => x.name);
  // next session to open after the chosen time
  let next = null;
  // sessions open on whole hours (all these zones have whole-hour offsets), so step by hour
  for (let k = 60 - (((m % 60) + 60) % 60); k <= 72 * 60 && !next; k += 60) { const o = openSessions(at + k * 60000).find((x) => !open.includes(x.name)); if (o) next = { name: o.name, k }; }
  const toMin = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3);
  const P = (v) => (v / 1440 * 100).toFixed(3) + '%';
  const wd = (t, tz) => new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short' }).format(t);
  const bneWd = wd(at, 'Australia/Brisbane');
  return html`<section class="panel">
    <div class="ph" style="padding-bottom:6px;gap:10px;flex-wrap:nowrap"><h2 style="white-space:nowrap">Market hours</h2>
      <span class="hstack" style="flex-wrap:nowrap;gap:8px;min-width:0;justify-content:flex-end" aria-live="polite">
        <b class="num" style=${`font-size:15px;${scrub != null ? 'color:#9DB8FF' : ''}`} title=${scrub == null ? 'Now, Brisbane time' : `Brisbane, ${bneWd} · release to go back to now`}>${hhmm(m)}</b>
        <span class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0" title=${`${open.length ? open.join(' + ') + ' open' : 'All closed'}${next ? ' · ' + next.name + ' opens in ' + dur(next.k) : ''}`}><b style=${`color:${open.length ? 'var(--pos)' : 'var(--text2)'}`}>${open.length ? open.map(short).join(' + ') : 'Closed'}</b>${next ? ' · ' + short(next.name) + ' ' + dur(next.k) : ''}</span></span></div>
    <div class="pb" style="padding-top:0;padding-bottom:10px">
      <div class="mh">
        <div class="mh-ticks" aria-hidden="true"><span></span><div>${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => html`<span style=${`left:${P(h * 60)};${h === 0 ? 'transform:none' : h === 24 ? 'transform:translateX(-100%)' : ''}`}>${String(h).padStart(2, '0')}</span>`)}</div></div>
        ${rows.map((r) => { const a = toMin(r.from), b = toMin(r.to), on = open.includes(r.name);
          const spans = a < b ? [[a, b]] : [[a, 1440], [0, b]];
          const x = SESSIONS.find((q) => q.name === r.name), lt = new Date(at + tzOffsetMs(x.tz, at)), lw = wd(at, x.tz);
          return html`<div class="mh-row"><span class="spread" style="flex-wrap:nowrap;padding-right:8px"><span style=${on ? 'color:var(--text);font-weight:600' : ''}>${r.name === 'New York' ? 'New York' : r.name}</span>
            <span class="num" style=${`font-size:11.5px;color:${on ? SESS_COLORS[r.name] : 'var(--mut)'}`} title=${`Local time in ${r.name}, ${lw}`}>${hhmm(lt.getUTCHours() * 60 + lt.getUTCMinutes())}</span></span><div class="mh-trk" title=${lw !== bneWd ? `${r.name}: ${lw}` : null}>
            ${spans.map(([x, y]) => html`<i style=${`left:${P(x)};width:${P(y - x)};background:${SESS_COLORS[r.name]};opacity:${on ? 1 : 0.35}`}></i>`)}</div></div>`; })}
        <div class="mh-lines" aria-hidden="true">
          <div style=${`left:${P(nowMin)};border-left:1.5px dashed rgba(255,255,255,.55)`}></div>
          ${scrub != null && html`<div style=${`left:${P(m)};border-left:2px solid var(--blue)`}><span class="mh-knob"></span></div>`}</div>
        <label class="sr" for="mhscrub">Check a time (Brisbane). Goes back to now when you let go.</label>
        <input id="mhscrub" class="mh-scrub" type="range" min="0" max="1435" step="5" value=${m} onInput=${(e) => setScrub(Number(e.target.value))}
          onPointerUp=${() => setScrub(null)} onPointerCancel=${() => setScrub(null)} onTouchEnd=${() => setScrub(null)} onBlur=${() => setScrub(null)}
          aria-valuetext=${`${hhmm(m)} Brisbane, ${open.length ? open.join(' and ') + ' open' : 'all sessions closed'}`}/>
      </div>
    </div>
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
  const rateTxt = manual[ccy] != null && manual[ccy] !== '' ? 'your rate' : fx && fx.AUD ? `ECB ${fx.date}${fx.stale ? ' (old)' : ''}` : fx ? 'enter a rate' : 'loading…';
  return html`<section class="panel">
    <div class="ph" style="padding-bottom:6px"><h2>Profit split</h2><div class="seg2" role="group" aria-label="Payout currency">${['AUD', 'NZD'].map((c) => html`<button type="button" class=${ccy === c ? 'on' : ''} aria-pressed=${ccy === c} onClick=${() => setCcy(c)}>${c}</button>`)}</div></div>
    <div class="pb stack" style="gap:7px;padding-top:0">
      <div class="hstack" style="flex-wrap:nowrap;gap:6px">
        <label class="sr" for="psacct">Account</label>
        <select id="psacct" class="inp sm" style="flex:1;min-width:0" value=${acct} onChange=${(e) => pick(e.target.value)}>
          ${list.map((p) => html`<option value=${p.id}>${p.name} · ${p.kind === 'funded' ? (p.last_payout_day ? 'since payout' : 'profit so far') : 'not funded yet'}</option>`)}
          <option value="any">Any amount</option></select>
        <label class="sr" for="psamt">Profit in USD</label>
        <div style="position:relative;width:118px;flex:0 0 118px"><span class="mut" style="position:absolute;left:9px;top:9px;font-size:11.5px">USD</span>
          <input id="psamt" class="inp sm num" style="padding-left:38px" inputmode="decimal" value=${amount} onInput=${(e) => setAmount(e.target.value)}/></div></div>
      <div class="spread" style="flex-wrap:nowrap;gap:8px">
        <div class="seg2" role="group" aria-label="Profit split" title=${note} style="flex-wrap:nowrap;flex:0 0 auto">${presets.map((v) => html`<button type="button" class=${String(v) === String(split) ? 'on' : ''} aria-pressed=${String(v) === String(split)} onClick=${() => setSplit(String(v))}>${v}%</button>`)}</div>
        <span class="sub" style="text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0" title=${`Firm keeps ${fmt.plain(amt - usd)}. ${note}`}>Share <b class="num" style="color:var(--text)">${fmt.plain(usd)}</b></span></div>
      <div class="spread" style="flex-wrap:nowrap;gap:8px;padding:7px 10px;border-radius:10px;background:#0F2A1C;border:1px solid #1D4A32" title="Before any firm fees or transfer charges. Your bank's rate on the day will differ a little.">
        <span class="cap" style="color:#8FE3B6">You receive</span>
        <span class="hstack" style="flex-wrap:nowrap;gap:8px;min-width:0">
          <span class="sub hstack" style="color:#8FE3B6;gap:3px;flex-wrap:nowrap" title=${fx && fx.source ? `${fx.source}, ${fx.date} · ${rateTxt}` : rateTxt}><label for="psrate" class="sr">USD to ${ccy} rate</label>@
            <input id="psrate" class="num" style="width:54px;background:transparent;border:0;border-bottom:1px dashed #3A6B50;color:#8FE3B6;font-size:11.5px;padding:0" inputmode="decimal"
              value=${manual[ccy] ?? (liveRate ? liveRate.toFixed(4) : '')} placeholder="rate" onInput=${(e) => setManual({ ...manual, [ccy]: e.target.value })}/></span>
          <b class="num" style="font-size:17px;color:#5BE3A0;white-space:nowrap">${local != null ? sym + local.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</b></span></div>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ economic calendar (TradingView or Myfxbook widget)

// TradingView shows event times in the viewer's own time zone (Brisbane on your devices).
// Myfxbook always starts at GMT; its time zone menu is remembered per browser.
const CAL_COUNTRIES = 'us,eu,gb,jp,au,nz,ca,ch';
const TV_CAL = (dark) => 'https://www.tradingview-widget.com/embed-widget/events/?locale=en#' + encodeURIComponent(JSON.stringify({
  colorTheme: dark ? 'dark' : 'light', isTransparent: true, width: '100%', height: '100%', importanceFilter: '1', countryFilter: CAL_COUNTRIES,
}));
const MYFX = 'https://widget.mfbcdn.net/widget/calendar.html?lang=en&impacts=3&symbols=AUD,CAD,CHF,EUR,GBP,JPY,NZD,USD';

function EconCalendar() {
  const get = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const [src, setSrc] = useState(() => get('tj.calSrc', 'tv'));
  const [dark, setDark] = useState(() => get('tj.calDark', '1') !== '0');
  const pick = (v) => { setSrc(v); put('tj.calSrc', v); };
  const flip = () => { const v = !dark; setDark(v); put('tj.calDark', v ? '1' : '0'); };
  const tv = src !== 'mfb';
  return html`<section class="panel" style="min-height:190px">
    <div class="ph"><div><h2>Economic calendar</h2><div class="sub" style="margin-top:2px">High impact${tv ? ' · your time zone' : ' · set GMT +10 once'}</div></div>
      <div class="hstack" style="gap:6px;flex-wrap:nowrap">
        <div class="seg2" role="group" aria-label="Calendar source">
          <button type="button" class=${tv ? 'on' : ''} aria-pressed=${tv} onClick=${() => pick('tv')} title="TradingView: times in your own time zone">TV</button>
          <button type="button" class=${!tv ? 'on' : ''} aria-pressed=${!tv} onClick=${() => pick('mfb')} title="Myfxbook: choose (GMT +10:00) in its time zone menu once">MFB</button></div>
        <button type="button" class="btn sm ghost" style="min-height:26px;padding:0 7px" onClick=${flip} title=${dark ? 'Light widget' : 'Dark widget'} aria-label=${dark ? 'Light widget' : 'Dark widget'}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg></button></div></div>
    <div style=${`flex:1;min-height:0;border-top:1px solid #1B212C;overflow:hidden;background:${dark ? '#10141B' : '#fff'}`}>
      ${tv ? html`<iframe key=${'tv' + dark} src=${TV_CAL(dark)} title="Economic calendar by TradingView" loading="lazy" style="width:100%;height:100%;min-height:130px;border:0;display:block"></iframe>`
        : html`<iframe key="mfb" src=${MYFX} title="Economic calendar by Myfxbook" loading="lazy" style=${`width:100%;height:100%;min-height:130px;border:0;display:block;${dark ? 'filter:invert(.9) hue-rotate(180deg)' : ''}`}></iframe>`}</div>
    <div style="padding:7px 14px;border-top:1px solid #1B212C;font-size:11px;color:#7F8897;display:flex;justify-content:space-between;gap:8px">
      <span>${tv ? 'Times shown in your device’s time zone' : 'Pick (GMT +10:00) in the widget’s time menu once per browser'}</span>
      ${tv ? html`<span><a href="https://www.tradingview.com/economic-calendar/" target="_blank" rel="noopener" style="color:#C3CAD6;font-weight:600">Economic calendar</a> by TradingView</span>`
        : html`<span><a href="https://www.myfxbook.com/forex-economic-calendar?utm_source=widget13&utm_medium=link&utm_campaign=copyright" title="Economic Calendar" target="_blank" rel="noopener" style="color:#C3CAD6;font-weight:600">Economic Calendar</a> by Myfxbook.com</span>`}</div>
  </section>`;
}
