-- v1.9 Trading Floor: the day's game plan and end-of-day debrief, plus floor settings
CREATE TABLE IF NOT EXISTS day_plans (
  day        TEXT NOT NULL,                 -- Brisbane day YYYY-MM-DD
  is_sample  INTEGER NOT NULL DEFAULT 0,
  markets    TEXT,                          -- JSON [{symbol, bias, levels:[{label,value}], plan}]
  debrief    TEXT,                          -- JSON {followed, best, worst, tomorrow, rating}
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, is_sample)
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('trade_window', '10:00-14:00'),
  ('max_ideas_day', '2'),
  ('loss_stop', '2'),
  ('news_pause_min', '15'),
  ('plan_markets', 'JP225,NAS100'),
  ('plan_levels', 'Asia high,Asia low,Pre-open range,Prev. day high,Prev. day low'),
  ('quote_symbols', 'OANDA:JP225USD=JP225,OANDA:NAS100USD=NAS100,FX:USDJPY=USDJPY');
