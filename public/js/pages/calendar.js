import { html, useState, useStore, useData, api, scopeQs, fmt, sgn, cls, Money, R, Dir, Loading, PageHead, Icon, todayBne } from '../lib.js';
import { SampleEmpty } from './dashboard.js';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const noon = (d) => Date.parse(d + 'T12:00:00+10:00');

function shiftMonth(m, n) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
}

export function Calendar() {
  const s = useStore();
  const [month, setMonth] = useState(todayBne().slice(0, 7));
  const [sel, setSel] = useState(todayBne());
  const st = useData(() => api(`/calendar?month=${month}&${scopeQs()}`), [month, s.acct, s.firm]);
  const label = new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.parse(month + '-01T00:00:00Z'));
  const step = (n) => { const m = shiftMonth(month, n); setMonth(m); setSel(m === todayBne().slice(0, 7) ? todayBne() : m + '-01'); };
  return html`<${PageHead} title="Calendar" sub="Daily results by Brisbane trading day (the day each idea closed)"/>
    <${SampleEmpty}/>
    <${Loading} state=${st}>${(d) => html`<${Body} d=${d} month=${month} label=${label} step=${step} goNow=${() => { setMonth(todayBne().slice(0, 7)); setSel(todayBne()); }} sel=${sel} setSel=${setSel}/>`}<//>`;
}

function Body({ d, month, label, step, goNow, sel, setSel }) {
  const today = todayBne();
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const start = new Date(Date.UTC(y, m - 1, 1 - offset));
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    let wk = 0, wkDays = 0, wkIdeas = 0;
    const row = [];
    for (let k = 0; k < 7; k++) {
      const dt = new Date(start.getTime() + (w * 7 + k) * 86400000);
      const day = dt.toISOString().slice(0, 10);
      const inMonth = dt.getUTCMonth() === m - 1;
      const x = inMonth ? d.days[day] : null;
      if (x) { wk += x.net; wkDays++; wkIdeas += x.ideas; }
      row.push({ day, inMonth, x, n: dt.getUTCDate(), weekend: k >= 5, prep: inMonth ? d.prep[day] : null });
    }
    if (w >= 4 && !row.some((c) => c.inMonth)) break;
    weeks.push({ row, wk: Math.round(wk * 100) / 100, wkDays, wkIdeas });
  }
  const s = d.summary;
  const prepDays = Object.entries(d.prep).filter(([k]) => k < today || k === today);
  const prepFull = prepDays.filter(([, p]) => p.total > 0 && p.done >= p.total).length;
  const cellK = (label2, value, sub, t) => html`<div class="kcell"><div class="cap">${label2}</div><div class=${cls('kv num', t)}>${value}</div><div class="sub">${sub}</div></div>`;
  return html`
  <section class="kstrip" aria-label="Month summary">
    ${cellK(label.split(' ')[0] + ' net', fmt.money(s.totalNet), `${s.count} ideas`, sgn(s.totalNet))}
    ${cellK('Win rate', fmt.rate(s.winRate), `${s.wins}W · ${s.losses}L`)}
    ${cellK('Green / red days', `${d.greenDays} / ${d.redDays}`, `${d.tradingDays} trading days`)}
    ${cellK('Best day', d.best ? fmt.money(d.best.net) : '—', d.best ? fmt.date(noon(d.best.day)) : '', d.best ? sgn(d.best.net) : '')}
    ${cellK('Worst day', d.worst ? fmt.money(d.worst.net) : '—', d.worst ? fmt.date(noon(d.worst.day)) : '', d.worst ? sgn(d.worst.net) : '')}
    ${cellK('Daily prep', `${prepFull} / ${prepDays.length}`, 'days complete')}
  </section>
  <div class="split-side fill">
    <section class="panel" style="min-height:520px">
      <div class="ph"><div class="hstack" style="gap:8px">
        <button class="btn sm" aria-label="Previous month" onClick=${() => step(-1)}><${Icon} name="back" size=${15}/></button>
        <h2 style="font-size:16px;min-width:150px;text-align:center">${label}</h2>
        <button class="btn sm" aria-label="Next month" onClick=${() => step(1)}><${Icon} name="chev" size=${15}/></button>
        ${month !== today.slice(0, 7) && html`<button class="btn sm ghost" onClick=${goNow}>This month</button>`}</div>
        <div class="sub hstack" style="gap:14px"><span class="hstack" style="gap:6px"><span class="dot" style="background:var(--blue)"></span>Prep complete</span>
          <span class="hstack" style="gap:6px"><span class="dot" style="box-shadow:inset 0 0 0 1.5px var(--amber)"></span>Prep incomplete</span></div></div>
      <div style="flex:1;min-height:0;overflow:auto;padding:0 12px 12px">
        <div style=${`display:grid;grid-template-columns:repeat(7,minmax(84px,1fr)) minmax(96px,1.05fr);grid-template-rows:auto repeat(${weeks.length},minmax(78px,1fr));gap:6px;height:100%;min-width:740px`}>
          ${[...WD, 'Week'].map((h) => html`<div class="cap" style="padding:2px 4px">${h}</div>`)}
          ${weeks.map((w, wi) => html`${w.row.map((c) => {
            const x = c.x, on = sel === c.day, fut = c.day > today;
            const bg = !c.inMonth ? 'transparent' : x ? (x.net >= 0 ? 'rgba(61,214,140,.10)' : 'rgba(255,122,132,.10)') : '#0C1016';
            const pr = c.prep;
            const dot = c.inMonth && !fut && !c.weekend && pr ? (pr.total > 0 && pr.done >= pr.total ? 'background:var(--blue)' : 'box-shadow:inset 0 0 0 1.5px var(--amber)') : null;
            return html`<button type="button" disabled=${!c.inMonth} onClick=${() => setSel(c.day)} aria-pressed=${on}
              aria-label=${`${c.day}${x ? `: ${fmt.money(x.net)}, ${x.ideas} ideas` : ''}${pr ? `, prep ${pr.done} of ${pr.total}` : ''}`}
              style=${`min-height:0;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;gap:2px;padding:8px 9px;border-radius:10px;text-align:left;color:var(--text);cursor:${c.inMonth ? 'pointer' : 'default'};background:${bg};border:1px solid ${on ? 'var(--blue)' : c.inMonth ? '#1B212C' : 'transparent'};${c.inMonth ? '' : 'visibility:hidden;'}${c.day === today ? 'box-shadow:inset 0 0 0 1px #34519A;' : ''}`}>
              <span class="spread" style="width:100%;flex-wrap:nowrap"><span class="num" style=${`font-size:12px;color:${fut ? '#4A5366' : c.weekend ? '#6E7787' : '#C3CAD6'}`}>${c.n}${c.day === today ? html` <span class="sub">today</span>` : ''}</span>
                ${dot && html`<span style=${`width:7px;height:7px;border-radius:50%;${dot}`}></span>`}</span>
              ${x ? html`<span class=${cls('num', sgn(x.net))} style="font-size:14px;font-weight:600">${fmt.money(x.net, 0)}</span>
                <span class="sub num" style="font-size:11px">${x.ideas} idea${x.ideas > 1 ? 's' : ''} · ${x.wins}W ${x.losses}L</span>` : html`<span></span><span class="sub" style="font-size:11px">${c.inMonth && !fut && !c.weekend ? 'No trades' : ''}</span>`}
            </button>`;
          })}<div style="display:flex;flex-direction:column;justify-content:space-between;padding:8px 9px;border-radius:10px;background:#121722;border:1px solid #1B212C">
            <span class="cap">Week ${wi + 1}</span>
            <span class=${cls('num', w.wkDays ? sgn(w.wk) : 'mut')} style="font-size:14px;font-weight:600">${w.wkDays ? fmt.money(w.wk, 0) : '—'}</span>
            <span class="sub" style="font-size:11px">${w.wkDays ? `${w.wkIdeas} ideas · ${w.wkDays} days` : ''}</span></div>`)}
        </div></div>
    </section>
    <${DayPanel} day=${sel} x=${d.days[sel]} prep=${d.prep[sel]}/>
  </div>`;
}

