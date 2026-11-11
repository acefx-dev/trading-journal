# Trade Journal — v1.6 (connector 1.02)

## Upgrading to v1.6: trade path (connector 1.02)

The push deploys automatically and runs migration `0007` (tables `sl_events` and `path_episodes`, setting `risk_grace_sec`). It also switches market sentiment to one overall bias. You can add separate markets back under Strategies → Market sentiment.

**Install connector 1.02 on every MT5 terminal** (FundingPips and both The5ers accounts):
1. Copy the new `mt5/TradeJournalConnector.mq5` over the old one in **File → Open Data Folder → MQL5 → Experts**.
2. Open it in MetaEditor and press **F7**. It should compile with 0 errors.
3. On each chart running the connector, right-click → **Expert list**, or just remove and re-attach it. Check that the inputs (URL, token) are still set. The status line on the chart should say `Trade Journal connector 1.02`, and Accounts & sync shows the version.

The EA is still read-only: it has no order functions. New in 1.02, checked once a second:
- **Stop-loss and size changes** on each open position, with the money at risk from the entry to the stop at that moment (0 once the stop is at or past the entry).
- **Drawdown and best point**: the lowest and highest combined floating P&L of all open positions of one symbol and side.

**What the journal does with it:**
- **Risk = the peak combined risk you held.** A higher combined risk that lasts less than **60 s** (Settings → Trade grouping) is ignored. That's the moment after a scale-in before you move the first stop: your $300 + $188.28 case counts as $300. If you leave it like that for longer, it counts as $488.28. R, the per-idea and daily limits and Analytics all use this. Trades without 1.02 data keep the old measure (the sum of each position's first stop).
- **Trade path tab** on each idea: worst and best point in R and dollars and when they happened, how much of the best you kept, and a timeline of the combined risk as stops moved.
- **Analytics → Trade path:** average heat on winners, how far losers went your way first, and how much of the best point winners kept.

Limits:
- Only trades from when 1.02 is running are covered.
- If the EA is restarted mid-trade, that trade's path is marked "recorded from part-way through".
- Partial closes drop out of the combined floating P&L, so the best point after a partial close is the remaining positions only.
- The EA hasn't been compiled here: press F7 and tell me about any error.


## Upgrading to v1.5: daily prep, sentiment, risk limits, linked accounts

The push deploys automatically and runs migration `0006` (risk limit columns, a `prep_sentiment` table and new settings). No Cloudflare step is needed and the connector EA is unchanged.

**Do these once:**
1. **Accounts & sync → each account → Edit → Max risk per trade idea / Max risk per day** (% of the initial account size), e.g. 0.6% on funded and 1% on challenges. The form shows the dollar amounts.
2. **Strategies → Market sentiment → Edit:** paste the prompt you use each morning. `{date}` and `{markets}` are filled in when you copy it. Markets default to JP225 and NAS100.
3. Optional: **Settings → Trade grouping:** the slippage tolerance (default 3%) and account linking (on, 5 minutes).

**What's new:**
- **Dashboard.** Daily preparation moves to the top of the right column. Step 1 is market sentiment: overall Bearish / Neutral / Bullish, a bias for JP225 and NAS100, what you checked, and a **Copy prompt** button. Step 2 is the checklist. The chip says how many steps are left, then **Ready to trade**. The economic calendar moves to the middle column.
- **Market hours** is a compact timeline in Brisbane time. Drag across the bars to check any time of day: the readout shows which sessions are open then and each city's local time. **Now** jumps back. The dashed line is the current time.
- **Risk limits.** Every idea is checked against each account's per-idea limit, and each Brisbane day's ideas against the daily limit (in the order they were opened). Up to the tolerance over the limit is fine (a $300 limit is a violation above $309). Over that, the idea shows **Over risk limit**, the Positions tab lists every account's check, and Analytics counts it as a broken rule even before you review it. Account cards on the dashboard show today's risk against the daily limit.
- **One review for the same trade on two accounts.** A trade you place by hand on another account that isn't a copier copy (e.g. FundingPips alongside The5ers), with the same instrument and direction within 5 minutes of the first entry, joins the same idea. The header shows “N accounts · one review”. If two unrelated trades were joined, use **Separate** on the Positions tab. Copier copies still link by their `TC:` comment as before. Linking applies to trades synced from now on.
- **Trade ideas:** a rating filter (5 only, 4 and up, 3 and up, 2 or less, not rated). The header shows whether the trade was with or against that day's bias.
- **Analytics:** a Sentiment filter and a Bias breakdown, plus a “Trading with your bias” panel.

