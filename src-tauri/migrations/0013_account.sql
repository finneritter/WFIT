-- Account section: the game scan already downloads the full inventory.php blob but
-- only uses 5 arrays. These tables surface the rest (profile, arsenal, resources,
-- mastery) for the Account screen. ALL tables here are a REBUILDABLE CACHE — the
-- account_* tables are replaced wholesale on each scan, and item_manifest is seeded
-- from a bundled TSV and refreshed from WFCD (modeled on relic_data). None of this is
-- user-sacred data (unlike inventory/sales/watchlist); the session token is never stored.

-- Non-tradeable name/icon/mastery reference (base frames, weapons, resources). The
-- join key is the DE uniqueName (same family as catalog_items.game_ref). Tradeable
-- prime gear is resolved via the catalog instead; this covers everything else and is
-- the Codex collection denominator (full masterable roster, max_rank NOT NULL).
CREATE TABLE item_manifest (
  unique_name  TEXT PRIMARY KEY,   -- DE /Lotus/... path
  display_name TEXT NOT NULL,
  category     TEXT NOT NULL,      -- warframe|primary|secondary|melee|archwing|companion|necramech|amp|special|railjack|resource
  icon_path    TEXT,              -- WFCD imageName; frontend builds the CDN URL
  max_rank     INTEGER,           -- 30/40 for masterable gear; NULL for resources
  mastery_req  INTEGER            -- MR requirement (NULL/0 = none)
);
CREATE INDEX idx_item_manifest_category ON item_manifest(category);

-- The last scanned account snapshot (single row, replaced wholesale each scan).
CREATE TABLE account_profile (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  scanned_at       TEXT,
  mastery_rank     INTEGER,
  equipped_glyph   TEXT,
  created          TEXT,
  credits          INTEGER,
  platinum         INTEGER,
  regal_aya        INTEGER,
  endo             INTEGER,
  trades_remaining INTEGER,
  gifts_remaining  INTEGER,
  nodes_completed  INTEGER,
  nodes_total      INTEGER,
  total_missions   INTEGER,
  daily_focus      INTEGER,
  focus_xp         INTEGER,
  login_streak     INTEGER,
  guild_id         TEXT,
  alignment        TEXT,
  training_date    TEXT
);

-- Owned arsenal (frames + every weapon class). category is the DE array the entry
-- came from, normalized to the same buckets as item_manifest.category. Rebuilt each scan.
CREATE TABLE account_gear (
  unique_name TEXT NOT NULL,
  category    TEXT NOT NULL,
  rank        INTEGER NOT NULL DEFAULT 0,
  xp          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (unique_name, category)
);

-- Owned resources/consumables/boosters with counts (all of MiscItems + friends). Rebuilt each scan.
CREATE TABLE account_resources (
  unique_name TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,      -- resource|consumable|booster|fusion_treasure
  count       INTEGER NOT NULL
);

-- Per-item mastery record (XPInfo) + lore/Cephalon-Fragment scans, for the Codex. Rebuilt each scan.
CREATE TABLE account_mastery (
  unique_name TEXT PRIMARY KEY,
  xp          INTEGER NOT NULL
);
CREATE TABLE account_lore_scans (
  unique_name TEXT PRIMARY KEY,
  scans       INTEGER NOT NULL
);

-- Intrinsics + syndicate standing (small key/value tables). Rebuilt each scan.
CREATE TABLE account_intrinsics (
  skill_key TEXT PRIMARY KEY,
  rank      INTEGER NOT NULL
);
CREATE TABLE account_syndicates (
  tag      TEXT PRIMARY KEY,
  standing INTEGER NOT NULL,
  title    TEXT
);
