import { html, useState, useStore, useData, api, fmt, cls, Loading, PageHead, Icon, Modal, toast, reloadBoot, todayBne } from '../lib.js';
import { SampleEmpty } from './dashboard.js';

export function Strategies() {
  const s = useStore();
  const list = s.boot.strategies;
  const [sel, setSel] = useState(list.find((x) => !x.archived)?.id);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const cur = list.find((x) => x.id === sel) || list.find((x) => !x.archived);
  const visible = list.filter((x) => showArchived || !x.archived);
  return html`<${PageHead} title="Strategies" sub="Rules, daily preparation and per-trade checklists" filter=${false}>
      <button class="btn pri" onClick=${() => setCreating(true)}><${Icon} name="plus" size=${16}/>New strategy</button><//>
    <${SampleEmpty}/>
    <div class="row">
      <section style="flex:1 1 260px;display:flex;flex-direction:column;gap:10px">
        ${visible.map((x) => html`<button type="button" class=${cls('list-btn', cur && x.id === cur.id && 'on')} aria-pressed=${cur && x.id === cur.id} onClick=${() => setSel(x.id)}>
          <span style="font-weight:600;font-size:14px">${x.name}${x.archived ? ' (archived)' : ''}</span>
          <span class="sub">${[x.instruments, x.sessions].filter(Boolean).join(' · ') || 'No instruments set'}</span>
          <span class="sub">${x.daily.length} daily · ${x.trade.length} per-trade items</span></button>`)}
        ${!list.length && html`<div class="card sub">No strategies yet. Create one to set up checklists.</div>`}
        ${list.some((x) => x.archived) && html`<label class="ck" style="border:0"><input type="checkbox" checked=${showArchived} onChange=${() => setShowArchived(!showArchived)}/><span class="sub">Show archived</span></label>`}
      </section>
      <div class="col" style="flex:3 1 620px">${cur ? html`<${Editor} key=${cur.id} st=${cur} list=${list}/>` : null}</div>
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
  return html`<${Modal} title="New strategy" onClose=${onClose}><form class="stack" onSubmit=${go}>
    <div class="field"><label class="lbl" for="ns">Name</label><input id="ns" class="inp" value=${name} onInput=${(e) => setName(e.target.value)} required autofocus/></div>
    <div class="field"><label class="lbl" for="nc">Copy checklists from</label><select id="nc" class="inp" value=${copy} onChange=${(e) => setCopy(e.target.value)}><option value="">Start empty</option>${list.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select></div>
    <div class="hstack"><button class="btn pri" type="submit">Create</button><button class="btn" type="button" onClick=${onClose}>Cancel</button></div></form><//>`;
}

function Editor({ st, list }) {
  const [f, setF] = useState({ name: st.name, description: st.description || '', instruments: st.instruments || '', sessions: st.sessions || '', default_risk_pct: st.default_risk_pct ?? '', max_ideas_per_day: st.max_ideas_per_day ?? '' });
  const [dirty, setDirty] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setDirty(true); };
  const save = async () => { try { await api('/strategies/' + st.id, { method: 'PUT', body: f }); setDirty(false); toast('Saved'); reloadBoot(); } catch (e) { toast(e.message, true); } };
  const archive = async () => {
    if (!confirm(st.archived ? 'Restore this strategy?' : 'Archive this strategy? Past reviews keep it.')) return;
    try { await api('/strategies/' + st.id, { method: 'PUT', body: { ...f, archived: !st.archived } }); reloadBoot(); } catch (e) { toast(e.message, true); }
  };
  return html`
  <section class="card stack" style="gap:16px">
    <div class="spread"><h2 class="h2" style="font-size:18px">${st.name}</h2>
      <div class="hstack"><button class="btn" onClick=${archive}>${st.archived ? 'Restore' : 'Archive'}</button><button class="btn pri" disabled=${!dirty} onClick=${save}>Save</button></div></div>
    <div class="fields">
      <div class="field"><label class="lbl" for="sn">Name</label><input id="sn" class="inp" value=${f.name} onInput=${set('name')}/></div>
      <div class="field"><label class="lbl" for="si">Instruments</label><input id="si" class="inp" value=${f.instruments} onInput=${set('instruments')} placeholder="JP225, NAS100"/></div>
      <div class="field"><label class="lbl" for="ss">Session (AEST)</label><input id="ss" class="inp" value=${f.sessions} onInput=${set('sessions')} placeholder="09:30 – 12:00"/></div>
      <div class="field"><label class="lbl" for="sr">Default risk % per idea</label><input id="sr" class="inp" type="number" step="0.05" min="0" value=${f.default_risk_pct} onInput=${set('default_risk_pct')}/></div>
      <div class="field"><label class="lbl" for="sm">Max ideas per day</label><input id="sm" class="inp" type="number" min="0" value=${f.max_ideas_per_day} onInput=${set('max_ideas_per_day')}/></div>
    </div>
    <div class="field"><label class="lbl" for="sd">Description and rules</label><textarea id="sd" class="inp" value=${f.description} onInput=${set('description')}></textarea></div>
  </section>
  <div class="row">
    <${Daily} st=${st}/>
    <${TradeList} st=${st}/>
  </div>`;
}

