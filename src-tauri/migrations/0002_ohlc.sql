-- Add OHLC columns to the daily price history so the item drawer can draw real
-- candlesticks. warframe.market's statistics endpoint already returns these per
-- day; older cached rows stay NULL until the next price refresh backfills them.
ALTER TABLE price_history ADD COLUMN open  INTEGER;
ALTER TABLE price_history ADD COLUMN high  INTEGER;
ALTER TABLE price_history ADD COLUMN low   INTEGER;
ALTER TABLE price_history ADD COLUMN close INTEGER;
