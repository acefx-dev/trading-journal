import { html, useState, useStore, useData, api, fmt, cls, sgn, Loading, PageHead, Icon, Modal, Bar, toast, reloadBoot, todayBne } from '../lib.js';
import { SampleEmpty } from './dashboard.js';

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export function Strategies() {
  const s = useStore();
  const list = s.boot.strategies;
  const [sel, setSel] = useState(list.find((x) => !x.archived)?.id);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const cur = list.find((x) => x.id === sel) || list.find((x) => !x.archived);
  const visible = list.filter((x) => showArchived || !x.archived || (cur && x.id === cur.id));
  // per-strategy results over the last 3 months (all accounts, R on the lead account)
  const stats = useData(() => api('/analytics/ideas?acct=all&firm=all'), [s.mode]);
  const from = Date.parse(addDays(todayBne(), -90) + 'T00:00:00+10:00');
  const perf = {};
  if (stats.data) for (const i of stats.data.ideas) if (i.close_time >= from) (perf[i.strategy_id] ||= []).push(i);
  const sum = (xs = []) => {
    const rx = xs.filter((x) => x.r != null), tot = rx.reduce((a, x) => a + x.r, 0), w = xs.filter((x) => x.basisNet > 0).length, l = xs.filter((x) => x.basisNet < 0).length;
    const ck = xs.filter((x) => x.ckTotal > 0);
    return { n: xs.length, win: w + l ? Math.round(w * 100 / (w + l)) + '%' : '—', avg: rx.length ? tot / rx.length : null, tot, comp: ck.length ? Math.round(ck.filter((x) => x.ckDone >= x.ckTotal).length * 100 / ck.length) + '%' : '—' };
  };
  const all = Object.fromEntries(list.map((x) => [x.id, sum(perf[x.id])]));
  const mx = Math.max(0.01, ...Object.values(all).map((p) => Math.abs(p.tot)));
  return html`<${PageHead} title="Strategies" sub="Playbooks, per-trade checklists and the shared daily preparation" filter=${false}>
      <button class="btn sm pri" onClick=${() => setCreating(true)}><${Icon} name="plus" size=${15}/>New strategy</button><//>
    <${SampleEmpty}/>
    <div class="strat3 fill">
      <section class="panel" style="min-height:300px">
        <div class="ph"><h2>Strategies</h2><span class="sub">${list.filter((x) => !x.archived).length} active</span></div>
        <div class="scrolly stack" style="padding:0 10px 10px;gap:8px">
          ${visible.map((x) => { const p = all[x.id]; const on = cur && x.id === cur.id;
            return html`<button type="button" aria-pressed=${on} onClick=${() => setSel(x.id)} style=${`text-align:left;color:var(--text);cursor:pointer;display:flex;flex-direction:column;gap:7px;padding:12px 14px;border-radius:12px;background:${on ? '#141C2E' : '#0C1016'};border:1px solid ${on ? '#34519A' : '#1B212C'}`}>
              <span class="spread" style="flex-wrap:nowrap"><b style="font-size:13.5px">${x.name}${x.archived ? ' (archived)' : ''}</b><span class=${cls('num', sgn(p.tot))} style="font-size:12px;font-weight:600">${p.n ? fmt.r(p.tot) : ''}</span></span>
              <span class="sub">${[x.instruments, x.sessions].filter(Boolean).join(' · ') || 'No instruments set'}</span>
              <span class="sub hstack" style="gap:12px"><span><b class="num" style="color:var(--text2)">${p.n}</b> ideas</span><span><b class="num" style="color:var(--text2)">${p.win}</b> win</span><span><b class="num" style="color:var(--text2)">${fmt.r(p.avg)}</b> avg</span></span>
              <${Bar} pct=${Math.abs(p.tot) / mx * 100} color=${p.tot >= 0 ? 'var(--pos)' : 'var(--neg)'}/></button>`; })}
          ${!list.length && html`<div class="sub" style="padding:8px">No strategies yet. Create one to set up its checklist.</div>`}
          <button type="button" class="btn" style="justify-content:flex-start" onClick=${() => setCreating(true)}><${Icon} name="plus" size=${15}/>New strategy</button>
        </div>
        ${list.some((x) => x.archived) && html`<label class="ck" style="border:0;border-top:1px solid #1B212C;padding:0 14px;min-height:40px"><input type="checkbox" checked=${showArchived} onChange=${() => setShowArchived(!showArchived)}/><span class="sub">Show archived (${list.filter((x) => x.archived).length})</span></label>`}
      </section>
      <section class="panel" style="min-height:300px">${cur ? html`<${Editor} key=${cur.id} st=${cur} p=${all[cur.id]}/>` : html`<div class="empty">Create a strategy to start.</div>`}</section>
      <div class="colstack">
        <${Prep}/>
        <${SentimentSetup}/>
        <${Grouping}/>
      </div>
    </div>
    ${creating && html`<${NewStrategy} list=${list} onClose=${() => setCreating(false)} onDone=${(id) => { setCreating(false); setSel(id); }}/>`}`;
}

