import { html, useState, useStore, useData, api, scopeQs, fmt, sgn, cls, Kpi, Money, Loading, PageHead, Icon, todayBne } from '../lib.js';
import { IdeaTable, SampleEmpty } from './dashboard.js';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function shiftMonth(m, n) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function Calendar() {
  const s = useStore();
  const [month, setMonth] = useState(todayBne().slice(0, 7));
  const [sel, setSel] = useState(null);
  const st = useData(() => api(`/calendar?month=${month}&${scopeQs()}`), [month, s.acct, s.firm]);
  const label = new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.parse(month + '-01T00:00:00Z'));
  return html`<${PageHead} title="Calendar" sub="Daily P&L by Brisbane trading day (the day each idea closed)"/>
    <${SampleEmpty}/>
    <div class="spread">
      <div class="hstack"><button class="btn" aria-label="Previous month" onClick=${() => { setMonth(shiftMonth(month, -1)); setSel(null); }}><${Icon} name="back" size=${16}/></button>
        <span style="font-weight:600;min-width:150px;text-align:center">${label}</span>
        <button class="btn" aria-label="Next month" onClick=${() => { setMonth(shiftMonth(month, 1)); setSel(null); }}><${Icon} name="chev" size=${16}/></button>
        ${month !== todayBne().slice(0, 7) && html`<button class="btn sm" onClick=${() => setMonth(todayBne().slice(0, 7))}>This month</button>`}</div>
    </div>
    <${Loading} state=${st}>${(d) => html`<${Grid} d=${d} month=${month} sel=${sel} setSel=${setSel}/>`}<//>`;
}

function Grid({ d, month, sel, setSel }) {
  const today = todayBne();
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const start = new Date(Date.UTC(y, m - 1, 1 - offset));
  const cells = [];
  for (let w = 0; w < 6; w++) {
    let wk = 0, wkDays = 0, wkIdeas = 0;
    const row = [];
    for (let k = 0; k < 7; k++) {
      const dt = new Date(start.getTime() + (w * 7 + k) * 86400000);
      const day = dt.toISOString().slice(0, 10);
      const inMonth = dt.getUTCMonth() === m - 1;
      const x = inMonth ? d.days[day] : null;
      if (x) { wk += x.net; wkDays++; wkIdeas += x.ideas; }
      row.push({ day, inMonth, x, n: dt.getUTCDate(), weekend: k >= 5 });
    }
    if (w === 5 && !row.some((c) => c.inMonth)) break;
    cells.push({ row, wk: Math.round(wk * 100) / 100, wkDays, wkIdeas, w });
  }
  const s = d.summary;
  const selDay = sel && d.days[sel];
  return html`
  <section class="kpis">
    <${Kpi} label="Net P&L" value=${fmt.money(s.totalNet)} tone=${sgn(s.totalNet)} sub=${`${s.count} ideas`}/>
    <${Kpi} label="Trading days" value=${d.tradingDays} sub=${`${d.greenDays} green · ${d.redDays} red`}/>
    <${Kpi} label="Win rate" value=${fmt.rate(s.winRate)} sub=${`${s.wins}W · ${s.losses}L`}/>
    <${Kpi} label="Best day" value=${d.best ? fmt.money(d.best.net) : '—'} tone=${d.best ? sgn(d.best.net) : ''} sub=${d.best ? fmt.date(Date.parse(d.best.day + 'T12:00:00+10:00')) : ''}/>
    <${Kpi} label="Worst day" value=${d.worst ? fmt.money(d.worst.net) : '—'} tone=${d.worst ? sgn(d.worst.net) : ''} sub=${d.worst ? fmt.date(Date.parse(d.worst.day + 'T12:00:00+10:00')) : ''}/>
  </section>
  <section class="card" style="padding:12px"><div class="scroll"><div class="cal">
    ${[...WD, 'Week'].map((h) => html`<div class="lbl" style="padding:6px 8px">${h}</div>`)}
    ${cells.map((c) => html`${c.row.map((cell) => {
      const x = cell.x;
      const klass = cls('cell', x && (x.net >= 0 ? 'up' : 'down'), cell.day === today && 'today', sel === cell.day && 'sel');
      const inner = html`<div class="spread"><span style=${`font-size:13px;font-weight:600;color:${cell.inMonth ? (cell.weekend ? '#6E7787' : '#C3CAD6') : '#3A4254'}`}>${cell.n}</span>${cell.day === today && html`<span class="sub">Today</span>`}</div>
        ${x && html`<div class=${cls('num', sgn(x.net))} style="font-size:15px;font-weight:600">${fmt.money(x.net, 0)}</div>
        <div class="sub">${x.ideas} idea${x.ideas > 1 ? 's' : ''} · ${x.wins}W ${x.losses}L</div>`}`;
      return x ? html`<button type="button" class=${klass} onClick=${() => setSel(sel === cell.day ? null : cell.day)} aria-label=${`${cell.day}: ${fmt.money(x.net)}, ${x.ideas} ideas`}>${inner}</button>`
        : html`<div class=${klass}>${inner}</div>`;
    })}
    <div class="cell wk"><span class="lbl">Week ${c.w + 1}</span>${c.wkDays > 0 && html`<span class=${cls('num', sgn(c.wk))} style="font-size:15px;font-weight:600">${fmt.money(c.wk, 0)}</span><span class="sub">${c.wkIdeas} ideas · ${c.wkDays} days</span>`}</div>`)}
  </div></div></section>
  ${selDay ? html`<${DayDetail} day=${sel} x=${selDay}/>` : html`<div class="sub">Select a day to see its ideas and the result on each account.</div>`}`;
}

function DayDetail({ day, x }) {
  const s = useStore();
  const st = useData(() => api(`/ideas?${scopeQs()}&from=${day}&to=${day}&status=closed`), [day, s.acct, s.firm]);
  return html`<section class="card flush">
    <div class="card-head"><h2 class="h2">${fmt.dateY(Date.parse(day + 'T12:00:00+10:00'))}</h2>
      <div class="hstack">${Object.entries(x.accounts).map(([n, v]) => html`<span class="chip">${n} <${Money} v=${v}/></span>`)}</div></div>
    <${Loading} state=${st}>${(d) => html`<${IdeaTable} ideas=${d.items}/>`}<//></section>`;
}
