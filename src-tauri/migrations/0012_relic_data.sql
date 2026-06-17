-- Relic reference data, made refreshable at runtime (was compile-time bundled in
-- domain/relic.rs). Seeded from the bundled TSVs, then replaced by a live fetch of
-- the WFCD warframe-items Relics.json on "Update game data" — so new relics work
-- without rebuilding the app. db::relic_data owns these; domain::relic mirrors them
-- into an in-memory snapshot.

-- DE projection uniqueName -> relic identity (for game-scan import mapping).
CREATE TABLE relic_ids (
    unique_name TEXT PRIMARY KEY,
    tier        TEXT NOT NULL,
    relic_name  TEXT NOT NULL,
    refinement  TEXT NOT NULL
);

-- Per-refinement reward table. reward_name is a catalog display name (resolved to a
-- slug at query time); chance is the drop % for that refinement.
CREATE TABLE relic_drops (
    tier        TEXT NOT NULL,
    relic_name  TEXT NOT NULL,
    refinement  TEXT NOT NULL,
    reward_name TEXT NOT NULL,
    chance      REAL NOT NULL,
    PRIMARY KEY (tier, relic_name, refinement, reward_name)
);

-- Per-relic vault status (same across refinements). vaulted = no longer farmable.
CREATE TABLE relic_vaults (
    tier       TEXT NOT NULL,
    relic_name TEXT NOT NULL,
    vaulted    INTEGER NOT NULL,
    PRIMARY KEY (tier, relic_name)
);
