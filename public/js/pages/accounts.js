import { html, useState, useEffect, useStore, useData, api, fmt, cls, sgn, Bar, Loading, PageHead, Icon, Modal, toast, reloadBoot, roleLabel, kindLabel, online, store } from '../lib.js';
import { SampleEmpty, PropBars } from './dashboard.js';
import { parseStatement } from '../importer.js';

const GROUPS = [['active', 'Active'], ['funded', 'Funded'], ['challenge', 'Challenge'], ['other', 'Personal / demo'], ['archived', 'Archived']];
const inGroup = (a, g) => (g === 'active' ? a.status === 'active' : g === 'archived' ? a.status === 'archived'
  : g === 'other' ? a.status === 'active' && (a.kind === 'personal' || a.kind === 'demo') : a.status === 'active' && a.kind === g);
const maxPct = (p) => (p && p.rules && p.rules.length ? Math.max(...p.rules.map((r) => r.pct)) : -1);

export function Accounts() {
  const s = useStore();
  const b = s.boot;
  const [edit, setEdit] = useState(null);   // account object or {} for new
  const [firms, setFirms] = useState(false);
  const [connect, setConnect] = useState(null);
  const [importing, setImporting] = useState(null);
  const [grp, setGrp] = useState('active');
  const [sel, setSel] = useState(null);
  const prop = useData(() => api('/prop?acct=all&firm=all&archived=1'), [b.now]);
  const pay = useData(() => api('/payouts'), [b.now]);
  const P = (a) => prop.data && prop.data.items.find((x) => x.account_id === a.id);
  const list = b.accounts.filter((a) => inGroup(a, grp)).sort((x, y) => maxPct(P(y)) - maxPct(P(x)) || x.id - y.id);
  const cur = b.accounts.find((a) => a.id === sel) || list[0] || b.accounts[0];
  const firmName = (a) => (b.firms.find((f) => f.id === a.firm_id) || {}).name;
  return html`<${PageHead} title="Accounts & sync" sub="MT5 accounts, prop rules and payouts" filter=${false}>
      <button class="btn sm" onClick=${() => setFirms(true)}>Prop firms</button>
      <button class="btn sm pri" onClick=${() => setEdit({})}><${Icon} name="plus" size=${15}/>Connect account</button><//>
    <${SampleEmpty}/>
    ${!b.accounts.length ? html`<div class="card stack" style="max-width:720px"><h2 class="h2">Start here</h2>
      <ol style="margin:0;padding-left:18px;line-height:1.8"><li>Add your prop firm (optional) and each MT5 account.</li><li>Mark the account you trade on as <b>Master</b> and the copier's Slaves as <b>Copy</b>.</li>
      <li>Open the account's <b>MT5 connector</b> tab and follow the steps to install the connector in that terminal.</li></ol>
      <div class="hstack"><button class="btn pri" onClick=${() => setEdit({})}>Add MT5 account</button><button class="btn" onClick=${() => setFirms(true)}>Add a prop firm</button></div></div>`
    : html`<div class="acct2 fill">
      <section class="panel" style="min-height:360px">
        <div class="ph"><div class="seg2" role="group" aria-label="Group">${GROUPS.map(([k, l]) => html`<button type="button" class=${grp === k ? 'on' : ''} aria-pressed=${grp === k} onClick=${() => setGrp(k)}>${l} <span class="num" style="opacity:.7">${b.accounts.filter((a) => inGroup(a, k)).length}</span></button>`)}</div>
          <span class="sub">Closest to a limit first</span></div>
        <div class="gr gh ag" style=${`grid-template-columns:${AGRID}`}><span>Account</span><span class="hide-sm">Group</span><span class="r">Balance</span><span class="hide-sm">Highest rule use</span><span class="r hide-sm">Split</span><span>MT5</span></div>
        <div class="scrolly">
          ${list.map((a) => { const p = P(a), m = maxPct(p), on = online(a);
            return html`<button type="button" class=${cls('gr ag', cur && a.id === cur.id && 'on')} style=${`grid-template-columns:${AGRID};padding:11px 10px`} onClick=${() => setSel(a.id)} aria-current=${cur && a.id === cur.id ? 'true' : null}>
              <span><b style="display:block;color:var(--text);font-size:13px">${a.name}</b><span class="sub">${firmName(a) || 'No firm'} · ${roleLabel(a)}</span></span>
              <span class="hide-sm"><span class=${cls('chip', a.kind === 'funded' ? 'b' : a.kind === 'challenge' ? 'a' : '')}>${kindLabel(a.kind)}${a.phase ? ' · ' + a.phase : ''}</span></span>
              <span class="num r" style="color:var(--text)">${fmt.plain(a.balance)}<span class="sub" style="display:block">${a.size ? 'of ' + fmt.plain(a.size, 0) : ''}</span></span>
              <span class="hide-sm stack" style="gap:5px">${m >= 0 ? html`<span class="sub num" style=${m >= 70 ? 'color:var(--amber)' : ''}>${Math.round(m)}% · ${(p.rules.find((r) => r.pct === m) || {}).label || ''}</span>
                <${Bar} pct=${m} color=${m >= 100 ? 'var(--neg)' : m >= 70 ? 'var(--amber)' : 'var(--pos)'}/>` : html`<span class="sub">${p && p.missing ? 'Rules incomplete' : 'No rules set'}</span>`}</span>
              <span class="num r hide-sm">${a.profit_split_pct != null ? a.profit_split_pct + '%' : '—'}</span>
              <span>${store.mode === 'sample' ? html`<span class="chip">Sample</span>` : !a.token_hint ? html`<span class="chip">Not set up</span>` : html`<span class=${cls('chip', on ? 'g' : 'a')}>${on ? 'Online' : 'Offline'}</span>`}</span>
            </button>`; })}
          ${!list.length && html`<div class="empty">No accounts in this group.</div>`}
        </div>
        <div class="sub" style="border-top:1px solid #1B212C;padding:9px 14px">Groups feed the account selector at the top of every page. Set an account's type in Overview → Edit.</div>
      </section>
      ${cur && html`<section class="panel" style="min-height:360px"><${Detail} key=${cur.id} a=${cur} p=${P(cur)} payout=${pay.data && pay.data.items.find((x) => x.id === cur.id)} firm=${firmName(cur)}
        onEdit=${() => setEdit(cur)} onConnect=${() => setConnect(cur)} onImport=${() => setImporting(cur)} reloadPay=${pay.reload}/></section>`}
    </div>`}
    ${edit && html`<${AccountForm} a=${edit} all=${b.accounts} firms=${b.firms} onClose=${() => setEdit(null)}/>`}
    ${firms && html`<${Firms} onClose=${() => setFirms(false)}/>`}
    ${connect && html`<${Connect} a=${connect} onClose=${() => setConnect(null)}/>`}
    ${importing && html`<${ImportStatement} a=${importing} onClose=${() => setImporting(null)}/>`}`;
}

