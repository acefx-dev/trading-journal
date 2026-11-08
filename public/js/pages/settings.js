import { html, useState, useStore, api, setStore, PageHead, Icon, toast, reloadBoot, KIND_GROUPS, scopeName } from '../lib.js';

export function Settings() {
  const s = useStore();
  const b = s.boot;
  return html`<${PageHead} title="Settings" sub=${'Signed in as ' + b.user} filter=${false}/>
    <div class="row">
      <div class="col" style="flex:1 1 420px"><${DefaultView} b=${b}/><${Grouping} b=${b}/><${Data} b=${b}/></div>
      <div class="col" style="flex:1 1 420px"><${Aliases} b=${b}/><${Mistakes} b=${b}/></div>
    </div>`;
}

function DefaultView({ b }) {
  const s = useStore();
  const [v, setV] = useState(b.settings.default_scope || 'all');
  const accts = b.accounts.filter((a) => a.status === 'active');
  const save = async (val) => {
    setV(val);
    try { await api('/settings', { method: 'PUT', body: { default_scope: val } }); await reloadBoot(); setStore({ acct: val, firm: 'all' }); toast('Default view saved'); }
    catch (e) { toast(e.message, true); }
  };
  return html`<section class="card stack"><h2 class="h2">Default view</h2>
    <div class="sub">The account or group the journal shows when you open it (dashboard and every page). You can still switch at the top of any page.</div>
    <div class="field"><label class="lbl" for="defv">Open the journal on</label>
      <select id="defv" class="inp" style="width:100%" value=${v} onChange=${(e) => save(e.target.value)}>
        <option value="all">All accounts (combined)</option>
        ${KIND_GROUPS.filter(([k]) => accts.some((a) => a.kind === k)).map(([k, l]) => html`<option value=${'kind:' + k}>${l}</option>`)}
        <option disabled>──────────</option>
        ${accts.map((a) => html`<option value=${String(a.id)}>${a.name}</option>`)}
      </select></div>
    ${s.mode === 'sample' && html`<div class="sub">This setting is shared by your data and the sample; account choices are listed for the data you're looking at now.</div>`}
    <div class="sub">Groups follow each account's <b>Type</b> (Accounts & sync → Edit). Now showing: ${scopeName(b, s.acct)}.</div>
  </section>`;
}

function Grouping({ b }) {
  const [v, setV] = useState({ group_window_min: b.settings.group_window_min, group_require_overlap: b.settings.group_require_overlap === '1', copy_match_window_sec: b.settings.copy_match_window_sec });
  const save = async (e) => { e.preventDefault(); try { await api('/settings', { method: 'PUT', body: v }); await reloadBoot(); toast('Saved. New trades use these rules.'); } catch (err) { toast(err.message, true); } };
  return html`<section class="card stack"><h2 class="h2">Trade grouping</h2>
    <div class="sub">How positions become one trading idea. Applies to trades synced from now on; ideas you changed by hand are never regrouped.</div>
    <form class="stack" onSubmit=${save}>
      <div class="fields">
        <div class="field"><label class="lbl" for="gw">Grouping window (minutes from the idea's first position)</label><input id="gw" class="inp" type="number" min="1" max="1440" value=${v.group_window_min} onInput=${(e) => setV({ ...v, group_window_min: e.target.value })}/></div>
        <div class="field"><label class="lbl" for="cw">Copy matching window (seconds), when the copier comment is missing</label><input id="cw" class="inp" type="number" min="5" max="3600" value=${v.copy_match_window_sec} onInput=${(e) => setV({ ...v, copy_match_window_sec: e.target.value })}/></div>
      </div>
      <label class="ck" style="border:0"><input type="checkbox" checked=${v.group_require_overlap} onChange=${() => setV({ ...v, group_require_overlap: !v.group_require_overlap })}/>
        <span>Only group a position if another position of the idea was still open (recommended)</span></label>
      <div class="sub">Always required: same account, same instrument (after symbol names below), same direction. Unrelated trades are never combined.</div>
      <div><button class="btn pri" type="submit">Save</button></div>
    </form></section>`;
}

function Aliases({ b }) {
  const [a, setA] = useState(''); const [c, setC] = useState('');
  const add = async (e) => { e.preventDefault(); try { await api('/aliases', { method: 'POST', body: { alias: a, canonical: c } }); setA(''); setC(''); await reloadBoot(); } catch (err) { toast(err.message, true); } };
  const del = async (x) => { try { await api('/aliases/' + encodeURIComponent(x.alias), { method: 'DELETE' }); await reloadBoot(); } catch (err) { toast(err.message, true); } };
  return html`<section class="card stack"><h2 class="h2">Symbol names</h2>
    <div class="sub">Brokers spell instruments differently (JPN225, JP225.cash). These map them to one name for grouping, copies and analytics. Suffixes like “.cash” or “m” are handled automatically.</div>
    <div class="hstack" style="gap:6px">${b.aliases.map((x) => html`<span class="chip">${x.alias} → ${x.canonical}<button class="btn sm ghost" style="min-height:20px;padding:0 2px" aria-label=${'Remove ' + x.alias} onClick=${() => del(x)}><${Icon} name="x" size=${12}/></button></span>`)}</div>
    <form class="hstack" onSubmit=${add}><label class="sr" for="aa">Broker name</label><input id="aa" class="inp" style="width:150px" placeholder="Broker name" value=${a} onInput=${(e) => setA(e.target.value)}/>
      <span class="mut">→</span><label class="sr" for="ac">Journal name</label><input id="ac" class="inp" style="width:150px" placeholder="Journal name" value=${c} onInput=${(e) => setC(e.target.value)}/><button class="btn" type="submit">Add</button></form>
  </section>`;
}

function Mistakes({ b }) {
  const [l, setL] = useState('');
  const add = async (e) => { e.preventDefault(); try { await api('/mistakes', { method: 'POST', body: { label: l } }); setL(''); await reloadBoot(); } catch (err) { toast(err.message, true); } };
  const tog = async (m) => { try { await api('/mistakes/' + m.id, { method: 'PUT', body: { active: !m.active } }); await reloadBoot(); } catch (err) { toast(err.message, true); } };
  return html`<section class="card stack"><h2 class="h2">Mistake tags</h2>
    <div class="sub">Tap a tag to hide or show it on reviews. Hidden tags stay on past reviews.</div>
    <div class="hstack" style="gap:6px">${b.mistakes.map((m) => html`<button type="button" class=${'chip ' + (m.active ? '' : 'off')} aria-pressed=${!!m.active} onClick=${() => tog(m)}>${m.label}</button>`)}</div>
    <form class="hstack" onSubmit=${add}><label class="sr" for="ml">New tag</label><input id="ml" class="inp" style="width:240px" placeholder="New tag" value=${l} onInput=${(e) => setL(e.target.value)}/><button class="btn" type="submit">Add</button></form>
  </section>`;
}

function Data({ b }) {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const run = async (fn, msg) => { setBusy(true); try { await fn(); await reloadBoot(); toast(msg); } catch (e) { toast(e.message, true); } setBusy(false); };
  return html`<section class="card stack"><h2 class="h2">Data</h2>
    <div class="sub">Sample data lives in its own accounts and never mixes with your real trades. Switch any time with “My data / Sample” in the menu.</div>
    <div class="hstack">
      <button class="btn" disabled=${busy} onClick=${() => run(async () => { await api('/sample', { method: 'POST' }); setStore({ mode: 'sample' }); }, 'Sample data loaded')}>${b.sampleLoaded ? 'Reload sample data' : 'Load sample data'}</button>
      ${b.sampleLoaded && html`<button class="btn danger" disabled=${busy} onClick=${() => confirm('Delete all sample data?') && run(async () => { await api('/sample', { method: 'DELETE' }); setStore({ mode: 'live' }); }, 'Sample data deleted')}>Delete sample data</button>`}
    </div>
    <div class="sub">Export: <a href=${'/api/export/ideas.csv?acct=all&firm=all' + (s.mode === 'sample' ? '&mode=sample' : '')} download>all closed ideas (CSV)</a>. Raw MT5 deals stay in the database unchanged as the audit record.</div>
  </section>`;
}
