import { html, useState, useStore, useData, api, fmt, cls, Loading, PageHead, Icon, Modal, toast, reloadBoot, roleLabel, kindLabel, online, store } from '../lib.js';
import { SampleEmpty, PropBars } from './dashboard.js';
import { parseStatement } from '../importer.js';

export function Accounts() {
  const s = useStore();
  const b = s.boot;
  const [edit, setEdit] = useState(null);   // account object or {} for new
  const [firmEdit, setFirmEdit] = useState(null);
  const [connect, setConnect] = useState(null);
  const [importing, setImporting] = useState(null);
  const prop = useData(() => api('/prop?acct=all&firm=all&archived=1'), [b.now]);
  const groups = [...b.firms.map((f) => ({ firm: f, accts: b.accounts.filter((a) => a.firm_id === f.id) })),
    { firm: null, accts: b.accounts.filter((a) => !a.firm_id) }].filter((g) => g.firm || g.accts.length);
  const log = useData(() => api('/sync/log?limit=60'), [b.now]);
  return html`<${PageHead} title="Accounts & sync" sub="Prop firms, MT5 accounts and the read-only connector" filter=${false}>
      <button class="btn" onClick=${() => setFirmEdit({})}><${Icon} name="plus" size=${16}/>Prop firm</button>
      <button class="btn pri" onClick=${() => setEdit({})}><${Icon} name="plus" size=${16}/>MT5 account</button><//>
    <${SampleEmpty}/>
    ${groups.map((g) => html`<section class="card stack" style="gap:14px">
      <div class="spread"><div><h2 class="h2">${g.firm ? g.firm.name : 'No prop firm'}</h2>
        <div class="sub" style="margin-top:4px">${g.accts.length} account${g.accts.length === 1 ? '' : 's'}${g.firm && g.firm.website ? html` · <a href=${g.firm.website} target="_blank" rel="noopener noreferrer">${g.firm.website.replace(/^https?:\/\//, '')}</a>` : ''}</div></div>
        ${g.firm && html`<button class="btn sm" onClick=${() => setFirmEdit(g.firm)}>Edit firm</button>`}</div>
      ${g.accts.map((a) => html`<${AccountRow} a=${a} all=${b.accounts} p=${prop.data && prop.data.items.find((x) => x.account_id === a.id)}
        onEdit=${() => setEdit(a)} onConnect=${() => setConnect(a)} onImport=${() => setImporting(a)}/>`)}
      ${!g.accts.length && html`<div class="sub">No accounts. Add one with “MT5 account”.</div>`}
    </section>`)}
    ${!b.accounts.length && !b.firms.length && html`<div class="card stack"><h2 class="h2">Start here</h2>
      <ol style="margin:0;padding-left:18px;line-height:1.8"><li>Add your prop firm (optional) and each MT5 account.</li><li>Mark the account you trade on as <b>Master</b> and the copier's Slaves as <b>Copy</b>.</li>
      <li>Press <b>Connect</b> on each account and follow the steps to install the connector in that terminal.</li></ol></div>`}
    <div class="row">
      <section class="card flush" style="flex:2 1 560px">
        <div class="card-head"><div><h2 class="h2">Sync log</h2><div class="sub" style="margin-top:4px">Every import, retry, check and change. Deals are stored once by their MT5 ticket.</div></div>
          <button class="btn sm" onClick=${log.reload}><${Icon} name="sync" size=${14}/>Refresh</button></div>
        <${Loading} state=${log}>${(d) => d.items.length ? html`<div class="scroll"><table class="tbl"><thead><tr><th>Time (AEST)</th><th>Account</th><th>Event</th><th>Details</th></tr></thead>
          <tbody>${d.items.map((l) => html`<tr><td class="num mut">${fmt.date(l.time)} ${fmt.timeS(l.time)}</td><td>${l.account_name || '—'}</td>
            <td><span class=${cls('chip', l.level === 'error' ? 'r' : l.level === 'warn' ? 'a' : l.actor === 'connector' ? 'g' : '')}>${l.action}</span></td>
            <td class="mut" style="white-space:normal;min-width:260px">${l.detail}</td></tr>`)}</tbody></table></div>` : html`<div class="empty">Nothing yet.</div>`}<//>
      </section>
      <section class="card stack" style="flex:1 1 340px">
        <h2 class="h2">How sync works</h2>
        <ol style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.5;color:var(--text2)">
          <li>The <b>Trade Journal Connector</b> EA runs in each MT5 terminal. It only reads history, positions and balance; it has no order code.</li>
          <li>On every trade it uploads within a second or two; otherwise every 15 s with positions open, or every 60 s when flat.</li>
          <li>Each deal is stored once (by deal ticket); positions are rebuilt from deals, then grouped into ideas. Copies link to the Master by the copier's <span class="num">TC:</span> comment.</li>
          <li>Once a day it sends the list of every deal ticket for the last 35 days. Anything missing is requested and filled in.</li>
        </ol>
        <div class="well hstack" style="align-items:flex-start;flex-wrap:nowrap;font-size:13px;line-height:1.5"><span class="mut"><${Icon} name="lock"/></span>
          <span>The journal never sends orders. On your trading terminals, “read-only” comes from the connector's code. A broker-enforced guarantee needs a separate terminal logged in with the account's <b>investor password</b>.</span></div>
      </section>
    </div>
    ${edit && html`<${AccountForm} a=${edit} all=${b.accounts} firms=${b.firms} onClose=${() => setEdit(null)}/>`}
    ${firmEdit && html`<${FirmForm} f=${firmEdit} onClose=${() => setFirmEdit(null)}/>`}
    ${connect && html`<${Connect} a=${connect} onClose=${() => setConnect(null)}/>`}
    ${importing && html`<${ImportStatement} a=${importing} onClose=${() => setImporting(null)}/>`}`;
}

