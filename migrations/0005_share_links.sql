-- v1.4: read-only links to one account, for sharing with a mentor, a partner or a firm.
CREATE TABLE share_links (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  token          TEXT NOT NULL UNIQUE,                 -- the secret part of the link (sh_ + 48 hex)
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,                        -- name shown on the shared page
  show_money     INTEGER NOT NULL DEFAULT 1,           -- 0 = percentages and R only
  show_trades    INTEGER NOT NULL DEFAULT 1,           -- list of closed trades
  show_notes     INTEGER NOT NULL DEFAULT 0,           -- review notes, screenshots and chart links
  show_open      INTEGER NOT NULL DEFAULT 0,           -- trades that are open right now
  show_firm      INTEGER NOT NULL DEFAULT 1,           -- prop firm name and prop-rule progress
  expires_at     INTEGER,                              -- ms; NULL = never
  revoked_at     INTEGER,                              -- ms; set when turned off
  created_at     INTEGER NOT NULL,
  last_viewed_at INTEGER,
  views          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX share_links_account ON share_links (account_id);
