import { html, render, useState, useEffect, useStore, setStore, store, api, Icon, fmt, online, toast, reloadBoot } from './lib.js';
import { Dashboard } from './pages/dashboard.js';
import { Ideas, IdeaDetail } from './pages/ideas.js';
import { Calendar } from './pages/calendar.js';
import { Strategies } from './pages/strategies.js';
import { Accounts } from './pages/accounts.js';
import { Analytics } from './pages/analytics.js';
import { Settings } from './pages/settings.js';
import { Review } from './pages/review.js';

const NAV = [
  ['#/', 'Dashboard', 'dash'], ['#/ideas', 'Trade ideas', 'ideas'], ['#/calendar', 'Calendar', 'cal'],
  ['#/strategies', 'Strategies', 'strat'], ['#/review', 'Review', 'review'], ['#/accounts', 'Accounts & sync', 'acct'], ['#/analytics', 'Analytics', 'ana'],
  ['#/settings', 'Settings', 'gear'],
];
const TABS = [['#/', 'Home', 'dash'], ['#/ideas', 'Ideas', 'ideas'], ['#/calendar', 'Calendar', 'cal'], ['#/strategies', 'Checklists', 'strat'], ['#/analytics', 'Stats', 'ana']];

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
  else if (seg[0] === 'ideas' && seg[1]) page = html`<${IdeaDetail} id=${seg[1]} key=${seg[1]}/>`;
  else if (seg[0] === 'ideas') page = html`<${Ideas}/>`;
  else if (seg[0] === 'calendar') page = html`<${Calendar}/>`;
  else if (seg[0] === 'strategies') page = html`<${Strategies}/>`;
  else if (seg[0] === 'accounts') page = html`<${Accounts}/>`;
  else if (seg[0] === 'analytics') page = html`<${Analytics}/>`;
  else if (seg[0] === 'settings') page = html`<${Settings}/>`;
  else if (seg[0] === 'review') page = html`<${Review}/>`;
  else page = html`<div class="empty">Page not found. <a href="#/">Go to the dashboard</a></div>`;

  const active = (href) => (href === '#/' ? path === '/' : path.startsWith(href.slice(1)));
  const accts = s.boot.accounts.filter((a) => a.status === 'active');
  const on = accts.filter(online).length;
  const lastSeen = Math.max(0, ...accts.map((a) => a.last_seen || 0));
  const noData = s.mode === 'live' && !accts.length;

  return html`
  ${s.mode === 'sample' && html`<div class="sample-bar"><b>Sample data.</b> Everything you see is made up, kept apart from your real trades.
    <button class="btn sm" onClick=${() => setStore({ mode: 'live' })}>Switch to my real data</button></div>`}
  <div class="app">
    <aside class="side">
      <div class="brand"><div class="logo"><${Icon} name="ana" size=${16}/></div><span>Trade Journal</span></div>
      <nav class="nav" aria-label="Main">${NAV.map(([href, label, ic]) => html`<a href=${href} class=${active(href) ? 'on' : ''} aria-current=${active(href) ? 'page' : null}><${Icon} name=${ic}/><span>${label}</span></a>`)}</nav>
      <div class="side-foot">
        <a href="#/accounts" class="card" style="padding:14px;display:flex;flex-direction:column;gap:8px;color:inherit">
          <span class="hstack" style="font-size:13px;font-weight:600"><span class="dot" style=${`background:${!accts.length || s.mode === 'sample' ? 'var(--dim)' : on === accts.length ? 'var(--pos)' : on ? 'var(--amber)' : 'var(--neg)'}`}></span>
            ${s.mode === 'sample' ? 'Sample accounts' : !accts.length ? 'No MT5 accounts yet' : `MT5 connector: ${on} of ${accts.length} online`}</span>
          <span class="sub">${s.mode === 'sample' ? 'Made-up accounts, not connected' : 'Read-only · last contact ' + fmt.ago(lastSeen)}</span>
        </a>
        <div class="seg" role="group" aria-label="Data shown">
          <button class=${s.mode === 'live' ? 'on' : ''} onClick=${() => setStore({ mode: 'live' })}>My data</button>
          <button class=${s.mode === 'sample' ? 'on' : ''} onClick=${() => setStore({ mode: 'sample' })}>Sample</button>
        </div>
        <div class="sub" style="padding:0 6px;line-height:1.5">Times in Australia/Brisbane · checklists reset 12:00 AM</div>
      </div>
    </aside>
    <main class="content" id="main">${noData && !path.startsWith('/accounts') && !path.startsWith('/settings') ? html`<${Welcome}/>` : page}</main>
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
