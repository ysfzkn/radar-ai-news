-- Adds 'restored' (a rejection undone: the story goes back to the review queue) to the actions
-- the history may hold. SQLite cannot change a CHECK constraint in place, so the table is rebuilt
-- with the same columns, rows and ids.
CREATE TABLE story_events_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_uid TEXT NOT NULL REFERENCES stories(uid),
    version INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('ingested', 'edited', 'approved', 'rejected', 'unpublished', 'expired', 'restored')),
    actor TEXT NOT NULL,
    note TEXT,
    at TEXT NOT NULL,
    UNIQUE (story_uid, version)
);

INSERT INTO story_events_new (id, story_uid, version, action, actor, note, at)
    SELECT id, story_uid, version, action, actor, note, at FROM story_events;

DROP TABLE story_events;

ALTER TABLE story_events_new RENAME TO story_events;
