// Trading Floor: plan → size → trade → stay disciplined, in one screen.
// Top bar (trading window, news guard, today's count, live quotes), then three columns:
// 1 prep + game plan · 2 position size, risk budget, open idea · 3 your edge, A+ setup, next events.
import { html, useState, useEffect, useRef, useStore, useData, api, fmt, sgn, cls, Bar, Dir, Money, R, Loading, PageHead, Modal, toast } from '../lib.js';
import { Prep, Sessions, EconCalendar, ProfitSplit, SampleEmpty } from './dashboard.js';

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
  const schedule = String(raw.plan_schedule ?? 'JP225@10:00-14:00,NAS100@16:00-20:00').split(',').map((x) => x.trim())
    .map((x) => /^([^@]{1,20})@(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(x)).filter(Boolean).map((m) => ({ symbol: m[1].trim(), from: m[2], to: m[3] }));
  const [w0, w1] = String(raw.trade_window || '10:00-14:00').split('-');
  return {
    schedule: schedule.length ? schedule : [{ symbol: 'JP225', from: w0, to: w1 }],
    maxIdeas: Number(raw.max_ideas_day ?? 2), lossStop: Number(raw.loss_stop ?? 2), pause: Number(raw.news_pause_min ?? 15),
    markets: String(raw.plan_markets || 'JP225,NAS100').split(',').map((x) => x.trim()).filter(Boolean),
    quotes: String(raw.quote_symbols || 'OANDA:JP225USD=JP225,OANDA:NAS100USD=NAS100,FX:USDJPY=USDJPY').split(',').map((x) => x.trim()).filter(Boolean)
      .map((x) => { const [proName, title] = x.split('='); return { proName, title: title || proName.split(':').pop() }; }),
  };
}

/** The schedule slot running now, else the next one today, else tomorrow's first. Times are Brisbane. */
function currentSlot(cfg, now) {
  const base = dayStart(now);
  const slots = cfg.schedule.map((x) => ({ ...x, t0: hmToMs(x.from, base), t1: hmToMs(x.to, base) })).map((x) => (x.t1 <= x.t0 ? { ...x, t1: x.t1 + 86400000 } : x)).sort((a, b) => a.t0 - b.t0);
  const live = slots.find((x) => now >= x.t0 && now < x.t1);
  if (live) return { ...live, state: 'open' };
  const next = slots.find((x) => x.t0 > now);
  if (next) return { ...next, state: 'before' };
  const first = slots[0];
  return { ...first, t0: first.t0 + 86400000, t1: first.t1 + 86400000, state: 'tomorrow' };
}