function NewStrategy({ list, onClose, onDone }) {
  const [name, setName] = useState('');
  const [copy, setCopy] = useState('');
  const go = async (e) => {
    e.preventDefault();
    try { const r = await api('/strategies', { method: 'POST', body: { name, copy_from: copy || null } }); await reloadBoot(); onDone(r.id); } catch (err) { toast(err.message, true); }
  };
  return html`<${Modal} title="New strategy" onClose=${onClose} dirty=${!!name.trim()}><form class="stack" onSubmit=${go}>
    <div class="field"><label class="lbl" for="ns">Name</label><input id="ns" class="inp" value=${name} onInput=${(e) => setName(e.target.value)} required autofocus/></div>
    <div class="field"><label class="lbl" for="nc">Copy the per-trade checklist from</label><select id="nc" class="inp" value=${copy} onChange=${(e) => setCopy(e.target.value)}><option value="">Start empty</option>${list.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select></div>
    <div class="hstack"><button class="btn pri" type="submit">Create</button><button class="btn" type="button" onClick=${onClose}>Cancel</button></div></form><//>`;
}

const PLAY = [['setup', 'Setup', 'What must be true before you look for an entry'], ['entry_rules', 'Entry', 'The exact trigger'], ['stop_rules', 'Stop loss', 'Where it goes and when it may move'], ['exit_rules', 'Exit and management', 'Targets, partials, trailing, time stop']];

