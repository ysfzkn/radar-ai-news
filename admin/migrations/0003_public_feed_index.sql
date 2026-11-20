-- The public feed (GET /api/stories) reads published stories newest first, uid ascending within a
-- tie, and pages with a (published_at, uid) keyset. This index matches that WHERE, keyset and
-- ORDER BY, so each call reads only the rows of its page, already in order, instead of scanning
-- and sorting every published row.
CREATE INDEX IF NOT EXISTS idx_stories_status_published ON stories(status, published_at DESC, uid);
