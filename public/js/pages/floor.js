// Trading Floor: plan → size → trade → stay disciplined, in one screen.
// Top bar (trading window, news guard, today's count, live quotes), then three columns:
// 1 prep + game plan · 2 position size, risk budget, open idea · 3 your edge, A+ setup, next events.
import { html, useState, useEffect, useRef, useStore, useData, api, fmt, sgn, cls, Bar, Dir, Money, R, Loading, PageHead, Modal, toast } from '../lib.js';
import { Prep, Sessions, EconCalendar, ProfitSplit, SampleEmpty } from './dashboard.js';
import { sessionOf } from '../sessions.js';

const TZ = 'Australia/Brisbane';
const bneHM = (t) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
const bneDayOf = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(t);
const bneDayLabel = (t) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(t);
const dayStart = (t) => Date.parse(bneDayOf(t) + 'T00:00:00+10:00');
const hmToMs = (hm, base) => base + (+hm.slice(0, 2) * 60 + +hm.slice(3, 5)) * 60000;
const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const avg = (xs) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null);
const fR = (v) => (v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + 'R');

function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, []);
  return now;
}

function floorSettings(s) {
  const raw = s.boot.settings || {};
  const [w0, w1] = String(raw.trade_window || '10:00-14:00').split('-');
  return {
    w0, w1,
    maxIdeas: Number(raw.max_ideas_day ?? 2), lossStop: Number(raw.loss_stop ?? 2), pause: Number(raw.news_pause_min ?? 15),
    quotes: String(raw.quote_symbols || 'OANDA:JP225USD=JP225,OANDA:NAS100USD=NAS100,FX:USDJPY=USDJPY').split(',').map((x) => x.trim()).filter(Boolean)
      .map((x) => { const [proName, title] = x.split('='); return { proName, title: title || proName.split(':').pop() }; }),
  };
}

