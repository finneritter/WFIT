CREATE TABLE catalog_items (
    slug           TEXT PRIMARY KEY,
    display_name   TEXT NOT NULL,
    part_type      TEXT NOT NULL,
    set_slug       TEXT REFERENCES catalog_items(slug),
    ducats         INTEGER,
    is_vaulted     INTEGER NOT NULL DEFAULT 0,
    is_tradeable   INTEGER NOT NULL DEFAULT 1,
    thumbnail_url  TEXT
);

CREATE INDEX idx_catalog_set_slug ON catalog_items(set_slug);
CREATE INDEX idx_catalog_display_name ON catalog_items(display_name);

CREATE TABLE inventory_items (
    slug              TEXT PRIMARY KEY REFERENCES catalog_items(slug),
    qty               INTEGER NOT NULL CHECK (qty >= 0),
    first_added_at    TEXT NOT NULL,
    last_modified_at  TEXT NOT NULL,
    notes             TEXT
);

CREATE TABLE sale_events (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug                        TEXT NOT NULL REFERENCES catalog_items(slug),
    qty                         INTEGER NOT NULL CHECK (qty > 0),
    plat_per_unit               INTEGER,
    market_median_at_sale_time  INTEGER,
    sold_at                     TEXT NOT NULL,
    notes                       TEXT
);

CREATE INDEX idx_sale_events_sold_at ON sale_events(sold_at);
CREATE INDEX idx_sale_events_slug ON sale_events(slug);

CREATE TABLE price_cache (
    slug         TEXT PRIMARY KEY REFERENCES catalog_items(slug),
    median_plat  INTEGER NOT NULL,
    trend        TEXT NOT NULL CHECK (trend IN ('up','flat','down')),
    fetched_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL
);

CREATE INDEX idx_price_cache_expires_at ON price_cache(expires_at);

-- Singleton row for app-level metadata (last catalog sync timestamp, etc).
CREATE TABLE app_meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
