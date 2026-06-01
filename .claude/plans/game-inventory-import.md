# Implementation plan — Game Inventory Import (memory-scan)

**Source proposal:** `GAME_INVENTORY_IMPORT.md` (read it for rationale/risk).
**This doc:** the concrete build, grounded in the current code. Date: 2026-06-01.

> **STATUS (2026-06-01):** Phase A + B1 + B2 implemented and **VERIFIED LIVE** — a real scan imported
> correct counts for prime parts, mods and arcanes. DE JSON arrays parsed: `MiscItems`, `Recipes`,
> `RawUpgrades` (stacked mods/arcanes — the count fix), `Upgrades`. Green (cargo check/clippy clean,
> 10 tests, tsc, build). `ptrace_scope` caveat applies on locked-down kernels. Auto-sync (§9) not built.

> One-line: opt-in, consent-gated, Linux-only memory-scan of the running Warframe client →
> DE mobile inventory endpoint → map `uniqueName → catalog_items.game_ref → slug` → reviewable
> diff → transactional merge as `source='de_scan'` rows. Isolated `gamescan` module, never on the
> warframe.market path. ToS-prohibited / ban-risky / off by default.

## Corrections to the proposal (verified against code)

- **`inventory_items.source` already exists** (`0001_init.sql:68`, values `'manual' | 'wfm_import'`).
  Migration `0003` must NOT re-add it — it only adds `last_scan_qty`. We extend the value set with
  `'de_scan'` (no schema change; it's free text).
- **`set_membership` table already exists** (`0001_init.sql:109`) — unrelated, ignore.
- **Migration mechanism:** append `M::up(include_str!("../../migrations/0003_game_import.sql"))` to
  the `MIGRATIONS` vec in `db/mod.rs:22`. Never edit a shipped migration.
- **Command pattern confirmed:** `#[tauri::command] pub async fn`, registered in
  `lib.rs:58 generate_handler!`. Preview/apply split already exists for listings
  (`wfm_fetch_listings` → `Vec<ImportRow>`, `wfm_apply_import(rows)` → transactional) — the scan
  mirrors it exactly (`game_scan_preview` → `Vec<ScanDiffRow>`, `game_scan_apply(rows)`).
- **Keychain** is via `keyring::Entry` (`wfm_account.rs`). The scan does NOT use it — the game
  session (`accountId`/`nonce`) is read, used, discarded; never persisted/logged.

---

## Phase A — store `game_ref` (SAFE, no scanning, build now)

Zero risk, no policy reversal, prerequisite for the mapping. The join key is already fetched in
Pass A and discarded.

1. **Migration `0003_game_import.sql`** (new file):
   ```sql
   ALTER TABLE catalog_items ADD COLUMN game_ref TEXT;
   CREATE INDEX idx_catalog_game_ref ON catalog_items(game_ref);
   ALTER TABLE inventory_items ADD COLUMN last_scan_qty INTEGER;
   CREATE TABLE game_scan_state (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     consent_at TEXT, last_scan_at TEXT, last_account_id TEXT,
     auto_sync INTEGER NOT NULL DEFAULT 0
   );
   ```
   Register in `db/mod.rs`.
2. **`market.rs fetch_catalog`** (`market.rs:87`): add `game_ref: Option<String>` to the local
   `Item` struct (`#[serde(rename = "gameRef")]`), thread into `CatalogUpsert`.
3. **`db/catalog.rs`**: add `game_ref` to `CatalogUpsert` + the upsert column list + `ON CONFLICT`
   (`COALESCE(excluded.game_ref, catalog_items.game_ref)` to preserve).
4. **Backfill:** the migration leaves `game_ref` NULL on existing rows. Force one catalog re-fetch —
   simplest: clear `KEY_LAST_CATALOG_SYNC` in the migration is not possible (different table), so
   add a one-shot: on launch, if `SELECT COUNT(*) FROM catalog_items WHERE game_ref IS NULL` > 0,
   run a catalog refresh. Or just call the existing `catalog_refresh` command from Settings once.
   → Decision: piggyback on launch_refresh — re-fetch catalog if any `game_ref IS NULL`.
5. **Verify:** `sqlite3 wfit.sqlite "SELECT slug,game_ref FROM catalog_items WHERE game_ref NOT NULL LIMIT 5"`
   — expect `/Lotus/Types/...` paths. Confirm prime-part coverage (the mapping depends on it).

**Gate A:** `cargo check`, app launches, catalog rows carry `game_ref`. Stop and assess coverage
before Phase B.

---

## Phase B — the `gamescan` module (gated, needs a running game to finish)

Build order splits into **B1 (offline, testable now)** and **B2 (needs live game + upstream source)**.

### Module layout (mirrors `worldstate.rs` isolation)
```
src-tauri/src/gamescan/
  mod.rs       # pub scan() -> Inventory; re-exports; #[cfg(target_os="linux")] gating
  consent.rs   # typed-phrase validation; reads/writes game_scan_state
  map.rs       # uniqueName -> slug via catalog game_ref; prime-part category filter
  process.rs   # find Warframe pid via /proc; is_running(); ptrace_scope check
  memory.rs    # chunked /proc/<pid>/mem reads; accountId + nonce extraction
  api.rs       # DE inventory endpoint client (OWN reqwest + throttle, NOT market.rs)
src-tauri/src/db/gamescan.rs   # game_scan_state CRUD + merge_from_scan (provenance-aware)
```
Add `mod gamescan;` to `lib.rs`; `pub mod gamescan;` to `db/mod.rs`.

### B1 — offline, build & unit-test now (no scanning, no ban risk)

6. **`db/gamescan.rs`**: `get_state`, `set_consent(ts)`, `clear_consent`, `set_last_scan(ts, acct)`,
   and `merge_from_scan(rows)` (transactional; §5 semantics below).
7. **`consent.rs`**: `EXPECTED_PHRASE = "I understand and accept the risk involved in using this
   functionality."`; `validate(phrase) -> bool` (exact match); `is_consented(db)`.
8. **`map.rs`**: `resolve(inventory_json, db) -> Vec<ScanItem{slug, qty}>`. Build a
   `game_ref -> slug` map (one query), filter DE inventory to prime-part categories
   (`MiscItems` etc. — confirm key names in B2), look up by `uniqueName`, drop unresolved.
   **Unit-tested** against a saved sample inventory JSON committed under
   `src-tauri/tests/fixtures/inventory_sample.json` (grab from warframe-helper output / browse.wf).
9. **Commands** (`commands.rs` + register in `lib.rs`), following the listings preview/apply split:
   | Command | Behavior |
   |---|---|
   | `game_scan_status()` | `{consented, warframe_running, auto_sync, last_scan_at}` — no scan |
   | `game_scan_consent(phrase)` | validate exact phrase → set `consent_at`; else error |
   | `game_scan_revoke()` | clear `consent_at` |
   | `game_scan_preview()` | **read-only**: consent+running gate → scan → map → `Vec<ScanDiffRow>` |
   | `game_scan_apply(rows)` | transactional merge; the only writer |
   `game_scan_preview/apply` return errors until B2 lands (`scan()` stubbed `Err(NotImplemented)`),
   so the whole consent/status/UI flow is testable before any real memory read exists.
10. **Frontend**: `lib/api.ts` wrappers + `lib/types.ts` (`ScanDiffRow`, `GameScanStatus`);
    `routes/Settings.tsx` new **"Game inventory (beta)"** section — risk copy, typed-phrase consent
    box, "Scan now" (disabled until consented + game detected), and a diff-review modal
    (added/changed/removed) gating `game_scan_apply`. Off by default, clearly labelled ban-risky.

**Gate B1:** `cargo check` + `cargo test` (map unit tests pass), `tsc`/`biome`, app launches,
Settings shows the gated section, consent typed-phrase flow works, "Scan now" returns the
NotImplemented error cleanly.

### B2 — the live scan (needs you at a running Warframe + upstream source)

These are the proposal's §9 open items — **cannot be settled from docs; lifted from
`warframe-helper`/`warframe-api-helper` and re-verified against one live scan.** Do NOT hardcode
from memory.

11. **`process.rs`**: locate `Warframe` pid by scanning `/proc/*/comm` (std::fs, no dep).
    `is_running()`. Check `/proc/sys/kernel/yama/ptrace_scope` — if ≥2, return a clear
    "can't read game memory (ptrace_scope=N)" error instead of empty.
12. **`memory.rs`**: read `/proc/<pid>/maps`, walk readable regions, chunked reads via
    `process_vm_readv` (add `nix = { version = "0.29", features = ["uio","process"] }`) or raw
    `/proc/<pid>/mem` seeks. Pattern-match `accountId` + `nonce` signatures (**lifted from upstream,
    verified live**). **Never log the nonce in committed code.**
13. **`api.rs`**: own `reqwest::Client` + own throttle (NOT the 350ms market limiter — different
    host/concern). POST/GET the DE mobile inventory endpoint (host/path/headers **lifted + verified**).
    Parse to a normalized `Inventory{ items: Vec<{unique_name, count}> }`. Save a raw dump (gitignored)
    for debugging. Wire `mod.rs::scan()` = process → memory → api → return `Inventory`.
14. **Confirm in B2** (against the live response): JSON category keys (`MiscItems`?), count field
    (`ItemCount`?), endpoint host/path/headers, signature bytes, and `game_ref`↔`uniqueName`
    coverage across the prime set. Check `warframe-helper`'s LICENSE before porting code vs.
    reimplementing from the protocol.

**Gate B2 (definition of done v1):** Settings → consent → "Scan now" (game running) → review diff →
apply → inventory shows true owned counts mapped to slugs, valued at wfm prices, with `manual` rows
preserved, off by default.

### Merge semantics (`merge_from_scan`, §5 of the proposal)
- First import: reviewable diff (added/changed/removed); nothing writes until confirmed.
- Confirmed/subsequent: scan is authoritative for `source='de_scan'` rows (`qty = count`,
  `last_scan_qty = count`). `manual` rows the scan also reports: surface conflict on first
  reconciliation, then flip to `de_scan`.
- Disappeared `de_scan` items → qty 0 / remove. **Never auto-delete a `manual` row.**
- Does NOT synthesize `sale_events` — keep `record_sale` as-is for P&L.

### Doc edits (proposal §8) — do at end of B1
- `CLAUDE.md` hard constraint: "no DE auth ever" → "no programmatic DE login (Akamai-dead); real
  inventory only via opt-in, consent-gated memory-scan (`gamescan`, isolated, Linux-only),
  ToS-prohibited/ban-risky, off by default. See `GAME_INVENTORY_IMPORT.md`."
- `WFM_ACCOUNT_SIGNIN.md`: add pointer; keep listings as the zero-risk default.
- `README.md`: feature under Settings with ban-risk caveat.

### macOS
Gate the whole feature behind `#[cfg(target_os = "linux")]`; macOS stays manual/listings-only (SIP
makes cross-process reads impractical). `game_scan_status` returns `warframe_running:false` /
unsupported on non-Linux.

---

## New Cargo deps
- `nix = { version = "0.29", features = ["uio","process"] }` (for `process_vm_readv`) — or raw
  `/proc` via std (decide in B2). Nothing else; `reqwest` already present.

## Risk posture (carry through)
- Off by default; typed-phrase consent persisted; revocable; scan codepath errors if not consented
  (checked in BOTH command and `gamescan::scan()`).
- No auto-sync in v1 (proposal §9 auto deferred — it's a risk dial).
- nonce/accountId never persisted or logged.