export function Floor() {
  const s = useStore();
  const [modal, setModal] = useState(null);
  const [focus, setFocus] = useState(() => { try { return localStorage.getItem('tj.focus') === '1'; } catch { return false; } });
  const dash = useData(() => api('/dashboard?acct=all'), [s.mode]);
  const plan = useData(() => api('/plan'), [s.mode]);
  const events = useData(() => api('/events?n=12').catch((e) => ({ items: [], error: e.message })), []);
  const sub = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()) + ' · Brisbane';
  const toggleFocus = () => { const v = !focus; setFocus(v); try { localStorage.setItem('tj.focus', v ? '1' : '0'); } catch { /* ignore */ } };
  return html`<${PageHead} title="Trading Floor" sub=${sub} filter=${false}>
      <div class="hstack floor-tools" style="gap:6px">
        <button type="button" class="btn sm" onClick=${() => setModal('cal')}>Calendar</button>
        <button type="button" class="btn sm" onClick=${() => setModal('hours')}>Market hours</button>
        <button type="button" class="btn sm" onClick=${() => setModal('split')}>Profit split</button>
        <button type="button" class=${cls('btn sm', focus && 'pri')} aria-pressed=${focus} onClick=${toggleFocus} title="Only the trading window, sizing, risk and the open idea">Focus mode</button>
        <button type="button" class="btn sm" onClick=${() => setModal('debrief')}>End-of-day debrief</button></div><//>
    <${SampleEmpty}/>
    <${Loading} state=${dash}>${(d) => html`
      <${FloorBar} d=${d} events=${events.data}/>
      <div class=${cls('floor2 fill', focus && 'focus')}>
        ${!focus && html`<div class="colstack">
          <${Prep} prep=${d.prep} reload=${dash.reload}/>
          <${GamePlan} st=${plan}/>
        </div>`}
        <div class="colstack">
          <${SizeTrade}/>
          <${RiskBudget} accounts=${d.accounts}/>
          <${OpenNow} ideas=${d.open}/>
        </div>
        ${!focus && html`<div class="colstack">
          <${Edge}/>
          <${UpNext} st=${events} onCalendar=${() => setModal('cal')}/>
        </div>`}
      </div>
      ${modal === 'split' && html`<${Modal} title="Profit split" onClose=${() => setModal(null)}><${ProfitSplit} payouts=${d.payouts}/><//>`}`}<//>
    ${modal === 'cal' && html`<${Modal} title="Economic calendar" wide onClose=${() => setModal(null)}><div style="height:min(70vh,640px);display:flex;flex-direction:column"><${EconCalendar}/></div><//>`}
    ${modal === 'hours' && html`<${Modal} title="Market hours" wide onClose=${() => setModal(null)}><${Sessions}/><//>`}
    ${modal === 'debrief' && html`<${Debrief} st=${plan} onClose=${() => setModal(null)}/>`}`;
}

// ------------------------------------------------------------------ top bar

function FloorBar({ d, events }) {
  const s = useStore();
  const now = useNow();
  const cfg = floorSettings(s);
  const base = dayStart(now), t0 = hmToMs(cfg.w0, base), t1 = hmToMs(cfg.w1, base);
  const before = now < t0, after = now >= t1, open = !before && !after;
  const pct = open ? (now - t0) / (t1 - t0) * 100 : after ? 100 : 0;
  // news inside (or touching) the window, with the pause either side
  const evs = (events && events.items) || [];
  const pauseMs = cfg.pause * 60000;
  const clash = evs.filter((e) => e.t + pauseMs >= Math.max(now, t0) && e.t - pauseMs <= t1 && e.t + pauseMs >= now);
  const nextEv = evs.find((e) => e.t >= now - pauseMs);
  const inPause = evs.find((e) => now >= e.t - pauseMs && now <= e.t + pauseMs);
  // today's ideas (opened today, Brisbane), realised P&L and losses in a row
  const today = bneDayOf(now);
  const all = [...d.open, ...d.recent].filter((i) => bneDayOf(i.open_time) === today);
  const closed = all.filter((i) => i.status !== 'open').sort((a, b) => a.close_time - b.close_time);
  let streak = 0; for (let k = closed.length - 1; k >= 0 && closed[k].net < 0; k--) streak++;
  const lossesToday = closed.filter((i) => i.net < 0).length;
  const stop = cfg.lossStop > 0 && lossesToday >= cfg.lossStop;
  const full = cfg.maxIdeas > 0 && all.length >= cfg.maxIdeas;
  const quotes = 'https://www.tradingview-widget.com/embed-widget/tickers/?locale=en#' + encodeURIComponent(JSON.stringify({
    symbols: cfg.quotes, colorTheme: 'dark', isTransparent: true, showSymbolLogo: false, width: '100%', height: 72 }));
  return html`<section class="card fbar" aria-label="Session status">
    <div class="fb-win"><div class="spread" style="flex-wrap:nowrap"><span><b>Your window</b> <span class="sub">${cfg.w0}–${cfg.w1}</span></span><span class="num sub" style="color:var(--text)">${bneHM(now)}</span></div>
      <${Bar} pct=${pct} color=${open ? 'var(--pos)' : '#3A4252'}/>
      <div class="sub">${open ? html`<span class="pos">Open</span> · ${dur(t1 - now)} left · ${sessionOf(now)} session` : before ? `Opens in ${dur(t0 - now)}` : 'Closed for today · time for the debrief'}</div></div>
    <div class="fb-cell"><div class="cap">News guard</div>
      ${inPause ? html`<div class="fb-v" style="color:var(--neg)">Pause now: ${inPause.ccy} ${inPause.title}</div><div class="sub">No new trades until ${bneHM(inPause.t + pauseMs)}</div>`
        : clash.length ? html`<div class="fb-v" style="color:var(--amber)">${clash[0].ccy} ${clash[0].title} at ${bneHM(clash[0].t)}</div><div class="sub">Pause ${bneHM(clash[0].t - pauseMs)}–${bneHM(clash[0].t + pauseMs)}${clash.length > 1 ? ` · +${clash.length - 1} more` : ''}</div>`
        : html`<div class="fb-v">No high-impact news in your window</div><div class="sub">${nextEv ? `Next: ${nextEv.ccy} ${nextEv.title} ${bneDayOf(nextEv.t) === today ? '' : bneDayLabel(nextEv.t) + ' '}${bneHM(nextEv.t)}` : events && events.error ? 'Event feed unavailable' : events ? 'Nothing else this week' : 'Loading events…'}</div>`}</div>
    <div class="fb-cell"><div class="cap">Today</div>
      <div class="fb-v" style=${stop || full ? 'color:var(--neg)' : ''}>${stop ? `Stop for today · ${lossesToday} losses` : html`<span class="num">${all.length}</span>${cfg.maxIdeas ? ` of ${cfg.maxIdeas}` : ''} ideas · <${Money} v=${d.todayNet} dec=${0}/> realised`}</div>
      <div class="sub">${full && !stop ? 'Idea limit reached for today' : `Losses in a row: ${streak}${cfg.lossStop ? ` · stop at ${cfg.lossStop} losses` : ''}`}</div></div>
    <div class="fb-quotes"><iframe src=${quotes} title="Live prices by TradingView" loading="lazy" scrolling="no"></iframe></div>
  </section>`;
}

// ------------------------------------------------------------------ 2 · game plan

function GamePlan({ st }) {
  const [data, setData] = useState(null);
  const [saved, setSaved] = useState(null);
  const [day, setDay] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    if (!st.data) return;
    const p = st.data;
    const mk = (sym) => ({ symbol: sym, bias: '', levels: p.defaults.levels.map((l) => ({ label: l, value: '' })), plan: '' });
    setData(p.markets && p.markets.length ? p.markets : p.defaults.markets.map(mk));
    setSaved(p.updated_at);
    setDay(p.day);
  }, [st.data]);
  const save = (next) => {
    setData(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { await api('/plan', { method: 'PUT', body: { day, markets: next } }); setSaved(Date.now()); } catch (e) { toast(e.message, true); }
    }, 700);
  };
  const upd = (k, f) => save(data.map((m, j) => (j === k ? f(m) : m)));
  const BIAS = [['long', '▲ Long', 'g'], ['wait', 'Wait', ''], ['short', '▼ Short', 'r']];
  return html`<section class="panel" style="min-height:220px">
    <div class="ph"><div><h2>Game plan</h2><div class="sub" style="margin-top:2px">${saved ? `Saved ${bneHM(saved)}` : 'Write it before your first trade'} · shown on each idea's review</div></div></div>
    <div class="scrolly" style="padding:0 14px 12px;display:flex;flex-direction:column;gap:10px">
      ${!data ? html`<div class="sub">Loading…</div>` : data.map((m, k) => html`<div class="gpm">
        <div class="spread" style="flex-wrap:nowrap;margin-bottom:8px"><b>${m.symbol}</b>
          <div class="seg2" role="group" aria-label=${m.symbol + ' bias'}>${BIAS.map(([v, l]) => html`<button type="button" class=${m.bias === v ? 'on' : ''} aria-pressed=${m.bias === v} onClick=${() => upd(k, (x) => ({ ...x, bias: x.bias === v ? '' : v }))}>${l}</button>`)}</div></div>
        <div class="gplv">${m.levels.map((l, j) => html`<label class="sub" for=${`lv${k}_${j}`} style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.label}</label>
          <input id=${`lv${k}_${j}`} class="inp sm num" inputmode="decimal" value=${l.value} placeholder="—" onInput=${(e) => upd(k, (x) => ({ ...x, levels: x.levels.map((y, i) => (i === j ? { ...y, value: e.target.value } : y)) }))}/>`)}</div>
        <label class="sr" for=${'pl' + k}>${m.symbol} plan</label>
        <textarea id=${'pl' + k} class="inp gpplan" rows="2" placeholder=${'If … then …  e.g. buy a pullback into the range after a sweep; no trade below …'}
          value=${m.plan} onInput=${(e) => upd(k, (x) => ({ ...x, plan: e.target.value }))}></textarea>
      </div>`)}
      <div class="sub">Markets and level names: Settings → Trading Floor.</div>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ 3 · size the trade

