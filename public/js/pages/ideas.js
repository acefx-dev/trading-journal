import { html, useState, useEffect, useRef, useStore, useData, api, scopeQs, store, fmt, sgn, cls, Kpi, Money, R, Dir, Loading, PageHead, Seg, Icon, Modal, toast, todayBne } from '../lib.js';
import { IdeaTable, SampleEmpty } from './dashboard.js';

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export function Ideas() {
  const s = useStore();
  const [range, setRange] = useState('30');
  const [status, setStatus] = useState('all');
  const [result, setResult] = useState('all');
  const [review, setReview] = useState('all');
  const [strategy, setStrategy] = useState('');
  const today = todayBne();
  const from = range === 'all' ? '' : addDays(today, -(Number(range) - 1));
  const qs = `${scopeQs()}&from=${from}&status=${status === 'all' ? '' : status}&result=${result === 'all' ? '' : result}&review=${review === 'todo' ? 'todo' : ''}&strategy=${strategy}&limit=300`;
  const st = useData(() => api('/ideas?' + qs), [qs]);
  const strategies = s.boot.strategies;
  const csv = '/api/export/ideas.csv?' + scopeQs() + (s.mode === 'sample' ? '&mode=sample' : '');
  return html`<${PageHead} title="Trade ideas" sub="Related positions grouped into one idea, with every copy on your other accounts">
      <a class="btn" href=${csv} download><${Icon} name="dl" size=${16}/><span class="hide-sm">Export CSV</span></a><//>
    <${SampleEmpty}/>
    <div class="card stack" style="gap:12px">
      <div class="hstack" style="gap:12px">
        <${Seg} label="Period" value=${range} onChange=${setRange} options=${[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All']]}/>
        <${Seg} label="Status" value=${status} onChange=${setStatus} options=${[['all', 'All'], ['open', 'Open'], ['closed', 'Closed']]}/>
        <${Seg} label="Result" value=${result} onChange=${setResult} options=${[['all', 'Any result'], ['win', 'Wins'], ['loss', 'Losses']]}/>
        <${Seg} label="Review" value=${review} onChange=${setReview} options=${[['all', 'All'], ['todo', 'Needs review']]}/>
        <label class="sr" for="fstrat">Strategy</label>
        <select id="fstrat" class="inp" value=${strategy} onChange=${(e) => setStrategy(e.target.value)}>
          <option value="">All strategies</option><option value="none">No strategy</option>
          ${strategies.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select>
      </div>
    </div>
    <${Loading} state=${st}>${(d) => html`
      <section class="kpis">
        <${Kpi} label="Closed ideas" value=${d.summary.count} sub=${`${d.summary.wins}W · ${d.summary.losses}L${d.total > d.summary.count ? ' · ' + (d.total - d.summary.count) + ' open' : ''}`}/>
        <${Kpi} label="Net P&L (scope)" value=${fmt.money(d.summary.totalNet)} tone=${sgn(d.summary.totalNet)}/>
        <${Kpi} label="Win rate" value=${fmt.rate(d.summary.winRate)}/>
        <${Kpi} label="Expectancy" value=${fmt.r(d.summary.expectancyR)} tone=${sgn(d.summary.expectancyR)} sub=${`${d.summary.rCount} with a known risk`}/>
      </section>
      <section class="card flush">${d.items.length ? html`<${IdeaTable} ideas=${d.items}/>` : html`<div class="empty">No ideas match these filters.</div>`}
        ${d.total > d.items.length && html`<div class="sub" style="padding:12px">Showing the latest ${d.items.length} of ${d.total}. Narrow the period to see older ones.</div>`}</section>`}<//>`;
}

// ------------------------------------------------------------------ one idea

export function IdeaDetail({ id }) {
  const st = useData(() => api('/ideas/' + id), [id]);
  return html`<nav class="sub hstack" aria-label="Breadcrumb"><a href="#/ideas">Trade ideas</a><${Icon} name="chev" size=${14}/>
    <span>${st.data ? `${st.data.idea.symbol} ${st.data.idea.direction === 'long' ? 'Long' : 'Short'} · ${fmt.date(st.data.idea.open_time)}` : 'Idea ' + id}</span></nav>
    <${Loading} state=${st}>${(d) => html`<${Detail} d=${d} reload=${st.reload}/>`}<//>`;
}