**Still to come (needs connector 1.02):**
- Risk is still the sum of each position's initial stop. A scale-in where you moved the first stop to stay inside $300 can still read higher (the 488.28 case) until the connector reports stop changes. The next update measures peak combined open risk instead.
- That update also adds drawdown and best point during the trade (MAE/MFE in R).


## Upgrading to v1.4: read-only share links

The push deploys automatically and adds the `share_links` table (migration `0005`). **One Cloudflare step is needed** so people can open a link without your login:

1. Zero Trust → **Access → Applications → Add an application → Self-hosted.**
2. Name: `Trade Journal shared pages`. Domain: your site (e.g. `trading-journal-btf.pages.dev`), **Path: `share`**. If you use a custom domain, add it too, also with path `share`.
3. Policy: action **Bypass**, Include → **Everyone**. Save.
4. Test it: make a link (below), then open it in a **private/incognito** window. You should see the read-only page, not the Cloudflare login.

Only addresses starting with `/share/` are opened up. Everything else, including the whole `/api/`, still needs your login. A shared page only reads from the one account its link was made for.

**Making a link:** Accounts & sync → pick the account → **Share** → **New link**.
- **Name shown on the page.** It defaults to the account name; change it if you'd rather not show that.
- **Expiry:** never, 1, 7, 30 or 90 days.
- **What to show:**
  - Dollar amounts. Off means percentages of account size and R only, and no dollar figure is sent to the page at all.
  - The trade list.
  - Notes, screenshots and chart links. Off by default.
  - Open trades. Off by default.
  - Prop firm name and rule progress.
- The link is copied straight away. Each link shows its views and when it was last opened.
- You can change what it shows at any time, and the change applies to links already sent.
- **Turn off** stops a link at once, and turning it back on restores the same address. **Delete** removes it for good.

**Never shown on a shared page:** your MT5 login and server, connector tokens, your email, other accounts, mistakes, ratings or checklists. Shared pages aren't indexed by search engines and don't pass the link to sites they link to.

Also in v1.4: each trade idea has an **Add screenshot** button in its header, the tab is now called **Screenshots & charts** (with a count), and pasting an image (Ctrl+V) works from any tab of an idea.

## Upgrading to v1.3

Nothing to do if automatic deploys are on (below): the push runs the tests, applies migration `0004` and deploys. Otherwise run `npm run db:migrate` then `npm run deploy`. The MT5 connector is unchanged.

**New in v1.3**
- **New look.** An icon rail replaces the sidebar; hover an icon for its name. On a large desktop (1280 px wide and 720 px tall or more) the Dashboard, Trade ideas, Calendar, Strategies and Accounts pages fit one screen and their panels scroll inside. Smaller screens scroll as before, and phones keep the bottom tabs.
- **Dashboard.**
  - Key figures run in one strip across the top, with a short warning in the header when an account is near a prop rule.
  - The **Economic calendar** is the Myfxbook widget (high impact, 8 currencies). It's shown dark by default; **Light** switches back to Myfxbook's own colours.
  - The **Accounts** list follows the account selector at the top right, puts the account closest to a limit first, and scrolls when you have many accounts.
  - **Market sessions** is a 24-hour timeline in Brisbane time with a "now" line and when the next session opens.
  - **Profit split calculator.** Choose an account and its split and profit since the last payout fill in, or type any amount. You can override the split (80/85/90/100%). The result is in AUD (or NZD) at the European Central Bank's daily USD rate, refreshed every 6 hours; you can type your own rate instead.
