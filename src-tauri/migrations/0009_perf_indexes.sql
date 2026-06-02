-- Performance indexes. The dominant catalog access pattern is "filter by
-- category, sort by display_name" (the Add-items grid, Sets, Ducats). Separate
-- single-column indexes on category and display_name can't serve both the filter
-- and the order in one pass, forcing a scan + in-memory sort over the ~30k-row
-- catalog. This compound index covers filter-then-sort directly.
CREATE INDEX IF NOT EXISTS idx_catalog_cat_name ON catalog_items(category, display_name);
