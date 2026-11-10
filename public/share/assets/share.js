// Read-only shared account page. Standalone: nothing here needs the journal login.
import { h, render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const TZ = 'Australia/Brisbane';

const n2 = (v, d = 2) => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = {
  money: (v, d = 2) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + n2(v, d)),
  plain: (v, d = 2) => (v == null ? '—' : (v < 0 ? '−' : '') + '$' + n2(v, d)),
  pct: (v, d = 2) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + n2(v, d) + '%'),
  r: (v) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + n2(v) + 'R'),
  rate: (v) => (v == null ? '—' : Math.round(v * 100) + '%'),
  date: (t) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(t),
  dateY: (t) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(t),
  time: (t) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(t),
  month: (m) => new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.parse(m + '-01T00:00:00Z')),
  dur: (ms) => { const m = Math.round(ms / 60000); return m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') : Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h'; },
  ago: (t) => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; },
};
const tone = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const KIND = { funded: 'Funded', challenge: 'Challenge', personal: 'Personal', demo: 'Demo' };

function App() {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    fetch(`/share/api/${token}`, { cache: 'no-store' }).then(async (r) => {
      const j = await r.json().catch(() => ({ error: 'Could not load this page.' }));
      setSt(r.ok ? { data: j } : { error: j.error || 'Could not load this page.' });
    }).catch(() => setSt({ error: 'Could not reach the server. Check your connection and reload.' }));
  }, []);
  if (st.loading) return html`<div class="boot">Loading…</div>`;
  if (st.error) return html`<div class="msg panel"><h1 style="font-size:20px;margin:0 0 8px">Not available</h1><div class="mut">${st.error}</div></div>`;
  return html`<${Page} d=${st.data}/>`;
}

