-- v1.6: trade path from connector 1.02 (stop-loss changes, drawdown and best point during the trade)

-- every stop-loss or volume change the connector saw on an open position (times are UTC ms)
CREATE TABLE IF NOT EXISTS sl_events (
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL,
  t           INTEGER NOT NULL,
  sl          REAL,
  volume      REAL,
  risk        REAL,              -- money lost if this position hit its S/L from its entry; 0 = S/L at or past entry; NULL = no S/L
  PRIMARY KEY (account_id, position_id, t)
);

-- combined floating P&L of all open positions of one symbol and side on an account, sampled every second:
-- lowest (mae) and highest (mfe) value and when they happened
CREATE TABLE IF NOT EXISTS path_episodes (
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  direction    TEXT NOT NULL,
  start_t      INTEGER NOT NULL,
  end_t        INTEGER,
  position_ids TEXT NOT NULL,     -- JSON array of MT5 position ids
  mae          REAL,
  mae_t        INTEGER,
  mfe          REAL,
  mfe_t        INTEGER,
  partial      INTEGER NOT NULL DEFAULT 0,   -- the connector started after the first position opened
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (account_id, symbol, direction, start_t)
);

-- a higher combined risk that lasts less than this many seconds (e.g. a scale-in before you move the first stop) is ignored
INSERT OR IGNORE INTO settings (key, value) VALUES ('risk_grace_sec', '60');
-- market sentiment: one overall bias (the user's prompt covers JP225 and NAS100 together)
UPDATE settings SET value = '' WHERE key = 'sentiment_markets' AND value = 'JP225,NAS100';
