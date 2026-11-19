CREATE TABLE cluster_scores (
    cluster_id INTEGER PRIMARY KEY REFERENCES clusters(id),
    relevance INTEGER NOT NULL,
    novelty INTEGER NOT NULL,
    usefulness INTEGER NOT NULL,
    category TEXT NOT NULL,
    risk_flags TEXT NOT NULL DEFAULT '[]',
    scored_at TEXT NOT NULL
);

CREATE TABLE stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id INTEGER NOT NULL UNIQUE REFERENCES clusters(id),
    run_id INTEGER NOT NULL REFERENCES runs(id),
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    reasons TEXT NOT NULL DEFAULT '[]',
    score TEXT NOT NULL,
    fact_card TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    published_at TEXT
);

CREATE INDEX idx_stories_created_at ON stories(created_at);

CREATE TABLE story_texts (
    story_id INTEGER NOT NULL REFERENCES stories(id),
    lang TEXT NOT NULL CHECK (lang IN ('tr', 'en')),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    dev_line TEXT NOT NULL,
    PRIMARY KEY (story_id, lang)
);

CREATE TABLE llm_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER REFERENCES runs(id),
    step TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    at TEXT NOT NULL
);

CREATE INDEX idx_llm_usage_at ON llm_usage(at);
