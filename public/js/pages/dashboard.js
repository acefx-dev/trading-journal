import { html, useState, useStore, useData, api, scopeQs, fmt, sgn, cls, Kpi, Money, R, Dir, Bar, Loading, LineChart, PageHead, toast, store, setStore, reloadBoot } from '../lib.js';

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
  const now = new Date();
  const sub = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now) + ' · Australia/Brisbane';
  return html`<${PageHead} title="Dashboard" sub=${sub}/>
    <${SampleEmpty}/>
    <${Loading} state=${st}>${(d) => html`<${Body} d=${d} reload=${st.reload}/>`}<//>`;
}

function Body({ d, reload }) {
  const combined = d.accounts.length > 1;
  const showToday = d.lastDay === d.today;
  const ls = d.lastDaySummary;
  const s30 = d.stats30;
  return html`
  <section class="kpis" aria-label="Key figures">
    <${Kpi} label=${showToday ? 'Today' : d.lastDay ? 'Last session · ' + fmt.date(Date.parse(d.lastDay + 'T12:00:00+10:00')) : 'Last session'}
      value=${fmt.money(d.lastDayNet)} tone=${sgn(d.lastDayNet)}
      sub=${ls ? `${combined ? 'Combined · R-basis ' + fmt.money(d.lastDayBasis) + ' · ' : ''}${ls.count} idea${ls.count === 1 ? '' : 's'} · ${ls.wins}W ${ls.losses}L` : 'No closed trades yet'}/>
    <${Kpi} label="This month" value=${fmt.money(d.monthNet)} tone=${sgn(d.monthNet)}
      sub=${`${combined ? 'Combined · R-basis ' + fmt.money(d.monthBasis) + ' · ' : ''}${d.monthSummary.count} ideas`}/>
    <${Kpi} label="Win rate · 30 days" value=${fmt.rate(s30.winRate)} sub=${`${s30.wins} of ${s30.wins + s30.losses} ideas`}/>
    <${Kpi} label="Profit factor · 30 days" value=${fmt.pf(s30)} sub=${`Wins ${fmt.plain(s30.grossWin, 0)} / losses ${fmt.plain(s30.grossLoss, 0)}`}/>
    <${Kpi} label="Expectancy · 30 days" value=${fmt.r(s30.expectancyR)} tone=${sgn(s30.expectancyR)} sub=${`≈ ${fmt.money(s30.expectancy)} per idea`}/>
    <${Kpi} label="Max drawdown" value=${d.drawdown ? fmt.pct(-d.drawdown.maxDdPct) : '—'} tone=${d.drawdown && d.drawdown.maxDdPct ? 'neg' : ''}
      sub=${d.drawdown ? `${fmt.money(-d.drawdown.maxDd)} · ${d.drawdown.account} (closed trades)` : '—'}/>
  </section>

  ${d.open.length > 0 && html`<section class="card flush">
    <div class="card-head"><h2 class="h2">Open now</h2><span class="sub">Floating P&L updates every 15 s from MT5</span></div>
    <${IdeaTable} ideas=${d.open} open/></section>`}

  <div class="row">
    <section class="card stack" style="flex:2 1 520px">
      <div class="spread"><h2 class="h2">Return by account · this month</h2>
        <div class="hstack" style="font-size:12px;color:var(--text2)">${d.accounts.map((a, i) => html`<span class="hstack" style="gap:6px">
          <i style=${`width:16px;height:0;border-top:3px ${DASHES[i % 5] ? 'dashed' : 'solid'} ${COLORS[i % 5]};display:inline-block`}></i>${a.name}
          <b class=${cls('num', sgn(a.monthPct))}>${fmt.pct(a.monthPct)}</b></span>`)}</div></div>
      <${LineChart} label="Return by account this month" yFmt=${(v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%'}
        series=${d.accounts.map((a, i) => ({ name: a.name, color: COLORS[i % 5], dash: DASHES[i % 5], points: [{ x: firstOfMonth(), y: 0 }, ...a.curve.map((p) => ({ x: p.t, y: p.pct }))] }))}
        xLabels=${monthLabels()}/>
      <div class="sub">Each line is that account's own closed P&L as a % of its balance at the start of the month.</div>
    </section>
    <${Prep} prep=${d.prep} reload=${reload}/>
  </div>

  <div class="row">
    <section class="card flush" style="flex:3 1 700px">
      <div class="card-head"><h2 class="h2">Recent trading ideas</h2><a href="#/ideas" style="font-size:13px">View all</a></div>
      ${d.recent.length ? html`<${IdeaTable} ideas=${d.recent}/>` : html`<div class="empty">No trades yet. They appear here as soon as the MT5 connector sends them.</div>`}
    </section>
    <section class="card stack" style="flex:1 1 300px;gap:0">
      <div class="spread" style="margin-bottom:4px"><h2 class="h2">Accounts</h2><a href="#/accounts" style="font-size:13px">Manage</a></div>
      ${d.accounts.map((a) => html`<${AccountRow} a=${a}/>`)}
      ${d.accounts.length > 1 && html`<div class="sub" style="padding-top:12px">Combined balance <b class="num" style="color:var(--text)">${fmt.plain(d.accounts.reduce((x, a) => x + (a.balance || 0), 0))}</b></div>`}
    </section>
  </div>`;
}

function firstOfMonth() {
  const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date()).slice(0, 8) + '01';
  return Date.parse(t + 'T00:00:00+10:00');
}
function monthLabels() {
  const s = firstOfMonth(), out = [];
  const end = Date.now();
  const step = 7 * 86400000;
  for (let t = s; t <= end - 2 * 86400000; t += step) out.push({ x: t, label: fmt.date(t).replace(/^\w+,? /, '') });
  out.push({ x: end, label: 'now' });
  return out;
}