- **One daily preparation list for every strategy.** Your old per-strategy daily lists were merged into one: same labels became one item, and history was kept. Edit it on the Strategies page. Past days stay as they were recorded.
- **Payouts per account.** Accounts & sync → an account → **Payouts**: profit split %, last payout date and the currency you're paid in. "Profit since payout" counts closed trades after that date.
- **Trade ideas.** The list (search, status, strategy, period) sits next to the selected idea's review, which has tabs: Review, Positions & accounts, Charts & links and Activity. The arrows step through the list, and "Mark reviewed" is in the header.
- **Analytics filters.**
  - Date presets, plus a Filters panel for symbol, market, strategy, session, direction, outcome and mistakes.
  - Advanced filters: date (all, last N days, since, range), weekday, entry hour, hold time and minimum rating.
  - Rule compliance: all trades, with violations, or fully compliant. "Only trades that broke any of …" filters by a checklist item left unticked on a reviewed idea.
  - Save a filter by name; saved filters are kept on the server.
- **Analytics results.** These follow the filter:
  - Key figures and a cumulative R or $ curve.
  - "Patterns in this selection": your strongest and weakest groups with 4 or more ideas.
  - A weekday × entry-hour map of average R.
  - A breakdown table you can group by strategy, symbol, market, session, weekday, hour, hold time, side, month or rating.
  - R distribution, rules followed vs broken, and costliest mistakes.
- **Strategies.** Each strategy has a playbook (setup, entry, stop loss, exit) and its own per-trade checklist, which you can reorder. Its card shows its last 3 months.

## Upgrading to v1.2

**Once only: turn on automatic deploys** (then every update I push goes live by itself, including database changes):
1. Cloudflare dashboard → **My Profile → API Tokens → Create Token → Custom token**.
   - Permissions: **Account → Cloudflare Pages → Edit** and **Account → D1 → Edit**. Account resources: your account.
   - Create it and copy the token.
2. Cloudflare dashboard → **Workers & Pages** → copy your **Account ID** (right-hand side).
3. GitHub → `acefx-dev/trading-journal` → **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_API_TOKEN` = the token
   - `CLOUDFLARE_ACCOUNT_ID` = the account ID
4. GitHub → **Actions** → *Test and deploy* → **Run workflow**. It runs the tests, applies new migrations (v1.2 adds `0003`), and deploys.

Until the secrets are in, deploy by hand as before: `npm run db:migrate` then `npm run deploy`.

**New in v1.2**
- **Session times fixed.** Each session now uses its own city's local hours (Sydney 07–16, Tokyo 09–18, London 08–17, New York 08–17), so daylight saving is handled. Today in Brisbane that's Tokyo 10:00–19:00, London 18:00–03:00 and New York 23:00–08:00. Trades in an overlap count for the session that opened last. Analytics shows the day's Brisbane times.
- **Prop-rule monitor.** For each account: daily loss used since the firm's reset, room to the max-loss floor (static or trailing), and progress to the profit target.
  - Bars on the dashboard and on Accounts & sync, plus a banner when a rule passes the warning level (default 70%; 90% shows as danger).
  - Set each account's reset (broker server time, UTC, New York 17:00 …) and how its daily loss is measured under **Edit**.
  - It only warns. Risk Guard Rail and the copier still enforce the limits.
- **Review page.** Week or month, with:
  - Net, win rate, expectancy, checklist and daily-prep compliance, and costs.
  - Results by day, best and worst ideas, instruments and strategies, and mistakes.
  - Your goals, what went well and what to improve (saved automatically).
- **Telegram alerts** (optional, see section 8): rule warnings, a daily summary and a Saturday weekly summary.
- **Import old history.** Accounts & sync → **Import** on an account. Load an MT5 history report (HTML) or a CSV, check the preview, then import. If the connector later sends the same positions, its real deals replace the imported ones, so nothing is counted twice.

## Upgrading from v1.0 to v1.1

```powershell
npm run db:migrate     # adds the chart-links table, screenshot timeframes and the default-view setting
npm run deploy
```

Your existing TradingView link on each idea is kept: it moves into the new links list. The EA doesn't change in v1.1.

**New in v1.1**
- **Account groups:** the account filter now has *All funded accounts* and *All challenge accounts* (and personal/demo if you have them). Groups follow each account's **Type**.
- **Default view:** Settings → Default view sets the account or group the journal opens on.
- **Setup windows:** clicking outside them no longer closes them. Escape or the X asks before throwing away changes.
- **Layout:** uses the full width of large screens. On the dashboard, the side boxes (Daily preparation, Accounts) line up in one column. The chart draws at its real size.
- **Trade lists:** an exit date/time and a **Duration** column. The Trade ideas page also has a **Costs** column.
- **Costs:** every position, account and idea shows gross P&L, commission, swap, fees and net. Analytics and the Trade ideas page total them. The CSV export has them too, plus the duration.
- **Charts:** you can add several TradingView links per idea, each with a timeframe and a note. Snapshot links (`tradingview.com/x/…`) show a preview. Screenshots also have a timeframe and a note.


A personal trading journal that runs on your Cloudflare account. Trades sync from every MT5 account in near real time, related positions are grouped into **trading ideas**, and copies made by your Trade Copier are linked to their Master trade.

```
MT5 terminal ──(TradeJournalConnector EA, read-only, HTTPS)──► Cloudflare Pages Functions ──► D1 database
                                                                        │                         R2 (screenshots)
