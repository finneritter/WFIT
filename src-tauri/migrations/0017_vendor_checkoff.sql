-- Manual "I've already grabbed this from the vendor" check-offs for the Vendors screen.
-- Only MANUAL checks live here; "owned" checks are derived live from inventory_items
-- (so a game-scan import auto-checks owned items with no extra write path).
--
-- No FK to catalog_items on item_ref: many vendor wares are account-bound
-- (cosmetics, Umbra Forma, Kuva…) and never resolve to a market slug, but must
-- still be manually check-off-able. item_ref = uniqueName else slug else normalized name.
CREATE TABLE vendor_checkoff (
    vendor_key TEXT NOT NULL,   -- 'baro' | 'varzia' | 'steel_path' | …
    item_ref   TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    PRIMARY KEY (vendor_key, item_ref)
);