function AccountRow({ a }) {
  const isChallenge = a.kind === 'challenge' && a.targetPct;
  return html`<div class="stack" style="gap:8px;padding:14px 0;border-bottom:1px solid #1A1F29">
    <div class="spread"><span style="font-weight:600">${a.name}</span>
      <span class=${cls('chip', a.role === 'master' && 'b')}>${a.kind === 'funded' ? 'Funded' : a.kind === 'challenge' ? 'Challenge' : a.kind} · ${a.role === 'master' ? 'Master' : a.role === 'copy' ? 'Copy' : 'Standalone'}</span></div>
    <div class="spread"><span class="num" style="font-size:16px;font-weight:600">${fmt.plain(a.balance)}</span><span class="sub">Today <${Money} v=${a.today}/></span></div>
    ${isChallenge ? html`<div class="spread sub"><span>Profit target ${a.targetPct}%</span><span class="num">${fmt.pct(a.totalPct)} · ${Math.round(a.targetProgress || 0)}%</span></div>
      <${Bar} pct=${a.targetProgress} color=${a.targetProgress >= 100 ? 'var(--pos)' : 'var(--blue)'}/>`
      : a.maxLossPct ? html`<div class="spread sub"><span>Room to max loss (${a.maxLossPct}%)</span><span class="num">${fmt.plain(a.roomToMaxLoss, 0)}</span></div>
      <${Bar} pct=${a.roomToMaxLoss != null && a.size ? a.roomToMaxLoss / (a.size * a.maxLossPct / 100) * 100 : 0} color="var(--pos)"/>`
      : html`<div class="sub">Since start ${fmt.money(a.total)} (${fmt.pct(a.totalPct)})</div>`}
  </div>`;
}

export function IdeaTable({ ideas, open, compact }) {
  const multi = (store.boot?.accounts || []).length > 1;
  return html`<div class="scroll"><table class="tbl">
    <thead><tr><th>Opened</th><th>Idea</th><th class="hide-sm">Strategy</th><th class="r hide-sm">Positions</th>${multi && html`<th class="hide-sm">Accounts</th>`}
      <th class="r">${open ? 'Floating' : 'R'}</th><th class="r">P&L${multi ? ' (scope)' : ''}</th>${!compact && html`<th class="hide-sm">Review</th>`}</tr></thead>
    <tbody>${ideas.map((i) => html`<tr class="click" onClick=${() => { location.hash = '#/ideas/' + i.id; }}>
      <td><div style="font-weight:500">${fmt.date(i.open_time)}</div><div class="sub num">${fmt.time(i.open_time)}</div></td>
      <td><a href=${'#/ideas/' + i.id} class="hstack" style="color:var(--text);font-weight:600;flex-wrap:nowrap" onClick=${(e) => e.stopPropagation()}>${i.symbol} <${Dir} d=${i.direction}/></a></td>
      <td class="mut hide-sm">${i.strategy_name || '—'}</td>
      <td class="num r hide-sm">${i.lead_positions}</td>
      ${multi && html`<td class="hide-sm"><span class="chip b">${i.accounts.length} account${i.accounts.length > 1 ? 's' : ''}</span></td>`}
      <td class="r">${open ? html`<${Money} v=${i.floating}/>` : html`<${R} v=${i.r}/>`}</td>
      <td class="r"><${Money} v=${i.net}/></td>
      ${!compact && html`<td class="hide-sm">${i.status === 'open' ? html`<span class="chip b">Open</span>` : i.reviewed ? html`<span class="chip g">Reviewed</span>` : html`<span class="chip a">Needs review</span>`}</td>`}
    </tr>`)}</tbody></table></div>`;
}

function Prep({ prep, reload }) {
  const withItems = prep.filter((p) => p.total > 0).sort((a, b) => b.total - a.total);
  const [sel, setSel] = useState(withItems[0]?.id);
  const cur = withItems.find((p) => p.id === sel) || withItems[0];
  const [local, setLocal] = useState({});
  if (!cur) return html`<section class="card stack" style="flex:1 1 320px"><h2 class="h2">Daily preparation</h2>
    <div class="sub">Add a daily checklist to a strategy on the <a href="#/strategies">Strategies</a> page.</div></section>`;
  const items = cur.items.map((i) => ({ ...i, checked: local[i.id] ?? i.checked }));
  const done = items.filter((i) => i.checked).length;
  const toggle = async (it) => {
    setLocal({ ...local, [it.id]: !it.checked });
    try { await api('/checklists/daily', { method: 'PUT', body: { item_id: it.id, checked: !it.checked, day: cur.day } }); }
    catch (e) { toast(e.message, true); setLocal({ ...local, [it.id]: it.checked }); reload(); }
  };
  return html`<section class="card stack" style="flex:1 1 320px">
    <div class="spread" style="align-items:flex-start"><div><h2 class="h2">Daily preparation</h2><div class="sub" style="margin-top:4px">Today · resets 12:00 AM Brisbane</div></div>
      <span class="chip b num">${done} / ${items.length}</span></div>
    ${withItems.length > 1 && html`<label class="sr" for="prepsel">Strategy</label><select id="prepsel" class="inp" value=${cur.id} onChange=${(e) => setSel(Number(e.target.value))}>${withItems.map((p) => html`<option value=${p.id}>${p.name} (${p.done}/${p.total})</option>`)}</select>`}
    <${Bar} pct=${done / items.length * 100}/>
    <div>${items.map((it) => html`<label class=${cls('ck', it.checked && 'done')}><input type="checkbox" checked=${it.checked} onChange=${() => toggle(it)}/><span>${it.label}</span></label>`)}</div>
    <a href="#/strategies" class="sub">History and editing →</a>
  </section>`;
}