function Page({ d }) {
  const a = d.account, s = d.stats, m = d.money;
  useEffect(() => { document.title = `${a.label} · trading results (read-only)`; }, []);
  const cell = (label, value, sub, t) => html`<div class="kcell"><div class="cap">${label}</div><div class=${'kv num ' + (t || '')}>${value}</div>${sub && html`<div class="sub" style="margin-top:3px">${sub}</div>`}</div>`;
  return html`<div class="wrap">
    <header class="head">
      <div style="min-width:0"><div class="row" style="gap:10px"><h1>${a.label}</h1>
        ${a.kind && html`<span class=${'chip ' + (a.kind === 'funded' ? 'b' : a.kind === 'challenge' ? 'a' : '')}>${KIND[a.kind] || a.kind}${a.phase ? ' · ' + a.phase : ''}</span>`}
        ${a.firm && html`<span class="chip">${a.firm}</span>`}${!a.active && html`<span class="chip">Closed account</span>`}${a.sample && html`<span class="chip a">Sample data</span>`}</div>
        <div class="sub" style="margin-top:6px;font-size:12.5px">Read-only view${a.since ? ` · results since ${fmt.dateY(a.since)}` : ''} · times in Brisbane (AEST)${a.last_update ? ` · MT5 last updated ${fmt.ago(a.last_update)}` : ''}</div></div>
      ${m && a.balance != null && html`<div class="bal"><div class="cap">Balance</div><div class="num" style="font-size:22px;font-weight:600;margin-top:4px">${fmt.plain(a.balance)}</div>
        <div class="sub">${a.size ? 'Account size ' + fmt.plain(a.size, 0) : ''}${a.equity != null && Math.abs(a.equity - a.balance) > 0.005 ? ' · equity ' + fmt.plain(a.equity) : ''}</div></div>`}
    </header>

    <section class="kstrip" aria-label="Key figures">
      ${m ? cell('Net P&L', fmt.money(s.totalNet), s.netPct != null ? fmt.pct(s.netPct) + ' of account size' : `${s.count} trades`, tone(s.totalNet))
        : cell('Return', s.netPct != null ? fmt.pct(s.netPct) : '—', 'of account size, closed trades', tone(s.netPct))}
      ${cell('Trades', s.count, `${s.wins} won · ${s.losses} lost${s.breakeven ? ' · ' + s.breakeven + ' even' : ''}`)}
      ${cell('Win rate', fmt.rate(s.winRate), `Last 30 days ${fmt.rate(d.last30.winRate)}`)}
      ${cell('Profit factor', s.profitFactorInfinite ? '∞' : s.profitFactor == null ? '—' : s.profitFactor.toFixed(2), 'gross won ÷ gross lost')}
      ${cell('Expectancy', fmt.r(s.expectancyR), s.realisedRR != null ? `avg win ${fmt.r(s.avgWinR)} · loss ${fmt.r(s.avgLossR)}` : 'per trade, in R', tone(s.expectancyR))}
      ${cell('Max drawdown', d.drawdown.pct != null ? fmt.pct(-d.drawdown.pct) : m && d.drawdown.amount != null ? fmt.money(-d.drawdown.amount) : '—', m && d.drawdown.amount ? fmt.money(-d.drawdown.amount) + ' from peak' : 'from peak, closed trades', d.drawdown.pct ? 'neg' : '')}
    </section>

    <div class="grid2">
      <section class="panel"><div class="ph"><h2>${d.curveUnit === 'money' ? 'Closed P&L' : d.curveUnit === 'pct' ? 'Return (% of account size)' : 'Cumulative R'}</h2><span class="sub">${d.curve.length} closed trades</span></div>
        <div class="pb"><${Curve} pts=${d.curve} unit=${d.curveUnit}/></div></section>
      <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
        ${d.prop && html`<section class="panel"><div class="ph"><h2>Prop firm rules</h2><span class="sub">live</span></div><div class="pb" style="display:flex;flex-direction:column;gap:12px">
          ${d.prop.rules.map((r) => html`<div><div class="row sub" style="justify-content:space-between"><span>${r.label}</span><span class="num">${m && r.used != null ? `${fmt.plain(r.used, 0)} of ${fmt.plain(r.limit, 0)} · ` : ''}${Math.round(r.pct)}% used</span></div>
            <div class="bar" style="margin-top:6px"><i style=${`width:${Math.max(1.5, Math.min(100, r.pct))}%;background:${r.level === 'ok' ? 'var(--pos)' : r.level === 'warn' ? 'var(--amber)' : 'var(--neg)'}`}></i></div></div>`)}
          ${d.prop.target && html`<div><div class="row sub" style="justify-content:space-between"><span>${d.prop.target.label}</span><span class="num">${m && d.prop.target.made != null ? `${fmt.money(d.prop.target.made, 0)} of ${fmt.plain(d.prop.target.target, 0)} · ` : ''}${Math.round(d.prop.target.pct)}%</span></div>
            <div class="bar" style="margin-top:6px"><i style=${`width:${Math.max(1.5, Math.min(100, d.prop.target.pct))}%;background:${d.prop.target.reached ? 'var(--pos)' : 'var(--blue)'}`}></i></div></div>`}
        </div></section>`}
        <section class="panel" style="flex:1"><div class="ph"><h2>By month</h2></div>
          <div class="scroll" style="padding:0 6px 8px"><table><thead><tr><th>Month</th><th class="r">Trades</th><th class="r">Won</th><th class="r">${m ? 'P&L' : 'Return'}</th><th class="r">R</th></tr></thead>
            <tbody>${d.monthly.map((x) => html`<tr><td>${fmt.month(x.month)}</td><td class="num r">${x.count}</td><td class="num r">${x.wins + x.losses ? Math.round(x.wins * 100 / (x.wins + x.losses)) + '%' : '—'}</td>
              <td class=${'num r ' + tone(m ? x.net : x.pct)} style="font-weight:600">${m ? fmt.money(x.net, 0) : fmt.pct(x.pct)}</td><td class=${'num r ' + tone(x.r)}>${fmt.r(x.r)}</td></tr>`)}
            ${!d.monthly.length && html`<tr><td colspan="5" class="mut">No closed trades yet.</td></tr>`}</tbody></table></div></section>
      </div>
    </div>

    ${d.open && html`<section class="panel"><div class="ph"><h2>Open now</h2><span class="sub">${d.open.length} open</span></div>
      <div class="scroll" style="padding:0 6px 8px">${d.open.length ? html`<table><thead><tr><th>Opened</th><th>Symbol</th><th class="r">Positions</th><th class="r">Floating</th></tr></thead>
        <tbody>${d.open.map((o) => html`<tr><td>${fmt.date(o.open_time)} <span class="num mut">${fmt.time(o.open_time)}</span></td><td><b>${o.symbol}</b> <${Dir} d=${o.direction}/></td><td class="num r">${o.positions}</td>
          <td class=${'num r ' + tone(m ? o.floating : o.floatingPct)}>${m ? fmt.money(o.floating) : fmt.pct(o.floatingPct)}</td></tr>`)}</tbody></table>` : html`<div class="sub" style="padding:4px 10px 8px">No open trades.</div>`}</div></section>`}

    ${d.show.trades && html`<${Trades} d=${d}/>`}
    <div class="foot">Read-only page shared from a private trading journal. Figures come from the MetaTrader 5 account and update automatically.</div>
  </div>`;
}

