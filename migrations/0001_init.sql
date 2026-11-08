-- Trading Journal schema (Cloudflare D1 / SQLite)
-- All times are UTC epoch milliseconds. Brisbane dates (YYYY-MM-DD) are stored only where a
-- "trading day" is the key (daily checklists). Money is in the account currency.

PRAGMA foreign_keys = ON;

CREATE TABLE prop_firms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  website     TEXT,
  notes       TEXT,
  is_sample   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE accounts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_id            INTEGER REFERENCES prop_firms(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  login              TEXT NOT NULL,                 -- MT5 login (shown masked in the UI)
  server             TEXT,
  broker             TEXT,
  currency           TEXT NOT NULL DEFAULT 'USD',
  kind               TEXT NOT NULL DEFAULT 'challenge', -- challenge | funded | personal | demo
  phase              TEXT,                          -- e.g. "Phase 1"
  size               REAL,                          -- initial account size
  role               TEXT NOT NULL DEFAULT 'standalone', -- master | copy | standalone
  master_account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  daily_loss_pct     REAL,
  max_loss_pct       REAL,
  max_loss_type      TEXT DEFAULT 'static',         -- static | trailing
  profit_target_pct  REAL,
  token_hash         TEXT,                          -- SHA-256 of the connector token
  token_hint         TEXT,                          -- last 4 characters, for display
  last_seen          INTEGER,                       -- last connector contact (UTC ms)
  last_deal_msc      INTEGER,                       -- newest deal time received (UTC ms)
  connector_version  TEXT,
  server_offset_sec  INTEGER,                       -- broker server time - UTC, at last contact
  tz_mode            TEXT NOT NULL DEFAULT 'auto',  -- auto (follows US DST if offset is +2/+3) | fixed
  balance            REAL,
  equity             REAL,
  status             TEXT NOT NULL DEFAULT 'active',-- active | archived
  is_sample          INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  UNIQUE (login, server, is_sample)
);

-- Raw MT5 deals: the audit source of truth. Never edited, only inserted.
CREATE TABLE deals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ticket        INTEGER NOT NULL,      -- DEAL_TICKET
  order_ticket  INTEGER,               -- DEAL_ORDER
  position_id   INTEGER,               -- DEAL_POSITION_ID (0 for balance operations)
  time          INTEGER NOT NULL,      -- UTC ms
  server_time   INTEGER,               -- broker server time ms, as sent
  type          INTEGER NOT NULL,      -- DEAL_TYPE_* (0 buy, 1 sell, 2 balance, ...)
  entry         INTEGER NOT NULL,      -- DEAL_ENTRY_* (0 in, 1 out, 2 inout, 3 out_by)
  symbol        TEXT,
  volume        REAL NOT NULL DEFAULT 0,
  price         REAL NOT NULL DEFAULT 0,
  profit        REAL NOT NULL DEFAULT 0,
  commission    REAL NOT NULL DEFAULT 0,
  swap          REAL NOT NULL DEFAULT 0,
  fee           REAL NOT NULL DEFAULT 0,
  sl            REAL,
  tp            REAL,
  risk          REAL,                  -- money at risk at the S/L for entry deals (from the connector)
  magic         INTEGER,
  reason        INTEGER,
  comment       TEXT,
  imported_at   INTEGER NOT NULL,
  UNIQUE (account_id, ticket)
);
CREATE INDEX deals_pos ON deals (account_id, position_id);
CREATE INDEX deals_time ON deals (account_id, time);

-- Positions rebuilt from deals (plus live S/L from the connector).
CREATE TABLE positions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  position_id      INTEGER NOT NULL,   -- MT5 POSITION_IDENTIFIER
  symbol           TEXT NOT NULL,
  direction        TEXT NOT NULL,      -- long | short
  open_time        INTEGER NOT NULL,
  close_time       INTEGER,
  volume           REAL NOT NULL,      -- total volume opened
  closed_volume    REAL NOT NULL DEFAULT 0,
  open_price       REAL,
  close_price      REAL,
  initial_sl       REAL,
  initial_tp       REAL,
  sl               REAL,
  tp               REAL,
  risk             REAL,               -- money at risk at the initial S/L
  profit           REAL NOT NULL DEFAULT 0,
  commission       REAL NOT NULL DEFAULT 0,
  swap             REAL NOT NULL DEFAULT 0,
  fee              REAL NOT NULL DEFAULT 0,
  floating         REAL,               -- live P&L while open
  status           TEXT NOT NULL DEFAULT 'open', -- open | closed
  comment          TEXT,
  magic            INTEGER,
  copy_of          INTEGER,            -- Master POSITION_IDENTIFIER (from "TC:<id>" or matching)
  copy_link        TEXT,               -- comment | match | manual
  master_pos       INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  idea_id          INTEGER REFERENCES ideas(id) ON DELETE SET NULL,
  group_mode       TEXT NOT NULL DEFAULT 'auto', -- auto | manual (manual is never regrouped)
  updated_at       INTEGER NOT NULL,
  UNIQUE (account_id, position_id)
);
CREATE INDEX positions_idea ON positions (idea_id);
CREATE INDEX positions_open ON positions (account_id, symbol, direction, open_time);
CREATE INDEX positions_copy ON positions (copy_of);

