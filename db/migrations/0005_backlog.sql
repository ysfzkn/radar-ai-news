-- The 14-day backlog. A score now records which question it answered ('fresh': is this
-- new today, 'backlog': does this still matter this week), the scorer's repeat flag, and
-- the highest story id when it was asked (a story written since makes it stale). Rows
-- from before this migration answered the fresh question with no list of written stories.
ALTER TABLE cluster_scores ADD COLUMN lens TEXT NOT NULL DEFAULT 'fresh';
ALTER TABLE cluster_scores ADD COLUMN repeat INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cluster_scores ADD COLUMN watermark INTEGER NOT NULL DEFAULT 0;

-- A story remembers when its event was first reported and which lane chose it.
ALTER TABLE stories ADD COLUMN reported_at TEXT;
ALTER TABLE stories ADD COLUMN lane TEXT NOT NULL DEFAULT 'fresh';
