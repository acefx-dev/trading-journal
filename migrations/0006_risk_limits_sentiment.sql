-- v1.5: risk limits per account, market sentiment in daily prep, linking the same trade across accounts.

-- Limits as a % of the account size. A violation is anything above the limit plus the tolerance
-- (setting risk_tolerance_pct, default 3%: a $300 limit is a violation above $309, so slippage of a few
-- dollars doesn't count).
ALTER TABLE accounts ADD COLUMN max_risk_trade_pct REAL;   -- per trading idea
ALTER TABLE accounts ADD COLUMN max_risk_day_pct REAL;     -- all ideas opened that Brisbane day

-- Daily market sentiment (step 1 of daily preparation).
CREATE TABLE prep_sentiment (
  day         TEXT NOT NULL,                 -- Brisbane day
  is_sample   INTEGER NOT NULL DEFAULT 0,
  overall     TEXT,                          -- bull | neutral | bear
  markets     TEXT,                          -- JSON {"JP225":"bull","NAS100":"bear"}
  basis       TEXT,                          -- JSON ["US futures","VIX"]
  note        TEXT,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (day, is_sample)
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('risk_tolerance_pct', '3'),
  ('sentiment_markets', 'JP225,NAS100'),
  ('sentiment_basis', 'US futures,Nikkei futures,VIX,USDJPY,Headlines'),
  ('link_accounts', '1'),
  ('link_window_min', '5'),
  ('sentiment_prompt', '');   -- your own prompt for checking market sentiment (Copy prompt button)