You (browser / phone) ──(Cloudflare Access login)──────────────────────┘
```

| Part | Where | What it is |
|---|---|---|
| `public/` | Cloudflare Pages | The app (Preact, no build step) |
| `functions/` + `src/` | Cloudflare Pages Functions | The API: sync, grouping, statistics |
| `migrations/` | Cloudflare D1 | Database schema |
| `mt5/TradeJournalConnector.mq5` | Each MT5 terminal | Read-only connector EA |
| `test/` | Your PC | Unit tests, connector simulation, screenshot script |

## What has and hasn't been tested

**v1.3 tested here:** migration `0004` on a database with v1.2 data; the connector simulation, extended with the shared prep list, payouts, playbooks, saved filters and the analytics feed; every page in headless Chrome at 1440×900, 1100 px and phone width with no app errors. **Not tested:** the Myfxbook widget and the live currency rate (my workspace has no outside network), so check both once deployed. If the rate can't be fetched, the calculator asks you for one.

**Tested here** (Linux, Node 22, Wrangler 4 local mode with a local D1 database and local R2):
- 16 unit tests: Brisbane day boundaries, broker server time → UTC (incl. US daylight saving), symbol names, building positions from deals, grouping rules, copy matching, statistics (`npm test`).
- A connector simulation that sends the same JSON the EA sends (`npm run test:connector`): duplicate deals ignored; a copy arriving before its Master waits, then links; an add joins the idea; an unrelated trade stays separate; R = 1.88 as expected; manual remove/add of positions; adding an unrelated trade refused; the daily check finds a missing deal; a token used on the wrong login is refused.
- Sample data loaded through the same pipeline; every page opened in Chrome (desktop and phone width) with no console errors; screenshot upload/download through R2.

**Not tested:**
- **The EA has not been compiled.** I don't have MetaEditor. Compile it (F7) and send me any error word for word.
- The real Cloudflare deployment and the **Cloudflare Access** login check. The code verifies Access tokens (signature, audience, expiry, issuer), but that path only runs once deployed.
- Real broker data (symbol names, commissions, server time offsets).

## 1. One-time setup (about 20 minutes)

You need **Node.js 20 or newer** (nodejs.org, LTS). Open a terminal (PowerShell) in `D:\Project\Trading Journal`.

```powershell
npm install
npx wrangler login            # opens the browser, sign in to Cloudflare
```

### 1a. Database (already created)
I created the D1 database **trading-journal** in your Cloudflare account (location: Oceania). Its ID is already in `wrangler.toml`. Create the tables:

```powershell
npm run db:migrate
```

### 1b. Screenshot storage (R2)
R2 isn't switched on in your account yet. In the Cloudflare dashboard: **R2 Object Storage → Enable / Purchase R2** (there is a free monthly allowance; Cloudflare may ask for a payment method). Then:

```powershell
npx wrangler r2 bucket create trading-journal-screenshots
```

If you'd rather skip screenshots for now, delete the `[[r2_buckets]]` block in `wrangler.toml`. Everything else works; uploads say storage isn't set up.

### 1c. Deploy the app

```powershell
npx wrangler pages project create trading-journal --production-branch main
npm run deploy
```

Your site is at **https://trading-journal.pages.dev** (Wrangler prints the exact address). **Until you finish step 1d, the API refuses every request** ("Login is not configured"), so nothing is exposed.

### 1d. Login with Cloudflare Access
1. Dashboard → **Zero Trust** (pick a team name if asked; the free plan is enough). Note your team domain, e.g. `yourteam.cloudflareaccess.com`.
2. **Access → Applications → Add an application → Self-hosted.**
   - Name: `Trade Journal`. Domain: `trading-journal.pages.dev` (no path).
   - Policy: **Allow**, Include → **Emails** → your email address.
   - Save, open the application again and copy the **Application Audience (AUD) Tag**.
3. Add a **second** self-hosted application for the connector:
   - Name: `Trade Journal connector`. Domain: `trading-journal.pages.dev`, **Path: `api/ingest`**.
   - Policy: action **Bypass**, Include → **Everyone**.
   - This lets the MT5 connector reach `/api/ingest` without a browser login. That one address only accepts uploads with a valid per-account connector token, and a token only works for its own MT5 login.
4. In `wrangler.toml`, under `[vars]`, set:
   ```toml
   ACCESS_TEAM_DOMAIN = "yourteam.cloudflareaccess.com"
   ACCESS_AUD = "the AUD tag you copied"
   ALLOWED_EMAILS = "you@example.com"   # optional extra lock
   ```
5. `npm run deploy` again. Open the site: Cloudflare asks for your email and sends a one-time code.
6. **Test the Bypass rule:** open `https://<your site>/api/ingest` in a **private/incognito** window. You must see `{"ok":true,"message":"Connector endpoint reachable…"}` **without** a login page. If you get the Cloudflare Access login instead, the connector can't get through either (MT5 shows `MT5 web error 1004` or similar).

