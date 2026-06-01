-- Live-order pricing for illiquid items. Historical trade statistics are sparse
-- and manipulable for barely-traded mods (a single 50000p wash print). The live
-- order book is the real signal: we value such items off the lowest live SELL
-- listings (asks), prioritizing sell orders over buy orders.
--
-- Populated only for ILLIQUID owned items on refresh (one /v2/orders/item call
-- each), per rank for mods/arcanes. rank -1 = a non-ranked item (e.g. prime part).
CREATE TABLE order_cache (
    slug        TEXT NOT NULL REFERENCES catalog_items(slug) ON DELETE CASCADE,
    rank        INTEGER NOT NULL,   -- mod_rank; -1 for non-ranked items
    sell        INTEGER NOT NULL,   -- robust lowest live sell (plat)
    fetched_at  TEXT NOT NULL,
    PRIMARY KEY (slug, rank)
);
