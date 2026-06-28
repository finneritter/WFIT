-- Riven Search tab. Rivens use a separate warframe.market API (v2 reference + v1
-- auctions); these tables cache the reference data and persist the user's saved
-- searches. The two reference tables are rebuildable caches; riven_saved_searches
-- is USER DATA (excluded from rebuild_cache / wipe_app).

-- Riven-capable weapons, incl. the disposition used for grading (v2 /riven/weapons).
CREATE TABLE riven_weapons (
    slug        TEXT NOT NULL PRIMARY KEY,
    name        TEXT NOT NULL,
    riven_type  TEXT NOT NULL,
    group_name  TEXT NOT NULL DEFAULT '',
    disposition REAL NOT NULL DEFAULT 0
);

-- Riven attributes / stats (v2 /riven/attributes). exclusive_to is a CSV of riven
-- types (empty = available on all weapons).
CREATE TABLE riven_attributes (
    slug                TEXT NOT NULL PRIMARY KEY,
    name                TEXT NOT NULL,
    unit                TEXT,
    exclusive_to        TEXT NOT NULL DEFAULT '',
    positive_is_negative INTEGER NOT NULL DEFAULT 0
);

-- The user's saved riven searches (USER DATA — never wiped by a cache rebuild).
CREATE TABLE riven_saved_searches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    label           TEXT NOT NULL DEFAULT '',
    weapon          TEXT NOT NULL,
    positives       TEXT NOT NULL DEFAULT '',  -- CSV of attribute slugs
    negative        TEXT,
    polarity        TEXT,
    re_rolls_max    INTEGER,
    mastery_rank_max INTEGER,
    created_at      TEXT NOT NULL
);