function DayPanel({ day, x, prep }) {
  const s = useStore();
  const st = useData(() => api(`/ideas?${scopeQs()}&from=${day}&to=${day}&status=closed`), [day, s.acct, s.firm]);
  const wd = WD[(new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7];
  const full = prep && prep.total > 0 && prep.done >= prep.total;
  return html`<section class="panel" style="min-height:420px">
    <div style="padding:14px 16px 10px;border-bottom:1px solid #1B212C"><div class="cap">Selected day</div>
      <h2 style="margin:4px 0 0;font-size:18px;font-weight:600">${wd} ${fmt.dateY(noon(day))}</h2></div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-bottom:1px solid #1B212C">
      <div class="kcell"><div class="cap">Net</div><div class=${cls('num', sgn(x ? x.net : 0))} style="font-size:16px;font-weight:600;margin-top:5px">${fmt.money(x ? x.net : 0)}</div></div>
      <div class="kcell"><div class="cap">Ideas</div><div class="num" style="font-size:16px;font-weight:600;margin-top:5px">${x ? x.ideas : 0}</div></div>
      <div class="kcell"><div class="cap">Won / lost</div><div class="num" style="font-size:16px;font-weight:600;margin-top:5px">${x ? `${x.wins} / ${x.losses}` : '—'}</div></div>
    </div>
    <div class="scrolly stack" style="padding:12px 16px;gap:12px">
      <div class="box hstack" style="flex-wrap:nowrap;gap:10px"><span style=${`width:9px;height:9px;border-radius:50%;flex:0 0 9px;${!prep ? 'background:var(--line3)' : full ? 'background:var(--blue)' : 'box-shadow:inset 0 0 0 1.5px var(--amber)'}`}></span>
        <span style="font-size:12.5px;flex:1">${!prep ? 'No daily prep recorded' : full ? `Daily prep complete · ${prep.done} of ${prep.total}` : `Daily prep incomplete · ${prep.done} of ${prep.total}`}</span><a href="#/strategies" style="font-size:12px">Checklist</a></div>
      ${x && Object.keys(x.accounts).length > 1 && html`<div class="hstack" style="gap:6px">${Object.entries(x.accounts).map(([n, v]) => html`<span class="chip">${n} <${Money} v=${v}/></span>`)}</div>`}
      <div class="field"><span class="lbl">Ideas closed this day</span>
        <${Loading} state=${st}>${(d) => d.items.length ? d.items.map((i) => html`<a href=${'#/ideas/' + i.id}
          style="display:grid;grid-template-columns:46px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border-radius:10px;background:#0C1016;border:1px solid #1B212C;color:var(--text)">
          <span class="num mut" style="font-size:12px">${fmt.time(i.open_time)}</span>
          <span style="min-width:0"><b style="font-size:13px">${i.symbol}</b> <${Dir} d=${i.direction}/><span class="sub" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.strategy_name || 'No strategy'}${i.reviewed ? '' : ' · to review'}</span></span>
          <span style="text-align:right"><span style="display:block;font-weight:600;font-size:13px"><${Money} v=${i.net}/></span><span class="sub"><${R} v=${i.r}/></span></span></a>`)
          : html`<span class="sub">No trades closed this day.</span>`}<//></div>
      <a href="#/review" class="btn sm" style="justify-content:center">Open the weekly review</a>
    </div>
  </section>`;
}
