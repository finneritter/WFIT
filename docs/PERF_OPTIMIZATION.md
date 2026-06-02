# WFIT — Responsiveness Optimization (2026-06-02)

A focused pass to make the app feel instant with a **large real inventory (800+ items, lots of
mods)**. Two compounding problems were fixed: (1) the UI froze whenever a market price sync ran,
and (2) reads and renders were heavy at scale. Read with `CLAUDE.md` and `docs/HANDOFF.md`.

**Branch:** `perf/responsiveness`. **Status:** all gates green; backend changes proven
value-preserving against the live 655-item DB. Not yet merged to `main`.

Gates: `cargo test` **24 pass + 1 ignored** · `cargo clippy` clean · `cargo fmt` · `tsc` ·
`npm run build` (routes now code-split into per-screen chunks). Pre-existing Biome a11y/style
warnings on untouched files are tolerated (same policy as prior sessions).

---

## The two root problems

1. **Froze during background work.** Every DB read and write shared one mutex-locked SQLite
   connection (`db/mod.rs`). A market sync (`lib.rs::launch_refresh` — batched upserts + order-book
   drains) held that lock for seconds and **all reads blocked** → the whole UI stalled.
2. **Reads + renders heavy at scale.** `get_inventory` fanned out into ~2000+ per-item/per-rank/
   per-set queries. On the frontend no list was virtualized, row components weren't memoized, the
   drawer chart recomputed every render, Rotation's 1s tick re-rendered the whole page, and one
   inventory edit force-refetched the entire catalog (5 large queries).

---

## Phase 1 — Backend (the freeze fix + N+1 collapse)

### Read/write connection split (`src-tauri/src/db/mod.rs`)
- `Db` now holds the single writer `Arc<Mutex<Connection>>` **plus** an `r2d2` pool of 4
  `query_only` read connections (`r2d2`, `r2d2_sqlite` added to `Cargo.toml`).
- New method **`Db::read(|c| …)`** runs read-only closures on a pooled connection — never blocks on
  the writer mutex. WAL allows concurrent readers during a write, so reads stay responsive mid-sync.
- `with` / `with_mut` are unchanged (writer mutex). **Important:** `with` doubles as a write path in
  many modules (buylist, watchlist, wfm, gamescan, settings, meta, vault, inventory mutations,
  `rebuild_cache`), so the split is **opt-in** — only verified read-only paths moved to `read()`.
  Readers are `query_only`, so any stray write routed to `read()` errors loudly instead of corrupting.
- Paths moved to `read()`: all of `catalog.rs`, `sets.rs`, `trends.rs`; the read helpers in
  `prices.rs` and `inventory.rs`; and `get_item_detail`'s reads in `commands.rs`.

### Pragmas (all connections, `tune()` in `db/mod.rs`)
`busy_timeout=5000` (wait, don't `SQLITE_BUSY`, when a reader briefly meets the writer's commit),
`cache_size=-65536` (64 MB), `mmap_size=256 MB`, `temp_store=MEMORY`. WAL + `synchronous=NORMAL`
unchanged on the writer.

### Batched the inventory N+1 (`db/prices.rs`, `db/inventory.rs`)
`get_inventory` went from **~2000+ queries to ~7**, with identical output:
- `prices::PriceMaps` + `load_owned_price_maps(c)` preload `order_cache` / `price_rank` /
  `price_cache` for all owned slugs in 3 queries. `effective_price_from(maps, slug, rank)` and
  `rank_aware_value_from(...)` are **in-memory twins** of the SQL `effective_price` / `rank_price`
  (same live-ask → per-rank-median → headline precedence, same nearest-rank tiebreak). **Keep the
  twins in lockstep if you touch one.**
- `prices::bid_ladders_for(c, slugs)` and `recent_medians_for(c, slugs)` batch the per-row bid-ladder
  and 12-pt sparkline loads via one `IN (…)` query each.
- `inventory::memberships(c, set_slugs)` batches the per-set `set_members` lookup that ran inside the
  `owned_holdings` loop. `fetch_owned`/`set_templates` now take `&Connection`; `owned_holdings` runs
  the whole valuation inside one `db.read()` closure.

### Index (`migrations/0009_perf_indexes.sql`)
`idx_catalog_cat_name ON catalog_items(category, display_name)` for the dominant filter-then-sort
catalog access.

