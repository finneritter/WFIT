-- Per-relic user preferences. User data (not a rebuildable cache), keyed by relic
-- identity — not refinement — so Protect survives qty->0 and applies to every stack.
CREATE TABLE relic_prefs (
    tier        TEXT NOT NULL,
    relic_name  TEXT NOT NULL,
    protected   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tier, relic_name)
);