function AccountRow({ a, all, p, onEdit, onConnect, onImport }) {
  const master = a.master_account_id && all.find((x) => x.id === a.master_account_id);
  const on = online(a);
  const rules = [a.daily_loss_pct && `Daily ${a.daily_loss_pct}%`, a.max_loss_pct && `Max ${a.max_loss_pct}% ${a.max_loss_type || ''}`, a.profit_target_pct && `Target ${a.profit_target_pct}%`].filter(Boolean).join(' · ');
  return html`<div class="well" style=${`display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;align-items:center;${a.status === 'archived' ? 'opacity:.6' : ''}`}>
    <div><div style="font-weight:600">${a.name}</div><div class="sub num" style="margin-top:4px">Login ${a.login_masked}${a.server ? ' · ' + a.server : ''}</div></div>
    <div class="hstack" style="gap:6px"><span class=${cls('chip', a.kind === 'funded' && 'b')}>${kindLabel(a.kind)}${a.phase ? ' · ' + a.phase : ''}</span>
      <span class="chip">${roleLabel(a)}${master ? ' of ' + master.name : ''}</span>${a.status === 'archived' && html`<span class="chip">Archived</span>`}</div>
    <div><div class="lbl">Size · balance</div><div class="num" style="font-size:13px;margin-top:4px">${fmt.plain(a.size, 0)} · ${fmt.plain(a.balance)}</div></div>
    <div><div class="lbl">Rules</div><div style="font-size:13px;margin-top:4px">${rules || '—'}</div></div>
    <div><div class="lbl">Connector</div><div class="hstack" style="font-size:13px;margin-top:4px;gap:6px">
      ${store.mode === 'sample' ? html`<span class="mut">Sample account</span>` : !a.token_hint ? html`<span class="dot" style="background:var(--dim)"></span>Not connected`
        : html`<span class="dot" style=${`background:${on ? 'var(--pos)' : 'var(--amber)'}`}></span>${on ? 'Online' : 'Offline'} · ${fmt.ago(a.last_seen)}`}</div>
      ${a.connector_version && a.connector_version !== 'sample' && html`<div class="sub">v${a.connector_version}${a.server_offset_sec != null ? ` · server UTC${a.server_offset_sec >= 0 ? '+' : '−'}${Math.abs(a.server_offset_sec / 3600)}` : ''}</div>`}</div>
    <div class="hstack" style="justify-content:flex-end">${store.mode !== 'sample' && html`<button class=${cls('btn sm', !a.token_hint && 'pri')} onClick=${onConnect}>${a.token_hint ? 'Connection' : 'Connect'}</button>`}
      ${store.mode !== 'sample' && html`<button class="btn sm" onClick=${onImport} title="Import past trades from an MT5 statement">Import</button>`}
      <button class="btn sm" onClick=${onEdit}>Edit</button></div>
    ${p && (p.rules.length > 0 || p.target || p.missing) && html`<div style="grid-column:1 / -1;border-top:1px solid var(--line);padding-top:12px" class="stack">
      <div class="spread"><span class="lbl">Prop rules (warnings only)</span><span class="sub">Firm day reset ${p.reset ? fmt.dt(p.reset) : '—'} · next ${p.nextReset ? fmt.dt(p.nextReset) : '—'} (Brisbane)</span></div>
      <${PropBars} p=${p} wide/>
      ${p.rules.map((r) => html`<div class="sub">${r.label}: ${r.note}.</div>`)}</div>`}
  </div>`;
}

