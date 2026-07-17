-- Eleanor's current Coda-weapon rotation, read off her in-game shop by OCR
-- (there is no API source). Four slots; each reruns its progenitor bonus every
-- 4 days. A full row set is rewritten on each capture, so slot is the PK.
CREATE TABLE coda_rotation (
    slot        INTEGER PRIMARY KEY,   -- 0..3, Eleanor's four offer slots
    weapon      TEXT NOT NULL,          -- exact name, e.g. "Coda Bassocyst"
    element     TEXT NOT NULL,          -- progenitor bonus element, e.g. "Heat"
    pct         INTEGER NOT NULL,       -- bonus %, 25..60
    captured_at TEXT NOT NULL           -- ISO 8601 UTC when the shop was OCR'd
);
