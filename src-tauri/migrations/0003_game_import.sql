-- Game inventory import (memory-scan). See GAME_INVENTORY_IMPORT.md and
-- .claude/plans/game-inventory-import.md.
--
-- NOTE: inventory_items.source already exists (0001) with values 'manual' |
-- 'wfm_import'. The scan adds a third value 'de_scan' — no schema change needed
-- for that. This migration only adds the join key, the scan-quantity column, and
-- the single-row feature state.

-- The join key: DE internal `uniqueName` path, already returned by /v2/items as
-- `gameRef` (Pass A) and previously discarded. Bridges inventory uniqueName -> slug.
ALTER TABLE catalog_items ADD COLUMN game_ref TEXT;
CREATE INDEX idx_catalog_game_ref ON catalog_items(game_ref);

-- Last quantity the scan reported for a row (so subsequent syncs can diff).
ALTER TABLE inventory_items ADD COLUMN last_scan_qty INTEGER;

-- Single-row state for the opt-in feature. The game session (accountId/nonce) is
-- NEVER stored here — it is read, used, and discarded. last_account_id is only the
-- account id, kept to detect "a different account was scanned".
CREATE TABLE game_scan_state (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    consent_at      TEXT,                          -- when risk was accepted (NULL = not consented)
    last_scan_at    TEXT,
    last_account_id TEXT,
    auto_sync       INTEGER NOT NULL DEFAULT 0     -- reserved; auto-sync is not built in v1
);
