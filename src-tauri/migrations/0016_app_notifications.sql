-- In-app notification center. A generic, persistent store any page/background
-- task can push to; the topbar bell lists active entries. The first producer is
-- the riven watcher (a saved riven search with notify=1 finding a matching
-- auction). USER-FACING state — NOT wiped by rebuild_cache (only wipe_app).
--
-- IMPORTANT — dismissal is SOFT (set dismissed_at, keep the row). Combined with
-- the UNIQUE dedup_key + INSERT OR IGNORE in db/notifications.rs, this is what
-- stops a still-live auction from re-notifying after you clear it: the row (and
-- its key) survive, so the next watcher tick's insert is ignored. A hard delete
-- would resurrect cleared notifications. prune_old only ever removes rows that
-- are BOTH dismissed AND old.
CREATE TABLE app_notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,              -- producer category, e.g. 'riven'
    dedup_key   TEXT UNIQUE,                -- idempotency key (NULL = never deduped)
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    nav_screen  TEXT,                       -- screen to open on click, e.g. 'rivens'
    nav_slug    TEXT,                       -- optional item slug to open in the Drawer
    payload     TEXT,                       -- producer-specific JSON (saved_search_id, …)
    created_at  TEXT NOT NULL,
    read_at     TEXT,                       -- NULL = unread (drives the bell badge)
    dismissed_at TEXT                       -- NULL = active (shown); set = cleared
);
CREATE INDEX idx_notifications_active ON app_notifications (dismissed_at, created_at);

-- Per-saved-search opt-in: when 1, the riven watcher checks this search and
-- files a notification on a matching auction. Off by default so existing saved
-- searches don't suddenly start notifying.
ALTER TABLE riven_saved_searches ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;
