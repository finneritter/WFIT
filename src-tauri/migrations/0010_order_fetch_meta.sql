-- Freshness stamp for order-book fetches, independent of whether the fetched
-- book had any rows. A genuinely-empty book (no online orders) counts as
-- "fresh" so the heartbeat doesn't refetch it every tick, while transient HTTP
-- failures store nothing and leave stale data (stale bids beat no bids).
CREATE TABLE IF NOT EXISTS order_fetch_meta (
  slug       TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL
);
