-- v1.2: prop-rule monitor, period reviews, Telegram alerts.

-- How each firm measures the daily loss (shown and warned about; enforcement stays in MT5).
ALTER TABLE accounts ADD COLUMN daily_reset_tz TEXT NOT NULL DEFAULT 'server';   -- server | UTC | America/New_York | Australia/Brisbane | …
ALTER TABLE accounts ADD COLUMN daily_reset_time TEXT NOT NULL DEFAULT '00:00';  -- HH:MM in that time zone
ALTER TABLE accounts ADD COLUMN daily_loss_of TEXT NOT NULL DEFAULT 'start';     -- start (start-of-day amount) | initial (account size)
ALTER TABLE accounts ADD COLUMN daily_loss_from TEXT NOT NULL DEFAULT 'higher';  -- higher (of balance and equity at reset) | balance

-- Weekly / monthly reviews. period = 'week:YYYY-MM-DD' (the Monday) or 'month:YYYY-MM'.
CREATE TABLE reviews (
  period      TEXT NOT NULL,
  is_sample   INTEGER NOT NULL DEFAULT 0,
  goals       TEXT,
  went_well   TEXT,
  improve     TEXT,
  rating      INTEGER,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (period, is_sample)
);

-- One row per alert sent, so each alert goes out once.
CREATE TABLE alerts_sent (
  key   TEXT PRIMARY KEY,
  time  INTEGER NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('warn_pct', '70'),
  ('telegram_chat_id', ''),
  ('alert_rules', '1'),
  ('alert_daily', '1'),
  ('alert_weekly', '1'),
  ('alert_daily_hour', '7');