function SizeTrade() {
  const sz = useData(() => api('/sizing'), []);
  const [f, setF] = useState(() => { try { return JSON.parse(sessionStorage.getItem('tj.size') || '{}'); } catch { return {}; } });
  const set = (k) => (e) => { const v = { ...f, [k]: e.target.value }; setF(v); try { sessionStorage.setItem('tj.size', JSON.stringify(v)); } catch { /* ignore */ } };
  const accts = sz.data ? sz.data.accounts : [];
  const symbols = [...new Set(accts.flatMap((a) => Object.keys(a.values)))].sort();
  const sym = f.sym && symbols.includes(f.sym) ? f.sym : symbols[0] || '';
  const entry = Number(String(f.entry || '').replace(/,/g, '')), stop = Number(String(f.stop || '').replace(/,/g, '')), tgt = Number(String(f.target || '').replace(/,/g, ''));
  const dist = entry > 0 && stop > 0 ? Math.abs(entry - stop) : 0;
  const rr = dist && tgt > 0 ? Math.abs(tgt - entry) / dist : null;
  const dir = entry && stop ? (stop < entry ? 'long' : 'short') : null;
  const masterName = (id) => (accts.find((a) => a.id === id) || {}).name || 'its master';
  return html`<section class="panel">
    <div class="ph"><div><h2>Size the trade</h2><div class="sub" style="margin-top:2px">Lots from each account's per-idea limit</div></div>${dir && html`<${Dir} d=${dir}/>`}</div>
    <div class="pb stack" style="gap:10px;padding-top:0">
      <div class="szin">
        <label class="stack" style="gap:4px"><span class="sub">Market</span><select class="inp sm" onChange=${set('sym')}>${symbols.length ? symbols.map((x) => html`<option value=${x} selected=${x === sym}>${x}</option>`) : html`<option value="">no trades yet</option>`}</select></label>
        <label class="stack" style="gap:4px"><span class="sub">Entry</span><input class="inp sm num" inputmode="decimal" value=${f.entry || ''} onInput=${set('entry')}/></label>
        <label class="stack" style="gap:4px"><span class="sub">Stop</span><input class="inp sm num" inputmode="decimal" value=${f.stop || ''} onInput=${set('stop')}/></label>
        <label class="stack" style="gap:4px"><span class="sub">Target</span><input class="inp sm num" inputmode="decimal" value=${f.target || ''} placeholder="optional" onInput=${set('target')}/></label>
      </div>
      <div class="sub">${dist ? html`Stop <b class="num" style="color:var(--text)">${fmt.num(dist, 2)}</b> points${rr != null ? html` · target <b class="num" style="color:var(--text)">${rr.toFixed(2)}R</b>` : ''}` : 'Enter the entry and stop prices.'}</div>
      <div>${sz.loading && !sz.data ? html`<div class="sub">Loading…</div>` : accts.map((a) => {
        const v = a.values[sym];
        let lots = null, note = '';
        if (a.role === 'copy') note = `copied from ${masterName(a.master_account_id)}`;
        else if (!a.limit) note = 'no per-idea limit set (Accounts)';
        else if (!v) note = `no ${sym || 'recent'} trades with a stop yet`;
        else if (dist) lots = Math.floor(a.limit / (dist * v.vpp) * 100) / 100;
        return html`<div class="szrow">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.name} <span class="sub">${note ? '· ' + note : v ? `· ${v.raw}` : ''}</span></span>
          <span class="num sub r">${a.limit && a.role !== 'copy' ? fmt.plain(a.limit) : ''}</span>
          <b class="num r" style="font-size:14px">${lots != null ? (lots > 0 ? lots.toFixed(2) + ' lots' : 'stop too wide') : a.role === 'copy' ? '—' : ''}</b></div>`; })}
      </div>
      <div class="sub">Point value per lot is learned from your own recent trades on each account. The journal only calculates: place the order in the Risk Guard Rail panel.</div>
    </div>
  </section>`;
}