function Detail({ d, reload }) {
  const s = useStore();
  const i = d.idea;
  const lead = d.positions.filter((p) => p.account_id === i.account_id);
  const dur = i.close_time ? Math.round((i.close_time - i.open_time) / 60000) : null;
  const leadAcc = i.accounts.find((a) => a.lead) || i.accounts[0];
  return html`
  <header class="spread" style="align-items:flex-start">
    <div class="stack" style="gap:10px">
      <div class="hstack" style="gap:12px"><h1 class="h1" style="font-size:26px">${i.symbol} ${i.direction === 'long' ? 'Long' : 'Short'}</h1>
        <${Dir} d=${i.direction}/>${i.strategy_name && html`<span class="chip">${i.strategy_name}</span>`}
        ${i.status === 'open' ? html`<span class="chip b">Open</span>` : i.reviewed_at ? html`<span class="chip g">Reviewed</span>` : html`<span class="chip a">Needs review</span>`}
        ${s.mode === 'sample' && html`<span class="chip a">Sample data</span>`}</div>
      <div class="sub" style="font-size:13px">${fmt.dateY(i.open_time)} · ${fmt.timeS(i.open_time)} → ${i.close_time ? fmt.timeS(i.close_time) : 'open'} AEST
        ${dur != null ? ` · ${dur} min` : ''} · ${lead.length} position${lead.length > 1 ? 's' : ''} on ${i.lead_name}${i.accounts.length > 1 ? ` · copied to ${i.accounts.length - 1} account${i.accounts.length > 2 ? 's' : ''}` : ''}</div>
    </div>
    <div class="hstack" style="gap:28px">
      ${i.accounts.length > 1 && html`<div><div class="lbl">Combined P&L</div><div class="kv"><${Money} v=${i.net}/></div></div>`}
      <div><div class="lbl">${i.lead_name}</div><div class="kv"><${Money} v=${leadAcc.net}/></div></div>
      <div><div class="lbl">R (on ${i.lead_name})</div><div class="kv"><${R} v=${leadAcc.r}/></div></div>
      <div><div class="lbl">Risk at initial S/L</div><div class="kv num">${leadAcc.risk != null ? fmt.plain(leadAcc.risk) : '—'}</div></div>
    </div>
  </header>
  ${leadAcc.risk == null && i.status === 'closed' && html`<div class="warn">R can't be worked out: at least one position had no stop-loss when the connector first saw it.</div>`}
  <${Positions} d=${d} reload=${reload}/>
  <div class="row">
    <div class="col" style="flex:3 1 560px">
      <${Executions} i=${i}/>
      <${Grouping} d=${d} reload=${reload}/>
      <${Audit} items=${d.audit}/>
    </div>
    <div class="col" style="flex:2 1 380px">
      <${Review} d=${d} reload=${reload}/>
      <${Chart} d=${d} reload=${reload}/>
    </div>
  </div>`;
}

function Positions({ d, reload }) {
  const i = d.idea;
  const byAcct = {};
  for (const p of d.positions) (byAcct[p.account_id] ||= []).push(p);
  const leadCount = d.positions.filter((p) => p.account_id === i.account_id).length;
  const act = async (url, msg) => { try { await api(url, { method: 'POST' }); toast(msg); reload(); } catch (e) { toast(e.message, true); } };
  return html`<section class="card flush">
    <div class="card-head"><div><h2 class="h2">Positions</h2><div class="sub" style="margin-top:4px">Original MT5 position IDs. Prices in each broker's own symbol.</div></div></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Account</th><th>Position</th><th>Opened</th><th class="r">Lots</th><th class="r">Entry</th><th class="r">Initial S/L</th><th class="r">Exit</th><th>Closed</th><th class="r">P&L</th><th class="r">R</th><th><span class="sr">Actions</span></th></tr></thead>
    <tbody>${Object.values(byAcct).map((ps) => ps.map((p, k) => html`<tr>
      <td>${k === 0 ? html`<b>${p.account_name}</b>${p.account_id === i.account_id ? html` <span class="chip b">Lead</span>` : ''}` : ''}</td>
      <td class="num">#${p.position_id}${p.master_position_id && html`<div class="sub" title=${p.copy_link === 'comment' ? 'Linked by the copier comment' : p.copy_link === 'match' ? 'Linked by symbol, side and time' : 'Linked by hand'}>copy of #${p.master_position_id}</div>`}</td>
      <td class="num">${fmt.timeS(p.open_time)}<div class="sub">${p.symbol}</div></td>
      <td class="num r">${fmt.num(p.volume)}</td>
      <td class="num r">${fmt.num(p.open_price, 5)}</td>
      <td class="num r">${p.initial_sl ? fmt.num(p.initial_sl, 5) : html`<span class="chip r">none</span>`}</td>
      <td class="num r">${p.close_price != null ? fmt.num(p.close_price, 5) : '—'}</td>
      <td class="num">${p.status === 'open' ? html`<span class="chip b">open</span>` : fmt.timeS(p.close_time)}</td>
      <td class="r">${p.status === 'open' ? html`<${Money} v=${p.net}/><div class="sub">floating</div>` : html`<${Money} v=${p.net}/>`}</td>
      <td class="r"><${R} v=${p.r}/></td>
      <td>${p.account_id === i.account_id
        ? leadCount > 1 && html`<button class="btn sm" onClick=${() => act(`/positions/${p.id}/detach`, 'Moved to a new idea')} title="Move this position (and its copies) to an idea of its own">Remove</button>`
        : p.master_pos && html`<button class="btn sm" onClick=${() => act(`/positions/${p.id}/unlink`, 'Copy unlinked')} title="This copy belongs to another trade">Unlink</button>`}</td>
    </tr>`))}</tbody></table></div></section>`;
}

function Executions({ i }) {
  if (i.accounts.length < 2) return null;
  return html`<section class="card flush">
    <div class="card-head"><div><h2 class="h2">Master idea vs account executions</h2><div class="sub" style="margin-top:4px">Each account's own deals. Totals add up to the combined P&L.</div></div></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Account</th><th class="r">Positions</th><th class="r">Lots</th><th class="r">Risk</th><th class="r">P&L</th><th class="r">R</th><th class="r">vs lead</th></tr></thead>
    <tbody>${i.accounts.map((a) => {
      const lead = i.accounts.find((x) => x.lead);
      const diff = lead && a !== lead && a.r != null && lead.r != null ? a.r - lead.r : null;
      return html`<tr><td style="font-weight:500">${a.name}${a.lead ? ' (lead)' : ''}</td><td class="num r">${a.positions}</td><td class="num r">${fmt.num(a.volume)}</td>
        <td class="num r">${a.risk != null ? fmt.plain(a.risk) : '—'}</td><td class="r"><${Money} v=${a.net}/></td><td class="r"><${R} v=${a.r}/></td>
        <td class=${cls('r num', diff != null && Math.abs(diff) >= 0.05 ? 'neg' : 'mut')}>${diff == null ? '—' : (diff >= 0 ? '+' : '−') + Math.abs(diff).toFixed(2) + 'R'}</td></tr>`;
    })}</tbody>
    <tfoot><tr><td style="font-weight:600;padding:12px">Combined</td><td></td><td></td><td></td><td class="r" style="padding:12px"><${Money} v=${i.net}/></td><td></td><td></td></tr></tfoot></table></div></section>`;
}

function Grouping({ d, reload }) {
  const g = d.grouping;
  const i = d.idea;
  const [show, setShow] = useState(false);
  const same = g.nearby.filter((n) => n.sameKind);
  const add = async (n) => { try { await api(`/ideas/${i.id}/positions`, { method: 'POST', body: { position_row_id: n.id } }); toast('Position added'); setShow(false); reload(); } catch (e) { toast(e.message, true); } };
  return html`<section class="card stack">
    <div class="spread"><h2 class="h2">Why these are grouped</h2><button class="btn sm" onClick=${() => setShow(true)}><${Icon} name="plus" size=${14}/>Add position</button></div>
    <div class="grid2">${[
      'Same account, instrument and direction',
      `Each opened within ${g.windowMin} min of the idea's first position`,
      g.requireOverlap ? 'Each overlapped a position that was still open' : 'Overlap not required (setting)',
      'Copies linked to their Master position by the copier (TC:) or by symbol, side and time',
    ].map((t) => html`<div class="well hstack" style="align-items:flex-start;flex-wrap:nowrap;font-size:13px"><span class="pos"><${Icon} name="check" size=${16}/></span><span>${t}</span></div>`)}</div>
    <div class="sub">Moved by hand: ${d.positions.some((p) => p.group_mode === 'manual') ? 'yes, kept as you set it' : 'no'}. Change the window on the <a href="#/settings">Settings</a> page (applies to new trades).</div>
    ${show && html`<${Modal} title="Add a position to this idea" onClose=${() => setShow(false)}>
      <div class="sub">Positions on ${i.lead_name} within 12 hours of this idea. Only ${i.symbol} ${i.direction} positions can be added; copies follow their Master automatically.</div>
      ${g.nearby.length ? html`<div class="scroll"><table class="tbl"><thead><tr><th>Position</th><th>Opened</th><th>Symbol</th><th class="r">Lots</th><th></th></tr></thead><tbody>
        ${g.nearby.map((n) => html`<tr><td class="num">#${n.position_id}</td><td class="num">${fmt.dt(n.open_time)}</td><td>${n.symbol} <${Dir} d=${n.direction}/></td><td class="num r">${fmt.num(n.volume)}</td>
          <td>${n.sameKind ? html`<button class="btn sm pri" onClick=${() => add(n)}>Add</button>` : html`<span class="sub">different trade</span>`}</td></tr>`)}
      </tbody></table></div>` : html`<div class="empty">No other positions nearby.</div>`}
      ${!same.length && g.nearby.length > 0 && html`<div class="sub">None of these match this idea's instrument and direction.</div>`}
    <//>`}
  </section>`;
}

function Audit({ items }) {
  return html`<section class="card"><h2 class="h2" style="margin-bottom:6px">Audit trail</h2>
    <ul style="list-style:none;margin:0;padding:0">${items.map((a) => html`<li style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--line2);font-size:13px">
      <span class="num mut" style="flex:0 0 120px">${fmt.date(a.time)} ${fmt.timeS(a.time)}</span>
      <span><b style="font-weight:500">${a.action}</b>${a.detail && html`<span class="mut"> · ${a.detail}</span>`}<span class="sub"> · ${a.actor}</span></span></li>`)}</ul></section>`;
}

const EMOTIONS = ['Calm', 'Confident', 'Impatient', 'Anxious', 'FOMO', 'Frustrated', 'Tired'];

function Review({ d, reload }) {
  const s = useStore();
  const i = d.idea;
  const [notes, setNotes] = useState(i.notes || '');
  const [dirty, setDirty] = useState(false);
  const [checks, setChecks] = useState(Object.fromEntries(d.checklist.map((c) => [c.id, c.checked])));
  const [mist, setMist] = useState(new Set(d.mistakes));
  const [rating, setRating] = useState(i.rating);
  const save = async (body, msg) => { try { await api('/ideas/' + i.id, { method: 'PUT', body }); if (msg) toast(msg); return true; } catch (e) { toast(e.message, true); return false; } };
  const toggleCheck = async (c) => {
    const v = !checks[c.id];
    setChecks({ ...checks, [c.id]: v });
    try { await api(`/ideas/${i.id}/checks`, { method: 'PUT', body: { item_id: c.id, checked: v } }); } catch (e) { toast(e.message, true); }
  };
  const toggleMistake = async (id) => {
    const n = new Set(mist); n.has(id) ? n.delete(id) : n.add(id); setMist(n);
    try { await api(`/ideas/${i.id}/mistakes`, { method: 'PUT', body: { ids: [...n] } }); } catch (e) { toast(e.message, true); }
  };
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(async () => { if (await save({ notes })) setDirty(false); }, 1200);
    return () => clearTimeout(t);
  }, [notes, dirty]);
  const done = d.checklist.filter((c) => checks[c.id]).length;
  return html`<section class="card stack" style="gap:14px">
    <div class="spread"><h2 class="h2">Review</h2>
      <button class=${cls('btn sm', !i.reviewed_at && 'pri')} onClick=${async () => { if (await save({ reviewed: !i.reviewed_at }, i.reviewed_at ? 'Marked as not reviewed' : 'Marked as reviewed')) reload(); }}>
        ${i.reviewed_at ? 'Reviewed ✓ (undo)' : 'Mark reviewed'}</button></div>
    <div class="field"><label class="lbl" for="rstrat">Strategy</label>
      <select id="rstrat" class="inp" style="width:100%" value=${i.strategy_id || ''} onChange=${async (e) => { if (await save({ strategy_id: e.target.value || null })) reload(); }}>
        <option value="">— choose —</option>${s.boot.strategies.filter((x) => !x.archived || x.id === i.strategy_id).map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select></div>
    ${i.strategy_id ? html`<div class="stack" style="gap:0">
      <div class="spread"><span class="lbl">Per-trade checklist</span><span class=${cls('chip num', done === d.checklist.length ? 'g' : 'a')}>${done} / ${d.checklist.length}</span></div>
      ${d.checklist.map((c) => html`<label class="ck"><input type="checkbox" checked=${!!checks[c.id]} onChange=${() => toggleCheck(c)}/><span>${c.label}</span></label>`)}
      ${!d.checklist.length && html`<div class="sub">This strategy has no per-trade checklist yet.</div>`}</div>` : html`<div class="sub">Choose a strategy to fill in its checklist.</div>`}
    <div class="field"><span class="lbl">Execution rating</span>
      <div class="stars" role="group" aria-label="Execution rating">${[1, 2, 3, 4, 5].map((v) => html`<button type="button" class=${v <= (rating || 0) ? 'on' : ''} aria-label=${'Rate ' + v + ' of 5'} aria-pressed=${v === rating}
        onClick=${async () => { const nv = v === rating ? null : v; setRating(nv); await save({ rating: nv }); }}><${Icon} name="star" size=${22} fill=${v <= (rating || 0)}/></button>`)}</div></div>
    <div class="field"><label class="lbl" for="emo">How you felt</label>
      <select id="emo" class="inp" value=${i.emotion || ''} onChange=${(e) => save({ emotion: e.target.value || null })}><option value="">—</option>${EMOTIONS.map((x) => html`<option>${x}</option>`)}</select></div>
    <div class="field"><span class="lbl">Mistakes</span><div class="hstack" style="gap:6px">
      ${s.boot.mistakes.filter((m) => m.active || mist.has(m.id)).map((m) => html`<button type="button" class=${cls('chip', mist.has(m.id) ? 'r' : 'off')} aria-pressed=${mist.has(m.id)} onClick=${() => toggleMistake(m.id)}>${m.label}</button>`)}</div></div>
    <div class="field"><label class="lbl" for="notes">Notes ${dirty ? html`<span class="sub">· saving…</span>` : ''}</label>
      <textarea id="notes" class="inp" value=${notes} onInput=${(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="What did you see? What would you do differently?"></textarea></div>
  </section>`;
}

function Chart({ d, reload }) {
  const i = d.idea;
  const [link, setLink] = useState(i.tv_link || '');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState(null);
  const fileRef = useRef();
  const upload = async (files) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setBusy(true);
    for (const f of list) {
      const fd = new FormData(); fd.append('file', f, f.name || 'screenshot.png');
      try { await api(`/ideas/${i.id}/screenshots`, { method: 'POST', body: fd }); } catch (e) { toast(e.message, true); }
    }
    setBusy(false); toast('Screenshot added'); reload();
  };
  useEffect(() => {
    const onPaste = (e) => { if (e.clipboardData && e.clipboardData.files.length && !(e.target instanceof HTMLTextAreaElement)) upload(e.clipboardData.files); };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [i.id]);
  const saveLink = async () => {
    if ((i.tv_link || '') === link.trim()) return;
    try { await api('/ideas/' + i.id, { method: 'PUT', body: { tv_link: link.trim() } }); toast('Chart link saved'); reload(); } catch (e) { toast(e.message, true); }
  };
  const sample = store.mode === 'sample';
  return html`<section class="card stack">
    <h2 class="h2">Chart</h2>
    <div class="field"><label class="lbl" for="tv">TradingView chart link</label>
      <div class="hstack" style="flex-wrap:nowrap"><input id="tv" class="inp" value=${link} placeholder="https://www.tradingview.com/x/…" onInput=${(e) => setLink(e.target.value)} onBlur=${saveLink} onKeyDown=${(e) => e.key === 'Enter' && saveLink()}/>
        ${i.tv_link && html`<a class="btn" href=${i.tv_link} target="_blank" rel="noopener noreferrer" aria-label="Open chart"><${Icon} name="ext" size=${16}/></a>`}</div>
      <div class="sub">In TradingView: camera icon → “Copy link to the chart image”, then paste here.</div></div>
    ${d.screenshots.length > 0 && html`<div class="shots">${d.screenshots.map((sh) => html`<div class="shot">
      <img src=${'/api/screenshots/' + sh.id} alt=${sh.filename || 'Screenshot'} loading="lazy" onClick=${() => setBig(sh.id)}/>
      <button class="btn sm" aria-label="Delete screenshot" onClick=${async () => { if (!confirm('Delete this screenshot?')) return; try { await api('/screenshots/' + sh.id, { method: 'DELETE' }); reload(); } catch (e) { toast(e.message, true); } }}><${Icon} name="trash" size=${14}/></button></div>`)}</div>`}
    ${sample ? html`<div class="sub">Screenshots are turned off for sample data.</div>` : html`
    <div class=${cls('drop', over && 'over')} onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
      onDrop=${(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}>
      ${busy ? 'Uploading…' : html`Drop chart screenshots here, paste one (Ctrl+V), or <button class="btn sm" onClick=${() => fileRef.current.click()}>choose files</button>`}
      <input ref=${fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange=${(e) => upload(e.target.files)}/></div>`}
    ${big && html`<div class="lightbox" onClick=${() => setBig(null)}><img src=${'/api/screenshots/' + big} alt="Screenshot"/></div>`}
  </section>`;
}
