-- v1.1: several TradingView links per idea (with timeframe and a note),
-- a timeframe on each screenshot, and a default account/group for the app.

CREATE TABLE idea_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id     INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  timeframe   TEXT,                 -- e.g. M5, H1, D1
  note        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idea_links_idea ON idea_links (idea_id);

-- keep the single link from v1.0
INSERT INTO idea_links (idea_id, url, created_at)
  SELECT id, tv_link, updated_at FROM ideas WHERE tv_link IS NOT NULL AND TRIM(tv_link) != '';

ALTER TABLE screenshots ADD COLUMN timeframe TEXT;

-- what the app shows when it opens: 'all', 'kind:funded', 'kind:challenge', … or an account id
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_scope', 'all');
