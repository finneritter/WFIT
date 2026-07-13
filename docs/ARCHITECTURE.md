# WFIT Architecture

WFIT is a local-first desktop app: a Rust core (Tauri 2) owning all data and domain logic, a
single SQLite file for state, and a React/Vite frontend that renders finished objects. There is
no server component — everything except `inventory` / `sales` / `watchlist` / `buy_list` /
`owned_relics` / user settings is a rebuildable cache of public APIs.

**Stack:** Tauri 2 (Rust) · rusqlite (WAL) · React 18 + Vite + TypeScript · TanStack Query · Biome.

**Design rules that hold everywhere:**

- **Rust owns the logic.** Domain transforms (name parsing, classification, pricing, valuation,
  EV math) live in `src-tauri/src/`; the frontend receives finished row objects over `invoke()`
  and renders them. Types mirror 1:1 (`src-tauri/src/types.rs` ↔ `src/lib/types.ts`, snake_case).
- **One market chokepoint.** Every warframe.market call goes through a single throttled client
  (`market.rs`): 400 ms minimum gap, serialized across concurrent callers, shared `User-Agent`
  tied to the crate version.
- **Consistency over cleverness.** Anything that changes what an item is worth must flow through
  the shared pricing helpers so the grid, drawer, summary, and trends can never disagree.

## Repository layout

```
src-tauri/src/          Rust core
  market.rs             warframe.market v2 client + global throttle
  worldstate/           live game state: DE raw worldState.php (authoritative for fissures,
                        cross-checked vs api.warframestat.us) + locally-derived world cycles
  wfm_account.rs        warframe.market account session (keychain-stored JWT), order writes
  wfm_socket.rs         warframe.market websocket (order events → notifications)
  gamescan/             opt-in, consent-gated memory scan of the running game client for real
                        inventory import (Linux + Windows; isolated from the market path)
  rivens/               riven search: separate wfm surface (v2 reference + v1 auctions),
                        value estimator (grade.rs/price.rs), saved-search watcher (watch.rs)
  overlay.rs            global-hotkey always-on-top Void Cascade HUD (separate tiny webview)
  notify.rs             desktop + in-app notification engine
  domain/               pure functions + bundled datasets (no I/O): classify, partname,
                        mod_rarity, arcane, relic (incl. squad-EV order statistics),
                        vendors (static vendor registry — non-rotating shop stock)
  db/                   one module per table/feature; transactional writes
  commands.rs           the #[tauri::command] surface
  lib.rs                AppState, handler registry, launch warm-up, background tasks
src/                    React frontend (routes/, components/, hooks/, lib/)
docs/                   feature and data-contract documentation
reference/              design wireframes and prior prototypes kept for context
```

## Database

- Lives at `$APPDATA/wfit/wfit.sqlite` (e.g. `~/.local/share/dev.finn.wfit/` on Linux); created
  and migrated on launch. A pre-migration snapshot is written to `…/backups/` before any pending
  migration; manual backups use `VACUUM INTO` (Settings → Backups). If the DB fails to open or
  migrate, the app boots into a recovery screen instead of panicking.
- **Connection model** (`db/mod.rs`): one writer behind a mutex (`with`/`with_mut`) plus an r2d2
  pool of `query_only` read connections (`read()`). WAL lets reads run while a sync holds the
  writer, so a long market sync never freezes the UI. Readers error loudly on stray writes.
- Pragmas on every connection: `busy_timeout=5000`, 64 MB page cache, 256 MB mmap,
  `temp_store=MEMORY`.
- **Migrations** (`src-tauri/migrations/`, `SCHEMA_VERSION` in `db/mod.rs` must match):
  `0001_init` catalog/inventory/watchlist/sales/sets · `0002_ohlc` · `0003_game_import` ·
  `0004_ranks` · `0005_orders` · `0006_buy_orders` · `0007_mod_rarity` · `0008_vault_status` ·
  `0009_perf_indexes` · `0010_order_fetch_meta` · `0011_owned_relics` · `0012_relic_data` ·
  `0013_account` · `0014_rivens` · `0015_riven_search_thresholds` · `0016_app_notifications` ·
  `0017_vendor_checkoff` · `0018_relic_prefs`.
- **Bundled reference data** (no DB table, or DB-seeded + live-refreshable): TSVs under
  `src-tauri/src/domain/data/` loaded into lazy maps — mod rarity, arcane dissolution values,
  relic ids/drop tables/vault flags (seeded to DB, hot-swapped from WFCD `Relics.json`; refreshed
  on launch when older than 3 days), Sol node names, Nightwave offerings, and static vendor
  offerings (`domain/data/vendors/` — one TSV per vendor, six syndicates so far; seeded from
  wiki.warframe.com by `scripts/scrape_vendors.py` into committed, hand-reviewed files — the app
  never touches the wiki at runtime).

## Data sources

| Source | Used for | Notes |
|---|---|---|
| warframe.market v2/v1 | item catalog, prices, order books, ducats, your listings, rivens | the only market source; 400 ms global throttle; v1 only where v2 has no equivalent (statistics, auction search) |
| DE `worldState.php` | fissures (authoritative), Circuit schedule, Varzia stock | raw feed, minimally parsed in `worldstate/raw.rs`, decoded with bundled WFCD data |
| api.warframestat.us | sortie, Baro, Nightwave, fallback fissures | slow-moving extras; origin can lag, so it is cross-checked against DE |
| WFCD `warframe-items` | relic drop tables + vault flags, item vault status | bundled snapshot + live refresh |
| World cycles | Cetus/Vallis/Cambion/Duviri clocks | derived locally from a DE anchor + deterministic game math, not scraped |

