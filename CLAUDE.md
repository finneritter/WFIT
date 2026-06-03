# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

WFIT ("Warframe Item Tracker") — a single-user **Tauri 2 (Rust) + local SQLite + React/Vite/Tailwind**
desktop app for tracking owned Warframe tradeable items, warframe.market prices/trends, a buy
watchlist, sales, set completion, ducat conversion, your warframe.market sell orders, and live
world-state (fissures/cycles/Baro). It is a rewrite of an old React+Supabase webapp — the entire
cloud backend is being deleted in favor of one local binary. **No auth, no hosting, no deploy.**

**Status: implemented and working** (Tauri app builds, runs, and is installed; committed/pushed to
`main` on the private repo `github.com/finneritter/WFIT`). All planned phases plus many features
beyond the original plan are done — game inventory import, rank-aware mods/arcanes, robust order-book
pricing, liquidation-adjusted ("realizable") valuation, an **Arcanes/Vosfor dissolution screen**, a
backend perf pass (read-connection pool + batched valuation), UI micro-animations, and per-category
cheap-item exclusion. The app now has **11 screens** (Arcanes added beyond the 9-screen wireframe).
`docs/HANDOFF.md` is the current-state doc; read it first. The `.claude/plans/` and
`reference/CLAUDE_ECONOMIC_RESEARCH/` files are now historical design references, not a to-do list.

## Authoritative documents (read before coding)

- **`.claude/plans/i-just-added-the-noble-widget.md`** — THE approved implementation plan (schema,
  module layout, command surface, build order, locked decisions). Start here — it's the build roadmap.
- **`docs/DATA_SOURCING_MASTER_PLAN.md`** — the warframe.market data contract (3 endpoints, verified
  field facts, the catalog two-pass strategy). All prices/catalog come from here.
- **`docs/GAMESTATE_WORLDSTATE.md`** — the Rotation screen's sources (isolated + read-only).
  **Fissures = DE's raw `api.warframe.com/cdn/worldState.php`** (authoritative; minimally parsed in
  `worldstate/raw.rs`, decoded via the bundled `sol_nodes.tsv` + `MT_*` maps), cross-checked against /
  falling back to `api.warframestat.us` (which still feeds cycles/Baro — fetch the canonical `/pc/`
  with a cache-buster; its origin lags minutes). A 3-min backend refresher keeps it fresh even while
  the webview throttles. Fissures are grouped Normal / Steel Path / Void Storm.
- **`docs/ARCANE_DISSOLUTION.md`** — the Arcanes screen's domain reference (Loid Vosfor collections,
  drop tables, per-arcane Vosfor, the collection-EV + keep/dissolve methodology). Bundled dataset.
- **`docs/PERF_OPTIMIZATION.md`** — the backend perf pass (read pool, batched valuation, pragmas).
- **`docs/WFM_ACCOUNT_SIGNIN.md`** — warframe.market account connect for the Listings screen (Tier 1
  username / Tier 2 pasted-JWT in OS keychain; read-only in v1).
- **`reference/design_handoff_wfit_update1/`** — THE design target (9-screen monochrome DIM-style wireframe).
  `README.md` + `wireframe.jsx` + `WFIT Wireframe.html`. Build as-is. The mock `CATALOG`/prices in
  `wireframe.jsx` are FAKE — take only layout/tokens/behavior; all real data comes from the APIs.
- **`reference/prior-tauri-attempt/`** — a working older Tauri scaffold (rusqlite). Reuse its
  plumbing (Db handle, error, migration runner, transactional writes, throttle, command shape);
  **rewrite `market.rs`** — it targets the dead v1 `/items` catalog, the app now uses v2.
- **`reference/market-proxy/index.ts`** — the v2 catalog + statistics logic to port to Rust
  (`partTypeOf`/`categoryOf`/`deriveSetSlug`, median/trend derivation, 350ms throttle).

Retired (do not build from): `reference/design/` (old "Primely" hi-fi),
`reference/design_handoff_wfit/` (superseded by update1). "Primely" is the old name of the app.

## Hard constraints (carry into all work)

- **warframe.market is the sole source for items/prices/ducats/sets.** Headers on every request:
  `User-Agent: wfit-desktop/0.1`, `Language: en`, `Platform: pc`, `Accept: application/json`.
  Global throttle: **350ms min-gap (~3 req/s)** across ALL warframe.market calls — one chokepoint.
- **No programmatic DE login** — POSTing credentials to DE's auth endpoint is dead (Akamai-blocked /
  decommissioned). The safe, default "sign-in" is to a *warframe.market* account, only for reading
  your own orders. **Exception (opt-in):** real owned inventory is available via a consent-gated
  **memory-scan** of the running game client (`gamescan` module — isolated from the market path,
  Linux-only, off by default). It does NOT log in; it reuses the live session. **ToS-prohibited and
  ban-risky.** See `docs/GAME_INVENTORY_IMPORT.md` and `.claude/plans/game-inventory-import.md`.
- Endpoint quirks: catalog = `GET /v2/items`; per-item detail = `GET /v2/items/<slug>` (plural;
  singular 404s); statistics = `GET /v1/items/<slug>/statistics` (v2 stats 404). Your orders =
  `GET /v2/orders/user/<name>`; public item orders = `GET /v2/orders/item/<slug>`. `vaulted` is
  exposed nowhere — not a feature.
- DB at `$APPDATA/wfit/…` via Tauri `app_data_dir()`; created + migrated on launch. Everything
  except inventory/sales/watchlist/buy_list is a rebuildable cache of the APIs.