function RiskBudget({ accounts }) {
  const list = accounts.filter((a) => a.riskToday && a.riskToday.limit);
  return html`<section class="panel">
    <div class="ph"><h2>Risk budget · today</h2><span class="sub">daily limit</span></div>
    <div class="pb" style="padding-top:0">${list.length ? list.map((a, k) => {
      const r = a.riskToday, pct = r.used / r.limit * 100;
      return html`<div class="rbrow" style=${k ? 'border-top:1px solid #161B24' : ''}>
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b style="font-weight:500">${a.name}</b>${r.tradeLimit ? html` <span class="sub">· per idea ${fmt.plain(r.tradeLimit)}</span>` : ''}</span>
        <span class="num"><span class=${r.level === 'over' ? 'neg' : ''}>${fmt.plain(r.used)}</span> <span class="sub">of ${fmt.plain(r.limit)}</span></span>
        <span style="grid-column:1/-1"><${Bar} pct=${pct} color=${r.level === 'over' ? 'var(--neg)' : pct >= 70 ? 'var(--amber)' : 'var(--pos)'}/></span></div>`; })
      : html`<div class="sub">Set a max risk per day on each account (Accounts → Edit) to track it here.</div>`}</div>
  </section>`;
}

function OpenNow({ ideas }) {
  return html`<section class="panel" style="min-height:120px">
    <div class="ph"><h2>Open now</h2><a href="#/ideas" style="font-size:12px">Ideas</a></div>
    <div class="scrolly" style="padding:0 14px 12px">${ideas.length ? ideas.map((i, k) => {
      const rNow = i.risk > 0 ? i.floating / i.risk : null;
      return html`<a href=${'#/ideas/' + i.id} class="opnow" style=${k ? 'border-top:1px solid #161B24' : ''}>
        <span class="spread" style="flex-wrap:nowrap"><span class="hstack" style="gap:8px;flex-wrap:nowrap"><b style="color:var(--text)">${i.symbol}</b><${Dir} d=${i.direction}/><span class="sub">since ${bneHM(i.open_time)}${i.accounts.length > 1 ? ` · ${i.accounts.length} accounts` : ''}</span></span>
          <b class=${cls('num', sgn(rNow))} style="font-size:15px">${rNow == null ? '' : fR(rNow)}</b></span>
        <span class="opgrid"><span><span class="cap">Floating</span><br/><${Money} v=${i.floating}/></span>
          <span><span class="cap">Risk held</span><br/><span class="num">${i.risk > 0 ? fmt.plain(i.risk) : 'no S/L'}</span></span>
          <span><span class="cap">Best so far</span><br/><span class="num">${i.path && i.path.mfe_r != null ? fR(i.path.mfe_r) : '—'}</span></span></span></a>`; })
      : html`<div class="sub" style="padding:6px 0">No open trades.</div>`}</div>
  </section>`;
}