## Pricing and valuation

The most-iterated subsystem. Full details in `docs/PERF_OPTIMIZATION.md` and inline docs.

- **Effective price** (`db/prices.rs::effective_price`): live lowest ask (median of the cheapest
  five online sells) → per-rank trade median → headline median, with a high-ball clamp so one
  troll ask can't inflate a valuation. Mods and arcanes are priced per rank.
- **Batched valuation:** `PriceMaps` preloads the order/rank/headline tables in three queries;
  `effective_price_from` / `rank_aware_value_from` are in-memory twins of the SQL (kept identical
  by pinned tests). Valuing an 800-item inventory costs ~7 queries, not ~2000.
- **Realizable value** (`db/inventory.rs`): market price × quantity overvalues hoards, so
  multi-copy mod/arcane stacks are liquidated into the live bid ladder plus a volume-capped,
  discounted tail. Prime parts and single copies keep full value — they are liquid. The portfolio
  headline is the realizable number; the optimistic ceiling is shown alongside.
- **Live heartbeat** (`lib.rs::spawn_price_heartbeat`): a perpetual 45-second tick repricing the
  stalest tier — watchlist (~10 min) → owned (~60 min) → catalog tail (6 h TTL) — well under the
  throttle ceiling. Ticks that change data emit a `prices-updated` event; the frontend refetches
  value-bearing views immediately. A topbar badge shows data age.
- `PRICING_VERSION` (`lib.rs`) is bumped whenever cached price derivation changes; a mismatch on
  launch wipes the derived caches and reprices cleanly.

## Frontend contracts

- **Screens** (`src/routes/`): Home (customizable widget dashboard), Inventory, Sets, Arcanes,
  Relics (full-catalog browser + RelicDrawer), Ducats, Listings, Sold History, Market screener,
  Riven Search, Watchlist, Buy List, Trends, Rotation, Vendors board (tabbed: Live rotating
  vendors · Syndicates static shops, more static groups planned), Account, Settings — plus
  the Void Cascade overlay window.
- **Topbar search** applies to every listing screen through one DIM-style grammar
  (`lib/searchQuery.ts`): free text, `is:` flags, `field:value`, numeric comparisons (`ev>30`).
  Each screen registers a `SearchSchema` in `lib/searchSchemas.ts` that drives both filtering and
  autocomplete. A page that lists rows without wiring the search is considered incomplete.
- **Click-opens-drawer** everywhere: any item row calls `onOpen(slug)` and the shared `Drawer`
  (price, candles, spread, realizable value, rank breakdown, relic sources, actions) opens on the
  right. The Relics screen has its own `RelicDrawer`; the item drawer stacks on top of it.
- **Query layer:** thin `invoke()` wrappers in `lib/api.ts`, React Query hooks + centralized
  query keys in `hooks/queries.ts`, precise invalidation per mutation, and a `prices-updated`
  listener that refreshes active views when the heartbeat lands.
- **Design language — the connected sheet (void revamp, 2026-07):** dense mono/void-blue theme
  where hairlines run edge to edge and always meet another line. List screens are full-bleed via
  one of two `App.tsx` content classes: `content-flush` (single-table spreadsheet screens —
  Relics/Sets/Vendors; the `.rtable` owns its scroll, sticky header + summary footer) or
  `content-sheet` (multi-band pages — Inventory/Trends/Arcanes/Listings/Market/Watchlist/Buy
  List/Ducats/Sold History/Account, the `SHEET_SCREENS` set in `App.tsx`; panels flatten into
  full-width ruled bands and tables gain column hairlines). `.statband` is a fused stat strip
  (cell dividers, no boxes) everywhere. Full contract + checklist: `docs/FEATURE_PLAYBOOK.md` §B.

## Testing and verification

- Gates: `cargo test` (unit tests cover pricing twins, valuation rules, relic EV math, worldstate
  parsing, riven grading), `cargo clippy`, `cargo fmt`, `tsc` + `vite build`, `biome check`.
- **Live-DB probes:** pricing bugs are usually data-integration bugs invisible to unit tests, so
  `#[ignore]`d probe tests open a *copy* of the real database and print derived values for
  hand-checking (`WFIT_LIVE_DB=/tmp/copy.sqlite cargo test <probe> -- --ignored --nocapture`).
  Always probe a copy — opening the live file with newer code migrates it out from under the
  installed binary.
- Headless UI checks drive the built frontend in Chromium (`playwright-core`) with a stubbed
  `__TAURI_INTERNALS__` and canned command data.

## Building and releasing

```sh
npm run tauri:dev        # dev app (Rust + Vite, dev-dashboard feature enabled)
npm run build            # tsc + vite production build
scripts/install.sh       # optimized local build installed as a desktop app
```

- Linux needs `webkit2gtk-4.1`; the WebKitGTK/Wayland rendering workarounds are set in `main()`.
- Releases: push a `v*` tag → GitHub Actions builds Linux + Windows bundles, signs the updater
  artifacts, and uploads them with `latest.json` to a draft release. If the tag-push event never
  reaches Actions (observed with v1.4.0 — also check the workflow hasn't been silently disabled),
  dispatch the same build manually: `gh workflow run release.yml -f tag=vX.Y.Z` checks out that
  tag and produces the identical draft release. Publishing the release makes
  existing installs (Windows + AppImage) offer the update in-app; deb/rpm users get a
  notification linking to Releases.
- The optional dev dashboard (loopback stress/observability server, `dev-dashboard` Cargo
  feature) is compiled out of release bundles and enabled for local dev builds.
