import { html, useState, useStore, api, setStore, PageHead, Icon, toast, reloadBoot, KIND_GROUPS, scopeName } from '../lib.js';

export function Settings() {
  const s = useStore();
  const b = s.boot;
  return html`<${PageHead} title="Settings" sub=${'Signed in as ' + b.user} filter=${false}/>
    <div class="row">
      <div class="col" style="flex:1 1 420px"><${DefaultView} b=${b}/><${Grouping} b=${b}/><${Data} b=${b}/></div>
      <div class="col" style="flex:1 1 420px"><${FloorSettings} b=${b}/><${Aliases} b=${b}/><${Mistakes} b=${b}/></div>
    </div>`;
}

function FloorSettings({ b }) {
  const st = b.settings;
  const init = { plan_schedule: st.plan_schedule ?? 'JP225@10:00-14:00,NAS100@16:00-20:00', max_ideas_day: st.max_ideas_day ?? '2', loss_stop: st.loss_stop ?? '2', news_pause_min: st.news_pause_min ?? '15',
    plan_markets: st.plan_markets || 'JP225,NAS100', plan_levels: st.plan_levels || '', quote_symbols: st.quote_symbols || '', calendar_ccys: st.calendar_ccys || 'USD,JPY,EUR,GBP,AUD,NZD,CAD,CHF' };
  const [v, setV] = useState(init);
  const rows = (v.plan_schedule || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const m = /^([^@]*)@(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(x); return m ? { symbol: m[1], from: m[2], to: m[3] } : { symbol: x, from: '', to: '' }; });
  const setRows = (r) => setV({ ...v, plan_schedule: r.filter((x) => x.symbol && x.from && x.to).map((x) => `${x.symbol.trim().toUpperCase()}@${x.from}-${x.to}`).join(',') });
  const upd = (k, f) => setRows(rows.map((x, j) => (j === k ? f(x) : x)));
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try { await api('/settings', { method: 'PUT', body: v }); await reloadBoot(); toast('Trading Floor settings saved'); } catch (err) { toast(err.message, true); }
  };
  const F = (id, label, input) => html`<div class="field"><label class="lbl" for=${id}>${label}</label>${input}</div>`;
  return html`<form class="card stack" onSubmit=${save}><h2 class="h2">Trading Floor</h2>
    <div class="field"><span class="lbl">Trading schedule (Brisbane time) · the Floor's window and game plan follow it</span>
      ${rows.map((r, k) => html`<div class="hstack" style="gap:6px;flex-wrap:nowrap;margin-top:6px">
        <input class="inp sm" style="width:110px" aria-label="Market" value=${r.symbol} onInput=${(e) => upd(k, (x) => ({ ...x, symbol: e.target.value }))}/>
        <input class="inp sm" type="time" aria-label="From" value=${r.from} onInput=${(e) => upd(k, (x) => ({ ...x, from: e.target.value }))}/>
        <span class="sub">to</span>
        <input class="inp sm" type="time" aria-label="To" value=${r.to} onInput=${(e) => upd(k, (x) => ({ ...x, to: e.target.value }))}/>
        <button type="button" class="btn sm ghost" aria-label="Remove" onClick=${() => setRows(rows.filter((_, j) => j !== k))}>✕</button></div>`)}
      <div style="margin-top:6px"><button type="button" class="btn sm" onClick=${() => setV({ ...v, plan_schedule: (v.plan_schedule ? v.plan_schedule + ',' : '') + 'XAUUSD@18:00-21:00' })}>Add a market</button></div></div>
    <div class="fields">
      ${F('mid', 'Max trade ideas per day, wins or losses (0 = no limit)', html`<input id="mid" class="inp" type="number" min="0" max="20" value=${v.max_ideas_day} onInput=${set('max_ideas_day')}/>`)}
      ${F('lst', 'Stop for the day after this many losing ideas (0 = off)', html`<input id="lst" class="inp" type="number" min="0" max="10" value=${v.loss_stop} onInput=${set('loss_stop')}/>`)}
      ${F('npm', 'No new trades this many minutes either side of high-impact news', html`<input id="npm" class="inp" type="number" min="0" max="120" value=${v.news_pause_min} onInput=${set('news_pause_min')}/>`)}
      ${F('ccy', 'Calendar currencies', html`<input id="ccy" class="inp" value=${v.calendar_ccys} onInput=${set('calendar_ccys')}/>`)}
    </div>
    ${F('pm', 'Game plan markets (comma separated)', html`<input id="pm" class="inp" value=${v.plan_markets} onInput=${set('plan_markets')}/>`)}
    ${F('pl', 'Game plan levels for each market', html`<input id="pl" class="inp" value=${v.plan_levels} onInput=${set('plan_levels')}/>`)}
    ${F('qs', 'Live prices (TradingView symbol = label)', html`<input id="qs" class="inp" value=${v.quote_symbols} onInput=${set('quote_symbols')} placeholder="OANDA:JP225USD=JP225,OANDA:NAS100USD=NAS100"/>`)}
    <div class="sub">Live prices come from TradingView's free widget, so they are TradingView's quotes (e.g. OANDA), not your broker's. The game plan markets and levels apply to new days.</div>
    <div><button class="btn pri" type="submit">Save</button></div>
  </form>`;
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
  const [v, setV] = useState({ group_window_min: b.settings.group_window_min, group_require_overlap: b.settings.group_require_overlap === '1', copy_match_window_sec: b.settings.copy_match_window_sec,
    link_accounts: b.settings.link_accounts !== '0', link_window_min: b.settings.link_window_min || '5', risk_tolerance_pct: b.settings.risk_tolerance_pct ?? '3', risk_grace_sec: b.settings.risk_grace_sec ?? '60' });
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
      <h3 class="cap" style="margin:6px 0 0">Same trade on several accounts</h3>
      <label class="ck" style="border:0"><input type="checkbox" checked=${v.link_accounts} onChange=${() => setV({ ...v, link_accounts: !v.link_accounts })}/>
        <span>Link a trade placed by hand on another account (not a copier copy) to the same idea, so you review it once</span></label>
      <div class="fields">
        <div class="field"><label class="lbl" for="lw">Linking window (minutes between the two entries)</label><input id="lw" class="inp" type="number" min="1" max="120" disabled=${!v.link_accounts} value=${v.link_window_min} onInput=${(e) => setV({ ...v, link_window_min: e.target.value })}/></div>
        <div class="field"><label class="lbl" for="rg">Ignore a higher combined risk lasting under (seconds)</label><input id="rg" class="inp" type="number" min="0" max="900" value=${v.risk_grace_sec} onInput=${(e) => setV({ ...v, risk_grace_sec: e.target.value })}/></div>
        <div class="field"><label class="lbl" for="rt">Risk limit tolerance for slippage (%)</label><input id="rt" class="inp" type="number" min="0" max="50" step="0.5" value=${v.risk_tolerance_pct} onInput=${(e) => setV({ ...v, risk_tolerance_pct: e.target.value })}/></div>
      </div>
      <div class="sub">Linking needs the same instrument and direction. Copier copies are always linked by their TC: comment. Use “Separate” on an idea's Positions tab if two trades were linked by mistake. With a ${v.risk_tolerance_pct || 0}% tolerance, a $300 limit is a violation above $${(300 * (1 + Number(v.risk_tolerance_pct || 0) / 100)).toFixed(0)}. With connector 1.02, a scale-in whose combined risk is back within the limit in under ${v.risk_grace_sec || 0} s (because you moved the first stop) isn't counted at the higher amount.</div>
      <div><button class="btn pri" type="submit">Save</button></div>
    </form></section>`;
}

function Alerts({ b }) {
  const st = b.settings;
  const [v, setV] = useState({ warn_pct: st.warn_pct || '70', alert_daily_hour: st.alert_daily_hour || '7',
    alert_rules: st.alert_rules !== '0', alert_daily: st.alert_daily !== '0', alert_weekly: st.alert_weekly !== '0' });
  const [busy, setBusy] = useState(false);
  const save = async (patch) => {
    const nv = { ...v, ...patch }; setV(nv);
    try { await api('/settings', { method: 'PUT', body: nv }); await reloadBoot(); toast('Saved'); } catch (e) { toast(e.message, true); }
  };
  const act = async (url, body, msg) => {
    setBusy(true);
    try { const r = await api(url, { method: 'POST', body }); toast(msg(r)); await reloadBoot(); } catch (e) { toast(e.message, true); }
    setBusy(false);
  };
  const tog = (k, label) => html`<label class="ck" style="border:0"><input type="checkbox" checked=${v[k]} onChange=${() => save({ [k]: !v[k] })}/><span>${label}</span></label>`;
  return html`<section class="card stack"><h2 class="h2">Warnings and Telegram alerts</h2>
    <div class="fields">
      <div class="field"><label class="lbl" for="wp">Warn when a prop rule is this % used</label>
        <input id="wp" class="inp" type="number" min="10" max="99" value=${v.warn_pct} onChange=${(e) => save({ warn_pct: e.target.value })}/></div>
      <div class="field"><label class="lbl" for="ah">Send summaries after (Brisbane hour)</label>
        <input id="ah" class="inp" type="number" min="0" max="23" value=${v.alert_daily_hour} onChange=${(e) => save({ alert_daily_hour: e.target.value })}/></div>
    </div>
    <div class="sub">Dashboard banners appear at this level; 90% shows as danger. Rule warnings are also sent to Telegram once per level per firm day.</div>
    ${!b.telegram ? html`<div class="warn"><div class="stack" style="gap:6px"><b>Telegram isn't set up yet</b>
      <span>1. In Telegram, message <b>@BotFather</b> → <i>/newbot</i> → copy the bot token.</span>
      <span>2. In your project folder run <span class="num">npx wrangler pages secret put TELEGRAM_BOT_TOKEN</span> and paste it (or add it under the Pages project → Settings → Variables and secrets).</span>
      <span>3. Redeploy (automatic if GitHub deploys are on), open your bot, press <b>Start</b>, then come back here.</span></div></div>`
    : html`<div class="hstack">${st.telegram_chat_id ? html`<span class="chip g">Connected to chat ${st.telegram_chat_id}</span>` : html`<span class="chip a">No chat yet</span>`}
        <button class="btn sm" disabled=${busy} onClick=${() => act('/alerts/find-chat', {}, (r) => 'Connected to ' + r.chat.name)}>Find my chat</button></div>
      <div class="sub">Open your bot in Telegram, press Start (or send any message), then “Find my chat”.</div>
      ${tog('alert_rules', 'Prop-rule warnings (warning, 90%, limit reached)')}
      ${tog('alert_daily', 'Daily summary of the previous trading day')}
      ${tog('alert_weekly', 'Weekly summary on Saturday')}
      <div class="hstack">${[['', 'Test message'], ['rules', 'Rule check now'], ['daily', 'Yesterday\'s summary'], ['week', 'Last 7 days']].map(([k, l]) => html`
        <button class="btn sm" disabled=${busy || !st.telegram_chat_id} onClick=${() => act('/alerts/test', { kind: k }, () => 'Sent')}>${l}</button>`)}</div>
      <div class="sub">Summaries go out with the first connector upload after the hour above, so a terminal must be running.</div>`}
  </section>`;
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
