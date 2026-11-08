import { html, useState, useStore, useData, api, scopeQs, fmt, sgn, cls, Kpi, Money, R, Loading, PageHead, Seg, LineChart, HBar } from '../lib.js';
import { SampleEmpty } from './dashboard.js';
import { sessionsInBrisbane } from '../sessions.js';

export function Analytics() {
  const s = useStore();
  const [range, setRange] = useState('90d');
  const [basis, setBasis] = useState('r');
  const st = useData(() => api(`/analytics?range=${range}&${scopeQs()}`), [range, s.acct, s.firm]);
  return html`<${PageHead} title="Analytics" sub="Closed trading ideas. R is measured on the Master (lead) account; dollars follow the account filter."/>
    <${SampleEmpty}/>
    <div class="hstack" style="gap:12px"><${Seg} label="Period" value=${range} onChange=${setRange} options=${[['30d', '30 days'], ['90d', '90 days'], ['month', 'This month'], ['ytd', 'This year'], ['all', 'All time']]}/>
      <${Seg} label="Curve" value=${basis} onChange=${setBasis} options=${[['r', 'Curve in R'], ['usd', 'Curve in $']]}/></div>
    <${Loading} state=${st}>${(d) => html`<${Body} d=${d} basis=${basis}/>`}<//>`;
}

function GroupTable({ rows, keyLabel, name = (g) => g.key }) {
  if (!rows.length) return html`<div class="empty">No data.</div>`;
  return html`<div class="scroll"><table class="tbl"><thead><tr><th>${keyLabel}</th><th class="r">Ideas</th><th class="r">Win rate</th><th class="r">Expectancy</th><th class="r">Avg win / loss</th><th class="r">Profit factor</th><th class="r">Net P&L</th></tr></thead>
    <tbody>${[...rows].sort((a, b) => b.totalNet - a.totalNet).map((g) => html`<tr><td style="font-weight:500">${name(g)}</td><td class="num r">${g.count}</td>
      <td class="num r">${fmt.rate(g.winRate)}</td><td class="r"><${R} v=${g.expectancyR}/></td>
      <td class="num r">${g.avgWinR != null ? g.avgWinR.toFixed(2) : '—'} / ${g.avgLossR != null ? Math.abs(g.avgLossR).toFixed(2) : '—'}</td>
      <td class="num r">${fmt.pf(g)}</td><td class="r"><${Money} v=${g.totalNet} dec=${0}/></td></tr>`)}</tbody></table></div>`;
}