function FirmForm({ f, onClose }) {
  const init = { name: f.name || '', website: f.website || '', notes: f.notes || '' };
  const [v, setV] = useState(init);
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const save = async (e) => {
    e.preventDefault();
    try { await api(f.id ? '/firms/' + f.id : '/firms', { method: f.id ? 'PUT' : 'POST', body: v }); await reloadBoot(); onClose(); } catch (err) { toast(err.message, true); }
  };
  const del = async () => { if (!confirm('Delete this firm?')) return; try { await api('/firms/' + f.id, { method: 'DELETE' }); await reloadBoot(); onClose(); } catch (err) { toast(err.message, true); } };
  return html`<${Modal} title=${f.id ? 'Edit prop firm' : 'Add prop firm'} onClose=${onClose} dirty=${dirty}><form class="stack" onSubmit=${save}>
    <div class="field"><label class="lbl" for="fn">Name</label><input id="fn" class="inp" required value=${v.name} onInput=${(e) => setV({ ...v, name: e.target.value })}/></div>
    <div class="field"><label class="lbl" for="fw">Website</label><input id="fw" class="inp" type="url" value=${v.website} onInput=${(e) => setV({ ...v, website: e.target.value })} placeholder="https://"/></div>
    <div class="field"><label class="lbl" for="fno">Notes (rules, payout dates…)</label><textarea id="fno" class="inp" value=${v.notes} onInput=${(e) => setV({ ...v, notes: e.target.value })}></textarea></div>
    <div class="hstack"><button class="btn pri" type="submit">Save</button><button class="btn" type="button" onClick=${() => (!dirty || confirm('Discard your changes?')) && onClose()}>Cancel</button>${f.id && html`<button class="btn danger" type="button" onClick=${del}>Delete</button>`}</div>
  </form><//>`;
}