function ItemEditor({ st, kind, items }) {
  const [label, setLabel] = useState('');
  const add = async (e) => {
    e.preventDefault();
    if (!label.trim()) return;
    try { await api(`/strategies/${st.id}/items`, { method: 'POST', body: { kind, label } }); setLabel(''); await reloadBoot(); } catch (err) { toast(err.message, true); }
  };
  const remove = async (it) => {
    if (!confirm(`Remove “${it.label}”? Past days and reviews keep it.`)) return;
    try { await api('/items/' + it.id, { method: 'DELETE' }); await reloadBoot(); } catch (err) { toast(err.message, true); }
  };
  const rename = async (it) => {
    const v = prompt('Rename item', it.label);
    if (!v || v === it.label) return;
    try { await api('/items/' + it.id, { method: 'PUT', body: { label: v } }); await reloadBoot(); } catch (err) { toast(err.message, true); }
  };
  return html`<details><summary class="sub" style="cursor:pointer;padding:8px 0">Edit items (${items.length})</summary>
    ${items.map((it) => html`<div class="spread" style="padding:6px 0;border-bottom:1px solid var(--line2);flex-wrap:nowrap"><span style="font-size:13px">${it.label}</span>
      <span class="hstack" style="flex-wrap:nowrap"><button class="btn sm ghost" aria-label=${'Rename ' + it.label} onClick=${() => rename(it)}><${Icon} name="edit" size=${14}/></button>
      <button class="btn sm ghost" aria-label=${'Remove ' + it.label} onClick=${() => remove(it)}><${Icon} name="trash" size=${14}/></button></span></div>`)}
    <form class="hstack" style="flex-wrap:nowrap;margin-top:8px" onSubmit=${add}><label class="sr" for=${'new' + kind}>New item</label>
      <input id=${'new' + kind} class="inp" value=${label} onInput=${(e) => setLabel(e.target.value)} placeholder="Add an item"/><button class="btn" type="submit">Add</button></form></details>`;
}

function Daily({ st }) {
  const s = useStore();
  const [day, setDay] = useState(todayBne());
  const today = todayBne();
  const d = useData(() => api('/checklists/daily?day=' + day), [day, st.daily.length, st.daily.map((x) => x.label).join('|')]);
  const h = useData(() => api('/checklists/history?days=30'), [st.id]);
  const [local, setLocal] = useState({});
  const toggle = async (it) => {
    setLocal({ ...local, [it.id]: !it.checked });
    try { await api('/checklists/daily', { method: 'PUT', body: { item_id: it.id, checked: !it.checked, day } }); h.reload(); }
    catch (e) { toast(e.message, true); setLocal({ ...local, [it.id]: it.checked }); d.reload(); }
  };
  return html`<section class="card stack" style="flex:1 1 320px;gap:10px">
    <div class="spread" style="align-items:flex-start"><div><h2 class="h2">Daily preparation</h2>
      <div class="sub" style="margin-top:4px">${day === today ? 'Today · resets 12:00 AM Brisbane' : 'Read-only: ' + fmt.dateY(Date.parse(day + 'T12:00:00+10:00'))}</div></div>
      ${day !== today && html`<button class="btn sm" onClick=${() => setDay(today)}>Back to today</button>`}</div>
    <${Loading} state=${d}>${(data) => {
      const cur = data.strategies.find((x) => x.id === st.id);
      if (!cur || !cur.items.length) return html`<div class="sub">${day === today ? 'No daily items yet.' : 'Nothing was recorded that day.'}</div>`;
      const items = cur.items.map((i) => ({ ...i, checked: data.editable ? (local[i.id] ?? i.checked) : i.checked }));
      return html`<div>${items.map((it) => html`<label class=${cls('ck', it.checked && 'done', !data.editable && 'ro')}>
        <input type="checkbox" checked=${it.checked} disabled=${!data.editable} onChange=${() => data.editable && toggle(it)}/><span>${it.label}</span></label>`)}</div>`;
    }}<//>
    ${day === today && html`<${ItemEditor} st=${st} kind="daily" items=${st.daily}/>`}
    <div class="stack" style="gap:8px;padding-top:6px"><span class="lbl">Last 30 days (click a day to see it)</span>
      <${Loading} state=${h}>${(hd) => {
        const rows = hd.rows.filter((r) => r.strategy_id === st.id);
        const full = rows.filter((r) => r.done >= r.total && r.total > 0).length;
        return html`<div class="hist">${hd.days.map((dd) => {
          const r = rows.find((x) => x.day === dd);
          const c = !r ? '' : r.done >= r.total ? 'full' : r.done > 0 ? 'part' : '';
          return html`<span class=${c} role="button" tabindex="0" style="cursor:pointer;${dd === day ? 'outline:2px solid #C9D8FF' : ''}" title=${`${dd}: ${r ? r.done + '/' + r.total : 'nothing recorded'}`}
            onClick=${() => setDay(dd)} onKeyDown=${(e) => e.key === 'Enter' && setDay(dd)}></span>`;
        })}</div><span class="sub">${full} complete day${full === 1 ? '' : 's'} in the last 30 · green = all done, amber = partly</span>`;
      }}<//></div>
  </section>`;
}

function TradeList({ st }) {
  return html`<section class="card stack" style="flex:1 1 320px;gap:10px">
    <div class="spread"><div><h2 class="h2">Per-trade checklist</h2><div class="sub" style="margin-top:4px">Ticked on each trade idea's review</div></div><span class="chip num">${st.trade.length} items</span></div>
    <div>${st.trade.map((t, k) => html`<div class="ck ro"><span class="num mut" style="width:18px">${k + 1}</span><span>${t.label}</span></div>`)}</div>
    <${ItemEditor} st=${st} kind="trade" items=${st.trade}/>
    <div class="sub">Analytics compares ideas with a complete checklist against incomplete ones.</div>
  </section>`;
}
