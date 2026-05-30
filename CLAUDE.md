# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

WFIT ("Warframe Item Tracker") — a single-user **Tauri 2 (Rust) + local SQLite + React/Vite/Tailwind**
desktop app for tracking owned Warframe tradeable items, warframe.market prices/trends, a buy
watchlist, sales, set completion, ducat conversion, your warframe.market sell orders, and live
world-state (fissures/cycles/Baro). It is a rewrite of an old React+Supabase webapp — the entire
cloud backend is being deleted in favor of one local binary. **No auth, no hosting, no deploy.**

**Status: planning/reference only — no app code yet.** `src/` and `src-tauri/` are empty directory
trees (no files yet); there is no root `package.json` or `Cargo.toml`. Git is initialized (default
branch `main`, no commits yet). Build by following the plan, in order.

## Authoritative documents (read before coding)

- **`.claude/plans/i-just-added-the-noble-widget.md`** — THE approved implementation plan (schema,
  module layout, command surface, build order, locked decisions). Start here — it's the build roadmap.
- **`DATA_SOURCING_MASTER_PLAN.md`** — the warframe.market data contract (3 endpoints, verified
  field facts, the catalog two-pass strategy). All prices/catalog come from here.
- **`GAMESTATE_WORLDSTATE.md`** — the Rotation screen's source (`api.warframestat.us`, optional
  second source, isolated + read-only).
- **`WFM_ACCOUNT_SIGNIN.md`** — warframe.market account connect for the Listings screen (Tier 1
  username / Tier 2 pasted-JWT in OS keychain; read-only in v1).
- **`design_handoff_wfit_update1/`** — THE design target (9-screen monochrome DIM-style wireframe).
  `README.md` + `wireframe.jsx` + `WFIT Wireframe.html`. Build as-is. The mock `CATALOG`/prices in
  `wireframe.jsx` are FAKE — take only layout/tokens/behavior; all real data comes from the APIs.
- **`reference/prior-tauri-attempt/`** — a working older Tauri scaffold (rusqlite). Reuse its
  plumbing (Db handle, error, migration runner, transactional writes, throttle, command shape);
  **rewrite `market.rs`** — it targets the dead v1 `/items` catalog, the app now uses v2.
- **`reference/market-proxy/index.ts`** — the v2 catalog + statistics logic to port to Rust
  (`partTypeOf`/`categoryOf`/`deriveSetSlug`, median/trend derivation, 350ms throttle).

Retired (do not build from): `design/` (old "Primely" hi-fi), `design_handoff_wfit/` (superseded by
update1). "Primely" is the old name of the app.

## Hard constraints (carry into all work)

- **warframe.market is the sole source for items/prices/ducats/sets.** Headers on every request:
  `User-Agent: wfit-desktop/0.1`, `Language: en`, `Platform: pc`, `Accept: application/json`.
  Global throttle: **350ms min-gap (~3 req/s)** across ALL warframe.market calls — one chokepoint.
- **No game-account (DE) auth, ever** — every path is dead (Akamai-blocked / decommissioned). The
  only "sign-in" is to a *warframe.market* account, and only for reading your own orders.
- Endpoint quirks: catalog = `GET /v2/items`; per-item detail = `GET /v2/items/<slug>` (plural;
  singular 404s); statistics = `GET /v1/items/<slug>/statistics` (v2 stats 404). Your orders =
  `GET /v2/orders/user/<name>`; public item orders = `GET /v2/orders/item/<slug>`. `vaulted` is
  exposed nowhere — not a feature.
- DB at `$APPDATA/wfit/…` via Tauri `app_data_dir()`; created + migrated on launch. Everything
  except inventory/sales/watchlist/buy_list is a rebuildable cache of the APIs.
- Domain transforms (partname/derive/parts) live **Rust-only**; the frontend gets finished objects.

## Commands (once scaffolded — these apply AFTER Phase 1; no manifests exist yet)

- `npm run tauri dev` — run the desktop app (Vite + Rust). `npm run dev` — frontend only.
- `npm run build` — `tsc` typecheck + Vite build. `cargo build` (in `src-tauri/`) — Rust.
- No test runner configured yet; "verify" = it builds and the app runs.
- **Linting/formatting = Biome** (chosen) for the frontend — set up once the project is scaffolded
  (`npx @biomejs/biome init`); use `npx biome check --write` to format+lint. Rust uses `cargo fmt` / `cargo clippy`.
- **Linux runtime prereq:** `webkit2gtk-4.1` must be installed (`sudo pacman -S webkit2gtk-4.1` on
  this CachyOS box) before `tauri dev` works. macOS builds must be done on macOS (no cross-compile).

## Architecture (target)

Rust core in `src-tauri/src/`: `market.rs` (warframe.market v2 client + throttle), `worldstate.rs`
(api.warframestat.us, isolated), `wfm_account.rs` (account/orders + keychain), `domain/`
(classify/partname/parts — pure), `db/` (rusqlite modules per table, transactional writes),
`commands.rs` (the `#[command]` surface), `lib.rs` (`AppState{db,market}` + handler registry).
Frontend in `src/`: React Query hooks calling `invoke()` (`lib/api.ts`), components/routes ported
1:1 from `wireframe.jsx`, the wireframe's CSS lifted to `theme.css` (square/dense/mono, no radius).
