-- WFIT initial schema. Single local user, no auth. Everything except
-- inventory_items / sale_events / watchlist / buy_list / wfm_account is a
-- rebuildable cache of the warframe.market (+ worldstate) APIs.
--
-- NOTE: set_slug is deliberately NOT a foreign key. It is a heuristic-derived
-- pointer to the set row, which may not exist (or not yet) in catalog_items;
-- the prior attempt learned this the hard way (see reference 0002_drop_set_slug_fk).

-- ----------------------------------------------------------------------------
-- Catalog: the full warframe.market item list (Pass A) across 5 categories.
-- ----------------------------------------------------------------------------
CREATE TABLE catalog_items (
    slug              TEXT PRIMARY KEY,
    wfm_id            TEXT,                          -- warframe.market item id (resolves setParts ids -> slugs)
    display_name      TEXT NOT NULL,
    part_type         TEXT NOT NULL,                 -- "Systems" | "Barrel" | "Set" | "Blueprint" | "Other" ...
    category          TEXT NOT NULL                  -- the 5 design categories
                        CHECK (category IN ('warframe','weapon','set','mod','arcane')),
    set_slug          TEXT,                          -- heuristic set pointer (no FK by design)
    ducats            INTEGER,                       -- real for primes; null for mods/arcanes
    is_vaulted        INTEGER NOT NULL DEFAULT 0,    -- inert: no warframe.market source, never surfaced
    is_tradeable      INTEGER NOT NULL DEFAULT 1,
    thumbnail_url     TEXT,
    detail_fetched_at TEXT,                          -- Pass B (set composition) incremental enrich timestamp
    updated_at        TEXT
);

CREATE INDEX idx_catalog_category ON catalog_items(category);
CREATE INDEX idx_catalog_set_slug ON catalog_items(set_slug);
CREATE INDEX idx_catalog_display_name ON catalog_items(display_name);

-- ----------------------------------------------------------------------------
-- Price cache: the fast read-path, derived from price_history.
-- ----------------------------------------------------------------------------
CREATE TABLE price_cache (
    slug         TEXT PRIMARY KEY REFERENCES catalog_items(slug) ON DELETE CASCADE,
    median_plat  INTEGER NOT NULL,
    trend        TEXT NOT NULL CHECK (trend IN ('up','flat','down')),
    delta_7d     REAL,                               -- real 7d % change (recent-7d avg vs prior-7d avg)
    volume_7d    INTEGER,                            -- summed daily volume over the recent 7 days
    fetched_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL
);

CREATE INDEX idx_price_cache_expires_at ON price_cache(expires_at);

-- ----------------------------------------------------------------------------
-- Price history: the real 90-day daily series from /v1 statistics.
-- ----------------------------------------------------------------------------
CREATE TABLE price_history (
    slug    TEXT NOT NULL REFERENCES catalog_items(slug) ON DELETE CASCADE,
    day     TEXT NOT NULL,                           -- ISO date (yyyy-mm-dd)
    median  INTEGER,
    volume  INTEGER,
    PRIMARY KEY (slug, day)
);

CREATE INDEX idx_price_history_slug ON price_history(slug);

-- ----------------------------------------------------------------------------
-- User state (NOT a cache): owned inventory.
-- ----------------------------------------------------------------------------
CREATE TABLE inventory_items (
    slug              TEXT PRIMARY KEY REFERENCES catalog_items(slug),
    qty               INTEGER NOT NULL CHECK (qty >= 0),
    first_added_at    TEXT NOT NULL,
    last_modified_at  TEXT NOT NULL,
    source            TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'wfm_import' (provenance for import UX)
    notes             TEXT
);

-- ----------------------------------------------------------------------------
-- User state: realized sales ledger.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- User state: buy-target watchlist (was localStorage in the webapp).
-- ----------------------------------------------------------------------------
CREATE TABLE watchlist (
    slug         TEXT PRIMARY KEY REFERENCES catalog_items(slug) ON DELETE CASCADE,
    target_plat  INTEGER,
    added_at     TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- User state: planning cart (Buy List screen).
-- ----------------------------------------------------------------------------
CREATE TABLE buy_list (
    slug     TEXT PRIMARY KEY REFERENCES catalog_items(slug) ON DELETE CASCADE,
    buy_qty  INTEGER NOT NULL CHECK (buy_qty > 0),
    added_at TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- Set composition (Pass B): authoritative membership from setParts/quantityInSet.
-- ----------------------------------------------------------------------------
CREATE TABLE set_membership (
    set_slug         TEXT NOT NULL,
    part_slug        TEXT NOT NULL,
    quantity_in_set  INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (set_slug, part_slug)
);

-- ----------------------------------------------------------------------------
-- warframe.market account connect (Listings screen). JWT is NOT here — keychain only.
-- ----------------------------------------------------------------------------
CREATE TABLE wfm_account (
    id             INTEGER PRIMARY KEY CHECK (id = 1),  -- single row, single user
    username       TEXT,
    status         TEXT,                                -- 'offline' | 'online' | 'ingame' (informational)
    last_import_at TEXT
);

-- ----------------------------------------------------------------------------
-- Read-only mirror of your warframe.market sell orders (refreshed on connect/sync).
-- ----------------------------------------------------------------------------
CREATE TABLE market_listings (
    order_id    TEXT PRIMARY KEY,
    slug        TEXT REFERENCES catalog_items(slug),
    order_type  TEXT,                                -- 'sell' | 'buy'
    your_price  INTEGER,
    qty         INTEGER,
    visible     INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT
);

CREATE INDEX idx_market_listings_slug ON market_listings(slug);

-- ----------------------------------------------------------------------------
-- App-level key/value: last-sync timestamps and the like.
-- ----------------------------------------------------------------------------
CREATE TABLE app_meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- User preferences: budget number, density/accent prefs, "include all mods" toggle.
-- ----------------------------------------------------------------------------
CREATE TABLE app_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
