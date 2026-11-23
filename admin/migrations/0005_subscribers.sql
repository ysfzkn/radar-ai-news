-- The e-mail newsletter's readers. Adds one table and one index, so code that does not know it
-- keeps working on a migrated database.
--
-- email: trimmed and lower-cased; the only personal data Radar stores.
-- status: 'pending' from the form until the reader presses the button behind the link in the
--   confirmation mail, then 'confirmed'. Only confirmed readers get the daily mail. A pending row
--   is deleted after 7 days; leaving the list deletes the row.
-- token: 64 hex characters from a random source; the confirm and the leave links carry it.
-- confirm_sent_at, confirm_sends: when the last confirmation mail went out and how many did, to
--   keep one address from being mailed again and again.
-- mailed_day: the Istanbul day ("YYYY-MM-DD") of the last edition mailed to this reader, so an
--   edition goes out once even when the hourly job runs many times.
CREATE TABLE subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    lang TEXT NOT NULL CHECK (lang IN ('tr', 'en')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed')),
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    confirm_sent_at TEXT,
    confirm_sends INTEGER NOT NULL DEFAULT 0,
    confirmed_at TEXT,
    mailed_day TEXT
);

CREATE INDEX subscribers_by_status ON subscribers (status, id);
