-- Vault status map (game uniqueName -> vaulted), refreshed from the WFCD
-- warframe-items dataset on a long TTL with a bundled offline fallback. Applied
-- onto catalog_items.is_vaulted (set rows joined by game_ref, then propagated to
-- member parts via set_slug). warframe.market exposes no vault status itself.
CREATE TABLE vault_status (
    game_ref TEXT PRIMARY KEY,
    vaulted  INTEGER NOT NULL
);