function Body({ d, basis }) {
  const s = d.summary;
  if (!d.count) return html`<div class="card empty">No closed ideas in this period.</div>`;
  const b = d.behaviour;
  const maxSym = Math.max(1, ...d.bySymbol.map((x) => Math.abs(x.totalNet)));
  const maxSes = Math.max(1, ...d.bySession.map((x) => Math.abs(x.totalNet)));
  const maxDow = Math.max(1, ...b.byWeekday.map((x) => Math.abs(x.totalNet)));
  const maxB = Math.max(1, ...d.rBuckets.map((x) => x.count));
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const cmp = (label, x, note) => html`<div class="well stack" style="gap:6px"><span class="lbl">${label}</span>
    <span class=${cls('num', sgn(x.expectancyR))} style="font-size:20px;font-weight:600">${x.count ? fmt.r(x.expectancyR) + ' avg' : '—'}</span>
    <span class="sub">${x.count} ideas · ${fmt.rate(x.winRate)} win rate${note ? ' · ' + note : ''}</span></div>`;
  return html`
  ${d.count < 30 && html`<div class="warn">Only ${d.count} closed idea${d.count === 1 ? '' : 's'} in this period. Treat these numbers as a record, not proof of an edge; they settle after 50–100 ideas per strategy.</div>`}
  ${d.rKnown < d.count && html`<div class="warn">${d.count - d.rKnown} idea(s) have no known risk (no stop-loss seen), so they're left out of R figures.</div>`}
  <section class="kpis">
    <${Kpi} label="Win rate" value=${fmt.rate(s.winRate)} sub=${`${s.wins}W · ${s.losses}L${s.breakeven ? ' · ' + s.breakeven + ' BE' : ''}`}/>
    <${Kpi} label="Expectancy" value=${fmt.r(s.expectancyR)} tone=${sgn(s.expectancyR)} sub=${`≈ ${fmt.money(s.expectancy)} per idea`}/>
    <${Kpi} label="Profit factor" value=${fmt.pf(s)} sub=${`${fmt.plain(s.grossWin, 0)} / ${fmt.plain(s.grossLoss, 0)}`}/>
    <${Kpi} label="Avg win / avg loss" value=${s.avgWinR != null ? `${s.avgWinR.toFixed(2)}R / ${Math.abs(s.avgLossR || 0).toFixed(2)}R` : '—'} sub=${`Realised R:R ${s.realisedRR ?? '—'}`}/>
    <${Kpi} label="Max drawdown" value=${d.byAccount.length ? fmt.pct(-Math.max(...d.byAccount.map((a) => a.drawdownPct))) : '—'} tone="neg" sub="Worst account, closed trades in period"/>
    <${Kpi} label="Net P&L" value=${fmt.money(s.totalNet, 0)} tone=${sgn(s.totalNet)} sub=${`${d.count} ideas · gross ${fmt.money(s.gross, 0)}`}/>
    <${Kpi} label="Costs" value=${fmt.money(s.commission + s.swap + s.fee)} tone=${sgn(s.commission + s.swap + s.fee)}
      sub=${`Commission ${fmt.money(s.commission)} · swap ${fmt.money(s.swap)} · fees ${fmt.money(s.fee)}`}/>
  </section>
  <div class="row">
    <section class="card stack" style="flex:3 1 560px"><h2 class="h2">Cumulative ${basis === 'r' ? 'R (lead account)' : 'P&L (scope)'}</h2>
      <${LineChart} label="Cumulative result" yFmt=${basis === 'r' ? (v) => (Number.isInteger(v) ? v : v.toFixed(1)) + 'R' : (v) => '$' + Math.round(v).toLocaleString('en-US')}
        series=${[{ color: '#5B8CFF', points: [{ x: 0, y: 0 }, ...d.curve.map((p, i) => ({ x: i + 1, y: basis === 'r' ? p.r : p.net }))] }]}
        xLabels=${[{ x: 0, label: 'start' }, { x: d.curve.length, label: 'idea ' + d.curve.length }]}/></section>
    <section class="card stack" style="flex:2 1 340px"><h2 class="h2">R distribution</h2>
      <div style="display:flex;gap:10px;align-items:flex-end;height:170px;padding-top:10px" role="img" aria-label=${d.rBuckets.map((x) => x.label + ': ' + x.count).join(', ')}>
        ${d.rBuckets.map((x, i) => html`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">
          <span class="num sub">${x.count}</span><div style=${`width:100%;height:${Math.round(x.count / maxB * 120)}px;min-height:2px;border-radius:6px 6px 0 0;background:${i < 2 ? 'var(--neg)' : 'var(--pos)'}`}></div><span class="sub" style="text-align:center">${x.label}</span></div>`)}</div></section>
  </div>
  <section class="card flush"><div class="card-head"><h2 class="h2">Strategy performance</h2></div><${GroupTable} rows=${d.byStrategy} keyLabel="Strategy" name=${(g) => g.name}/></section>
  <section class="card flush"><div class="card-head"><div><h2 class="h2">Account performance</h2><div class="sub" style="margin-top:4px">Each account's own result in the ideas it took part in</div></div></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Account</th><th>Role</th><th class="r">Ideas</th><th class="r">Win rate</th><th class="r">Expectancy</th><th class="r">Profit factor</th><th class="r">Max DD</th><th class="r">Net P&L</th></tr></thead>
    <tbody>${d.byAccount.map((a) => html`<tr><td style="font-weight:500">${a.name}</td><td class="mut">${a.role === 'master' ? 'Master' : a.role === 'copy' ? 'Copy' : 'Standalone'}</td><td class="num r">${a.count}</td><td class="num r">${fmt.rate(a.winRate)}</td>
      <td class="r"><${R} v=${a.expectancyR}/></td><td class="num r">${fmt.pf(a)}</td><td class="num r neg">${fmt.pct(-a.drawdownPct)}</td><td class="r"><${Money} v=${a.totalNet} dec=${0}/></td></tr>`)}</tbody></table></div></section>
  <div class="row">
    <section class="card stack" style="flex:1 1 360px"><h2 class="h2">By instrument</h2>${d.bySymbol.sort((a, b) => b.totalNet - a.totalNet).map((x) => html`<${HBar} label=${x.key} sub=${`${x.count} ideas · ${fmt.rate(x.winRate)}`} value=${x.totalNet} max=${maxSym}/>`)}</section>
    <section class="card stack" style="flex:1 1 360px"><h2 class="h2">By session</h2>${d.bySession.sort((a, b) => b.totalNet - a.totalNet).map((x) => html`<${HBar} label=${x.key} sub=${`${x.count} ideas · ${fmt.r(x.expectancyR)}`} value=${x.totalNet} max=${maxSes}/>`)}
      <div class="sub">By each trade's open time. Sessions use each city's local hours (Sydney 07–16, Tokyo 09–18, London 08–17, New York 08–17), so daylight saving is handled.
        Today in Brisbane: ${sessionsInBrisbane().map((x) => `${x.name} ${x.from}–${x.to}`).join(' · ')}. Where two overlap, the trade counts for the one that opened last.</div></section>
    <section class="card stack" style="flex:1 1 360px"><h2 class="h2">By weekday</h2>${b.byWeekday.sort((a, c) => DOW.indexOf(a.key) - DOW.indexOf(c.key)).map((x) => html`<${HBar} label=${x.key} sub=${`${x.count} ideas`} value=${x.totalNet} max=${maxDow}/>`)}</section>
  </div>
  <section class="card stack"><h2 class="h2">Trading behaviour</h2>
    <div class="grid2">
      ${cmp('Checklist fully complete', b.checklistComplete)}
      ${cmp('Checklist incomplete', b.checklistIncomplete, b.noChecklist ? b.noChecklist + ' without a strategy' : '')}
      ${cmp('No mistakes tagged', b.clean)}
      ${cmp('The idea after a losing idea', b.afterLoss)}
      ${cmp('3rd+ idea of the day', b.thirdPlusOfDay)}
    </div>
    ${b.mistakes.length ? html`<div class="scroll"><table class="tbl"><thead><tr><th>Mistake</th><th class="r">Ideas</th><th class="r">Expectancy</th><th class="r">Net P&L</th></tr></thead>
      <tbody>${b.mistakes.map((m) => html`<tr><td>${m.label}</td><td class="num r">${m.count}</td><td class="r"><${R} v=${m.expectancyR}/></td><td class="r"><${Money} v=${m.totalNet} dec=${0}/></td></tr>`)}</tbody></table></div>`
      : html`<div class="sub">Tag mistakes on your trade reviews to see their cost here.</div>`}
    ${b.byRating.length > 0 && html`<div class="stack" style="gap:6px"><span class="lbl">Result by your execution rating</span><div class="hstack">${b.byRating.sort((x, y) => x.key - y.key).map((r) => html`<span class="chip">${'★'.repeat(r.key)} · ${r.count} · <span class=${sgn(r.expectancyR)}>${fmt.r(r.expectancyR)}</span></span>`)}</div></div>`}
  </section>
  ${d.byMonth.length > 1 && html`<section class="card flush"><div class="card-head"><h2 class="h2">By month</h2></div><${GroupTable} rows=${d.byMonth} keyLabel="Month"/></section>`}`;
}
