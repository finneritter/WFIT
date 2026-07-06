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
cheap-item exclusion. The app now has **16 screens** (Dashboard, Market, Relics, Account, Arcanes, and a
**Riven Search** screen all added beyond the 9-screen wireframe), plus a global-hotkey Void Cascade HUD overlay.
`docs/HANDOFF.md` is the current-state doc; read it first. The `.claude/plans/` and
`docs/archive/` files (incl. `CLAUDE_ECONOMIC_RESEARCH/`) are now historical design references, not a to-do list.

## Authoritative documents (read before coding)

- **`docs/FEATURE_PLAYBOOK.md`** — THE "how we add a feature" reference: the universal contracts
  (Rust owns logic, types mirror 1:1, one market throttle, click-opens-Drawer, search on every
  listing page), the frontend/backend checklists, and the shared pricing/valuation/exclusion
  helpers that MUST be reused instead of reimplemented. **Open this whenever building a feature.**

- **`.claude/plans/i-just-added-the-noble-widget.md`** — THE approved implementation plan (schema,
  module layout, command surface, build order, locked decisions). Start here — it's the build roadmap.
- **`docs/DATA_SOURCING_MASTER_PLAN.md`** — the warframe.market data contract (3 endpoints, verified
  field facts, the catalog two-pass strategy). All prices/catalog come from here.
- **`docs/GAMESTATE_WORLDSTATE.md`** — the Rotation screen's sources (isolated + read-only).
  **Fissures = DE's raw `api.warframe.com/cdn/worldState.php`** (authoritative; minimally parsed in
  `worldstate/raw.rs`, decoded via the bundled `sol_nodes.tsv` + `MT_*` maps), cross-checked against /
  falling back to `api.warframestat.us` (which feeds the slow-moving extras: sortie/Baro/Varzia/Steel
  Path — fetch the canonical `/pc/` with a cache-buster; its origin has been seen hours stale).
  **World cycles are derived locally** (`worldstate/cycles.rs`: DE bounty-window anchor + deterministic
  clocks), not taken from warframestat. A 3-min backend refresher keeps it fresh even while
  the webview throttles. Fissures are grouped Normal / Steel Path / Void Storm. The screen is tabbed
  (Overview · Fissures). The **Relics** screen is a full-catalog spreadsheet browser (every known
  relic, owned or not; squad-aware best-of-N drop EV + ducat EV via `domain/relic.rs::squad_ev`;
  burn-order default sort with set/wanted signals from `wanted::crack_signals` — no crackable-now,
  Omnia fissures take any tier; rare-drop price column + `rare > Np` filter; VAULT / AYA (Varzia's
  current Resurgence stock, resolved from worldstate projections) / protected do-not-burn tags;
  relic reference data auto-refreshes from WFCD on launch when >3 days stale; row click →
  `RelicDrawer` with per-refinement EV/ROI and per-drop ownership — see
  `db/relics.rs::browser_rows`/`detail`); vendors live in the standalone
  **Vendors** board (Baro · Varzia · Teshin, plus Wave-2: the Duviri **Circuit** Incarnon week from
  DE raw `EndlessXpSchedule`, and **Nora's cred shop** from a bundled dataset —
  `domain/data/nightwave_offerings.tsv`).
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
  `User-Agent: wfit-desktop/<crate version>` (one shared constant: `lib.rs::USER_AGENT`, tied to
  `CARGO_PKG_VERSION`), `Language: en`, `Platform: pc`, `Accept: application/json`.
  Global throttle: **400ms min-gap (~2.5 req/s), serialized across concurrent callers** (the async
  mutex is held across the wait — don't "optimize" it back to a read-release-sleep-stamp that lets
  concurrent callers burst; that caused 429s). ALL warframe.market calls go through it — one
  chokepoint. Writes (`create/update/delete_order`) additionally retry on a 429.
- **No programmatic DE login** — POSTing credentials to DE's auth endpoint is dead (Akamai-blocked /
  decommissioned). The safe, default "sign-in" is to a *warframe.market* account, only for reading
  your own orders. **Exception (opt-in):** real owned inventory is available via a consent-gated
  **memory-scan** of the running game client (`gamescan` module — isolated from the market path,
  **Linux + Windows**, off by default; macOS unsupported — SIP blocks cross-process reads). It does
  NOT log in; it reuses the live session. **ToS-prohibited and ban-risky.** See
  `docs/GAME_INVENTORY_IMPORT.md` and `.claude/plans/game-inventory-import.md`.
- Endpoint quirks: catalog = `GET /v2/items`; per-item detail = `GET /v2/items/<slug>` (plural;
  singular 404s); statistics = `GET /v1/items/<slug>/statistics` (v2 stats 404). Your orders =
  `GET /v2/orders/user/<name>`; public item orders = `GET /v2/orders/item/<slug>`. `vaulted` is
  exposed nowhere — not a feature.
- DB at `$APPDATA/wfit/…` via Tauri `app_data_dir()`; created + migrated on launch. Everything
  except inventory/sales/watchlist/buy_list is a rebuildable cache of the APIs.
- Domain transforms (partname/derive/parts) live **Rust-only**; the frontend gets finished objects.

## Commands

- **Session start: `git pull` before doing anything else.** This repo is worked on from two
  machines (Linux desktop + Mac laptop), so the local checkout may be behind `main`. If the working
  tree is dirty or the pull reports a divergence, stop and ask instead of merging/rebasing blindly.
- `npm run tauri:dev` — run the desktop app. The WebKitGTK/Wayland workaround env vars are set in
  `main()` on Linux (override by exporting them yourself). `npm run dev` — frontend only.
  `scripts/install.sh` — build an optimized release and install it as a launchable app (search
  "WFIT" in KRunner). Release bundles: push a `v*` tag → `.github/workflows/release.yml` builds
  Linux + Windows bundles into a draft GitHub release.