function Editor({ st, p }) {
  const init = { name: st.name, description: st.description || '', instruments: st.instruments || '', sessions: st.sessions || '', default_risk_pct: st.default_risk_pct ?? '', max_ideas_per_day: st.max_ideas_per_day ?? '',
    setup: st.setup || '', entry_rules: st.entry_rules || '', stop_rules: st.stop_rules || '', exit_rules: st.exit_rules || '' };
  const [f, setF] = useState(init);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { try { await api('/strategies/' + st.id, { method: 'PUT', body: f }); toast('Saved'); reloadBoot(); } catch (e) { toast(e.message, true); } };
  const archive = async () => {
    if (!confirm(st.archived ? 'Restore this strategy?' : 'Archive this strategy? Past reviews keep it.')) return;
    try { await api('/strategies/' + st.id, { method: 'PUT', body: { archived: !st.archived } }); reloadBoot(); } catch (e) { toast(e.message, true); }
  };
  const k = (label, value, t) => html`<div class="kcell"><div class="cap">${label}</div><div class=${cls('num', t)} style="font-size:17px;font-weight:600;margin-top:5px">${value}</div></div>`;
  return html`
    <div style="padding:14px 16px 12px;border-bottom:1px solid #1B212C" class="spread">
      <div style="min-width:0;flex:1"><div class="hstack" style="gap:10px"><h2 style="margin:0;font-size:20px;font-weight:600;letter-spacing:-.02em">${st.name}</h2><span class=${cls('chip', !st.archived && 'g')}>${st.archived ? 'Archived' : 'Active'}</span></div>
        ${st.description && html`<div class="sub" style="margin-top:5px;font-size:12.5px">${st.description}</div>`}</div>
      <div class="hstack" style="gap:6px"><button class="btn sm" onClick=${archive}>${st.archived ? 'Restore' : 'Archive'}</button><button class="btn sm pri" disabled=${!dirty} onClick=${save}>Save</button></div>
    </div>
    <div class="mstrip">
      ${k('Ideas · 3 months', p.n)}${k('Win rate', p.win)}${k('Expectancy', fmt.r(p.avg), sgn(p.avg))}${k('Total', fmt.r(p.tot), sgn(p.tot))}${k('Checklist complete', p.comp)}
    </div>
    <div class="scrolly stack" style="padding:14px 16px 16px;gap:16px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
        <div class="field"><label class="lbl" for="sn">Name</label><input id="sn" class="inp sm" value=${f.name} onInput=${set('name')}/></div>
        <div class="field"><label class="lbl" for="si">Instruments</label><input id="si" class="inp sm" value=${f.instruments} onInput=${set('instruments')} placeholder="JP225, NAS100"/></div>
        <div class="field"><label class="lbl" for="ss">Window (Brisbane)</label><input id="ss" class="inp sm" value=${f.sessions} onInput=${set('sessions')} placeholder="09:00 – 12:00"/></div>
        <div class="field"><label class="lbl" for="sr">Default risk % per idea</label><input id="sr" class="inp sm" type="number" step="0.05" min="0" value=${f.default_risk_pct} onInput=${set('default_risk_pct')}/></div>
        <div class="field"><label class="lbl" for="sm">Max ideas per day</label><input id="sm" class="inp sm" type="number" min="0" value=${f.max_ideas_per_day} onInput=${set('max_ideas_per_day')}/></div>
      </div>
      <div class="field"><label class="lbl" for="sd">Summary</label><input id="sd" class="inp sm" value=${f.description} onInput=${set('description')} placeholder="One line on what this strategy trades"/></div>
      <div class="field"><span class="cap">Playbook</span>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">${PLAY.map(([key, label, ph]) => html`<div class="field"><label class="lbl" for=${'pb' + key}>${label}</label>
          <textarea id=${'pb' + key} class="inp" style="min-height:76px;font-size:12.5px" placeholder=${ph} value=${f[key]} onInput=${set(key)}></textarea></div>`)}</div></div>
      <${TradeList} st=${st}/>
      ${dirty && html`<div class="hstack" style="position:sticky;bottom:0;background:#10141B;padding:8px 0;border-top:1px solid #1B212C"><span class="sub">Unsaved changes</span><button class="btn sm pri" onClick=${save}>Save</button><button class="btn sm" onClick=${() => setF(init)}>Undo</button></div>`}
    </div>`;
}

