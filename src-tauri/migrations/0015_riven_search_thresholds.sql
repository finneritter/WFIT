-- Per-stat value thresholds for saved riven searches. A JSON object mapping an
-- attribute slug to a number: for a positive that's a minimum % (roll must be at
-- least this), for the negative a maximum magnitude (downside no worse than this).
-- Applied as a CLIENT-SIDE filter over returned auctions; never sent to the API,
-- so it lives on the saved-search row, not in RivenQuery. Additive + defaulted.
ALTER TABLE riven_saved_searches ADD COLUMN min_values TEXT NOT NULL DEFAULT '{}';
