-- Every start of the daily workflow from the admin screen ("Çalıştır"): who asked, when, with
-- which options, and whether GitHub took it. Adds a table and an index only, so code that does not
-- know it keeps working on a migrated database.
--
-- outcome: 'pending' from the moment the row is written until GitHub has answered; then
-- 'dispatched' or 'failed' (with one of the known failure names). A row left 'pending' (the Worker
-- stopped in between) is shown as "Sonuç bilinmiyor".
CREATE TABLE run_dispatches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('normal', 'review_all', 'collect_only')),
    max_stories INTEGER CHECK (max_stories IS NULL OR (max_stories BETWEEN 1 AND 8)),
    outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'dispatched', 'failed')),
    failure TEXT CHECK (failure IS NULL OR failure IN ('unauthorized', 'not_found', 'invalid', 'rate_limited', 'unavailable')),
    finished_at TEXT
);

CREATE INDEX run_dispatches_by_time ON run_dispatches (requested_at DESC, id DESC);