function AccountForm({ a, all, firms, onClose }) {
  const isNew = !a.id;
  const [init] = useState(() => ({
    name: a.name || '', login: a.login || '', firm_id: a.firm_id || '', kind: a.kind || 'challenge', phase: a.phase || '', size: a.size ?? '',
    role: a.role || 'standalone', master_account_id: a.master_account_id || '', daily_loss_pct: a.daily_loss_pct ?? 5, max_loss_pct: a.max_loss_pct ?? 10,
    max_loss_type: a.max_loss_type || 'static', profit_target_pct: a.profit_target_pct ?? '', tz_mode: a.tz_mode || 'auto', status: a.status || 'active',
    daily_reset_tz: a.daily_reset_tz || 'server', daily_reset_time: a.daily_reset_time || '00:00', daily_loss_of: a.daily_loss_of || 'start', daily_loss_from: a.daily_loss_from || 'higher',
  }));
  const [v, setV] = useState(init);
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const masters = all.filter((x) => x.id !== a.id && x.role !== 'copy' && x.status === 'active');
  const save = async (e) => {
    e.preventDefault();
    try {
      const body = { ...v, login: isNew ? v.login : undefined };
      if (!isNew) delete body.login;
      await api(isNew ? '/accounts' : '/accounts/' + a.id, { method: isNew ? 'POST' : 'PUT', body });
      await reloadBoot(); toast('Account saved'); onClose();
    } catch (err) { toast(err.message, true); }
  };
  const F = (id, label, input) => html`<div class="field"><label class="lbl" for=${id}>${label}</label>${input}</div>`;
  return html`<${Modal} title=${isNew ? 'Add MT5 account' : 'Edit ' + a.name} onClose=${onClose} wide dirty=${dirty}><form class="stack" onSubmit=${save}>
    <div class="fields">
      ${F('an', 'Name shown in the journal', html`<input id="an" class="inp" required value=${v.name} onInput=${set('name')} placeholder="The5ers 100K #1"/>`)}
      ${F('al', 'MT5 login (number)', html`<input id="al" class="inp" required=${isNew} disabled=${!isNew} inputmode="numeric" value=${v.login} onInput=${set('login')}/>`)}
      ${F('af', 'Prop firm', html`<select id="af" class="inp" style="width:100%" value=${v.firm_id} onChange=${set('firm_id')}><option value="">None</option>${firms.map((f) => html`<option value=${f.id}>${f.name}</option>`)}</select>`)}
      ${F('ak', 'Type', html`<select id="ak" class="inp" style="width:100%" value=${v.kind} onChange=${set('kind')}><option value="challenge">Challenge</option><option value="funded">Funded</option><option value="personal">Personal</option><option value="demo">Demo</option></select>`)}
      ${F('ap', 'Phase (optional)', html`<input id="ap" class="inp" value=${v.phase} onInput=${set('phase')} placeholder="Phase 1"/>`)}
      ${F('as', 'Initial account size', html`<input id="as" class="inp" type="number" min="0" step="any" value=${v.size} onInput=${set('size')} placeholder="100000"/>`)}
    </div>
    <div class="fields">
      ${F('ar', 'Role with the trade copier', html`<select id="ar" class="inp" style="width:100%" value=${v.role} onChange=${set('role')}><option value="standalone">Standalone (not copied)</option><option value="master">Master (you trade here)</option><option value="copy">Copy (a Slave of the copier)</option></select>`)}
      ${v.role === 'copy' && F('am', 'Copies trades from', html`<select id="am" class="inp" style="width:100%" required value=${v.master_account_id} onChange=${set('master_account_id')}><option value="">Choose the Master…</option>${masters.map((m) => html`<option value=${m.id}>${m.name}</option>`)}</select>`)}
    </div>
    <div class="sub">Rules here are for display and analytics only. Your limits are enforced in MT5 by Risk Guard Rail and the copier. Check your firm's exact rules.</div>
    <div class="fields">
      ${F('ad', 'Daily loss limit %', html`<input id="ad" class="inp" type="number" min="0" step="0.1" value=${v.daily_loss_pct} onInput=${set('daily_loss_pct')}/>`)}
      ${F('ax', 'Max loss %', html`<input id="ax" class="inp" type="number" min="0" step="0.1" value=${v.max_loss_pct} onInput=${set('max_loss_pct')}/>`)}
      ${F('at', 'Max loss type', html`<select id="at" class="inp" style="width:100%" value=${v.max_loss_type} onChange=${set('max_loss_type')}><option value="static">Static</option><option value="trailing">Trailing</option></select>`)}
      ${F('ag', 'Profit target % (challenges)', html`<input id="ag" class="inp" type="number" min="0" step="0.1" value=${v.profit_target_pct} onInput=${set('profit_target_pct')}/>`)}
    </div>
    <div class="fields">
      ${F('art', 'Daily reset: time zone', html`<select id="art" class="inp" style="width:100%" value=${v.daily_reset_tz} onChange=${set('daily_reset_tz')}>
        <option value="server">Broker server time (MT5 Market Watch)</option><option value="UTC">UTC</option><option value="America/New_York">New York (e.g. 17:00 ET)</option>
        <option value="Europe/London">London</option><option value="Europe/Prague">Central Europe (CET)</option><option value="Asia/Dubai">Dubai</option>
        <option value="Asia/Jerusalem">Israel</option><option value="Australia/Sydney">Sydney</option><option value="Australia/Brisbane">Brisbane</option></select>`)}
      ${F('arh', 'Daily reset: time', html`<input id="arh" class="inp" type="time" value=${v.daily_reset_time} onInput=${set('daily_reset_time')}/>`)}
      ${F('alo', 'Daily loss limit is a % of', html`<select id="alo" class="inp" style="width:100%" value=${v.daily_loss_of} onChange=${set('daily_loss_of')}><option value="start">The start-of-day amount</option><option value="initial">The initial account size</option></select>`)}
      ${F('alf', 'Daily loss is measured from', html`<select id="alf" class="inp" style="width:100%" value=${v.daily_loss_from} onChange=${set('daily_loss_from')}><option value="higher">The higher of balance and equity at the reset</option><option value="balance">The balance at the reset</option></select>`)}
    </div>
    <details><summary class="sub" style="cursor:pointer">Advanced</summary><div class="fields" style="margin-top:12px">
      ${F('az', 'Broker server time', html`<select id="az" class="inp" style="width:100%" value=${v.tz_mode} onChange=${set('tz_mode')}><option value="auto">Auto: UTC+2/+3 follows US daylight saving (most brokers)</option><option value="fixed">Fixed: use the offset as measured</option></select>`)}
      ${!isNew && F('ast', 'Status', html`<select id="ast" class="inp" style="width:100%" value=${v.status} onChange=${set('status')}><option value="active">Active</option><option value="archived">Archived (hidden, history kept)</option></select>`)}
    </div></details>
    <div class="hstack"><button class="btn pri" type="submit">Save</button><button class="btn" type="button" onClick=${() => (!dirty || confirm('Discard your changes?')) && onClose()}>Cancel</button></div>
  </form><//>`;
}

