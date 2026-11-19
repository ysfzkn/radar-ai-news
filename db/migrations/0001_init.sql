CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tier INTEGER NOT NULL,
    kind TEXT NOT NULL,
    url TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    lang TEXT NOT NULL DEFAULT 'en',
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    first_seen TEXT NOT NULL
);

CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL REFERENCES sources(id),
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    cluster_id INTEGER REFERENCES clusters(id),
    UNIQUE (source_id, url)
);

CREATE INDEX idx_items_published_at ON items(published_at);
CREATE INDEX idx_items_cluster_id ON items(cluster_id);

CREATE TABLE runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    stats TEXT
);
