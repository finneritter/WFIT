-- The set_slug column references catalog_items(slug). When the edge function
-- bulk-upserts the full warframe.market catalog, parts can appear before their
-- corresponding "<frame>_prime_set" row, which trips the per-row FK check and
-- rolls back the entire upsert.
--
-- We never strictly enforce that a part's set_slug exists in catalog_items —
-- it's used for grouping in queries, not as a hard relationship. Drop the FK
-- and keep the column.

ALTER TABLE catalog_items
    DROP CONSTRAINT IF EXISTS catalog_items_set_slug_fkey;