function Connect({ a, onClose }) {
  const [token, setToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const url = location.origin + '/api/ingest';
  const make = async () => {
    if (a.token_hint && !confirm('Create a new token? The connector using the old one stops working until you paste the new one.')) return;
    setBusy(true);
    try { const r = await api(`/accounts/${a.id}/token`, { method: 'POST' }); setToken(r.token); reloadBoot(); } catch (e) { toast(e.message, true); }
    setBusy(false);
  };
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Copied'), () => {});
  return html`<${Modal} title=${'Connect ' + a.name} onClose=${onClose} wide>
    ${a.token_hint && !token && html`<div class="warn okbox">This account has a token (ending …${a.token_hint}). Last contact ${fmt.ago(a.last_seen)}.</div>`}
    <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:14px;line-height:1.55">
      <li><b>Create a token.</b> It's shown once; paste it into the connector.
        <div class="hstack" style="margin-top:8px"><button class="btn pri" disabled=${busy} onClick=${make}>${a.token_hint ? 'Create a new token' : 'Create token'}</button></div>
        ${token && html`<div class="stack" style="gap:6px;margin-top:10px"><div class="code">${token}</div><div class="hstack"><button class="btn sm" onClick=${() => copy(token)}>Copy token</button><span class="sub">Keep it private. It lets the holder upload trades to this account only.</span></div></div>`}</li>
      <li><b>Allow the journal's address in MT5.</b> In the terminal logged in to login ${a.login_masked}: Tools → Options → Expert Advisors → tick <i>Allow WebRequest for listed URL</i> and add:
        <div class="code" style="margin-top:6px">${location.origin}</div></li>
      <li><b>Install the connector.</b> Copy <span class="num">TradeJournalConnector.mq5</span> into File → Open Data Folder → MQL5 → Experts, open it in MetaEditor and press F7.</li>
      <li><b>Attach it to its own chart</b> (any symbol), not your Risk Guard Rail chart. Inputs:
        <div class="code" style="margin-top:6px">Journal upload URL = ${url}<br/>Connector token = (the token above)</div>
        <button class="btn sm" style="margin-top:6px" onClick=${() => copy(url)}>Copy URL</button></li>
      <li>The chart shows <i>“OK · … sent”</i> within a few seconds, and this page shows the account as online. The first upload sends the last 90 days of history.</li>
    </ol>
    <div class="sub">The terminal must be running for trades to sync. If it was closed, the connector catches up from the account history when it starts again.</div>
  <//>`;
}

function ImportStatement({ a, onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [name, setName] = useState('');
  const known = a.server_offset_sec;
  const [mode, setMode] = useState(known != null && known !== 7200 && known !== 10800 ? 'fixed' : 'auto');
  const [hours, setHours] = useState(known != null ? known / 3600 : 2);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const pick = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setErr(null); setRows(null); setDone(null); setName(f.name);
    try { setRows(parseStatement(new Uint8Array(await f.arrayBuffer()), f.name)); } catch (x) { setErr(x.message); }
  };
  const go = async () => {
    setBusy(true);
    try { setDone(await api(`/accounts/${a.id}/import`, { method: 'POST', body: { positions: rows, tz_mode: mode, offset_hours: Number(hours) } })); reloadBoot(); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const sum = rows ? rows.reduce((s, r) => s + r.profit + r.commission + r.swap, 0) : 0;
  const t = rows && rows.length ? [Math.min(...rows.map((r) => r.open_time)), Math.max(...rows.map((r) => r.close_time))] : null;
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  return html`<${Modal} title=${'Import history into ' + a.name} onClose=${onClose} wide dirty=${!!rows && !done}>
    <ol style="margin:0;padding-left:20px;line-height:1.6">
      <li>In MT5 (logged in to ${a.login_masked}): <b>Toolbox → History</b>, choose the period (right-click → <i>All History</i> or a custom period).</li>
      <li>Right-click the history → <b>Report → HTML</b> and save it. Or use a CSV with the columns listed in the README.</li>
      <li>Choose the file here, check the preview, then Import.</li></ol>
    <input type="file" accept=".html,.htm,.csv" onChange=${pick} aria-label="Statement file"/>
    ${err && html`<div class="warn err">${err}</div>`}
    ${rows && html`<div class="well stack" style="gap:6px">
      <b>${rows.length} closed position${rows.length === 1 ? '' : 's'} found in ${name}</b>
      ${t && html`<span class="sub">${day(t[0])} to ${day(t[1])} (server dates) · net ${fmt.money(sum)} · ${[...new Set(rows.map((r) => r.symbol))].join(', ')}</span>`}
      <span class="sub">Positions the connector already sent are skipped. Imported trades are replaced automatically if the connector later sends the same positions.</span></div>
    <div class="fields">
      <div class="field"><label class="lbl" for="imz">Broker server time in this report</label>
        <select id="imz" class="inp" style="width:100%" value=${mode} onChange=${(e) => setMode(e.target.value)}>
          <option value="auto">UTC+2 in winter, +3 in US summer (most brokers)</option><option value="fixed">A fixed offset</option></select></div>
      ${mode === 'fixed' && html`<div class="field"><label class="lbl" for="imh">Offset from UTC (hours)</label><input id="imh" class="inp" type="number" step="0.5" min="-12" max="14" value=${hours} onInput=${(e) => setHours(e.target.value)}/></div>`}
    </div>
    <div class="sub">The report shows each position's final S/L, not the first one, so R for imported trades is an estimate (from the trade's own P&L per point). Trades without a S/L get no R.</div>`}
    ${done ? html`<div class="warn okbox">Imported ${done.imported} position(s) into ${done.ideas} new idea(s); ${done.skipped} skipped. <a href="#/ideas">See them</a></div>
      <div><button class="btn" onClick=${onClose}>Close</button></div>`
      : html`<div class="hstack"><button class="btn pri" disabled=${!rows || !rows.length || busy} onClick=${go}>${busy ? 'Importing…' : 'Import'}</button><button class="btn" onClick=${onClose}>Cancel</button></div>`}
  <//>`;
}