> If you later add a custom domain, add it to both Access applications too.

## 2. Connect each MT5 account

In the app: **Accounts & sync**.
1. **+ Prop firm** (FundingPips, The5ers…) and **+ MT5 account** for each login.
   - Your trading account: role **Master**.
   - Each copier Slave: role **Copy**, "Copies trades from" = the Master.
   - Any other account: **Standalone**.
   - Enter size, daily/max loss and target. These are for display and statistics only; Risk Guard Rail and the copier still enforce your limits.
2. Press **Connect** on the account and follow the steps on screen:
   - **Create token** (shown once; copy it).
   - In that terminal: **Tools → Options → Expert Advisors → Allow WebRequest for listed URL** → add `https://trading-journal.pages.dev`.
   - Copy `TradeJournalConnector.mq5` to **File → Open Data Folder → MQL5 → Experts**, open it in MetaEditor, press **F7**.
   - Open **a new chart just for the connector** (any symbol), attach the EA, paste the URL (`https://…/api/ingest`) and the token.
3. The chart shows `OK | n deal(s) … sent`. The first upload sends the last 90 days (in batches of 200), so history appears within a minute.

Do this on **every** terminal: the Master and each Slave. The connector can run next to Risk Guard Rail and the Trade Copier; it never trades.

### Connector inputs

| Input | Default | Meaning |
|---|---|---|
| Journal upload URL | — | `https://<your site>/api/ingest` |
| Connector token | — | From the Accounts page. One token per account |
| CF-Access-Client-Id / Secret | empty | Only if you use an Access **service token** instead of the Bypass rule |
| Send every N s while positions are open | 15 | Floating P&L updates |
| Send every N s when flat | 60 | Heartbeat |
| First run: days of history | 90 | |
| Daily check: days compared | 35 | Once a day: every deal ticket is compared; missing deals are requested and sent |

Any trade event (fill, close, S/L change) triggers an upload within about 1 second.

## 3. How the data works

