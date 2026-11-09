import { html, useState, useEffect, useRef, useStore, useData, api, scopeQs, fmt, sgn, cls, Loading, PageHead, LineChart, Icon, toast, todayBne } from '../lib.js';
import { SampleEmpty } from './dashboard.js';
import { sessionOf } from '../sessions.js';

// ------------------------------------------------------------------ helpers

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BNE = 10 * 3600000; // Brisbane has no daylight saving
const bne = (t) => new Date(t + BNE);
const dayOf = (t) => bne(t).toISOString().slice(0, 10);
const dn = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / 864e5);
const FX = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'SEK', 'NOK', 'SGD', 'HKD', 'ZAR', 'MXN', 'CNH', 'TRY', 'PLN', 'DKK']);
export function marketOf(sym) {
  const s = String(sym || '').toUpperCase();
  if (/^(XAU|XAG|XPT|XPD|GOLD|SILVER)/.test(s)) return 'Metals';
  if (/^(BTC|ETH|LTC|XRP|SOL|ADA|DOGE)/.test(s)) return 'Crypto';
  if (/^(USOIL|UKOIL|WTI|BRENT|XTI|XBR|NGAS|NATGAS)/.test(s)) return 'Energy';
  if (s.length >= 6 && FX.has(s.slice(0, 3)) && FX.has(s.slice(3, 6))) return 'Forex';
  return 'Indices';
}
const holdOf = (m) => (m < 15 ? '< 15 min' : m < 60 ? '15–60 min' : m < 240 ? '1–4 h' : m < 1440 ? '4–24 h' : '> 1 day');
const HOLDS = ['< 15 min', '15–60 min', '1–4 h', '4–24 h', '> 1 day'];
const outOf = (i) => (i.basisNet > 0 ? 'Win' : i.basisNet < 0 ? 'Loss' : 'Breakeven');
const fR = (v) => (v == null || !isFinite(v) ? '—' : fmt.r(v));
const tone = (v) => (v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : 'mut');
const pfTxt = (v) => (v === Infinity ? '∞' : v == null ? '—' : v.toFixed(2));

/** Win/loss by the lead account's result (as everywhere else); R stats only where R is known. */
function stat(xs) {
  const n = xs.length, w = xs.filter((x) => x.basisNet > 0).length, l = xs.filter((x) => x.basisNet < 0).length;
  const rx = xs.filter((x) => x.r != null);
  const tot = rx.reduce((a, x) => a + x.r, 0);
  const gw = rx.filter((x) => x.r > 0).reduce((a, x) => a + x.r, 0), gl = -rx.filter((x) => x.r < 0).reduce((a, x) => a + x.r, 0);
  const wr = rx.filter((x) => x.r > 0), lr = rx.filter((x) => x.r < 0);
  const usd = xs.reduce((a, x) => a + x.net, 0);
  const won = xs.filter((x) => x.net > 0).reduce((a, x) => a + x.net, 0), lost = -xs.filter((x) => x.net < 0).reduce((a, x) => a + x.net, 0);
  return { n, w, l, be: n - w - l, win: w + l ? w / (w + l) : null, rn: rx.length, avg: rx.length ? tot / rx.length : null, tot,
    pf: lost ? won / lost : won ? Infinity : null, aw: wr.length ? gw / wr.length : null, al: lr.length ? gl / lr.length : null, usd, gw, gl };
}

const PRESETS = [['today', 'Today'], ['yday', 'Yesterday'], ['wk', 'This week'], ['lwk', 'Last week'], ['m', 'This month'], ['lm', 'Last month'], ['3m', 'Last 3 months'], ['y', 'This year'], ['all', 'All time']];
const blank = () => ({ preset: '3m', dmode: 'preset', lastn: '30', since: '', from: '', to: '',
  sym: [], mkt: [], strat: [], sess: [], dir: [], out: [], mist: [], dow: [], hold: [], h1: '', h2: '', rating: 0, comp: 'all', rules: [] });
const CAT_KEYS = [['sym', 'Symbol'], ['mkt', 'Market'], ['strat', 'Strategy'], ['sess', 'Session'], ['dir', 'Direction'], ['out', 'Outcome'], ['mist', 'Mistakes']];
const loadF = () => { try { return { ...blank(), ...JSON.parse(localStorage.getItem('tj.af') || '{}') }; } catch { return blank(); } };

