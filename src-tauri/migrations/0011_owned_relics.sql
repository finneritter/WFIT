-- Owned void relics. Relics are NOT warframe.market catalog items (they're not
-- traded there), so they live in their own table keyed by relic identity +
-- refinement rather than by a catalog slug. Their worth is inferred from the
-- bundled drop tables (domain::relic) priced against the catalog.
CREATE TABLE owned_relics (
    tier       TEXT NOT NULL,                         -- Lith | Meso | Neo | Axi | Requiem
    relic_name TEXT NOT NULL,                          -- e.g. "A1", "S3"
    refinement TEXT NOT NULL DEFAULT 'Intact',         -- Intact | Exceptional | Flawless | Radiant
    qty        INTEGER NOT NULL CHECK (qty > 0),
    source     TEXT NOT NULL DEFAULT 'manual',         -- manual | de_scan
    first_added_at   TEXT NOT NULL,
    last_modified_at TEXT NOT NULL,
    PRIMARY KEY (tier, relic_name, refinement)
);