### Correctness proof
Two tests (`db/prices.rs`): `effective_price_from_matches_sql` (every precedence path) and
`rank_aware_value_from_sums_per_rank`. One concurrency test (`db/mod.rs`):
`read_does_not_block_on_a_held_write` — a `read` returns in <300ms while a `with_mut` holds the lock
for 600ms (the headline freeze-fix guarantee). Plus an **`#[ignore]` live probe**
(`inventory::tests::probe_real_db`) that fingerprints the entire valuation (per-row slug/qty/value/
realizable/median/spark) over a real DB copy:

```fish
WFIT_PROBE_DB=/path/to/wfit.sqlite cargo test --lib probe_real_db -- --ignored --nocapture
```

Run on this branch and on `main` against an **identical snapshot** (use `sqlite3 … ".backup"` so the
running app doesn't skew it) → byte-identical (`total_value=8850`, `total_realizable=5176`, same hash).

---

## Phase 2 — Data layer (`src/hooks/queries.ts`, `src/routes/Inventory.tsx`)

- **Optimistic catalog patching.** `patchCatalogRow(qc, slug, update)` patches the affected row in
  every cached catalog category, so the Add-items ✓/stepper updates instantly. Catalog invalidations
  switched to `refetchType: "none"` (mark stale, refetch lazily on next mount) — no more 5-column
  force-refetch on every inventory/watch/buy edit. Edge cases (e.g. set additions touching parts)
  self-reconcile on next modal open.
- **De-duplicated pricing-progress polling.** Inventory's separate 5s timer was removed; totals now
  refresh off the progress query's own updates (and once when the sync ends). Worldstate / progress
  polling was already screen-gated by React Query's observer model (each is consumed by exactly one
  screen, unmounted when you leave it), so no extra gating was needed.

---

## Phase 3 — Rendering (for 800+ items)

- **Memoization + stable handler.** `App.open` is now `useCallback` (stable identity), and
  `Tile` / `ChipItem` / `InvTable` / `Section` (`Inventory.tsx`), `Icon`, `Glyph`, `Spark`,
  `CandleChart` are `React.memo`. The grid no longer re-renders all rows on every 2s pricing tick or
  filter toggle.
- **`content-visibility: auto`** on `.tile` / `.chip-it` (`theme.css`) — browser-native offscreen
  skipping (the windowing win) without JS layout math. Chosen over `@tanstack/react-virtual` because
  the wrapping grids + user-adjustable tile sizes + multi-section page scroll make JS windowing
  fragile; this is zero-regression and uniform across all three views. Requires WebKit ≥2.46 (the box
  runs 2.52); degrades to a no-op on older WebKit. **Future option:** true windowing of the flat
  tables (Sold/Ducats) if hard DOM-count reduction is ever wanted.
- **CandleChart** geometry (percentile domain, MA7/MA30, candle/volume rects) moved into a
  `useMemo([candles,w,h])` (`charts.tsx`).
- **Rotation tick isolation** (`Rotation.tsx`). A self-ticking memoized `<Countdown>` leaf sharing one
  module-level interval replaces the page-level `useNow`; the heavy `fissures`/`typeSummary` memos no
  longer depend on `now`. Only timer cells repaint each second (expired fissures fall off on the ~45s
  worldstate refetch instead of the exact second — acceptable).
- **`Intl.NumberFormat` cached** as a module singleton in `lib/format.ts` (`fmt` ran hundreds of
  times per grid render).
- **Route code-splitting** (`App.tsx`). Each screen is a `React.lazy` chunk under one `<Suspense>`;
  only the active screen's module is parsed.

---

## Files changed

Backend: `db/mod.rs`, `db/inventory.rs`, `db/prices.rs`, `db/catalog.rs`, `db/sets.rs`,
`db/trends.rs`, `commands.rs`, `Cargo.toml`, new `migrations/0009_perf_indexes.sql`.
Frontend: `App.tsx`, `hooks/queries.ts`, `lib/format.ts`, `routes/Inventory.tsx`,
`routes/Rotation.tsx`, `components/{charts,Icon,ui}.tsx`, `theme.css`.

`PRICING_VERSION` was **not** bumped: Phase 1c is a pure batching refactor with proven-identical
output, so the derived caches don't need wiping.

---

## Verify

```fish
cd src-tauri && cargo test && cargo clippy && cargo fmt --check
cd .. && npx tsc --noEmit && npm run build
npm run tauri:dev   # eyeball: grid scroll at 60fps, Rotation timers tick without page repaint,
                    # add an item mid-sync and confirm the list stays interactive (no freeze)
```
The one thing not covered by gates is the live GUI feel — worth a quick `tauri:dev` to confirm the
grid scroll and Rotation timers.
