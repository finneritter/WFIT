-- Add a real category to the catalog so the UI can show "Warframe"/"Weapon"
-- under a part name without guessing from part_type. warframe.market exposes
-- this via item tags ("warframe", "weapon", ...); the market-proxy edge
-- function now derives it on catalog_refresh and upserts it here.
--
-- Nullable + no default: existing rows stay NULL until the next catalog_refresh
-- backfills them. The client falls back to part_type-based classification when
-- this is NULL, so it degrades gracefully.

ALTER TABLE catalog_items
    ADD COLUMN IF NOT EXISTS category TEXT;