// ------------------------------------------------------------------ 4 · your edge + A+ setup

function Edge() {
  const s = useStore();
  const st = useData(() => api('/analytics/ideas?acct=all'), [s.mode]);
  const [ticks, setTicks] = useState({});
  const now = Date.now();
  const cfg = floorSettings(s);
  if (!st.data) return html`<section class="panel"><div class="ph"><h2>Your edge right now</h2></div><div class="pb sub">${st.error || 'Loading…'}</div></section>`;
  const from = now - 60 * 86400000;
  const ideas = st.data.ideas.filter((i) => i.open_time >= from && i.close_time && i.r != null);
  // the session that matters now: the current one, or the one your window opens in
  // ideas opened inside your trading window (time of day, Brisbane)
  const minOf = (t) => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(t).split(':'); return +p[0] * 60 + +p[1]; };
  const wA = +cfg.w0.slice(0, 2) * 60 + +cfg.w0.slice(3, 5), wB = +cfg.w1.slice(0, 2) * 60 + +cfg.w1.slice(3, 5);
  const inSess = ideas.filter((i) => { const m = minOf(i.open_time); return wA <= wB ? m >= wA && m < wB : m >= wA || m < wB; });
  const counts = {};
  for (const i of inSess) if (i.strategy_id) counts[i.strategy_id] = (counts[i.strategy_id] || 0) + 1;
  const topId = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const topIdeas = inSess.filter((i) => String(i.strategy_id) === topId);
  const strat = topId ? s.boot.strategies.find((x) => String(x.id) === topId) : null;
  const notes = [];
  if (strat && topIdeas.length >= 3) {
    const wins = topIdeas.filter((i) => i.r > 0).length;
    const byHour = {};
    for (const i of topIdeas) { const h = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', hour12: false }).format(i.open_time); (byHour[h] ||= []).push(i.r); }
    const best = Object.entries(byHour).filter(([, v]) => v.length >= 2).sort((a, b) => avg(b[1]) - avg(a[1]))[0];
    notes.push({ ic: '◎', c: 'b', html: html`<b>${strat.name}</b> in your window: ${topIdeas.length} ideas in 60 days · <b class=${wins / topIdeas.length >= 0.5 ? 'pos' : 'neg'}>${Math.round(wins / topIdeas.length * 100)}% win</b> · ${fR(avg(topIdeas.map((i) => i.r)))} average${best ? html`. Best from ${best[0]}:00 (${fR(avg(best[1]))})` : ''}.` });
  }
  // top mistake this month
  const m0 = Date.parse(bneDayOf(now).slice(0, 8) + '01T00:00:00+10:00');
  const mc = {};
  for (const i of ideas.filter((x) => x.open_time >= m0)) for (const id of i.mistakes || []) { (mc[id] ||= { n: 0, r: 0 }); mc[id].n++; mc[id].r += i.r; }
  const topM = Object.entries(mc).sort((a, b) => b[1].n - a[1].n || a[1].r - b[1].r)[0];
  if (topM) {
    const label = (st.data.mistakes.find((x) => String(x.id) === topM[0]) || {}).label || 'A mistake';
    notes.push({ ic: '!', c: 'a', html: html`Top mistake this month: <b>${label.toLowerCase()}</b> (${topM[1].n} time${topM[1].n > 1 ? 's' : ''}, ${fR(topM[1].r)}).` });
  }
  // after N losses in a day
  if (cfg.lossStop > 0) {
    const byDay = {};
    for (const i of ideas) (byDay[bneDayOf(i.open_time)] ||= []).push(i);
    const after = [];
    for (const list of Object.values(byDay)) {
      list.sort((a, b) => a.open_time - b.open_time);
      let losses = 0;
      for (const i of list) { if (losses >= cfg.lossStop) after.push(i.r); if (i.r < 0) losses++; }
    }
    if (after.length >= 2) notes.push({ ic: '■', c: 'r', html: html`After <b>${cfg.lossStop} losses in a day</b>, your next ${after.length} trades averaged <b class=${sgn(avg(after))}>${fR(avg(after))}</b>.${avg(after) < 0 ? ' Stop for the day there.' : ''}` });
  }
  // with vs against the bias
  const w = ideas.filter((i) => i.align === 'with').map((i) => i.r), a = ideas.filter((i) => i.align === 'against').map((i) => i.r);
  if (w.length >= 2 && a.length >= 2) notes.push({ ic: '✓', c: 'g', html: html`Trades <b>with your bias</b> averaged <b class=${sgn(avg(w))}>${fR(avg(w))}</b>; against it <b class=${sgn(avg(a))}>${fR(avg(a))}</b>.` });
  const rules = strat ? st.data.rules.filter((r) => r.strategy_id === strat.id) : [];
  return html`<section class="panel" style="min-height:180px">
    <div class="ph"><h2>Your edge right now</h2><span class="sub">last 60 days</span></div>
    <div class="scrolly" style="padding:0 14px 12px">
      ${notes.length ? notes.map((n, k) => html`<div class="edge" style=${k ? 'border-top:1px solid #161B24' : ''}><span class=${'eic ' + n.c} aria-hidden="true">${n.ic}</span><span>${n.html}</span></div>`)
        : html`<div class="sub" style="padding:6px 0">Not enough reviewed trades yet. Notes appear after a few weeks of trades with strategies, mistakes and a daily bias.</div>`}
      ${rules.length > 0 && html`<div class="cap" style="margin:14px 0 4px">A+ setup · ${strat.name}</div>
        ${rules.map((r) => html`<label class="ck" style="min-height:28px;font-size:12.5px;gap:10px"><input type="checkbox" checked=${!!ticks[r.id]} onChange=${() => setTicks({ ...ticks, [r.id]: !ticks[r.id] })} style="width:15px;height:15px"/><span>${r.label}</span></label>`)}
        <div class="sub" style="margin-top:4px">Tick as you check the chart; this list resets each visit.</div>`}
    </div>
  </section>`;
}

