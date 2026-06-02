# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

WFIT ("Warframe Item Tracker") — a single-user **Tauri 2 (Rust) + local SQLite + React/Vite/Tailwind**
desktop app for tracking owned Warframe tradeable items, warframe.market prices/trends, a buy
watchlist, sales, set completion, ducat conversion, your warframe.market sell orders, and live
world-state (fissures/cycles/Baro). It is a rewrite of an old React+Supabase webapp — the entire
cloud backend is being deleted in favor of one local binary. **No auth, no hosting, no deploy.**

**Status: implemented and working** (Tauri app builds, runs, and is installed; committed/pushed to
`main` on the private repo `github.com/finneritter/WFIT`). All planned phases plus several features
beyond the original plan are done — game inventory import, rank-aware mods/arcanes, robust order-book
pricing, and liquidation-adjusted ("realizable") inventory valuation. `docs/HANDOFF.md` is the
current-state doc; read it first. The `.claude/plans/` and `reference/CLAUDE_ECONOMIC_RESEARCH/` files
are now historical design references, not a to-do list.

## Authoritative documents (read before coding)

- **`.claude/plans/i-just-added-the-noble-widget.md`** — THE approved implementation plan (schema,
  module layout, command surface, build order, locked decisions). Start here — it's the build roadmap.
- **`docs/DATA_SOURCING_MASTER_PLAN.md`** — the warframe.market data contract (3 endpoints, verified
  field facts, the catalog two-pass strategy). All prices/catalog come from here.
- **`docs/GAMESTATE_WORLDSTATE.md`** — the Rotation screen's source (`api.warframestat.us`, optional
  second source, isolated + read-only).
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
(classify/partname/parts — pure), `db/` (rusqlite modules per table, transactional writes),
`commands.rs` (the `#[command]` surface), `lib.rs` (`AppState{db,market}` + handler registry).
Frontend in `src/`: React Query hooks calling `invoke()` (`lib/api.ts`), components/routes ported
1:1 from `wireframe.jsx`, the wireframe's CSS lifted to `theme.css` (square/dense/mono, no radius).

## Pricing & valuation (the most-iterated subsystem — read before touching it)

Per-item **price** (`db/prices.rs::effective_price`): live lowest **ask** (`order_cache`, median of
the cheapest 5 online sells) → per-rank trade median (`price_rank`) → headline median. Trade medians
themselves are outlier-robust (`market.rs::robust_price` = winsorized, volume-weighted). Mods/arcanes
are priced **per rank** (`mod_rank` from statistics; rank-0 vs max are different goods).

**Realizable (liquidation-adjusted) value** (`db/inventory.rs::realizable_value`): a market price is a
*marginal* price, so `× qty` overvalues hoards. Each holding is valued by liquidating it into the live
**buy orders** (`buy_orders`, best-bid-first), then a volume-capped, discounted tail (`TAIL_FACTOR`,
`WINDOW_DAYS`); units beyond real demand ≈ 0. `Summary.realizable_plat` is the honest headline,
`total_plat` the optimistic "ceiling." Per-item `confidence` (high/medium/low) gates presentation.
Rationale + the economics is in `reference/CLAUDE_ECONOMIC_RESEARCH/` and `.claude/plans/pricing-rework.md`.

**Auto-reprice:** bump `PRICING_VERSION` (`lib.rs`) whenever price/valuation derivation changes — on
launch a mismatch wipes the derived price caches and recomputes, so fixes can't be stranded behind the
6 h TTL. Do NOT rely on the TTL alone for logic changes.
