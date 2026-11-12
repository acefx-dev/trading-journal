// Trading Floor: everything for the session in one place: daily prep with sentiment, the economic calendar,
// market hours, the next high-impact events and the profit split.
import { html, useStore, useData, api, fmt, Loading, PageHead } from '../lib.js';
import { Prep, Sessions, EconCalendar, ProfitSplit, SampleEmpty } from './dashboard.js';

const bneHM = (t) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
const bneDay = (t) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short' }).format(t);
const inTxt = (ms) => (ms <= 0 ? 'now' : ms < 3600000 ? `in ${Math.round(ms / 60000)} min` : ms < 86400000 ? `in ${Math.floor(ms / 3600000)}h ${String(Math.round(ms % 3600000 / 60000)).padStart(2, '0')}` : '');

export function Floor() {
  const s = useStore();
  const prep = useData(() => api('/prep'), [s.mode]);
  const pay = useData(() => api('/payouts'), [s.mode]);
  const sub = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()) + ' · Brisbane';
  return html`<${PageHead} title="Trading Floor" sub=${sub} filter=${false}/>
    <${SampleEmpty}/>
    <div class="floor fill">
      <div class="colstack">
        <${Loading} state=${prep}>${(p) => html`<${Prep} prep=${p} reload=${prep.reload}/>`}<//>
      </div>
      <div class="colstack floor-cal"><${EconCalendar}/></div>
      <div class="colstack">
        <${Sessions}/>
        <${UpNext}/>
        <${Loading} state=${pay}>${(p) => html`<${ProfitSplit} payouts=${p.items}/>`}<//>
      </div>
    </div>`;
}

/** The week's remaining high-impact events (Forex Factory feed), grouped by day, in Brisbane time. */
function UpNext() {
  const ev = useData(() => api('/events?n=12'), []);
  const items = ev.data && ev.data.items ? ev.data.items : [];
  let lastDay = '';
  return html`<section class="panel" style="min-height:160px">
    <div class="ph"><div><h2>Up next · high impact</h2><div class="sub" style="margin-top:2px">Brisbane time${ev.data && ev.data.stale ? ' · last update over an hour ago' : ''}</div></div></div>
    <div class="scrolly" style="padding:0 14px 10px">
      ${ev.loading && !ev.data ? html`<div class="sub" style="padding:8px 0">Loading…</div>`
        : ev.data && ev.data.error && !items.length ? html`<div class="sub" style="padding:8px 0">Couldn’t load the event feed. Use the calendar beside this.</div>`
        : !items.length ? html`<div class="sub" style="padding:8px 0">No more high-impact events this week.</div>`
        : items.map((e) => { const day = bneDay(e.t); const head = day !== lastDay; lastDay = day;
          return html`${head && html`<div class="cap" style="padding:10px 0 2px">${day === bneDay(Date.now()) ? 'Today' : day}</div>`}
            <div class="evrow" title=${e.forecast || e.previous ? `Forecast ${e.forecast || '—'} · previous ${e.previous || '—'}` : ''}>
              <span class="num" style="color:var(--text2)">${bneHM(e.t)}</span><span class="ccy">${e.ccy}</span>
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.title}${e.forecast ? html` <span class="sub">f ${e.forecast}</span>` : ''}</span>
              <span class="sub">${inTxt(e.t - Date.now())}</span></div>`; })}
    </div>
    <div class="sub" style="padding:7px 14px;border-top:1px solid #1B212C;font-size:11px">Source: Forex Factory weekly feed, updated hourly</div>
  </section>`;
}
