import { html, useState, useEffect, useStore, useData, api, scopeQs, fmt, sgn, cls, Kpi, Money, R, Dir, Loading, PageHead, Seg, Icon, HBar, toast, todayBne } from '../lib.js';
import { SampleEmpty } from './dashboard.js';

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const monday = (d) => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
const dayLabel = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function Review() {
  const s = useStore();
  const [kind, setKind] = useState('week');
  // at the weekend and on Monday, open on the week that just finished
  const defaultWeek = () => { const t = todayBne(), wd = new Date(t + 'T00:00:00Z').getUTCDay(); return monday(wd === 1 ? addDays(t, -7) : t); };  // Sat/Sun already belong to the finished week
  const [week, setWeek] = useState(defaultWeek);
  const [month, setMonth] = useState(todayBne().slice(0, 7));
  const qs = kind === 'week' ? `kind=week&start=${week}` : `kind=month&month=${month}`;
  const st = useData(() => api(`/review?${qs}&${scopeQs()}`), [qs, s.acct, s.firm]);
  const title = kind === 'week' ? `${dayLabel(week)} – ${dayLabel(addDays(week, 6))}`
    : new Date(month + '-01T00:00:00Z').toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const step = (n) => (kind === 'week' ? setWeek(addDays(week, 7 * n)) : setMonth(shiftMonth(month, n)));
  const isCurrent = kind === 'week' ? week === monday(todayBne()) : month === todayBne().slice(0, 7);
  return html`<${PageHead} title="Review" sub="Look back over a week or a month, then write down what to keep and what to change"/>
    <${SampleEmpty}/>
    <div class="spread">
      <div class="hstack"><${Seg} label="Period" value=${kind} onChange=${setKind} options=${[['week', 'Week'], ['month', 'Month']]}/></div>
      <div class="hstack"><button class="btn" aria-label="Previous" onClick=${() => step(-1)}><${Icon} name="back" size=${16}/></button>
        <span style="font-weight:600;min-width:180px;text-align:center">${title}</span>
        <button class="btn" aria-label="Next" onClick=${() => step(1)}><${Icon} name="chev" size=${16}/></button>
        ${!isCurrent && html`<button class="btn sm" onClick=${() => (kind === 'week' ? setWeek(monday(todayBne())) : setMonth(todayBne().slice(0, 7)))}>Current</button>`}</div>
    </div>
    <${Loading} state=${st}>${(d) => html`<${Body} d=${d} key=${d.period + s.mode}/>`}<//>`;
}