function Dir({ d }) {
  return html`<span class=${'chip ' + (d === 'long' ? 'g' : 'r')} style="height:20px;font-size:11px">${d === 'long' ? 'Long' : 'Short'}</span>`;
}

function Curve({ pts, unit }) {
  if (pts.length < 2) return html`<div class="sub" style="padding:40px 0;text-align:center">Not enough closed trades to draw a curve yet.</div>`;
  const W = 760, H = 240, L = 58, R = 8, T = 10, B = 26;
  const all = [{ t: pts[0].t, v: 0 }, ...pts];
  const vs = all.map((p) => p.v), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), span = hi - lo || 1;
  const X = (k) => L + (W - L - R) * k / (all.length - 1), Y = (v) => T + (H - T - B) * (hi - v) / span;
  const line = all.map((p, k) => (k ? 'L' : 'M') + X(k).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
  const lab = (v) => (unit === 'money' ? (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US') : unit === 'pct' ? v.toFixed(1) + '%' : v.toFixed(1) + 'R');
  const ticks = [hi, (hi + lo) / 2, lo].filter((v, k, a) => a.indexOf(v) === k);
  const last = all[all.length - 1].v;
  return html`<svg viewBox=${`0 0 ${W} ${H}`} width="100%" role="img" aria-label=${`Curve over ${pts.length} trades, ending at ${lab(last)}`}>
    <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5B8CFF" stop-opacity=".25"/><stop offset="1" stop-color="#5B8CFF" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map((v) => html`<line x1=${L} x2=${W - R} y1=${Y(v)} y2=${Y(v)} stroke="#171C25"/><text x=${L - 6} y=${Y(v) + 4} fill="#7F8897" font-size="10.5" text-anchor="end" font-family="JetBrains Mono, monospace">${lab(v)}</text>`)}
    <line x1=${L} x2=${W - R} y1=${Y(0)} y2=${Y(0)} stroke="#2A3242"/>
    <path d=${line + ` L${X(all.length - 1).toFixed(1)} ${Y(0).toFixed(1)} L${L} ${Y(0).toFixed(1)} Z`} fill="url(#g)"/>
    <path d=${line} fill="none" stroke="#5B8CFF" stroke-width="2" stroke-linejoin="round"/>
    <text x=${L} y=${H - 6} fill="#7F8897" font-size="10.5">${fmt.dateY(pts[0].t)}</text>
    <text x=${W - R} y=${H - 6} fill="#7F8897" font-size="10.5" text-anchor="end">${fmt.dateY(pts[pts.length - 1].t)}</text>
  </svg>`;
}

function Trades({ d }) {
  const [open, setOpen] = useState(null);
  const [big, setBig] = useState(null);
  const [limit, setLimit] = useState(50);
  const m = d.money, notes = d.show.notes;
  const list = d.trades.slice(0, limit);
  const has = (t) => notes && (t.notes || (t.shots && t.shots.length) || (t.links && t.links.length));
  return html`<section class="panel"><div class="ph"><h2>Closed trades</h2><span class="sub">${d.trades.length} most recent${notes ? ' · click a trade with notes to see them' : ''}</span></div>
    <div class="scroll" style="padding:0 6px 8px"><table><thead><tr><th>Opened</th><th class="hide-sm">Closed</th><th>Symbol</th><th class="hide-sm">Strategy</th><th class="r hide-sm">Held</th><th class="r">R</th><th class="r">${m ? 'P&L' : 'Return'}</th>${notes && html`<th></th>`}</tr></thead>
      <tbody>${list.map((t) => html`
        <tr class=${has(t) ? 'click' : ''} onClick=${() => has(t) && setOpen(open === t.id ? null : t.id)} aria-expanded=${has(t) ? open === t.id : null}>
          <td>${fmt.date(t.open_time)} <span class="num mut">${fmt.time(t.open_time)}</span></td>
          <td class="hide-sm num mut">${fmt.date(t.close_time) !== fmt.date(t.open_time) ? fmt.date(t.close_time) + ' ' : ''}${fmt.time(t.close_time)}</td>
          <td><b>${t.symbol}</b> <${Dir} d=${t.direction}/>${t.positions > 1 ? html` <span class="sub num">×${t.positions}</span>` : ''}</td>
          <td class="hide-sm mut">${t.strategy || '—'}</td>
          <td class="r hide-sm num mut">${fmt.dur(t.close_time - t.open_time)}</td>
          <td class=${'num r ' + tone(t.r)}>${fmt.r(t.r)}</td>
          <td class=${'num r ' + tone(m ? t.net : t.pct)} style="font-weight:600">${m ? fmt.money(t.net) : fmt.pct(t.pct)}</td>
          ${notes && html`<td class="r">${has(t) ? html`<button class="btn" style="height:24px;padding:0 8px;font-size:11.5px" aria-label="Show notes">${open === t.id ? 'Hide' : 'Notes'}</button>` : ''}</td>`}
        </tr>
        ${open === t.id && html`<tr class="detail"><td colspan="8"><div style="display:flex;flex-direction:column;gap:10px;padding:4px 2px">
          ${t.notes && html`<div style="white-space:pre-wrap;line-height:1.55;color:var(--text2)">${t.notes}</div>`}
          ${t.links && t.links.length > 0 && html`<div class="row">${t.links.map((l) => html`<a class="btn" href=${l.url} target="_blank" rel="noopener noreferrer">${l.timeframe ? l.timeframe + ' · ' : ''}${l.note || 'Chart'}</a>`)}</div>`}
          ${t.shots && t.shots.length > 0 && html`<div class="shots">${t.shots.map((s) => html`<button type="button" onClick=${() => setBig(s.id)} aria-label=${'Open screenshot' + (s.timeframe ? ' ' + s.timeframe : '')}>
            <img src=${`/share/api/${token}/shot/${s.id}`} alt=${s.caption || 'Chart screenshot'} loading="lazy"/>${s.timeframe && html`<span class="chip b" style="position:absolute;left:8px;top:8px">${s.timeframe}</span>`}</button>`)}</div>`}
        </div></td></tr>`}`)}
      ${!d.trades.length && html`<tr><td colspan="8" class="mut">No closed trades yet.</td></tr>`}</tbody></table></div>
    ${d.trades.length > limit && html`<div style="padding:0 16px 14px"><button class="btn" onClick=${() => setLimit(limit + 100)}>Show more</button></div>`}
    ${big && html`<div class="lightbox" onClick=${() => setBig(null)} role="dialog" aria-label="Screenshot"><img src=${`/share/api/${token}/shot/${big}`} alt="Chart screenshot"/></div>`}
  </section>`;
}

render(html`<${App}/>`, document.getElementById('app'));
