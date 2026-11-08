"""Load each page of the local journal in Chrome, collect console errors, save screenshots."""
import sys, os, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8788'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/shots'
os.makedirs(OUT, exist_ok=True)
pages = sys.argv[3].split(',') if len(sys.argv) > 3 else ['', 'ideas', 'calendar', 'strategies', 'accounts', 'analytics', 'settings']
mobile = os.environ.get('MOBILE') == '1'

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 1000}, device_scale_factor=1)
    page = ctx.new_page()
    errors = []
    page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
    ctx.add_init_script("if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x','1'); localStorage.setItem('tj.state', JSON.stringify({mode: '%s', acct: 'all', firm: 'all'})); }" % os.environ.get('MODE', 'sample'))
    for name in pages:
        page.goto(BASE + '/#/' + name)
        page.reload()
        page.wait_for_timeout(1800)
        fn = os.path.join(OUT, (name.replace('/', '_') or 'dashboard') + ('_m' if mobile else '') + '.png')
        page.screenshot(path=fn, full_page=True)
        txt = page.inner_text('main') if page.query_selector('main') else page.inner_text('body')
        print('==', name or 'dashboard', '| errors so far:', len(errors), '|', txt[:160].replace('\n', ' | '))
    for e in errors[:30]:
        print(e)
    b.close()