/** The week's remaining high-impact events, grouped by day, in Brisbane time. */
export function UpNext({ st, onCalendar, n = 12, compact }) {
  const items = st.data && st.data.items ? st.data.items.slice(0, n) : [];
  let lastDay = '';
  const today = bneDayOf(Date.now());
  return html`<section class="panel" style=${compact ? '' : 'min-height:160px'}>
    <div class="ph"><div><h2>Up next · high impact</h2>${!compact && html`<div class="sub" style="margin-top:2px">Brisbane time${st.data && st.data.source ? ' · ' + st.data.source : ''}</div>`}</div>
      ${onCalendar ? html`<button type="button" class="btn sm ghost" onClick=${onCalendar}>Full calendar</button>` : html`<a href="#/floor" style="font-size:12px">Trading Floor</a>`}</div>
    <div class=${compact ? '' : 'scrolly'} style="padding:0 14px 10px">
      ${st.loading && !st.data ? html`<div class="sub" style="padding:8px 0">Loading…</div>`
        : !items.length ? html`<div class="sub" style="padding:8px 0">${st.data && st.data.error ? html`Couldn’t load the event feed${st.data.tried ? ` (${st.data.tried.map((x) => `${x.source} ${x.status || x.error || ''}`).join(', ')})` : ''}. Use the full calendar.` : 'No more high-impact events this week.'}</div>`
        : items.map((e) => { const day = bneDayOf(e.t); const head = !compact && day !== lastDay; lastDay = day;
          return html`${head && html`<div class="cap" style="padding:10px 0 2px">${day === today ? 'Today' : bneDayLabel(e.t)}</div>`}
            <div class="evrow" title=${e.forecast || e.previous ? `Forecast ${e.forecast || '—'} · previous ${e.previous || '—'}` : ''}>
              <span class="num" style="color:var(--text2)">${compact && day !== today ? new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short' }).format(e.t) + ' ' : ''}${bneHM(e.t)}</span><span class="ccy">${e.ccy}</span>
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.title}</span>
              <span class="sub num">${e.actual ? 'a ' + e.actual : e.forecast ? 'f ' + e.forecast : ''}</span></div>`; })}
    </div>
  </section>`;
}