function TradeList({ st }) {
  const [label, setLabel] = useState('');
  const add = async (e) => {
    e.preventDefault();
    if (!label.trim()) return;
    try { await api(`/strategies/${st.id}/items`, { method: 'POST', body: { label } }); setLabel(''); await reloadBoot(); } catch (err) { toast(err.message, true); }
  };
  const remove = async (it) => {
    if (!confirm(`Remove “${it.label}”? Past reviews keep it.`)) return;
    try { await api('/items/' + it.id, { method: 'DELETE' }); await reloadBoot(); } catch (err) { toast(err.message, true); }
  };
  const rename = async (it) => {
    const v = prompt('Rename item', it.label);
    if (!v || v === it.label) return;
    try { await api('/items/' + it.id, { method: 'PUT', body: { label: v } }); await reloadBoot(); } catch (err) { toast(err.message, true); }
  };
  const move = async (k, dir) => {
    const a = st.trade[k], b = st.trade[k + dir];
    if (!a || !b) return;
    try { await Promise.all([api('/items/' + a.id, { method: 'PUT', body: { sort: k + dir } }), api('/items/' + b.id, { method: 'PUT', body: { sort: k } })]); await reloadBoot(); } catch (err) { toast(err.message, true); }
  };
  return html`<div class="field"><div class="spread"><span class="cap">Per-trade checklist · ${st.name}</span><span class="sub">Ticked on each idea's review</span></div>
    <div class="box" style="padding:2px 6px">
      ${st.trade.map((t, k) => html`<${ItemRow} label=${t.label} n=${k + 1} onUp=${k ? () => move(k, -1) : null} onDown=${k < st.trade.length - 1 ? () => move(k, 1) : null} onRename=${() => rename(t)} onRemove=${() => remove(t)}/>`)}
      ${!st.trade.length && html`<div class="sub" style="padding:10px 6px">No items yet. These are the rules Analytics checks when you filter by rule compliance.</div>`}
      <form class="hstack" style="flex-wrap:nowrap;padding:8px 0 6px;gap:8px" onSubmit=${add}><label class="sr" for="newt">New checklist item</label>
        <input id="newt" class="inp sm" value=${label} onInput=${(e) => setLabel(e.target.value)} placeholder="Add an item for this strategy"/><button class="btn sm" type="submit">Add</button></form>
    </div></div>`;
}

function ItemRow({ label, n, onUp, onDown, onRename, onRemove, children }) {
  return html`<div class="hstack" style="flex-wrap:nowrap;gap:6px;min-height:38px;border-bottom:1px solid #151A22;font-size:13px">
    ${n != null && html`<span class="num mut" style="width:18px;text-align:right">${n}</span>`}
    ${children || html`<span style="flex:1;min-width:0">${label}</span>`}
    <span class="hstack" style="flex-wrap:nowrap;gap:0">
      <button type="button" class="btn sm ghost" style="min-height:30px;padding:0 6px" aria-label=${'Move up: ' + label} disabled=${!onUp} onClick=${onUp}>↑</button>
      <button type="button" class="btn sm ghost" style="min-height:30px;padding:0 6px" aria-label=${'Move down: ' + label} disabled=${!onDown} onClick=${onDown}>↓</button>
      <button type="button" class="btn sm ghost" style="min-height:30px;padding:0 6px" aria-label=${'Rename ' + label} onClick=${onRename}><${Icon} name="edit" size=${14}/></button>
      <button type="button" class="btn sm ghost" style="min-height:30px;padding:0 6px" aria-label=${'Remove ' + label} onClick=${onRemove}><${Icon} name="trash" size=${14}/></button></span></div>`;
}

// ------------------------------------------------------------------ shared daily preparation

