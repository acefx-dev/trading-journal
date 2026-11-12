-- v1.10 Trading Floor redesign: a trading schedule (market by time of day) and the A+ setup ticks saved per day
ALTER TABLE day_plans ADD COLUMN setup TEXT;   -- JSON {strategy_id, ticks: {checklist_item_id: true}}
INSERT OR IGNORE INTO settings (key, value) VALUES ('plan_schedule', 'JP225@10:00-14:00,NAS100@16:00-20:00');