export function Floor() {
  const s = useStore();
  const [modal, setModal] = useState(null);
  const dash = useData(() => api('/dashboard?acct=all'), [s.mode]);
  const plan = useData(() => api('/plan'), [s.mode]);
  const events = useData(() => api('/events?n=12').catch((e) => ({ items: [], error: e.message })), []);
  const ana = useData(() => api('/analytics/ideas?acct=all').catch(() => null), [s.mode]);
  const sub = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()) + ' · Brisbane';
  return html`<${PageHead} title="Trading Floor" sub=${sub} filter=${false}>
      <div class="hstack floor-tools" style="gap:6px">
        <button type="button" class="btn sm" onClick=${() => setModal('cal')}>Calendar</button>
        <button type="button" class="btn sm" onClick=${() => setModal('hours')}>Market hours</button>
        <button type="button" class="btn sm" onClick=${() => setModal('split')}>Profit split</button>
        <button type="button" class="btn sm pri" onClick=${() => setModal('debrief')}>End-of-day debrief</button></div><//>
    <${SampleEmpty}/>
    <${Loading} state=${dash}>${(d) => html`
      <${FloorBar} d=${d} events=${events.data}/>
      <div class="floor3 fill">
        <div class="f-prep"><${Prep} prep=${d.prep} reload=${dash.reload}/></div>
        <div class="f-setup"><${SetupPanel} st=${plan} ana=${ana.data}/></div>
        <div class="f-live colstack"><${OpenNow} ideas=${d.open}/><${RiskBudget} accounts=${d.accounts}/></div>
        <div class="f-plan"><${GamePlan} st=${plan} ana=${ana.data}/></div>
        <div class="f-news"><${UpNext} st=${events} onCalendar=${() => setModal('cal')}/></div>
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
  const slot = currentSlot(cfg, now);
  const { t0, t1 } = slot, open = slot.state === 'open';
  const pct = open ? (now - t0) / (t1 - t0) * 100 : 0;
  const evs = (events && events.items) || [];
  const pauseMs = cfg.pause * 60000;
  const clash = evs.filter((e) => e.t + pauseMs >= Math.max(now, t0) && e.t - pauseMs <= t1);
  const nextEv = evs.find((e) => e.t >= now - pauseMs);
  const inPause = evs.find((e) => now >= e.t - pauseMs && now <= e.t + pauseMs);
  const today = bneDayOf(now);
  const all = [...d.open, ...d.recent].filter((i) => bneDayOf(i.open_time) === today);
  const losses = all.filter((i) => i.status !== 'open' && i.net < 0).length;
  const stop = cfg.lossStop > 0 && losses >= cfg.lossStop;
  const full = cfg.maxIdeas > 0 && all.length >= cfg.maxIdeas;
  const quotes = 'https://www.tradingview-widget.com/embed-widget/tickers/?locale=en#' + encodeURIComponent(JSON.stringify({
    symbols: cfg.quotes, colorTheme: 'dark', isTransparent: true, showSymbolLogo: false, width: '100%', height: 72 }));
  return html`<section class="card fbar" aria-label="Session status">
    <div class="fb-win"><div class="spread" style="flex-wrap:nowrap"><span><b>${slot.symbol}</b> <span class="sub">${slot.from}–${slot.to}</span></span><span class="num sub" style="color:var(--text)">${bneHM(now)}</span></div>
      <${Bar} pct=${pct} color=${open ? 'var(--pos)' : '#3A4252'}/>
      <div class="sub">${open ? html`<span class="pos">Window open</span> · ${dur(t1 - now)} left` : slot.state === 'before' ? `Window opens in ${dur(t0 - now)}` : 'Done for today · time for the debrief'}</div></div>
    <div class="fb-cell"><div class="cap">News guard</div>
      ${inPause ? html`<div class="fb-v" style="color:var(--neg)">Pause now: ${inPause.ccy} ${inPause.title}</div><div class="sub">No new trades until ${bneHM(inPause.t + pauseMs)}</div>`
        : clash.length ? html`<div class="fb-v" style="color:var(--amber)">${clash[0].ccy} ${clash[0].title} at ${bneHM(clash[0].t)}</div><div class="sub">Pause ${bneHM(clash[0].t - pauseMs)}–${bneHM(clash[0].t + pauseMs)}${clash.length > 1 ? ` · +${clash.length - 1} more` : ''}</div>`
        : html`<div class="fb-v">No high-impact news in this window</div><div class="sub">${nextEv ? `Next: ${nextEv.ccy} ${nextEv.title} ${bneDayOf(nextEv.t) === today ? '' : bneDayLabel(nextEv.t) + ' '}${bneHM(nextEv.t)}` : events && events.error ? 'Event feed unavailable' : events ? 'Nothing else this week' : 'Loading events…'}</div>`}</div>
    <div class="fb-cell"><div class="cap">Today's limits</div>
      ${stop ? html`<div class="fb-v" style="color:var(--neg)">Stop for today · ${losses} losing ideas</div><div class="sub">You set a stop at ${cfg.lossStop} losses</div>`
        : html`<div class="fb-v"><span class=${full ? 'neg' : ''}>Ideas <b class="num">${all.length}</b>${cfg.maxIdeas ? ` of ${cfg.maxIdeas}` : ''}</span> · Losses <b class="num">${losses}</b>${cfg.lossStop ? ` of ${cfg.lossStop}` : ''}</div>
          <div class="sub">${full ? 'Max ideas reached for today' : html`Realised <${Money} v=${d.todayNet} dec=${0}/>`}</div>`}</div>
    <div class="fb-quotes"><iframe src=${quotes} title="Live prices by TradingView" loading="lazy" scrolling="no"></iframe></div>
  </section>`;
}