function Prep() {
  const s = useStore();
  const today = todayBne();
  const [day, setDay] = useState(today);
  const [label, setLabel] = useState('');
  const [local, setLocal] = useState({});
  const items = s.boot.prep;
  const d = useData(() => api('/prep?day=' + day), [day, items.map((x) => x.id + x.label).join('|')]);
  const h = useData(() => api('/prep/history?days=30'), [items.length]);
  const toggle = async (it) => {
    setLocal({ ...local, [it.id]: !it.checked });
    try { await api('/prep', { method: 'PUT', body: { item_id: it.id, checked: !it.checked, day } }); h.reload(); }
    catch (e) { toast(e.message, true); setLocal({ ...local, [it.id]: it.checked }); d.reload(); }
  };
  const add = async (e) => {
    e.preventDefault();
    if (!label.trim()) return;
    try { await api('/prep/items', { method: 'POST', body: { label } }); setLabel(''); await reloadBoot(); } catch (err) { toast(err.message, true); }
  };
  const remove = async (it) => {
    if (!confirm(`Remove “${it.label}”? Past days keep it.`)) return;
    try { await api('/prep/items/' + it.id, { method: 'DELETE' }); await reloadBoot(); } catch (err) { toast(err.message, true); }
  };
  const rename = async (it) => {
    const v = prompt('Rename item', it.label);
    if (!v || v === it.label) return;
    try { await api('/prep/items/' + it.id, { method: 'PUT', body: { label: v } }); await reloadBoot(); } catch (err) { toast(err.message, true); }
  };
  const move = async (k, dir) => {
    const a = items[k], b = items[k + dir];
    if (!a || !b) return;
    try { await Promise.all([api('/prep/items/' + a.id, { method: 'PUT', body: { sort: k + dir } }), api('/prep/items/' + b.id, { method: 'PUT', body: { sort: k } })]); await reloadBoot(); } catch (err) { toast(err.message, true); }
  };
  const editable = day === today;
  return html`<section class="panel" style="flex:1;min-height:320px">
    <div class="ph"><div><h2>Daily preparation</h2><div class="sub" style="margin-top:2px">${editable ? 'One list for every trading day · all strategies' : 'Read-only: ' + fmt.dateY(Date.parse(day + 'T12:00:00+10:00'))}</div></div>
      ${editable ? html`<${Loading} state=${d}>${(x) => { const n = x.items.filter((i) => local[i.id] ?? i.checked).length; return html`<span class=${cls('chip num', n === x.total && x.total ? 'g' : 'b')}>${n} / ${x.total}</span>`; }}<//>`
        : html`<button class="btn sm" onClick=${() => setDay(today)}>Back to today</button>`}</div>
    <div class="scrolly" style="padding:0 14px">
      <${Loading} state=${d}>${(x) => {
        if (!editable) return x.items.length ? x.items.map((it) => html`<label class=${cls('ck ro', it.checked && 'done')} style="min-height:36px;font-size:13px"><input type="checkbox" checked=${it.checked} disabled/><span>${it.label}</span></label>`)
          : html`<div class="sub" style="padding:8px 0">Nothing was recorded that day.</div>`;
        return x.items.map((it, k) => { const checked = local[it.id] ?? it.checked;
          return html`<${ItemRow} label=${it.label} onUp=${k ? () => move(k, -1) : null} onDown=${k < x.items.length - 1 ? () => move(k, 1) : null} onRename=${() => rename(it)} onRemove=${() => remove(it)}>
            <label class=${cls('ck', checked && 'done')} style="flex:1;min-width:0;border:0;min-height:36px;font-size:13px;gap:10px"><input type="checkbox" checked=${checked} onChange=${() => toggle({ ...it, checked })} style="width:16px;height:16px;flex:0 0 16px"/><span>${it.label}</span></label><//>`; });
      }}<//>
      ${editable && html`<form class="hstack" style="flex-wrap:nowrap;padding:10px 0;gap:8px" onSubmit=${add}><label class="sr" for="newp">New daily item</label>
        <input id="newp" class="inp sm" value=${label} onInput=${(e) => setLabel(e.target.value)} placeholder="Add a daily item"/><button class="btn sm" type="submit">Add</button></form>`}
    </div>
    <div class="stack" style="border-top:1px solid #1B212C;padding:10px 14px;gap:8px">
      <${Loading} state=${h}>${(hd) => {
        const past = hd.rows.filter((r) => r.day !== today);
        const full = past.filter((r) => r.total > 0 && r.done >= r.total).length;
        return html`<div class="spread"><span class="sub">Last 30 days · click a day to see it</span><span class="sub"><b class="num" style="color:var(--text2)">${full}</b> complete</span></div>
          <div class="hist">${hd.days.map((dd) => {
            const r = hd.rows.find((x) => x.day === dd);
            const c = !r ? '' : r.done >= r.total ? 'full' : r.done > 0 ? 'part' : '';
            return html`<button type="button" class=${c} style=${`width:14px;height:14px;border-radius:4px;border:0;padding:0;cursor:pointer;background:${c === 'full' ? 'var(--pos)' : c === 'part' ? '#8A6A24' : 'var(--line3)'};${dd === day ? 'outline:2px solid #C9D8FF' : ''}`}
              aria-label=${`${dd}: ${r ? r.done + ' of ' + r.total : 'nothing recorded'}`} title=${`${dd}: ${r ? r.done + '/' + r.total : 'nothing recorded'}`} onClick=${() => setDay(dd)}></button>`;
          })}</div>`;
      }}<//>
      <div class="sub">Resets 12:00 AM Brisbane. Shown on the dashboard. Past days keep the list as it was, so editing it never rewrites history.</div>
    </div>
  </section>`;
}

function SentimentSetup() {
  const s = useStore();
  const set = s.boot.settings;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ markets: set.sentiment_markets ?? '', basis: set.sentiment_basis ?? '', prompt: set.sentiment_prompt || '' });
  const save = async (e) => {
    e.preventDefault();
    try { await api('/settings', { method: 'PUT', body: { sentiment_markets: f.markets, sentiment_basis: f.basis, sentiment_prompt: f.prompt } }); await reloadBoot(); toast('Sentiment settings saved'); setOpen(false); }
    catch (err) { toast(err.message, true); }
  };
  return html`<section class="panel">
    <div class="ph"><div><h2>Market sentiment</h2><div class="sub" style="margin-top:2px">Step 1 of daily prep · ${(f.markets || '').split(',').filter(Boolean).join(', ') || 'overall only'}</div></div>
      <button type="button" class="btn sm" onClick=${() => setOpen(!open)} aria-expanded=${open}>${open ? 'Close' : 'Edit'}</button></div>
    ${open ? html`<form class="pb stack" style="gap:8px" onSubmit=${save}>
      <label class="stack" style="gap:4px"><span class="sub">Separate bias per market (optional; leave empty for one overall bias)</span><input class="inp sm" value=${f.markets} onInput=${(e) => setF({ ...f, markets: e.target.value })} placeholder="optional, e.g. JP225,NAS100"/></label>
      <label class="stack" style="gap:4px"><span class="sub">What you check (chips you can tick)</span><input class="inp sm" value=${f.basis} onInput=${(e) => setF({ ...f, basis: e.target.value })} placeholder="US futures,VIX,USDJPY,Headlines"/></label>
      <label class="stack" style="gap:4px"><span class="sub">Your sentiment prompt · the Copy prompt button copies this. {date} and {markets} are filled in for you.</span>
        <textarea class="inp" rows="6" maxlength="8000" value=${f.prompt} onInput=${(e) => setF({ ...f, prompt: e.target.value })} placeholder="Paste the prompt you use to check today's sentiment"></textarea></label>
      <div class="hstack"><button class="btn sm pri" type="submit">Save</button><span class="sub">${f.prompt.length} / 8000</span></div>
    </form>` : html`<div class="pb sub" style="padding-top:0">${set.sentiment_prompt ? 'Prompt saved · copy it from the dashboard.' : 'No prompt saved yet. Click Edit to paste yours.'} Trades are tagged as with, against or neutral to the bias you set for that market.</div>`}
  </section>`;
}

function Grouping() {
  const s = useStore();
  const set = s.boot.settings;
  return html`<section class="panel">
    <div class="ph"><div><h2>Trade grouping</h2><div class="sub" style="margin-top:2px">How MT5 positions become one idea</div></div><a href="#/settings" style="font-size:12px">Change</a></div>
    <div class="pb stack" style="gap:6px;font-size:12.5px;color:var(--text2)">
      <span>Same account, symbol and direction, opened within <b class="num">${set.group_window_min || 30} min</b> of the idea's first position${set.group_require_overlap === '1' ? ', while one is still open' : ''}.</span>
      <span class="sub">Copies link to their Master position by the copier's TC: comment, or by symbol, side and time.</span></div>
  </section>`;
}