function Body({ d }) {
  const s = d.summary;
  const costs = s.commission + s.swap + s.fee;
  const maxDay = Math.max(1, ...d.days.map((x) => Math.abs(x.net)));
  const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '—');
  return html`
  <section class="kpis">
    <${Kpi} label="Net P&L" value=${fmt.money(s.totalNet)} tone=${sgn(s.totalNet)} sub=${`${s.count} ideas · ${s.wins}W ${s.losses}L`}/>
    <${Kpi} label="Win rate" value=${fmt.rate(s.winRate)} sub=${`Profit factor ${fmt.pf(s)}`}/>
    <${Kpi} label="Expectancy" value=${fmt.r(s.expectancyR)} tone=${sgn(s.expectancyR)} sub=${`Avg win ${s.avgWinR ?? '—'}R · avg loss ${s.avgLossR != null ? Math.abs(s.avgLossR) : '—'}R`}/>
    <${Kpi} label="Checklist followed" value=${pct(d.checklist.complete, d.checklist.ideas)} sub=${`${d.checklist.complete} of ${d.checklist.ideas} ideas fully ticked`}/>
    <${Kpi} label="Daily prep done" value=${pct(d.prep.complete, d.prep.days)} sub=${`${d.prep.complete} of ${d.prep.days} days with a record`}/>
    <${Kpi} label="Costs" value=${fmt.money(costs)} tone=${sgn(costs)} sub=${d.unreviewed ? `${d.unreviewed} idea(s) still to review` : 'All ideas reviewed'}/>
  </section>
  ${d.unreviewed > 0 && html`<div class="warn">${d.unreviewed} closed idea(s) in this period aren't reviewed yet. <a href="#/ideas">Review them</a> first so the numbers below are complete.</div>`}
  <div class="dash-grid">
    <div class="col">
      <section class="card stack"><h2 class="h2">By day</h2>
        ${d.days.length ? d.days.map((x) => html`<${HBar} label=${dayLabel(x.day)} sub=${`${x.ideas} ideas · ${x.wins}W ${x.losses}L`} value=${x.net} max=${maxDay}/>`) : html`<div class="sub">No closed trades in this period.</div>`}</section>
      <div class="row">
        <${List} title="Best ideas (by R)" items=${d.best}/>
        <${List} title="Worst ideas (by R)" items=${d.worst}/>
      </div>
      <section class="card flush"><div class="card-head"><h2 class="h2">By instrument and strategy</h2></div>
        <div class="scroll"><table class="tbl"><thead><tr><th>Instrument / strategy</th><th class="r">Ideas</th><th class="r">Win rate</th><th class="r">Expectancy</th><th class="r">Net P&L</th></tr></thead>
        <tbody>${[...d.bySymbol, ...d.byStrategy].map((g, k) => html`<tr style=${k === d.bySymbol.length ? 'border-top:2px solid var(--line3)' : ''}><td>${g.key}</td><td class="num r">${g.count}</td>
          <td class="num r">${fmt.rate(g.winRate)}</td><td class="r"><${R} v=${g.expectancyR}/></td><td class="r"><${Money} v=${g.totalNet}/></td></tr>`)}</tbody></table></div></section>
      <section class="card stack"><h2 class="h2">Mistakes tagged</h2>
        ${d.mistakes.length ? html`<div class="hstack">${d.mistakes.map((m) => html`<span class="chip r">${m.label} · ${m.count}</span>`)}</div>` : html`<div class="sub">None tagged in this period.</div>`}</section>
    </div>
    <${Notes} d=${d}/>
  </div>`;
}

function List({ title, items }) {
  return html`<section class="card stack" style="flex:1 1 280px;gap:0"><h2 class="h2" style="margin-bottom:6px">${title}</h2>
    ${items.length ? items.map((i) => html`<a href=${'#/ideas/' + i.id} class="spread" style="padding:10px 0;border-bottom:1px solid var(--line2);color:var(--text);flex-wrap:nowrap">
      <span class="hstack" style="flex-wrap:nowrap"><b>${i.symbol}</b><${Dir} d=${i.direction}/><span class="sub">${fmt.date(i.close_time)}</span></span>
      <span class="hstack" style="flex-wrap:nowrap"><${R} v=${i.r}/><${Money} v=${i.net}/></span></a>`) : html`<div class="sub">—</div>`}</section>`;
}

function Notes({ d }) {
  const n = d.notes || {};
  const [v, setV] = useState({ goals: n.goals || '', went_well: n.went_well || '', improve: n.improve || '', rating: n.rating || null });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(n.updated_at || null);
  const set = (k) => (e) => { setV({ ...v, [k]: e.target.value }); setDirty(true); };
  const save = async (val = v) => {
    try { await api('/review', { method: 'PUT', body: { period: d.period, ...val } }); setDirty(false); setSaved(Date.now()); }
    catch (e) { toast(e.message, true); }
  };
  useEffect(() => { if (!dirty) return; const t = setTimeout(() => save(), 1200); return () => clearTimeout(t); }, [v, dirty]);
  const F = (k, label, ph) => html`<div class="field"><label class="lbl" for=${'rv' + k}>${label}</label>
    <textarea id=${'rv' + k} class="inp" value=${v[k]} onInput=${set(k)} placeholder=${ph}></textarea></div>`;
  return html`<section class="card stack" style="align-self:start">
    <div class="spread"><h2 class="h2">Your review</h2><span class="sub">${dirty ? 'Saving…' : saved ? 'Saved ' + fmt.ago(saved) : 'Not written yet'}</span></div>
    ${F('goals', 'Goals for this period', 'e.g. Max 2 ideas a day; no adds before a 5-min close')}
    ${F('went_well', 'What went well', 'What should you keep doing?')}
    ${F('improve', 'What to improve', 'One or two concrete changes for next time')}
    <div class="field"><span class="lbl">How did you trade overall?</span>
      <div class="stars" role="group" aria-label="Period rating">${[1, 2, 3, 4, 5].map((k) => html`<button type="button" class=${k <= (v.rating || 0) ? 'on' : ''} aria-label=${'Rate ' + k + ' of 5'} aria-pressed=${k === v.rating}
        onClick=${() => { const nv = { ...v, rating: k === v.rating ? null : k }; setV(nv); save(nv); }}><${Icon} name="star" size=${22} fill=${k <= (v.rating || 0)}/></button>`)}</div></div>
  </section>`;
}
