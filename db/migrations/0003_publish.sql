ALTER TABLE stories ADD COLUMN uid TEXT;
UPDATE stories SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL;
CREATE UNIQUE INDEX idx_stories_uid ON stories(uid);
ALTER TABLE stories ADD COLUMN pushed_at TEXT;

CREATE TABLE story_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id INTEGER NOT NULL REFERENCES clusters(id),
    run_id INTEGER REFERENCES runs(id),
    outcome TEXT NOT NULL CHECK (outcome IN ('thin', 'failed', 'refused')),
    at TEXT NOT NULL
);

CREATE INDEX idx_story_attempts_cluster ON story_attempts(cluster_id);