const AGRID = 'minmax(0,1.6fr) 120px 118px minmax(0,1fr) 56px 86px';
const TABS = [['overview', 'Overview'], ['pay', 'Payouts'], ['conn', 'MT5 connector']];

function Detail({ a, p, payout, firm, onEdit, onConnect, onImport, reloadPay }) {
  const s = useStore();
  const [tab, setTab] = useState('overview');
  const master = a.master_account_id && s.boot.accounts.find((x) => x.id === a.master_account_id);
  const kv = (k, v) => html`<div><div class="cap">${k}</div><div style="font-size:13px;margin-top:4px">${v}</div></div>`;
  return html`
    <div style="padding:14px 16px 10px" class="spread">
      <div style="min-width:0;flex:1"><div class="hstack" style="gap:8px"><h2 style="margin:0;font-size:18px;font-weight:600">${a.name}</h2>
        <span class=${cls('chip', a.kind === 'funded' ? 'b' : a.kind === 'challenge' ? 'a' : '')}>${kindLabel(a.kind)}</span>${a.status === 'archived' && html`<span class="chip">Archived</span>`}</div>
        <div class="sub" style="margin-top:4px">${firm || 'No prop firm'} · login ${a.login_masked} · ${roleLabel(a)}${master ? ' of ' + master.name : ''}</div></div>
      <button class="btn sm" onClick=${onEdit}><${Icon} name="edit" size=${14}/>Edit</button></div>
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => html`<button type="button" role="tab" class=${cls('tab', tab === k && 'on')} aria-selected=${tab === k} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    <div class="scrolly" style="padding:16px">
      ${tab === 'overview' && html`<div class="stack" style="gap:16px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px">
          ${kv('Balance', html`<span class="num">${fmt.plain(a.balance)}</span>`)}${kv('Equity', html`<span class="num">${fmt.plain(a.equity)}</span>`)}
          ${kv('Account size', html`<span class="num">${fmt.plain(a.size, 0)}</span>`)}${kv('Phase', a.phase || '—')}
          ${kv('Broker server', a.server || '—')}${kv('Currency', a.currency)}</div>
        <div class="box stack" style="gap:10px">
          <div class="spread"><span class="cap">Prop rules (warnings only)</span>${p && p.reset && html`<span class="sub">Day reset ${fmt.dt(p.reset)} · next ${fmt.dt(p.nextReset)}</span>`}</div>
          ${p && (p.rules.length > 0 || p.target || p.missing) ? html`<${PropBars} p=${p} wide/>${p.rules.map((r) => html`<div class="sub">${r.label}: ${r.note}.</div>`)}`
            : html`<div class="sub">No rules set. Add the firm's daily loss, max loss and target with Edit.</div>`}
          <div class="sub">Risk Guard Rail and the copier enforce your limits in MT5. The journal only warns.</div></div>
      </div>`}
      ${tab === 'pay' && html`<${Payout} a=${a} payout=${payout} reloadPay=${reloadPay}/>`}
      ${tab === 'conn' && html`<${Connector} a=${a} onConnect=${onConnect} onImport=${onImport}/>`}
    </div>`;
}

function Payout({ a, payout, reloadPay }) {
  const init = { profit_split_pct: a.profit_split_pct ?? '', last_payout_day: a.last_payout_day || '', payout_currency: a.payout_currency || 'AUD' };
  const [v, setV] = useState(init);
  const [fx, setFx] = useState(null);
  useEffect(() => { api('/fx').then(setFx).catch(() => setFx({})); }, []);
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const save = async (e) => {
    e.preventDefault();
    try { await api('/accounts/' + a.id, { method: 'PUT', body: v }); await reloadBoot(); reloadPay(); toast('Payout settings saved'); } catch (err) { toast(err.message, true); }
  };
  const profit = payout ? payout.profit : null;
  const sp = Number(v.profit_split_pct);
  const share = profit != null && v.profit_split_pct !== '' ? Math.max(0, profit) * sp / 100 : null;
  const rate = v.payout_currency === 'USD' ? 1 : fx && fx[v.payout_currency];
  const sym = { AUD: 'A$', NZD: 'NZ$', USD: 'US$' }[v.payout_currency];
  return html`<form class="stack" style="gap:14px" onSubmit=${save}>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">
      <div class="field"><label class="lbl" for="psp">Profit split (your share %)</label><input id="psp" class="inp sm num" type="number" min="0" max="100" step="0.5" value=${v.profit_split_pct} onInput=${(e) => setV({ ...v, profit_split_pct: e.target.value })} placeholder="80"/></div>
      <div class="field"><label class="lbl" for="plp">Last payout date</label><input id="plp" class="inp sm" type="date" value=${v.last_payout_day} onInput=${(e) => setV({ ...v, last_payout_day: e.target.value })}/></div>
      <div class="field"><label class="lbl" for="pcu">Pay me in</label><select id="pcu" class="inp sm" style="width:100%" value=${v.payout_currency} onChange=${(e) => setV({ ...v, payout_currency: e.target.value })}><option>AUD</option><option>NZD</option><option>USD</option></select></div>
    </div>
    <div class="sub">Profit closed after the last payout date counts toward the next payout. Leave the date empty if you haven't been paid yet. Challenge accounts: enter the split you'll get once funded.</div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
      <div class="box"><div class="cap">${v.last_payout_day ? 'Profit since payout' : 'Profit so far'}</div><div class=${cls('num', sgn(profit))} style="font-size:16px;font-weight:600;margin-top:4px">${profit != null ? fmt.money(profit) : '—'}</div><div class="sub">closed trades, after costs</div></div>
      <div class="box"><div class="cap">Your share</div><div class="num" style="font-size:16px;font-weight:600;margin-top:4px">${share != null ? fmt.plain(share) : '—'}</div><div class="sub">${share != null ? 'Firm keeps ' + fmt.plain(Math.max(0, profit) - share) : 'set a split'}</div></div>
      <div class="box" style="background:#0F2A1C;border-color:#1D4A32"><div class="cap" style="color:#8FE3B6">You receive</div><div class="num" style="font-size:16px;font-weight:700;margin-top:4px;color:#5BE3A0">${share != null && rate ? sym + (share * rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</div>
        <div class="sub" style="color:#8FE3B6">${v.payout_currency === 'USD' ? 'no conversion' : rate ? `@ ${rate.toFixed(4)} · ECB ${fx.date}` : fx ? 'rate unavailable' : 'loading rate…'}</div></div>
    </div>
    ${!payout && a.status === 'archived' && html`<div class="sub">Archived accounts aren't counted.</div>`}
    <div class="hstack"><button class="btn sm pri" type="submit" disabled=${!dirty}>Save payout settings</button>${dirty && html`<button class="btn sm" type="button" onClick=${() => setV(init)}>Undo</button>`}</div>
    <div class="sub">The dashboard's profit split calculator starts from this split, this currency and this amount.</div>
  </form>`;
}

function Connector({ a, onConnect, onImport }) {
  const s = useStore();
  const log = useData(() => api('/sync/log?limit=200'), [s.boot.now]);
  const on = online(a);
  if (store.mode === 'sample') return html`<div class="sub">Sample accounts aren't connected to MT5.</div>`;
  return html`<div class="stack" style="gap:14px">
    <div class="box hstack" style="flex-wrap:nowrap;gap:10px"><span class="dot" style=${`background:${!a.token_hint ? 'var(--dim)' : on ? 'var(--pos)' : 'var(--amber)'}`}></span>
      <div style="flex:1"><div style="font-size:13px;font-weight:600">${!a.token_hint ? 'Not connected yet' : on ? 'Online' : 'Offline'}${a.token_hint ? ' · last contact ' + fmt.ago(a.last_seen) : ''}</div>
        <div class="sub">${a.connector_version ? 'TradeJournalConnector ' + a.connector_version + ' · ' : ''}read-only${a.server_offset_sec != null ? ` · server UTC${a.server_offset_sec >= 0 ? '+' : '−'}${Math.abs(a.server_offset_sec / 3600)}` : ''}${a.token_hint ? ' · token …' + a.token_hint : ''}</div></div></div>
    <div class="hstack"><button class=${cls('btn sm', !a.token_hint && 'pri')} onClick=${onConnect}>${a.token_hint ? 'Connection details / new token' : 'Connect this account'}</button>
      <button class="btn sm" onClick=${onImport}>Import MT5 statement</button></div>
    <div class="field"><span class="cap">Sync log · this account</span>
      <${Loading} state=${log}>${(d) => { const rows = d.items.filter((l) => l.account_id === a.id).slice(0, 60);
        return rows.length ? html`<div class="box" style="padding:0 10px">${rows.map((l) => html`<div style="display:grid;grid-template-columns:118px 1fr;gap:10px;padding:8px 0;border-bottom:1px solid #151A22;font-size:12.5px">
          <span class="num mut">${fmt.date(l.time)} ${fmt.time(l.time)}</span><span><span class=${cls('chip', l.level === 'error' ? 'r' : l.level === 'warn' ? 'a' : l.actor === 'connector' ? 'g' : '')} style="height:20px">${l.action}</span> <span class="mut">${l.detail}</span></span></div>`)}</div>`
          : html`<div class="sub">Nothing logged for this account yet.</div>`; }}<//></div>
    <div class="box sub" style="line-height:1.55">The connector EA only reads history, positions and balance; it has no order code. It uploads within a second or two of each trade, every 15 s with positions open and every 60 s when flat,
      and once a day sends every deal ticket of the last 35 days so anything missed is filled in.</div>
  </div>`;
}

function Firms({ onClose }) {
  const s = useStore();
  const [edit, setEdit] = useState(null);
  return html`<${Modal} title="Prop firms" onClose=${onClose}>
    ${s.boot.firms.map((f) => html`<div class="spread" style="border-bottom:1px solid var(--line2);padding:8px 0"><div><b>${f.name}</b><div class="sub">${s.boot.accounts.filter((a) => a.firm_id === f.id).length} accounts${f.website ? ' · ' + f.website.replace(/^https?:\/\//, '') : ''}</div></div>
      <button class="btn sm" onClick=${() => setEdit(f)}>Edit</button></div>`)}
    ${!s.boot.firms.length && html`<div class="sub">No firms yet.</div>`}
    <div><button class="btn pri" onClick=${() => setEdit({})}><${Icon} name="plus" size=${15}/>Add prop firm</button></div>
    ${edit && html`<${FirmForm} f=${edit} onClose=${() => setEdit(null)}/>`}
  <//>`;
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
    profit_split_pct: a.profit_split_pct ?? '', last_payout_day: a.last_payout_day || '', payout_currency: a.payout_currency || 'AUD',
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
    <div class="fields">
      ${F('aps', 'Profit split (your share %)', html`<input id="aps" class="inp" type="number" min="0" max="100" step="0.5" value=${v.profit_split_pct} onInput=${set('profit_split_pct')} placeholder="80"/>`)}
      ${F('apd', 'Last payout date', html`<input id="apd" class="inp" type="date" value=${v.last_payout_day} onInput=${set('last_payout_day')}/>`)}
      ${F('apc', 'Pay me in', html`<select id="apc" class="inp" style="width:100%" value=${v.payout_currency} onChange=${set('payout_currency')}><option>AUD</option><option>NZD</option><option>USD</option></select>`)}
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
