CREATE TABLE stories (
    uid TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('review', 'published', 'rejected', 'expired')),
    publish_mode TEXT CHECK (publish_mode IN ('auto', 'human')),
    reasons TEXT NOT NULL DEFAULT '[]',
    score TEXT NOT NULL,
    fact_card TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_count INTEGER NOT NULL,
    sources TEXT NOT NULL DEFAULT '[]',
    edited INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    published_at TEXT,
    decided_at TEXT
);

CREATE INDEX idx_stories_status_created ON stories(status, created_at);

CREATE TABLE story_texts (
    story_uid TEXT NOT NULL REFERENCES stories(uid),
    lang TEXT NOT NULL CHECK (lang IN ('tr', 'en')),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    dev_line TEXT NOT NULL,
    PRIMARY KEY (story_uid, lang)
);

CREATE TABLE story_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_uid TEXT NOT NULL REFERENCES stories(uid),
    version INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('ingested', 'edited', 'approved', 'rejected', 'unpublished', 'expired')),
    actor TEXT NOT NULL,
    note TEXT,
    at TEXT NOT NULL,
    UNIQUE (story_uid, version)
);