- Domain transforms (partname/derive/parts) live **Rust-only**; the frontend gets finished objects.

## Commands

- `npm run tauri:dev` — run the desktop app (bakes in the WebKitGTK/Wayland env vars; plain
  `tauri dev` crashes on this box). `npm run dev` — frontend only. `scripts/install.sh` — build an
  optimized release and install it as a launchable app (search "WFIT" in KRunner).
- `npm run build` — `tsc` typecheck + Vite build. In `src-tauri/`: `cargo build` / `cargo clippy` /
  `cargo test` (Rust unit tests exist — pricing/valuation/gamescan logic).
- "Verify" = gates green (`cargo test`/`clippy`, `tsc`, `npm run build`, `biome`) AND it builds/runs.
  Data-level bugs need a live-DB spot-check (`sqlite3 $DB`), not just the gates — most pricing bugs
  this project hit were data/integration issues invisible to unit tests.
- **Linting/formatting = Biome** (chosen) for the frontend — set up once the project is scaffolded
  (`npx @biomejs/biome init`); use `npx biome check --write` to format+lint. Rust uses `cargo fmt` / `cargo clippy`.
- **Linux runtime prereq:** `webkit2gtk-4.1` must be installed (`sudo pacman -S webkit2gtk-4.1` on
  this CachyOS box) before `tauri dev` works. macOS builds must be done on macOS (no cross-compile).

## Architecture (target)

Rust core in `src-tauri/src/`: `market.rs` (warframe.market v2 client + throttle), `worldstate.rs`
(api.warframestat.us, isolated), `wfm_account.rs` (account/orders + keychain), `gamescan/`
(opt-in DE memory-scan inventory import — isolated like worldstate, Linux-only, off by default), `domain/`
(`classify`/`partname`/`mod_rarity`/`arcane` — pure; the rarity & arcane datasets are bundled `.tsv`s
loaded into `Lazy` maps, no DB table), `db/` (rusqlite modules per table incl. `arcanes.rs`,
transactional writes), `commands.rs` (the `#[command]` surface), `lib.rs` (`AppState` + handler registry).
**DB connection model** (`db/mod.rs`): one writer behind a mutex (`with`/`with_mut`, also used by the
few legacy read paths) **plus an r2d2 pool of `query_only` read connections** (`read()`) for hot UI
reads, so a market sync holding the writer doesn't freeze the UI (WAL = concurrent readers).
Frontend in `src/`: React Query hooks calling `invoke()` (`lib/api.ts`), components/routes ported
from `wireframe.jsx` (Arcanes is beyond it), the wireframe's CSS lifted to `theme.css`
(square/dense/mono, no radius; micro-animations + a `prefers-reduced-motion` guard).

## Pricing & valuation (the most-iterated subsystem — read before touching it)

Per-item **price** (`db/prices.rs::effective_price`): live lowest **ask** (`order_cache`, median of
the cheapest 5 online sells) → per-rank trade median (`price_rank`) → headline median. Trade medians
themselves are outlier-robust (`market.rs::robust_price` = winsorized, volume-weighted). Mods/arcanes
are priced **per rank** (`mod_rank` from statistics; rank-0 vs max are different goods).

**Batched valuation (perf):** `get_inventory` no longer runs `effective_price` per item. `prices::PriceMaps`
+ `load_owned_price_maps` preload order/rank/headline once; **`effective_price_from` / `rank_aware_value_from`
are in-memory twins of the SQL and MUST stay identical to `effective_price`/`rank_price`**; bid ladders
and sparklines load via `bid_ladders_for`/`recent_medians_for`. `owned_holdings` runs the whole valuation
in one pooled `db.read()`.

**Realizable (liquidation-adjusted) value** (`db/inventory.rs::owned_holdings` + `realizable_value`): a
market price is a *marginal* price, so `× qty` overvalues hoards. **Full value (no haircut) when the row
is a prime part (`warframe`/`weapon`/`set`) OR a single copy (`qty <= 1`)** — those are liquid/fungible.
Only **multi-copy mod/arcane stacks** are haircut: liquidate into the live **buy orders** (`buy_orders`,
best-bid-first) then a volume-capped, discounted tail (`TAIL_FACTOR`, `WINDOW_DAYS`); units beyond real
demand ≈ 0. Exclusions (rarity list + per-category min-plat, `settings`) zero a row's value via the
`excluded` flag. `Summary.realizable_plat` is the honest headline, `total_plat` the optimistic "ceiling";
per-item `confidence` gates presentation. Economics in `reference/CLAUDE_ECONOMIC_RESEARCH/`.

**Live heartbeat** (`lib.rs::spawn_price_heartbeat`): a perpetual 45s-tick rolling repricer —
tiered watchlist (~10min) → owned (~60min) → catalog tail (6h TTL), ~12 stats + ~6 order books per
tick, listings mirror every ~10min — that defers to any active full sync (`pricing_active`), stamps
`last_price_sync`, and emits a `prices-updated` Tauri event the frontend listens for
(`useLivePriceEvents`) to refetch value-bearing views immediately. Topbar `LiveBadge` shows data age.

**Auto-reprice:** bump `PRICING_VERSION` (`lib.rs`) whenever the *cached* price derivation changes
(`price_cache`/`price_rank`/`order_cache`/`buy_orders`) — on launch a mismatch wipes those caches and
recomputes. NOTE: `realizable_plat` is computed fresh each `get_inventory` (not cached), so valuation-
*rule* changes take effect immediately and need no bump. Do NOT rely on the TTL alone for cached logic.