**Source of truth = MT5 deals.**
- Each deal is stored once, keyed by its MT5 deal ticket, and never edited.
- Positions are rebuilt from their deals every time, keeping the original position ID.
- The audit trail (Accounts & sync, and each idea) logs every import, link, regroup and edit.

**Time.**
- Everything is stored in UTC and shown in **Australia/Brisbane**.
- The connector sends the broker's server time plus its current offset from UTC.
- For brokers on UTC+2/+3, the journal assumes the usual "New York close" rule (+3 while the US is on daylight saving), so older deals are converted correctly. If your broker is a fixed UTC+3 all year, set the account's *Broker server time* to **Fixed** (Edit → Advanced).
- A day's P&L is counted on the Brisbane day each idea **closed**. A New York trade that closes after midnight counts on the next day.

**Trade grouping** (Settings → Trade grouping):
- A Master or standalone position joins an existing idea only if it's the **same account, instrument and direction**, opened **within 30 minutes of the idea's first position**, and (by default) **another position of that idea was still open**. Otherwise it starts a new idea.
- Different instruments, directions or accounts are never combined. The app refuses to add one by hand too.
- **Copies** follow their Master position:
  - first by the copier's `TC:<Master position ID>` comment;
  - if a broker removed the comment, by the closest Master position with the same instrument and direction within 60 seconds.
- A copy that arrives before its Master waits and links when the Master arrives.
- A trade you place by hand on a Copy account becomes its own idea.
- On an idea you can **Remove** a position (it and its copies move to a new idea), **Add position**, or **Unlink** a wrongly matched copy. Positions you move by hand are never regrouped automatically.
- **Symbol names** (Settings): JPN225, JP225.cash and NIKKEI225 all map to JP225, and USTEC/US100 map to NAS100. Suffixes like `.cash` and `m` are handled automatically. Add your brokers' names if needed.

**R and money.**
- **R** = the idea's P&L ÷ the money at risk at the **initial** stop-loss, on the Master (lead) account.
- The EA works out the risk with MT5's own `OrderCalcProfit` for that symbol and account currency, so broker contract sizes are respected. For history, it uses today's conversion rate for cross-currency symbols, which is a small approximation.
- If a position never had a stop-loss when the connector saw it, R is shown as "—" and left out of R statistics. It's never guessed.
- **Dollars** follow the account filter: "All accounts" = combined, or pick one account.
- Win/loss is decided by the lead account's result, so the combined and Master views agree.

**Daily checklists.**
- One record per item per **Brisbane day**, so the reset at 12:00 AM happens on its own.
- Past days are kept exactly as they were (labels included) and are read-only.
- Removing an item hides it from new days but keeps it in history.

**Costs.**
- Commission, swap and fees come from each MT5 deal: `DEAL_COMMISSION`, `DEAL_SWAP` and `DEAL_FEE`.
- **Gross** is the trading result before costs, and **net = gross + commission + swap + fees** (costs are negative).
- An open position's swap is included in its floating P&L, and shows up separately once the position closes.

**Sample data.**
- Settings → Load sample data, or "Sample" in the menu.
- It's stored in separate, flagged accounts (`is_sample`), runs through the same sync pipeline, and never appears in "My data".
- Delete it any time.

## 4. Running costs and limits

For personal use this should fit Cloudflare's free tiers. Check Cloudflare's current pricing pages, since limits change.
- Three connected terminals send roughly 4,000–20,000 uploads per day, depending on how long positions are open.
- Each upload writes a few database rows.
- If you connect many more accounts, raise the "when flat" interval to 120 s.

## 5. Updating and local testing

```powershell
npm test                       # unit tests
copy .dev.vars.example .dev.vars
npm run dev                    # local app at http://127.0.0.1:8788 with a local database
npm run test:connector         # (second terminal) simulate the MT5 connector
```

- A schema change comes as a new file in `migrations/`; run `npm run db:migrate`, then `npm run deploy`.
- To update the EA, copy the new `.mq5` over the old one and press F7. Its sync position is kept per login in MT5's Global Variables (`TJC_<login>_ack`), so nothing is re-sent unnecessarily. Re-sent deals would be ignored anyway.

