-- Rank-aware mods/arcanes. warframe.market prices mods/arcanes per rank (a rank-0
-- Arcane Energize ≈ 7p, rank-5 ≈ 100p), and the game inventory exposes each copy's
-- rank. This adds the rank dimension WITHOUT disturbing inventory_items (which stays
-- the total-per-slug truth so the grid/sets/sums are untouched):
--   - the per-rank owned breakdown lives in inventory_ranks
--   - per-rank market medians live in price_rank (parsed from the same statistics)

-- Rank ceiling per item (from /v2/items `maxRank`; e.g. arcanes = 5). Informational
-- + lets the drawer show "Rank 5 / 5".
ALTER TABLE catalog_items ADD COLUMN max_rank INTEGER;

-- The owned breakdown per (item, rank). Written by the game scan; sum over rank
-- equals inventory_items.qty for scanned mods/arcanes. Prime parts don't appear here.
CREATE TABLE inventory_ranks (
    slug  TEXT NOT NULL REFERENCES catalog_items(slug) ON DELETE CASCADE,
    rank  INTEGER NOT NULL,
    qty   INTEGER NOT NULL CHECK (qty > 0),
    PRIMARY KEY (slug, rank)
);

-- Per-rank market median (mods/arcanes only). Refreshed alongside price_cache from
-- the same /v1 statistics response (mod_rank field) — no extra network cost.
CREATE TABLE price_rank (
    slug    TEXT NOT NULL REFERENCES catalog_items(slug) ON DELETE CASCADE,
    rank    INTEGER NOT NULL,
    median  INTEGER NOT NULL,
    PRIMARY KEY (slug, rank)
);