function dateWindow(f) {
  const today = todayBne(), t = dn(today), mon = t - ((new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7);
  const m1 = dn(today.slice(0, 8) + '01');
  const pm = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 10);
  if (f.dmode === 'preset') {
    const W = { today: [t, t], yday: [t - 1, t - 1], wk: [mon, t], lwk: [mon - 7, mon - 1], m: [m1, t], lm: [dn(pm), m1 - 1], '3m': [t - 91, t], y: [dn(today.slice(0, 5) + '01-01'), t], all: [-1e9, 1e9] }[f.preset] || [-1e9, 1e9];
    return { lo: W[0], hi: W[1], label: (PRESETS.find((p) => p[0] === f.preset) || [, 'All time'])[1] };
  }
  if (f.dmode === 'lastn') { const n = Math.max(1, parseInt(f.lastn, 10) || 1); return { lo: t - n + 1, hi: t, label: `Last ${n} days` }; }
  if (f.dmode === 'since') return { lo: f.since ? dn(f.since) : -1e9, hi: 1e9, label: f.since ? 'Since ' + f.since : 'All time' };
  if (f.dmode === 'range') return { lo: f.from ? dn(f.from) : -1e9, hi: f.to ? dn(f.to) : 1e9, label: `${f.from || '…'} → ${f.to || '…'}` };
  return { lo: -1e9, hi: 1e9, label: 'All time' };
}

// ------------------------------------------------------------------ page

export function Analytics() {
  const s = useStore();
  const st = useData(() => api('/analytics/ideas?' + scopeQs()), [s.acct, s.firm]);
  return html`<${PageHead} title="Analytics" sub="R on the lead account · dollars for the accounts selected"/>
    <${SampleEmpty}/>
    <${Loading} state=${st}>${(d) => html`<${Body} d=${d}/>`}<//>`;
}