-- A trading idea: one or more positions on the lead account (Master or standalone),
-- plus every copy of them on other accounts.
CREATE TABLE ideas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, -- lead account
  symbol        TEXT NOT NULL,
  direction     TEXT NOT NULL,
  strategy_id   INTEGER REFERENCES strategies(id) ON DELETE SET NULL,
  rating        INTEGER,               -- 1..5
  emotion       TEXT,
  notes         TEXT,
  tv_link       TEXT,
  reviewed_at   INTEGER,
  is_sample     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX ideas_acct ON ideas (account_id);

CREATE TABLE strategies (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  description        TEXT,
  instruments        TEXT,             -- comma separated
  sessions           TEXT,             -- free text, AEST
  default_risk_pct   REAL,
  max_ideas_per_day  INTEGER,
  archived           INTEGER NOT NULL DEFAULT 0,
  is_sample          INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

-- Items are never hard-deleted once used, so history keeps its meaning.
CREATE TABLE checklist_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id  INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,          -- daily | trade
  label        TEXT NOT NULL,
  sort         INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);
CREATE INDEX checklist_items_strat ON checklist_items (strategy_id, kind);

-- One row per item per Brisbane day. A new day simply has no rows yet = the 12:00 AM reset.
CREATE TABLE daily_checks (
  item_id      INTEGER NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  strategy_id  INTEGER NOT NULL,
  day          TEXT NOT NULL,          -- YYYY-MM-DD, Australia/Brisbane
  checked      INTEGER NOT NULL,
  label        TEXT NOT NULL,          -- label as it was that day
  checked_at   INTEGER NOT NULL,
  PRIMARY KEY (item_id, day)
);
CREATE INDEX daily_checks_day ON daily_checks (strategy_id, day);

CREATE TABLE trade_checks (
  idea_id     INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  checked     INTEGER NOT NULL,
  label       TEXT NOT NULL,
  checked_at  INTEGER NOT NULL,
  PRIMARY KEY (idea_id, item_id)
);

CREATE TABLE mistakes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  label     TEXT NOT NULL UNIQUE,
  active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE idea_mistakes (
  idea_id     INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  mistake_id  INTEGER NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
  PRIMARY KEY (idea_id, mistake_id)
);

CREATE TABLE screenshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id       INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL,
  filename      TEXT,
  content_type  TEXT,
  size          INTEGER,
  caption       TEXT,
  created_at    INTEGER NOT NULL
);

-- Map broker symbol names to one name (e.g. JPN225 -> JP225) for grouping and analytics.
CREATE TABLE symbol_aliases (
  alias      TEXT PRIMARY KEY,         -- upper case, as the broker spells it
  canonical  TEXT NOT NULL
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Balance/equity once every few minutes per account (drawdown and equity charts).
CREATE TABLE snapshots (
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  time        INTEGER NOT NULL,
  balance     REAL,
  equity      REAL,
  PRIMARY KEY (account_id, time)
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  time        INTEGER NOT NULL,
  actor       TEXT NOT NULL,           -- connector | user | system
  account_id  INTEGER,
  idea_id     INTEGER,
  action      TEXT NOT NULL,
  detail      TEXT,
  level       TEXT NOT NULL DEFAULT 'info' -- info | warn | error
);
CREATE INDEX audit_time ON audit_log (time);
CREATE INDEX audit_idea ON audit_log (idea_id);

INSERT INTO settings (key, value) VALUES
  ('group_window_min', '30'),
  ('group_require_overlap', '1'),
  ('copy_match_window_sec', '60');

INSERT INTO mistakes (label) VALUES
  ('Entered before candle close'), ('Added position late'), ('Moved S/L'), ('Oversized'),
  ('Outside session'), ('FOMO'), ('Revenge trade'), ('Ignored checklist'), ('Early exit');

INSERT INTO symbol_aliases (alias, canonical) VALUES
  ('JPN225', 'JP225'), ('JP225', 'JP225'), ('NIKKEI225', 'JP225'), ('NIK225', 'JP225'), ('JAP225', 'JP225'),
  ('NAS100', 'NAS100'), ('USTEC', 'NAS100'), ('US100', 'NAS100'), ('NDX100', 'NAS100'), ('NQ100', 'NAS100'),
  ('XAUUSD', 'XAUUSD'), ('GOLD', 'XAUUSD');
