-- Live BUY orders (bids) — the demand curve. Realizable value is computed by
-- liquidating a holding into these best-bid-first, so an item nobody is bidding on
-- is worth ~nothing regardless of its sticker price. Stored per (slug, rank, price)
-- level (qty summed across orders at that price), for online buyers only.
CREATE TABLE buy_orders (
    slug        TEXT NOT NULL REFERENCES catalog_items(slug) ON DELETE CASCADE,
    rank        INTEGER NOT NULL,   -- mod_rank; -1 for non-ranked items
    price       INTEGER NOT NULL,   -- bid price (plat)
    qty         INTEGER NOT NULL,   -- units wanted at this price (online buyers)
    fetched_at  TEXT NOT NULL,
    PRIMARY KEY (slug, rank, price)
);
CREATE INDEX idx_buy_orders_slug ON buy_orders(slug);