// ------------------------------------------------------------------ end-of-day debrief

function Debrief({ st, onClose }) {
  const init = (st.data && st.data.debrief) || {};
  const [f, setF] = useState({ followed: init.followed || '', best: init.best || '', worst: init.worst || '', tomorrow: init.tomorrow || '' });
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify({ followed: init.followed || '', best: init.best || '', worst: init.worst || '', tomorrow: init.tomorrow || '' });
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api('/plan', { method: 'PUT', body: { day: st.data && st.data.day, debrief: f } }); toast('Debrief saved'); st.reload(); onClose(); }
    catch (err) { toast(err.message, true); } finally { setBusy(false); }
  };
  const ta = (k, label, ph) => html`<label class="stack" style="gap:5px"><span class="sub">${label}</span><textarea class="inp" rows="2" placeholder=${ph} value=${f[k]} onInput=${(e) => setF({ ...f, [k]: e.target.value })}></textarea></label>`;
  return html`<${Modal} title="End-of-day debrief" onClose=${onClose} dirty=${dirty}>
    <form class="stack" style="gap:12px" onSubmit=${save}>
      <div class="stack" style="gap:6px"><span class="sub">Did you follow your game plan?</span>
        <div class="seg2" role="group" aria-label="Followed the plan">${[['yes', 'Yes'], ['partly', 'Partly'], ['no', 'No']].map(([v, l]) => html`<button type="button" class=${f.followed === v ? 'on' : ''} aria-pressed=${f.followed === v} onClick=${() => setF({ ...f, followed: v })}>${l}</button>`)}</div></div>
      ${ta('best', 'Best decision today', 'e.g. waited for the retest instead of chasing')}
      ${ta('worst', 'Worst decision today', 'e.g. moved my stop wider on NAS100')}
      ${ta('tomorrow', 'One thing for tomorrow', 'e.g. no trades in the first 10 minutes')}
      <div class="hstack"><button class="btn pri" type="submit" disabled=${busy}>${busy ? 'Saving…' : 'Save debrief'}</button><span class="sub">Saved with today (${st.data ? st.data.day : ''}).</span></div>
    </form><//>`;
}
