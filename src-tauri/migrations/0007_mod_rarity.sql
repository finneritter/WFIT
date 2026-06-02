-- Mod rarity (common|uncommon|rare|legendary), bundled from the WFCD dataset and
-- joined on game_ref. Display-only signal that drives the portfolio-value exclusion
-- preference; NULL for non-mods and the handful of unmapped mods.
ALTER TABLE catalog_items ADD COLUMN mod_rarity TEXT;