## 6. Troubleshooting

| Chart / app says | Fix |
|---|---|
| `MT5 blocks the web address…` | Add the site URL in Tools → Options → Expert Advisors → Allow WebRequest |
| `Cloudflare Access sent a login page…` or `MT5 web error 1001/1003/1004` | Access is redirecting the connector to its login page. In Zero Trust → Access → Applications → *Trade Journal connector* → **Policies**: the policy's **Action must be Bypass** (not Allow), Include **Everyone**, and the policy must be attached to that application. It needs a destination for **each** address you use (e.g. `journal.acefx.nz/api/ingest` and `….pages.dev/api/ingest`). Then run the private-window test in step 1d.6 |
| `HTTP 403 from Cloudflare` | Security → Bots: turn off **Bot Fight Mode** for the domain, or add a WAF skip rule for the path `/api/ingest` |
| `Unknown connector token` | The token was replaced. Paste the newest one from Accounts → Connection |
| `This token is for login …` | That token belongs to another account. Each terminal needs its own token |
| App: "Login is not configured" | Set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, then deploy again |
| A copy shows as its own idea | Its comment had no `TC:` and no Master position matched within 60 s. Use **Add position** on the right idea, or check the account's role/Master |
| Times off by one hour on old trades | Set the account's Broker server time to **Fixed** |

## 8. Telegram alerts (optional)

1. In Telegram, message **@BotFather** → `/newbot` → choose a name. Copy the **bot token**.
2. In your project folder: `npx wrangler pages secret put TELEGRAM_BOT_TOKEN` and paste the token. Or in the dashboard: Workers & Pages → trading-journal → Settings → **Variables and secrets** → add a *secret* named `TELEGRAM_BOT_TOKEN`.
3. Deploy again (automatic with GitHub deploys: re-run the workflow).
4. Open your new bot in Telegram and press **Start**. In the journal: **Settings → Warnings and Telegram alerts → Find my chat**. You get a "Connected" message.
5. Choose which alerts you want, and use the test buttons.

| Alert | When |
|---|---|
| Prop-rule warning | A rule passes the warning level, 90%, or 100%. Once per level per account per firm day |
| Daily summary | The previous Brisbane trading day (Mon–Sat), after the hour you choose (default 07:00) |
| Weekly summary | Monday to Saturday morning, sent from Saturday at that hour |

Cloudflare Pages has no timer, so alerts go out with the **next connector upload** (every 15–60 s while a terminal runs). With every terminal closed, nothing is sent until one starts again.

## 9. Importing old history

- **MT5 report:** Toolbox → **History** → right-click → choose the period (*All History* or a custom one) → right-click → **Report → HTML**. Then in the journal: Accounts & sync → **Import** on that account. MT5 saves the report as UTF-16 and the journal reads it.
- **CSV** instead: a header row with `position, symbol, type, volume, open_time, open_price, sl, tp, close_time, close_price, commission, swap, profit`. Times as `2026.11.06 09:14:03`, in broker server time.
- Pick the report's **server time**: UTC+2/+3 (most brokers) or a fixed offset.
- Limits of a report: it shows each position's **final** S/L, so R for imported trades is estimated from the trade's own P&L per point, and trades without a S/L get no R. It has no copier comments, so imported copies are matched to their Master by symbol, direction and time (60 s).
- I tested the reader on a report I built in MT5's layout. If your real report isn't read, send it to me and I'll adjust the reader.

## 7. Known limits

- **Read-only is by design, not enforced by the broker.** The connector contains no order code. A broker-enforced guarantee would need a separate terminal per account logged in with the **investor password**. That's possible, but not with the same terminal that runs Risk Guard Rail and the copier.
- **The journal only sees what a running terminal sends.** If the PC is off, trades appear when the terminal starts again (history catch-up).
- **Prop-firm rules are shown, not enforced.** The journal can't know exactly how each firm measures daily loss.
- **Netting accounts:** position reversals (in/out deals) are handled approximately. Prop accounts are usually hedging accounts, which are fully supported.
- **Drawdown** is measured on closed trades (the balance curve), not intraday equity.
