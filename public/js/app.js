import { html, render, useState, useEffect, useStore, setStore, store, api, Icon, fmt, online, toast, reloadBoot } from './lib.js';
import { Dashboard } from './pages/dashboard.js';
import { Ideas } from './pages/ideas.js';
import { Calendar } from './pages/calendar.js';
import { Strategies } from './pages/strategies.js';
import { Accounts } from './pages/accounts.js';
import { Analytics } from './pages/analytics.js';
import { Settings } from './pages/settings.js';
import { Review } from './pages/review.js';
import { Floor } from './pages/floor.js';

const NAV = [
  ['#/', 'Dashboard', 'dash'], ['#/floor', 'Trading Floor', 'floor'], ['#/ideas', 'Trade ideas', 'ideas'], ['#/calendar', 'Calendar', 'cal'],
  ['#/strategies', 'Strategies', 'strat'], ['#/analytics', 'Analytics', 'ana'], ['#/review', 'Review', 'review'], ['#/accounts', 'Accounts & sync', 'acct'],
];
// pages that fit one screen on a large desktop (their panels scroll inside)
const FIT = ['/', '/floor', '/ideas', '/calendar', '/strategies', '/accounts'];
const TABS = [['#/', 'Home', 'dash'], ['#/floor', 'Floor', 'floor'], ['#/ideas', 'Ideas', 'ideas'], ['#/calendar', 'Calendar', 'cal'], ['#/analytics', 'Stats', 'ana']];

function useRoute() {
  const [r, setR] = useState(location.hash || '#/');
  useEffect(() => { const f = () => { setR(location.hash || '#/'); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}

function App() {
  const s = useStore();
  const route = useRoute();
  const [err, setErr] = useState(null);
  useEffect(() => { reloadBoot().catch((e) => setErr(e.message)); }, [s.mode]);

  if (err) return html`<div class="content"><div class="warn err">${err}</div></div>`;
  if (!s.boot) return html`<div class="boot">Loading your journal…</div>`;

  const path = route.replace(/^#/, '') || '/';
  const seg = path.split('/').filter(Boolean);
  let page;
  if (!seg.length) page = html`<${Dashboard}/>`;
  else if (seg[0] === 'ideas') page = html`<${Ideas} id=${seg[1] || null}/>`;
  else if (seg[0] === 'calendar') page = html`<${Calendar}/>`;
  else if (seg[0] === 'strategies') page = html`<${Strategies}/>`;
  else if (seg[0] === 'accounts') page = html`<${Accounts}/>`;
  else if (seg[0] === 'analytics') page = html`<${Analytics}/>`;
  else if (seg[0] === 'settings') page = html`<${Settings}/>`;
  else if (seg[0] === 'review') page = html`<${Review}/>`;
  else if (seg[0] === 'floor') page = html`<${Floor}/>`;
  else page = html`<div class="empty">Page not found. <a href="#/">Go to the dashboard</a></div>`;

  const active = (href) => (href === '#/' ? path === '/' : path.startsWith(href.slice(1)));
  const accts = s.boot.accounts.filter((a) => a.status === 'active');
  const on = accts.filter(online).length;
  const lastSeen = Math.max(0, ...accts.map((a) => a.last_seen || 0));
  const noData = s.mode === 'live' && !accts.length;

  const fit = FIT.some((f) => (f === '/' ? path === '/' : path.startsWith(f))) && !noData;
  return html`
  ${s.mode === 'sample' && html`<div class="sample-bar"><b>Sample data.</b> Everything you see is made up, kept apart from your real trades.
    <button class="btn sm" onClick=${() => setStore({ mode: 'live' })}>Switch to my real data</button></div>`}
  <div class="app" style=${s.mode === 'sample' ? '--bar:33px' : ''}>
    <nav class="rail" aria-label="Main">
      <a href="#/" class="logo" aria-label="Trade Journal home" style="color:var(--bg)"><${Icon} name="ana" size=${18}/></a>
      ${NAV.map(([href, label, ic]) => html`<a href=${href} class=${active(href) ? 'on' : ''} aria-current=${active(href) ? 'page' : null} aria-label=${label}><${Icon} name=${ic} size=${20}/><span class="tip" aria-hidden="true">${label}</span></a>`)}
      <div class="rail-foot">
        <a href="#/settings" class=${active('#/settings') ? 'on' : ''} aria-label="Settings"><${Icon} name="gear" size=${20}/><span class="tip" aria-hidden="true">Settings</span></a>
        <a href="#/accounts" class="rail-mt5" aria-label=${s.mode === 'sample' ? 'Sample accounts' : !accts.length ? 'No MT5 accounts yet' : `MT5 connector: ${on} of ${accts.length} online, last contact ${fmt.ago(lastSeen)}`}>
          <span class="dot" style=${`background:${!accts.length || s.mode === 'sample' ? 'var(--dim)' : on === accts.length ? 'var(--pos)' : on ? 'var(--amber)' : 'var(--neg)'};box-shadow:0 0 0 3px rgba(61,214,140,.12)`}></span>MT5
          <span class="tip" aria-hidden="true">${s.mode === 'sample' ? 'Sample accounts' : !accts.length ? 'No MT5 accounts yet' : `MT5: ${on} of ${accts.length} online · ${fmt.ago(lastSeen)}`}</span></a>
      </div>
    </nav>
    <main class=${'content' + (fit ? ' fit' : '')} id="main">${noData && !path.startsWith('/accounts') && !path.startsWith('/settings') ? html`<${Welcome}/>` : page}</main>
  </div>
  <nav class="tabbar" aria-label="Main">${TABS.map(([href, label, ic]) => html`<a href=${href} class=${active(href) ? 'on' : ''}><${Icon} name=${ic} size=${20}/><span>${label}</span></a>`)}</nav>
  ${s.toast && html`<div class=${'toast' + (s.toast.bad ? ' bad' : '')} role="status">${s.toast.msg}</div>`}`;
}

function Welcome() {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const loadSample = async () => {
    setBusy(true);
    try {
      setStore({ mode: 'sample' });
      if (!s.boot.sampleLoaded) { await api('/sample', { method: 'POST' }); }
      await reloadBoot();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  return html`<div class="card stack" style="max-width:720px;margin:6vh auto;padding:32px;gap:18px">
    <h1 class="h1">Welcome to your trade journal</h1>
    <p class="mut" style="margin:0;line-height:1.6">Connect your MT5 accounts and every trade appears here within seconds, grouped into trading ideas,
      with copies on your other accounts linked to their Master trade. The connector only reads; it never trades.</p>
    <div class="hstack">
      <a class="btn pri" href="#/accounts">Connect your first MT5 account</a>
      <button class="btn" disabled=${busy} onClick=${loadSample}>${busy ? 'Loading…' : 'Explore with sample data'}</button>
    </div>
    <div class="sub">Sample data is stored separately and never mixes with your real trades. Switch with “My data / Sample” in the menu.</div>
  </div>`;
}

render(html`<${App}/>`, document.getElementById('app'));