- `npm run build` — `tsc` typecheck + Vite build. In `src-tauri/`: `cargo build` / `cargo clippy` /
  `cargo test` (Rust unit tests exist — pricing/valuation/gamescan logic).
- **Dev dashboard** — a local **stress + observability + fault-injection** web dashboard the app
  serves on a loopback HTTP server (`127.0.0.1:8848`, `WFIT_DASH_PORT` to change, `0` to disable),
  opened from **Settings › Developer › Web dashboard** (no auto-open). It's behind the
  **`dev-dashboard` Cargo feature — OFF by default since the public beta** (an unauthenticated
  loopback server doesn't ship to strangers): release CI bundles are lean, while `npm run tauri:dev`
  and `scripts/install.sh` pass `--features dev-dashboard` explicitly so local workflows keep it.
  CI tests with the feature on AND checks the lean config compiles without axum
  (`cargo tree -e no-dev | grep axum`). Everything lives in
  `src-tauri/src/devtools/`; hot-path instrumentation (market throttle, DB writer/read pool, heartbeat,
  `owned_holdings`) is zero-cost when the feature is off (no-op shims / `#[cfg]` blocks). Reproducible
  CLI: `cargo bench --features bench` (criterion microbench of the liquidation curve) and
  `scripts/stress.sh` (drives the dashboard's HTTP API through a scenario). When touching the market/db
  hot paths, keep the recorder/fault shims intact and DON'T let timing wrap the throttle *wait* (only
  `send().await`) — that would skew latency and risk the serialization guarantee. NOTE: the stress
  endpoints (simulate/clear/rebuild) are unauthenticated on the loopback port; destructive ones
  snapshot the DB first.
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
(opt-in DE memory-scan inventory import — isolated like worldstate, Linux + Windows, off by default;
per-OS backend behind a shared `scan.rs` `MemReader` trait), `rivens/` (Riven Search domain — separate
warframe.market surface: v2 riven reference/weapons/attributes + v1 auction search; `grade.rs`/`price.rs`
value estimator + `watch.rs` saved-search matching, isolated from the main market path), `overlay.rs`
(global-hotkey Void Cascade status HUD pill; always-on-top, Rust-owned auto-hide), `notify.rs` +
`wfm_socket.rs` (in-app notification center + wfm websocket), `domain/`
(`classify`/`partname`/`mod_rarity`/`arcane` — pure; the rarity & arcane datasets are bundled `.tsv`s
loaded into `Lazy` maps, no DB table), `db/` (rusqlite modules per table — inventory, prices, settings,
watchlist, buylist, sales, sets, trends, relics, rivens, arcanes, notifications, etc.; transactional
writes), `commands.rs` (the `#[command]` surface), `lib.rs` (`AppState` + handler registry).
**DB connection model** (`db/mod.rs`): one writer behind a mutex (`with`/`with_mut`, also used by the
few legacy read paths) **plus an r2d2 pool of `query_only` read connections** (`read()`) for hot UI
reads, so a market sync holding the writer doesn't freeze the UI (WAL = concurrent readers).
Frontend in `src/`: React Query hooks calling `invoke()` (`lib/api.ts`), components/routes ported
from `wireframe.jsx` (Arcanes is beyond it), the wireframe's CSS lifted to `theme.css`
(square/dense/mono, no radius; micro-animations + a `prefers-reduced-motion` guard).

**Topbar search is a cross-cutting contract — maintain it on every new page/tab.** The topbar input
is shared by all screens; a page filters its own rows with the DIM-style query grammar in
`lib/searchQuery.ts`. When you add a screen OR a new tab that lists rows, you MUST: (1) add a
`SearchSchema<Row>` in `lib/searchSchemas.ts` (`text`/`is`/`fields`), (2) register it in
`PAGE_SCHEMAS` (+ a `PAGE_PLACEHOLDER`) for a full screen, and (3) in the component, call
`usePageSearch()` → `compileQuery(search, schema)` → `rows.filter(test)` so the bar actually narrows
the list. A tab inside a screen (e.g. Listings' "Recommended") compiles its own schema against
`usePageSearch()` even though the topbar autocomplete uses the screen's registered schema. Prefer
inventory-style filter controls (`components/Dropdown` + `chip` toggles in a `.filters` row) for
category/sort axes that don't fit the text grammar. A page that renders rows without wiring search is
considered incomplete.

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
per-item `confidence` gates presentation. Economics in `docs/archive/CLAUDE_ECONOMIC_RESEARCH/`.

**Live heartbeat** (`lib.rs::spawn_price_heartbeat`): a perpetual 45s-tick rolling repricer —
tiered watchlist (~10min) → owned (~60min) → catalog tail (6h TTL), ~12 stats + ~6 order books per
tick, listings mirror every ~10min — that defers to any active full sync (`pricing_active`), stamps
`last_price_sync`, and emits a `prices-updated` Tauri event the frontend listens for
(`useLivePriceEvents`) to refetch value-bearing views immediately. Topbar `LiveBadge` shows data age.

**Auto-reprice:** bump `PRICING_VERSION` (`lib.rs`) whenever the *cached* price derivation changes
(`price_cache`/`price_rank`/`order_cache`/`buy_orders`) — on launch a mismatch wipes those caches and
recomputes. NOTE: `realizable_plat` is computed fresh each `get_inventory` (not cached), so valuation-
*rule* changes take effect immediately and need no bump. Do NOT rely on the TTL alone for cached logic.
