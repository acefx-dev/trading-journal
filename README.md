# Trade Journal — v1.0.1 (connector 1.01)

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

## 7. Known limits

- **Read-only is by design, not enforced by the broker.** The connector contains no order code. A broker-enforced guarantee would need a separate terminal per account logged in with the **investor password**. That's possible, but not with the same terminal that runs Risk Guard Rail and the copier.
- **The journal only sees what a running terminal sends.** If the PC is off, trades appear when the terminal starts again (history catch-up).
- **Prop-firm rules are shown, not enforced.** The journal can't know exactly how each firm measures daily loss.
- **Netting accounts:** position reversals (in/out deals) are handled approximately. Prop accounts are usually hedging accounts, which are fully supported.
- **Sessions** in Analytics are fixed Brisbane hours (Tokyo 08–16, London 16–22, New York 22–06). They shift by an hour when London/New York change their clocks.
- **Drawdown** is measured on closed trades (the balance curve), not intraday equity.