function Body({ d }) {
  const s = useStore();
  const [f, setF0] = useState(loadF);
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState('sym');
  const [adv, setAdv] = useState(false);
  const [groupBy, setGroupBy] = useState('strat');
  const [curve, setCurve] = useState('r');
  const [saved, setSaved] = useState(d.saved || []);
  const [savedSel, setSavedSel] = useState('');
  const [saving, setSaving] = useState(null);
  const popRef = useRef(), btnRef = useRef();
  const setF = (patch) => { const v = { ...f, ...patch }; setF0(v); setSavedSel(''); try { localStorage.setItem('tj.af', JSON.stringify(v)); } catch { /* ignore */ } };
  const replaceF = (v) => { setF0(v); try { localStorage.setItem('tj.af', JSON.stringify(v)); } catch { /* ignore */ } };
  useEffect(() => {
    if (!open) return;
    const k = (e) => { if (e.key === 'Escape') setOpen(false); };
    const m = (e) => { if (popRef.current && !popRef.current.contains(e.target) && btnRef.current && !btnRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', k); document.addEventListener('mousedown', m);
    return () => { document.removeEventListener('keydown', k); document.removeEventListener('mousedown', m); };
  }, [open]);

  // enrich each idea once
  const mistName = Object.fromEntries(d.mistakes.map((m) => [m.id, m.label]));
  const ruleName = Object.fromEntries(d.rules.map((r) => [r.id, r.label]));
  const ALL = d.ideas.map((i) => {
    const b = bne(i.open_time);
    const comp = i.ckTotal > 0 ? (i.ckDone >= i.ckTotal ? 'ok' : i.reviewed ? 'viol' : 'unknown') : 'unknown';
    return { ...i, day: dayOf(i.close_time), dow: DOW[(b.getUTCDay() + 6) % 7], hour: b.getUTCHours(), sess: sessionOf(i.open_time), mkt: marketOf(i.symbol),
      dir: i.direction === 'long' ? 'Long' : 'Short', held: Math.round((i.close_time - i.open_time) / 60000), out: outOf(i), comp,
      mistN: i.mistakes.map((m) => mistName[m]).filter(Boolean), missedN: comp === 'viol' ? i.missed.map((m) => ruleName[m]).filter(Boolean) : [] };
  });
  const uniq = (k) => [...new Set(ALL.map((x) => x[k]))].sort();
  const CATS = { sym: uniq('symbol'), mkt: uniq('mkt'), strat: uniq('strategy'), sess: uniq('sess'), dir: ['Long', 'Short'], out: ['Win', 'Loss', 'Breakeven'],
    mist: [...new Set(ALL.flatMap((x) => x.mistN))].sort() };
  const RULES = [...new Set(d.rules.map((r) => r.label))].sort();

  // filter
  const win = dateWindow(f);
  const has = (a, v) => !a.length || a.includes(v);
  const inHours = (h) => { if (f.h1 === '' && f.h2 === '') return true; const a = f.h1 === '' ? 0 : +f.h1, b = f.h2 === '' ? 23 : +f.h2; return a <= b ? h >= a && h <= b : h >= a || h <= b; };
  const L = ALL.filter((x) => { const t = dn(x.day); return t >= win.lo && t <= win.hi; })
    .filter((x) => has(f.sym, x.symbol) && has(f.mkt, x.mkt) && has(f.strat, x.strategy) && has(f.sess, x.sess) && has(f.dir, x.dir) && has(f.out, x.out)
      && (!f.mist.length || x.mistN.some((m) => f.mist.includes(m))) && has(f.dow, x.dow) && has(f.hold, holdOf(x.held)) && inHours(x.hour)
      && (!f.rating || (x.rating || 0) >= f.rating) && (f.comp === 'all' || x.comp === f.comp)
      && (!f.rules.length || x.missedN.some((r) => f.rules.includes(r))));
  const S = stat(L);

  // active filter chips
  const chips = [];
  CAT_KEYS.forEach(([k, l]) => { if (f[k].length) chips.push({ label: `${l}: ${f[k].join(', ')}`, rm: () => setF({ [k]: [] }) }); });
  if (f.dmode !== 'preset') chips.push({ label: 'Date: ' + win.label, rm: () => setF({ dmode: 'preset', preset: '3m' }) });
  if (f.dow.length) chips.push({ label: 'Days: ' + f.dow.join(', '), rm: () => setF({ dow: [] }) });
  if (f.h1 !== '' || f.h2 !== '') chips.push({ label: `Entry ${String(f.h1 || 0).padStart(2, '0')}:00–${String(f.h2 === '' ? 23 : f.h2).padStart(2, '0')}:59`, rm: () => setF({ h1: '', h2: '' }) });
  if (f.hold.length) chips.push({ label: 'Hold: ' + f.hold.join(', '), rm: () => setF({ hold: [] }) });
  if (f.rating) chips.push({ label: `Rating ${f.rating}+`, rm: () => setF({ rating: 0 }) });
  if (f.comp !== 'all') chips.push({ label: f.comp === 'ok' ? 'Fully compliant' : 'With rule breaks', rm: () => setF({ comp: 'all' }) });
  if (f.rules.length) chips.push({ label: 'Broke: ' + f.rules.join(', '), rm: () => setF({ rules: [] }) });
  const tog = (k, v) => setF({ [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });

  const persist = async (list) => {
    setSaved(list);
    try { await api('/settings', { method: 'PUT', body: { saved_filters: list } }); } catch (e) { toast(e.message, true); }
  };
  const doSave = async () => {
    const name = (saving || '').trim();
    if (!name) return;
    const list = [...saved.filter((x) => x.name !== name), { name, f }];
    await persist(list); setSaving(null); setSavedSel(name); toast('Filter saved');
  };

  const pill = (on, label, onClick, extra = '') => html`<button type="button" class=${cls('pill', on && 'on')} aria-pressed=${on} onClick=${onClick} style=${extra}>${label}</button>`;
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return html`<section class="panel" style="position:relative;z-index:5;overflow:visible">
      <div class="hstack" style="padding:10px 12px;gap:8px">
        <label class="sr" for="sv">Saved filters</label>
        <select id="sv" class="inp sm" style="width:190px" value=${savedSel} onChange=${(e) => { const v = e.target.value; setSavedSel(v); const x = saved.find((y) => y.name === v); if (x) replaceF({ ...blank(), ...x.f }); }}>
          <option value="">Saved filters…</option>${saved.map((x) => html`<option value=${x.name}>${x.name}</option>`)}</select>
        ${savedSel && html`<button type="button" class="btn sm ghost" aria-label=${'Delete saved filter ' + savedSel} title="Delete this saved filter"
          onClick=${() => { if (confirm(`Delete the saved filter “${savedSel}”?`)) { persist(saved.filter((x) => x.name !== savedSel)); setSavedSel(''); } }}><${Icon} name="trash" size=${14}/></button>`}
        <span class="hide-phone" style="width:1px;height:22px;background:#1E2430;margin:0 2px"></span>
        ${PRESETS.map(([k, l]) => pill(f.dmode === 'preset' && f.preset === k, l, () => setF({ dmode: 'preset', preset: k })))}
        <div class="hstack" style="margin-left:auto;gap:10px">
          <span class="sub">${S.n} of ${ALL.length} ideas · ${win.label}</span>
          <button ref=${btnRef} type="button" class=${cls('pill big', open && 'on')} aria-expanded=${open} onClick=${() => setOpen(!open)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z"/></svg>Filters
            ${chips.length > 0 && html`<span class="chip b num" style="height:18px;padding:0 6px;font-size:11px">${chips.length}</span>`}</button></div>
      </div>
      ${chips.length > 0 && html`<div class="hstack" style="padding:0 12px 10px;gap:6px">
        ${chips.map((c) => html`<span class="chip b" style="height:26px">${c.label}<button type="button" style="border:0;background:none;color:inherit;cursor:pointer;padding:0 0 0 2px" aria-label=${'Remove ' + c.label} onClick=${c.rm}>×</button></span>`)}
        <button type="button" class="btn sm ghost" style="min-height:26px" onClick=${() => replaceF(blank())}>Clear all</button></div>`}

      ${open && html`<div ref=${popRef} class="pop" role="dialog" aria-label="Filters">
        <div class="stack" style="padding:16px 18px;gap:14px;max-height:min(640px,70vh);overflow:auto">
          <div class="field"><span class="cap">I'm looking for</span>
            <div class="hstack" style="gap:8px">${CAT_KEYS.map(([k, l]) => html`<button type="button" class=${cls('pill big', cat === k && 'on')} aria-pressed=${cat === k} onClick=${() => setCat(cat === k ? '' : k)}>${l}${f[k].length ? html`<span class="num" style="color:#9DB8FF;font-size:11.5px">${f[k].length}</span>` : ''}</button>`)}</div></div>
          ${cat && html`<div class="box">
            <div class="spread" style="margin-bottom:8px"><span class="sub">Pick one or more · ${CAT_KEYS.find((c) => c[0] === cat)[1]}</span><button type="button" class="btn sm ghost" style="min-height:24px" onClick=${() => setF({ [cat]: [] })}>Clear</button></div>
            <div class="hstack" style="gap:6px">${CATS[cat].length ? CATS[cat].map((v) => pill(f[cat].includes(v), v, () => tog(cat, v))) : html`<span class="sub">Nothing to pick yet.</span>`}</div></div>`}
          <button type="button" class="btn sm ghost" style="align-self:flex-start;padding:0" aria-expanded=${adv} onClick=${() => setAdv(!adv)}>${adv ? '▾' : '▸'} Advanced filters</button>
          ${adv && html`<div class="stack" style="gap:14px">
            <div class="field"><span class="cap">Date</span>
              <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px">${[['all', 'All time'], ['lastn', 'Last N days'], ['since', 'Since'], ['range', 'Range']].map(([k, l]) => {
                const on = f.dmode === k || (k === 'all' && f.dmode === 'preset' && f.preset === 'all');
                return pill(on, l, () => setF(k === 'all' ? { dmode: 'preset', preset: 'all' } : { dmode: k }), 'justify-content:center'); })}</div>
              ${f.dmode === 'lastn' && html`<div class="hstack" style="margin-top:6px"><label class="sr" for="aln">Days</label><input id="aln" class="inp sm num" style="width:80px" inputmode="numeric" value=${f.lastn} onInput=${(e) => setF({ lastn: e.target.value })}/><span class="sub">days back from today</span></div>`}
              ${f.dmode === 'since' && html`<div class="hstack" style="margin-top:6px"><label class="sub" for="asi">Since</label><input id="asi" type="date" class="inp sm" style="width:auto" value=${f.since} onInput=${(e) => setF({ since: e.target.value })}/></div>`}
              ${f.dmode === 'range' && html`<div class="hstack" style="margin-top:6px"><label class="sr" for="afr">From</label><input id="afr" type="date" class="inp sm" style="width:auto" value=${f.from} onInput=${(e) => setF({ from: e.target.value })}/><span class="sub">to</span>
                <label class="sr" for="ato">To</label><input id="ato" type="date" class="inp sm" style="width:auto" value=${f.to} onInput=${(e) => setF({ to: e.target.value })}/></div>`}</div>
            <div class="field"><span class="cap">Day of week (Brisbane)</span><div class="hstack" style="gap:6px">${DOW.slice(0, 6).map((v) => pill(f.dow.includes(v), v, () => tog('dow', v)))}</div></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
              <div class="field"><span class="cap">Entry time (Brisbane)</span><div class="hstack" style="flex-wrap:nowrap;gap:6px">
                <label class="sr" for="ah1">From hour</label><select id="ah1" class="inp sm" style="flex:1" value=${f.h1} onChange=${(e) => setF({ h1: e.target.value })}><option value="">Any</option>${hours.map((h) => html`<option value=${h}>${String(h).padStart(2, '0')}:00</option>`)}</select>
                <span class="sub">to</span><label class="sr" for="ah2">To hour</label><select id="ah2" class="inp sm" style="flex:1" value=${f.h2} onChange=${(e) => setF({ h2: e.target.value })}><option value="">Any</option>${hours.map((h) => html`<option value=${h}>${String(h).padStart(2, '0')}:59</option>`)}</select></div></div>
              <div class="field"><span class="cap">Execution rating</span><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px">${[[0, 'Any'], [3, '3+'], [4, '4+'], [5, '5']].map(([v, l]) => pill(f.rating === v, l, () => setF({ rating: v }), 'justify-content:center'))}</div></div>
            </div>
            <div class="field"><span class="cap">Hold time</span><div class="hstack" style="gap:6px">${HOLDS.map((v) => pill(f.hold.includes(v), v, () => tog('hold', v)))}</div></div>
          </div>`}
          <div class="field"><span class="cap">Rule compliance (per-trade checklist)</span>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">${[['all', 'All trades'], ['viol', 'With violations'], ['ok', 'Fully compliant']].map(([k, l]) => pill(f.comp === k, l, () => setF({ comp: k }), 'justify-content:center'))}</div>
            ${RULES.length > 0 && html`<span class="sub" style="margin-top:4px">Only trades that broke any of:</span>
              <div class="hstack" style="gap:6px">${RULES.map((r) => pill(f.rules.includes(r), r, () => tog('rules', r), 'height:26px;font-size:11.5px'))}</div>`}
            <span class="sub">A broken rule is a checklist item left unticked on a reviewed idea.</span></div>
        </div>
        <div class="hstack" style="padding:12px 18px;border-top:1px solid #1B212C;gap:8px">
          <button type="button" class="btn sm ghost" onClick=${() => replaceF(blank())}>Clear all</button>
          ${saving != null ? html`<span class="hstack" style="margin-left:auto;flex-wrap:nowrap;gap:6px"><label class="sr" for="sname">Filter name</label>
              <input id="sname" class="inp sm" style="width:180px" placeholder="Name this filter" value=${saving} onInput=${(e) => setSaving(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && doSave()}/>
              <button type="button" class="btn sm" onClick=${doSave}>Save</button></span>`
            : html`<button type="button" class="btn sm" style="margin-left:auto" onClick=${() => setSaving(savedSel || '')}>Save filter</button>`}
          <button type="button" class="btn sm pri" onClick=${() => setOpen(false)}>Show ${S.n} ideas</button></div>
      </div>`}
    </section>

    ${S.n > 0 && S.n < 30 && html`<div class="warn" style="padding:9px 14px">Only ${S.n} idea${S.n === 1 ? '' : 's'} match. Treat these as leads to check, not proof; patterns settle after 30 or more ideas.</div>`}
    ${S.rn < S.n && html`<div class="sub">${S.n - S.rn} idea(s) have no known risk (no stop-loss seen) and are left out of R figures.</div>`}
    ${!S.n ? html`<div class="panel"><div class="empty">${ALL.length ? 'No closed ideas match these filters.' : 'No closed ideas yet.'}</div></div>` : html`<${Results} L=${L} S=${S} groupBy=${groupBy} setGroupBy=${setGroupBy} curve=${curve} setCurve=${setCurve}/>`}`;
}

// ------------------------------------------------------------------ results

const DIMS = {
  strat: ['Strategy', (x) => x.strategy], sym: ['Symbol', (x) => x.symbol], mkt: ['Market', (x) => x.mkt], sess: ['Session', (x) => x.sess],
  dow: ['Weekday', (x) => x.dow], hour: ['Entry hour', (x) => String(x.hour).padStart(2, '0') + ':00'], hold: ['Hold time', (x) => holdOf(x.held)],
  dir: ['Direction', (x) => x.dir], month: ['Month', (x) => x.day.slice(0, 7)], rating: ['Rating', (x) => (x.rating ? x.rating + '★' : 'Not rated')],
};
const GROUPS = [['strat', 'Strategy'], ['sym', 'Symbol'], ['mkt', 'Market'], ['sess', 'Session'], ['dow', 'Weekday'], ['hour', 'Hour'], ['hold', 'Hold'], ['dir', 'Side'], ['month', 'Month'], ['rating', 'Rating']];
const SORT = { dow: (a, b) => DOW.indexOf(a.label) - DOW.indexOf(b.label), hold: (a, b) => HOLDS.indexOf(a.label) - HOLDS.indexOf(b.label), month: (a, b) => a.label.localeCompare(b.label), hour: (a, b) => a.label.localeCompare(b.label) };

function groupOf(L, key) {
  const g = {};
  for (const x of L) { const v = DIMS[key][1](x); (g[v] ||= []).push(x); }
  return Object.entries(g).map(([label, xs]) => ({ label, ...stat(xs) }));
}

function Results({ L, S, groupBy, setGroupBy, curve, setCurve }) {
  const chron = [...L].sort((a, b) => a.close_time - b.close_time);
  let cum = 0, peak = 0, dd = 0, ddAt = null, cu = 0;
  const pts = [{ x: 0, y: 0 }];
  chron.forEach((x, k) => {
    cum += x.r || 0; cu += x.net;
    const v = curve === 'r' ? cum : cu;
    pts.push({ x: k + 1, y: Math.round(v * 100) / 100 });
    if (cum > peak) peak = cum;
    if (peak - cum > dd) { dd = peak - cum; ddAt = x.close_time; }
  });
  // patterns: groups with 4+ ideas (but not the whole selection), by average R
  const segs = [];
  ['strat', 'sym', 'mkt', 'sess', 'dow', 'hour', 'hold', 'dir'].forEach((k) => groupOf(L, k).forEach((g) => { if (g.n >= 4 && g.n < S.n && g.avg != null) segs.push({ dim: DIMS[k][0], ...g }); }));
  segs.sort((a, b) => b.avg - a.avg);
  const ins = [];
  segs.filter((g) => g.avg > 0).slice(0, 2).forEach((g) => ins.push({ tag: 'Strength', c: 'g', title: `${g.dim}: ${g.label}`, sub: `${g.n} ideas · ${fmt.rate(g.win)} win · ${fR(g.tot)} total`, v: fR(g.avg) }));
  segs.filter((g) => g.avg < 0).slice(-2).reverse().forEach((g) => ins.push({ tag: 'Leak', c: 'r', title: `${g.dim}: ${g.label}`, sub: `${g.n} ideas · ${fmt.rate(g.win)} win · ${fR(g.tot)} total`, v: fR(g.avg) }));
  const ok = stat(L.filter((x) => x.comp === 'ok')), bad = stat(L.filter((x) => x.comp === 'viol'));
  if (bad.n) ins.push({ tag: 'Rules', c: 'a', title: 'Ideas with a broken rule', sub: `${bad.n} of ${S.n} ideas · ${fR(bad.tot)} in total`, v: fR(bad.avg) });
  // heatmap: weekday × entry hour (only hours with trades), trading-day order from 05:00
  const hrs = [...new Set(L.map((x) => x.hour))].sort((a, b) => ((a + 19) % 24) - ((b + 19) % 24));
  const days = DOW.filter((dname) => L.some((x) => x.dow === dname));
  // distribution
  const B = [['≤ −1', (r) => r <= -0.95], ['−1…−.5', (r) => r > -0.95 && r <= -0.5], ['−.5…0', (r) => r > -0.5 && r < 0], ['0….5', (r) => r >= 0 && r < 0.5], ['.5…1', (r) => r >= 0.5 && r < 1], ['1…2', (r) => r >= 1 && r < 2], ['≥ 2', (r) => r >= 2]];
  const rx = L.filter((x) => x.r != null);
  const cnt = B.map((b) => rx.filter((x) => b[1](x.r)).length), cmax = Math.max(1, ...cnt);
  // breakdown
  const rows = groupOf(L, groupBy).sort(SORT[groupBy] || ((a, b) => b.tot - a.tot));
  const mx = Math.max(0.01, ...rows.map((r) => Math.abs(r.tot)));
  const mists = {};
  L.forEach((x) => x.mistN.forEach((m) => (mists[m] ||= []).push(x)));
  const mrows = Object.entries(mists).map(([label, xs]) => ({ label, ...stat(xs) })).sort((a, b) => a.tot - b.tot);
  const box = (label, x) => html`<div class="box stack" style="gap:5px"><span class="cap">${label}</span><span class=${cls('num', tone(x.avg))} style="font-size:20px;font-weight:700">${x.n ? fR(x.avg) : '—'}</span>
    <span class="sub">${x.n} ideas · ${fmt.rate(x.win)} win</span><span class="sub">Total ${fR(x.tot)} · ${fmt.money(x.usd, 0)}</span></div>`;
  const cell = (v, ...rest) => html`<div class="kcell"><div class="cap">${v}</div>${rest}</div>`;
  return html`
  <section class="kstrip k7" aria-label="Results for the current filter">
    ${cell('Net P&L', html`<div class=${cls('kv num', sgn(S.usd))}>${fmt.money(S.usd, 0)}</div>`, html`<div class="sub">after costs · accounts selected</div>`)}
    ${cell('Ideas', html`<div class="kv num">${S.n}</div>`, html`<div class="sub">${S.w}W · ${S.l}L · ${S.be} BE</div>`)}
    ${cell('Win rate', html`<div class="kv num">${fmt.rate(S.win)}</div>`, html`<div class="bar" style="margin-top:7px"><i style=${`width:${Math.round((S.win || 0) * 100)}%`}></i></div>`)}
    ${cell('Expectancy', html`<div class=${cls('kv num', tone(S.avg))}>${fR(S.avg)}</div>`, html`<div class="sub">per idea · total ${fR(S.tot)}</div>`)}
    ${cell('Profit factor', html`<div class="kv num">${pfTxt(S.pf)}</div>`, html`<div class="sub">+${S.gw.toFixed(1)}R won · −${S.gl.toFixed(1)}R lost</div>`)}
    ${cell('Avg win / loss', html`<div class="kv num">${S.aw != null ? S.aw.toFixed(2) : '—'} / ${S.al != null ? S.al.toFixed(2) : '—'}</div>`, html`<div class="sub">${S.aw && S.al ? 'realised R:R ' + (S.aw / S.al).toFixed(2) : '—'}</div>`)}
    ${cell('Max drawdown', html`<div class="kv num neg">${dd ? '−' + dd.toFixed(2) + 'R' : '0R'}</div>`, html`<div class="sub">${dd ? 'low on ' + fmt.date(ddAt) : 'no drawdown'}</div>`)}
  </section>

  <div class="split-a">
    <section class="panel"><div class="ph"><div><h2>Cumulative ${curve === 'r' ? 'R' : 'P&L'}</h2><div class="sub" style="margin-top:2px">Each step is one closed idea, oldest to newest</div></div>
      <div class="seg2" role="group" aria-label="Curve">${[['r', 'R'], ['usd', '$']].map(([k, l]) => html`<button type="button" class=${curve === k ? 'on' : ''} aria-pressed=${curve === k} onClick=${() => setCurve(k)}>${l}</button>`)}</div></div>
      <div class="pb"><${LineChart} height=${240} label=${`Cumulative ${curve === 'r' ? 'R' : 'P&L'} over ${S.n} ideas`} yFmt=${curve === 'r' ? (v) => (Number.isInteger(v) ? v : v.toFixed(1)) + 'R' : (v) => '$' + Math.round(v).toLocaleString('en-US')}
        series=${[{ color: '#5B8CFF', points: pts }]} xLabels=${[{ x: 0, label: chron.length ? fmt.date(chron[0].close_time) : 'start' }, { x: chron.length, label: chron.length ? fmt.date(chron[chron.length - 1].close_time) : '' }]}/></div></section>
    <section class="panel"><div class="ph"><div><h2>Patterns in this selection</h2><div class="sub" style="margin-top:2px">Groups with 4 or more ideas, by average R</div></div></div>
      <div class="pb stack" style="gap:8px">${ins.length ? ins.map((t) => html`<div class="box" style="display:flex;gap:10px;align-items:flex-start">
        <span class=${'chip ' + t.c}>${t.tag}</span><div style="min-width:0;flex:1"><div style="font-size:12.5px;font-weight:600">${t.title}</div><div class="sub">${t.sub}</div></div>
        <span class=${cls('num', t.c === 'g' ? 'pos' : 'neg')} style="font-weight:600;font-size:12.5px">${t.v}</span></div>`)
        : html`<div class="sub">Not enough ideas in any group yet. Widen the dates or remove a filter.</div>`}</div></section>
  </div>

  <div class="split-b">
    <section class="panel"><div class="ph"><div><h2>When you trade best</h2><div class="sub" style="margin-top:2px">Average R by weekday and entry hour (Brisbane) · small number = ideas</div></div></div>
      <div class="pb" style="overflow-x:auto"><div class="hm" style=${`grid-template-columns:40px repeat(${hrs.length},minmax(40px,1fr));min-width:${40 + hrs.length * 44}px`}>
        <div></div>${hrs.map((h) => html`<div style="color:#8B94A3;height:22px">${String(h).padStart(2, '0')}</div>`)}
        ${days.map((dname) => html`<div style="color:#C3CAD6;align-items:flex-start;font-size:11.5px">${dname}</div>${hrs.map((h) => {
          const c = L.filter((x) => x.dow === dname && x.hour === h), st = stat(c);
          if (!c.length) return html`<div style="background:#0E1219;color:#3A4254" title=${`${dname} ${h}:00 no ideas`}>·</div>`;
          const a = st.avg == null ? 0.12 : Math.min(1, Math.abs(st.avg) / 1.2) * 0.75 + 0.12;
          const pos = (st.avg ?? st.usd) >= 0;
          return html`<div title=${`${dname} ${String(h).padStart(2, '0')}:00 · ${st.n} ideas · avg ${fR(st.avg)} · ${fmt.money(st.usd, 0)}`}
            style=${`background:${pos ? 'rgba(61,214,140,' : 'rgba(255,122,132,'}${a.toFixed(2)});color:${a > 0.5 ? '#0B0E13' : '#E6E9EF'}`}>
            <b class="num" style="font-weight:600">${st.avg == null ? '—' : fR(st.avg).replace('R', '')}</b><span style="opacity:.75">${st.n}</span></div>`;
        })}`)}
      </div><div class="sub" style="margin-top:8px">Sessions are split by each city's own hours; see the Session breakdown for totals.</div></div></section>
    <section class="panel"><div class="ph"><h2>Breakdown</h2>
      <div class="seg2" role="group" aria-label="Group by">${GROUPS.map(([k, l]) => html`<button type="button" class=${groupBy === k ? 'on' : ''} aria-pressed=${groupBy === k} onClick=${() => setGroupBy(k)}>${l}</button>`)}</div></div>
      <div style="padding:0 6px 8px;overflow-x:auto"><table class="mtbl"><thead><tr><th>${DIMS[groupBy][0]}</th><th class="r">Ideas</th><th class="r">Win</th><th class="r">Avg R</th><th style="width:30%">Total R</th><th class="r">PF</th><th class="r">P&L</th></tr></thead>
        <tbody>${rows.map((r) => html`<tr><td style="font-weight:600">${r.label}</td><td class="num r">${r.n}</td><td class="num r">${fmt.rate(r.win)}</td><td class=${cls('num r', tone(r.avg))}>${fR(r.avg)}</td>
          <td><div class="hstack" style="flex-wrap:nowrap;gap:8px"><div style="flex:1;height:8px;position:relative;background:#151A22;border-radius:4px">
            <i style=${`position:absolute;top:0;bottom:0;border-radius:4px;${r.tot >= 0 ? 'left:50%;background:var(--pos)' : 'right:50%;background:var(--neg)'};width:${(Math.abs(r.tot) / mx * 50).toFixed(1)}%`}></i></div>
            <span class=${cls('num', tone(r.tot))} style="width:58px;text-align:right">${fR(r.tot)}</span></div></td>
          <td class="num r">${pfTxt(r.pf)}</td><td class=${cls('num r', sgn(r.usd))}>${fmt.money(r.usd, 0)}</td></tr>`)}</tbody></table></div></section>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">
    <section class="panel"><div class="ph"><h2>R distribution</h2><span class="sub">${rx.length} ideas with R</span></div>
      <div class="pb"><div style="display:flex;gap:8px;align-items:flex-end;height:150px" role="img" aria-label=${'R distribution: ' + B.map((b, k) => b[0] + ' ' + cnt[k]).join(', ')}>
        ${B.map((b, k) => html`<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;height:100%"><span class="num sub">${cnt[k]}</span>
          <div style=${`width:100%;border-radius:6px 6px 0 0;min-height:2px;height:${Math.round(cnt[k] / cmax * 118)}px;background:${k < 3 ? 'var(--neg)' : 'var(--pos)'}`}></div></div>`)}</div>
        <div style="display:flex;gap:8px;margin-top:6px">${B.map((b) => html`<span class="sub num" style="flex:1;text-align:center;font-size:10.5px">${b[0]}</span>`)}</div></div></section>
    <section class="panel"><div class="ph"><h2>Rules followed vs broken</h2></div>
      <div class="pb" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${box('All rules followed', ok)}${box('A rule broken', bad)}
        <div class="sub" style="grid-column:1/-1">${ok.n && bad.n && ok.avg != null && bad.avg != null ? `Breaking a rule cost ${(ok.avg - bad.avg).toFixed(2)}R per idea on average in this selection.` : 'Tick the per-trade checklist on your reviews to compare.'}</div></div></section>
    <section class="panel"><div class="ph"><h2>Costliest mistakes</h2><span class="sub">tagged in reviews</span></div>
      <div style="padding:0 6px 8px">${mrows.length ? html`<table class="mtbl"><thead><tr><th>Mistake</th><th class="r">Ideas</th><th class="r">Avg R</th><th class="r">Total R</th></tr></thead>
        <tbody>${mrows.slice(0, 8).map((m) => html`<tr><td style="white-space:normal">${m.label}</td><td class="num r">${m.n}</td><td class=${cls('num r', tone(m.avg))}>${fR(m.avg)}</td><td class=${cls('num r', tone(m.tot))} style="font-weight:600">${fR(m.tot)}</td></tr>`)}</tbody></table>`
        : html`<div class="sub" style="padding:6px 10px">No tagged mistakes in this selection.</div>`}</div></section>
  </div>`;
}