// ------------------------------------------------------------------ game plan (one market at a time)

function GamePlan({ st, ana }) {
  const s = useStore();
  const cfg = floorSettings(s);
  const now = useNow(60000);
  const [data, setData] = useState(null);
  const [saved, setSaved] = useState(null);
  const [day, setDay] = useState(null);
  const [sym, setSym] = useState(null);
  const timer = useRef(null);
  const levelsDef = (st.data && st.data.defaults.levels) || [];
  useEffect(() => {
    if (!st.data) return;
    setData(st.data.markets || []);
    setSaved(st.data.updated_at);
    setDay(st.data.day);
  }, [st.data]);
  const slot = currentSlot(cfg, now);
  const cur = sym || slot.symbol || 'JP225';
  const traded = ana ? [...new Set(ana.ideas.map((i) => i.symbol))] : [];
  const options = [...new Set([...cfg.schedule.map((x) => x.symbol), ...cfg.markets, ...(data || []).map((m) => m.symbol), ...traded])];
  const blank = (x) => ({ symbol: x, bias: '', levels: levelsDef.map((l) => ({ label: l, value: '' })), plan: '' });
  const m = (data || []).find((x) => x.symbol === cur) || blank(cur);
  const save = (next) => {
    const list = (data || []).some((x) => x.symbol === cur) ? data.map((x) => (x.symbol === cur ? next : x)) : [...(data || []), next];
    setData(list);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { await api('/plan', { method: 'PUT', body: { day, markets: list } }); setSaved(Date.now()); } catch (e) { toast(e.message, true); }
    }, 700);
  };
  const pick = (v) => { if (v === '__other') { const x = prompt('Market symbol (e.g. XAUUSD)'); if (x && x.trim()) setSym(x.trim().toUpperCase()); } else setSym(v); };
  const BIAS = [['long', '▲ Long'], ['wait', 'Wait'], ['short', '▼ Short']];
  const inSchedule = cfg.schedule.find((x) => x.symbol === cur);
  return html`<section class="panel">
    <div class="ph"><div><h2>Game plan</h2><div class="sub" style="margin-top:2px">${inSchedule ? `${inSchedule.from}–${inSchedule.to} window` : 'Not in your schedule'} · ${saved ? `saved ${bneHM(saved)}` : 'saves as you type'} · shown on the idea's review</div></div>
      <div class="hstack" style="gap:6px;flex-wrap:nowrap">
        <label class="sr" for="gpsym">Market</label>
        <select id="gpsym" class="inp sm" onChange=${(e) => pick(e.target.value)}>${options.map((x) => html`<option value=${x} selected=${x === cur}>${x}${cfg.schedule.find((y) => y.symbol === x) ? ' · ' + cfg.schedule.find((y) => y.symbol === x).from : ''}</option>`)}
          ${!options.includes(cur) && html`<option value=${cur} selected>${cur}</option>`}<option value="__other">Other…</option></select>
        <div class="seg2" role="group" aria-label=${cur + ' bias'}>${BIAS.map(([v, l]) => html`<button type="button" class=${m.bias === v ? 'on' : ''} aria-pressed=${m.bias === v} onClick=${() => save({ ...m, bias: m.bias === v ? '' : v })}>${l}</button>`)}</div></div></div>
    <div class="scrolly gp1">
      <div class="gplv1">${(m.levels.length ? m.levels : levelsDef.map((l) => ({ label: l, value: '' }))).map((l, j) => html`<label class="gpl"><span class="sub">${l.label}</span>
        <input class="inp sm num" inputmode="decimal" value=${l.value} placeholder="—" onInput=${(e) => save({ ...m, levels: (m.levels.length ? m.levels : levelsDef.map((x) => ({ label: x, value: '' }))).map((y, i) => (i === j ? { ...y, value: e.target.value } : y)) })}/></label>`)}</div>
      <label class="sr" for="gpplan">${cur} plan</label>
      <textarea id="gpplan" class="inp gpplan" rows="3" placeholder="If … then …  e.g. buy a pullback into the pre-open range after a sweep; no trade below the Asia low."
        value=${m.plan} onInput=${(e) => save({ ...m, plan: e.target.value })}></textarea>
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

// ------------------------------------------------------------------ A+ setup (saved per day) + your edge

function edgeNotes(ana, cfg, slot, strat) {
  if (!ana) return [];
  const now = Date.now();
  const ideas = ana.ideas.filter((i) => i.open_time >= now - 60 * 86400000 && i.close_time && i.r != null);
  const minOf = (t) => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(t).split(':'); return +p[0] * 60 + +p[1]; };
  const wA = +slot.from.slice(0, 2) * 60 + +slot.from.slice(3), wB = +slot.to.slice(0, 2) * 60 + +slot.to.slice(3);
  const inWin = ideas.filter((i) => { const m = minOf(i.open_time); return wA <= wB ? m >= wA && m < wB : m >= wA || m < wB; });
  const notes = [];
  const mine = strat ? inWin.filter((i) => i.strategy_id === strat.id) : [];
  if (strat && mine.length >= 3) {
    const wins = mine.filter((i) => i.r > 0).length;
    notes.push({ c: 'b', ic: '◎', html: html`<b>${strat.name}</b> in this window: ${mine.length} ideas · <b class=${wins / mine.length >= 0.5 ? 'pos' : 'neg'}>${Math.round(wins / mine.length * 100)}% win</b> · ${fR(avg(mine.map((i) => i.r)))} avg` });
  }
  const m0 = Date.parse(bneDayOf(now).slice(0, 8) + '01T00:00:00+10:00');
  const mc = {};
  for (const i of ideas.filter((x) => x.open_time >= m0)) for (const id of i.mistakes || []) { (mc[id] ||= { n: 0, r: 0 }); mc[id].n++; mc[id].r += i.r; }
  const topM = Object.entries(mc).sort((a, b) => b[1].n - a[1].n || a[1].r - b[1].r)[0];
  if (topM) notes.push({ c: 'a', ic: '!', html: html`Top mistake this month: <b>${((ana.mistakes.find((x) => String(x.id) === topM[0]) || {}).label || 'a mistake').toLowerCase()}</b> (${topM[1].n}×, ${fR(topM[1].r)})` });
  if (cfg.lossStop > 0) {
    const byDay = {};
    for (const i of ideas) (byDay[bneDayOf(i.open_time)] ||= []).push(i);
    const after = [];
    for (const list of Object.values(byDay)) { list.sort((a, b) => a.open_time - b.open_time); let l = 0; for (const i of list) { if (l >= cfg.lossStop) after.push(i.r); if (i.r < 0) l++; } }
    if (after.length >= 2) notes.push({ c: 'r', ic: '■', html: html`After ${cfg.lossStop} losses in a day, the next trades averaged <b class=${sgn(avg(after))}>${fR(avg(after))}</b>` });
  }
  const w = ideas.filter((i) => i.align === 'with').map((i) => i.r), a = ideas.filter((i) => i.align === 'against').map((i) => i.r);
  if (w.length >= 2 && a.length >= 2) notes.push({ c: 'g', ic: '✓', html: html`With your bias <b class=${sgn(avg(w))}>${fR(avg(w))}</b> avg · against it <b class=${sgn(avg(a))}>${fR(avg(a))}</b>` });
  return notes.slice(0, 3);
}

function SetupPanel({ st, ana }) {
  const s = useStore();
  const cfg = floorSettings(s);
  const now = useNow(60000);
  const slot = currentSlot(cfg, now);
  const strategies = s.boot.strategies.filter((x) => !x.archived);
  const [pickId, setPickId] = useState(null);
  const [ticks, setTicks] = useState({});
  const [day, setDay] = useState(null);
  useEffect(() => {
    if (!st.data) return;
    setDay(st.data.day);
    if (st.data.setup) { setTicks(st.data.setup.ticks || {}); if (st.data.setup.strategy_id) setPickId(st.data.setup.strategy_id); }
  }, [st.data]);
  // default: the strategy you use most for this market inside this window
  let auto = null;
  if (ana) {
    const counts = {};
    for (const i of ana.ideas) if (i.strategy_id && i.symbol === slot.symbol) counts[i.strategy_id] = (counts[i.strategy_id] || 0) + 1;
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    auto = top ? Number(top) : null;
  }
  const strat = strategies.find((x) => x.id === (pickId || auto)) || strategies[0];
  const items = strat ? strat.trade || [] : [];
  const persist = async (next, id) => {
    try { await api('/plan', { method: 'PUT', body: { day, setup: { strategy_id: id ?? (strat && strat.id), ticks: next } } }); } catch (e) { toast(e.message, true); }
  };
  const tick = (id) => { const next = { ...ticks }; if (next[id]) delete next[id]; else next[id] = true; setTicks(next); persist(next); };
  const choose = (id) => { setPickId(id); setTicks({}); persist({}, id); };
  const done = items.filter((i) => ticks[i.id]).length;
  const notes = edgeNotes(ana, cfg, slot, strat);
  return html`<section class="panel">
    <div class="ph"><div><h2>A+ setup</h2><div class="sub" style="margin-top:2px">Tick before you enter · saved for today</div></div>
      <div class="hstack" style="gap:8px;flex-wrap:nowrap"><span class=${cls('chip', items.length && done === items.length ? 'g' : '')}>${done} / ${items.length}</span>
        <label class="sr" for="aplus">Strategy</label>
        <select id="aplus" class="inp sm" style="max-width:210px" onChange=${(e) => choose(Number(e.target.value))}>${strategies.map((x) => html`<option value=${x.id} selected=${strat && x.id === strat.id}>${x.name}</option>`)}</select></div></div>
    <div class="pb" style="padding-top:0">
      ${items.length ? items.map((i) => html`<label class=${cls('ck', ticks[i.id] && 'done')} style="min-height:28px;font-size:12.5px;gap:10px;padding-top:3px;padding-bottom:3px">
          <input type="checkbox" checked=${!!ticks[i.id]} onChange=${() => tick(i.id)} style="width:15px;height:15px;flex:0 0 15px"/><span>${i.label}</span></label>`)
        : html`<div class="sub" style="padding:6px 0">${strat ? html`${strat.name} has no checklist yet. Add one on the <a href="#/strategies">Strategies</a> page.` : html`Add a strategy on the <a href="#/strategies">Strategies</a> page.`}</div>`}
      ${notes.length > 0 && html`<div class="cap" style="margin:12px 0 2px">Your edge · last 60 days</div>
        ${notes.map((n) => html`<div class="edge"><span class=${'eic ' + n.c} aria-hidden="true">${n.ic}</span><span>${n.html}</span></div>`)}`}
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

export function Debrief({ st, onClose }) {
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
      <div class="hstack"><button class="btn pri" type="submit" disabled=${busy}>${busy ? 'Saving…' : 'Save debrief'}</button><span class="sub">Saved with ${st.data ? st.data.day : "this day"}.</span></div>
    </form><//>`;
}
