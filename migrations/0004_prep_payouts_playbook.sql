-- v1.3: one shared daily preparation list, per-account payouts, strategy playbooks.

-- Payouts: each challenge / firm has its own split.
ALTER TABLE accounts ADD COLUMN profit_split_pct REAL;                        -- your share, e.g. 80
ALTER TABLE accounts ADD COLUMN last_payout_day TEXT;                         -- YYYY-MM-DD (Brisbane); profit since then = next payout
ALTER TABLE accounts ADD COLUMN payout_currency TEXT NOT NULL DEFAULT 'AUD';  -- AUD | NZD | USD

-- Strategy playbook text.
ALTER TABLE strategies ADD COLUMN setup TEXT;
ALTER TABLE strategies ADD COLUMN entry_rules TEXT;
ALTER TABLE strategies ADD COLUMN stop_rules TEXT;
ALTER TABLE strategies ADD COLUMN exit_rules TEXT;

-- One daily preparation list for every trading day, shared by all strategies.
CREATE TABLE prep_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  is_sample   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX prep_items_sample ON prep_items (is_sample, active, sort);

-- One row per item per Brisbane day (labels kept as they were that day).
CREATE TABLE prep_checks (
  item_id     INTEGER NOT NULL REFERENCES prep_items(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,
  checked     INTEGER NOT NULL,
  label       TEXT NOT NULL,
  checked_at  INTEGER NOT NULL,
  PRIMARY KEY (item_id, day)
);
CREATE INDEX prep_checks_day ON prep_checks (day);

-- Carry the old per-strategy daily lists over: one shared item per distinct label.
INSERT INTO prep_items (label, sort, active, is_sample, created_at)
  SELECT c.label, MIN(c.sort), 1, s.is_sample, MIN(c.created_at)
  FROM checklist_items c JOIN strategies s ON s.id = c.strategy_id
  WHERE c.kind = 'daily' AND c.active = 1 AND s.archived = 0
  GROUP BY s.is_sample, c.label;

-- Labels that only exist in history are kept (inactive) so past days still show them.
INSERT INTO prep_items (label, sort, active, is_sample, created_at)
  SELECT d.label, 999, 0, s.is_sample, MIN(d.checked_at)
  FROM daily_checks d JOIN strategies s ON s.id = d.strategy_id
  WHERE NOT EXISTS (SELECT 1 FROM prep_items p WHERE p.label = d.label AND p.is_sample = s.is_sample)
  GROUP BY s.is_sample, d.label;

INSERT OR IGNORE INTO prep_checks (item_id, day, checked, label, checked_at)
  SELECT p.id, d.day, MAX(d.checked), d.label, MAX(d.checked_at)
  FROM daily_checks d JOIN strategies s ON s.id = d.strategy_id
  JOIN prep_items p ON p.label = d.label AND p.is_sample = s.is_sample
  GROUP BY p.id, d.day;

-- The old per-strategy daily items stay in the table for history but are no longer used.
UPDATE checklist_items SET active = 0 WHERE kind = 'daily';

INSERT OR IGNORE INTO settings (key, value) VALUES ('saved_filters', '[]');
