# WFIT — Session Handoff (2026-06-01)

WFIT is a working, installed **Tauri 2 (Rust) + local SQLite + React/Vite** desktop app for tracking
owned Warframe tradeables, warframe.market prices, sets, ducats, your sell orders, and live
world-state. Read with `CLAUDE.md` (hard constraints). This handoff supersedes the earlier ones; the
2026-05-31 "polish + features" session is condensed at the bottom.

## ⚠️ Status: everything below this session is UNCOMMITTED

The 2026-05-31 work is committed/pushed to **github.com/finneritter/WFIT** (`main`). **All of this
session's work — game inventory import (migrations 0003–0005), rank-aware + reliable pricing, the
frontend changes, and the doc updates — is sitting in the working tree, not committed.** First
decision next session: review `git status`/`git diff` and commit (suggest a feature branch off `main`).

All gates pass: `cargo check`/`clippy` clean · `cargo test` **12 pass** · `tsc` · `npm run build` ·
`biome` (pre-existing a11y warnings on interactive divs are tolerated).

---

## Running / building

```fish
pkill -x wfit; pkill -x node        # stop any running instance (exact-name kills only)
npm run tauri:dev                   # dev; bakes in the WebKitGTK/Wayland env vars (plain `tauri dev` crashes)
scripts/install.sh                  # build optimized release + install as a launchable app
```
- **Linux prereq:** `webkit2gtk-4.1`. Launch needs `WEBKIT_DISABLE_DMABUF_RENDERER=1
  WEBKIT_DISABLE_COMPOSITING_MODE=1` (baked into the `tauri:dev` script + installed `.desktop`).
- Live DB: `~/.local/share/dev.finn.wfit/wfit.sqlite`. Migrations `0001`–`0005` applied on launch.

---

## What this session added

### 1. Game inventory import (AlecaFrame-style memory-scan) — VERIFIED WORKING

Optional, opt-in, consent-gated, **Linux-only**, off by default. Reads the running Warframe client's
memory for the live session (`accountId`+`nonce`), calls the DE mobile inventory endpoint, maps it to
the catalog, and merges true owned counts. **ToS-prohibited / ban-risky** — see
`GAME_INVENTORY_IMPORT.md` and `.claude/plans/game-inventory-import.md`. This is a deliberate reversal
of the old "no DE auth ever" rule (it never logs in; it reuses the live session).

- **Isolated `gamescan/` module** (like `worldstate.rs`): `process.rs` (find pid; `/proc` only),
  `memory.rs` (scan writable-anon `/proc/<pid>/mem` for `accountId=<24hex>&nonce=<digits>`; never
  logs/persists the nonce), `api.rs` (`mobile.warframe.com/api/inventory.php`; own HTTP client),
  `map.rs` (uniqueName→slug via `catalog_items.game_ref`), `consent.rs` (typed-phrase gate). Plus
  `db/gamescan.rs` (state + diff + `merge_from_scan`). Reimplemented from the public protocol — **no
  upstream code copied** (`wf-auth-finder` is GPLv3; Sainan's is MIT+Commons-Clause).
- **DE JSON arrays parsed** (`map.rs INVENTORY_ARRAYS`): `MiscItems` (prime parts/resources),
  `Recipes` (blueprints), **`RawUpgrades`** (stacked unranked mods/arcanes — the real count; omitting
  it was the original undercount bug), `Upgrades` (individual ranked instances + their `lvl`).
- **Commands:** `game_scan_{status,consent,revoke,preview,apply}` (mirror the wfm preview/apply split).
  UI: `components/GameScanPanel.tsx` in Settings (consent → Scan now → reviewable diff → apply).
- **Caveat:** at the common `kernel.yama.ptrace_scope = 1` a sibling memory read may be denied;
  `memory.rs` returns guidance (`sysctl -w kernel.yama.ptrace_scope=0` or `setcap cap_sys_ptrace+ep`).
  Scope ≥2 is rejected up front. It worked on this box after that setup.

### 2. Rank-aware mods/arcanes

warframe.market prices mods/arcanes **per rank** (rank-0 Arcane Energize ≈ 7p, rank-5 ≈ 100p).
- Migration `0004_ranks.sql`: `catalog_items.max_rank`; `inventory_ranks(slug,rank,qty)` (per-rank
  owned breakdown, scan-written, additive — `inventory_items` stays the total-per-slug truth);
  `price_rank(slug,rank,median)`.
- The scan reads each copy's rank; valuation is Σ qty_r × price(rank r); the drawer shows an **Owned
  by rank** table. `fetch_statistics` parses `mod_rank` (headline/history from rank 0 only).

### 3. Reliable pricing (the big one — see `.claude/plans/pricing-rework.md`)

The recurring "price is wrong / 50000p" had **two** causes — both fixed:

- **Formula:** trade statistics are sparse/gameable for illiquid mods. The **live order book is now
  the primary price source** for all owned items: `prices::effective_price(slug, rank)` resolves
  **live lowest ask (`order_cache`) → per-rank trade median → headline median**. The ask is robust
  (`robust_low` = median of the cheapest 5 asks, online preferred), so one troll-low/high ask can't
  move it. Trade medians themselves are also robust (`market.rs robust_price` = winsorized +
  volume-weighted median over 45 days). Migration `0005_orders.sql` = `order_cache(slug,rank,sell)`.
  Fetched for all owned items by `refresh_owned_orders` (background on launch; forced by Refresh prices).
- **Refresh (the structural fix):** fixes never reached already-cached values because refresh is
  TTL-gated. Now there's a **`PRICING_VERSION` const + `KEY_PRICING_VERSION` meta** — on launch a
  mismatch wipes `price_cache`/`price_rank`/`order_cache` and recomputes. **➜ Bump `PRICING_VERSION`
  (in `lib.rs`) whenever you change how prices are derived** so it auto-reprices on next launch instead
  of stale values surviving. Currently `"2"`.
- Chart fix (`charts.tsx CandleChart`): robust 4th–96th-percentile y-domain so one spike candle no
  longer flattens the graph.
- Validated live: disruptor (had a 50000p wash print) → **~1p** from the live book; liquid items
  unchanged. Valuation basis = lowest ask; no illiquidity discount (v1 decision).

---

## Architecture pointers

- **Migrations:** `0001_init` · `0002_ohlc` · `0003_game_import` (game_ref, last_scan_qty,
  game_scan_state) · `0004_ranks` (max_rank, inventory_ranks, price_rank) · `0005_orders` (order_cache).
- **Pricing path:** `market.rs` (`fetch_statistics` → robust per-rank medians; `fetch_sell_prices` →
  robust live asks) → `db/prices.rs` (`upsert_many`, `store_sell_prices`, `effective_price`,
  `rank_price`) → `db/inventory.rs` valuation (`value_plat`, blended per-unit display) → drawer.
- **Modules** (`src-tauri/src/`): `market.rs`, `worldstate.rs`, `wfm_account.rs`, `gamescan/`,
  `domain/`, `db/` (per-table), `commands.rs`, `lib.rs` (`AppState` + `launch_refresh`).

## Key gotchas / lessons for next session
- **When you change how a cached/derived value is computed, bump `PRICING_VERSION`** (or a similar
  stamp) so it recomputes — don't rely on the TTL; stale old-logic values otherwise survive and look
  like the fix didn't work. This caused several rounds of confusion this session.
- `/proc/<pid>/comm` truncates to 15 chars (`Warframe.x64.exe` → `Warframe.x64.ex`) — match the
  truncated form.
- **UI not exhaustively click-tested** (no window-raise/input tool on this box — no wmctrl/ydotool).
  Verified via build gates + querying the live SQLite DB. Game-scan + pricing WERE verified live with
  the user this session; the 05-31 screens still want a click-test.
- Shell stdout here can be unreliable — route to files / trust exit codes. Stop the dev server with
  `pkill -x wfit` / `pkill -x node` (broad `pkill -f` self-kills the agent's shell).

## Known gaps / next steps
- **Commit this session's work** (uncommitted — see top).
- Pass B set composition (`sets_refresh` → `set_membership`) available but Sets/valuation still use the
  `set_slug` heuristic (`quantity_in_set` assumed 1).
- Game scan: no auto-sync (manual "Scan now" only); macOS unsupported (SIP). Re-scan+apply to refresh
  the per-rank breakdown of already-imported mods (the diff flags breakdown-only changes).
- Listings write actions (price edit / list-on-market) still v1-deferred (read-only).
- macOS build not done (needs a Mac). Search covers the tradable catalog only.
- Optional pricing follow-ups: store highest bid + show full spread/liquidity/source in the drawer;
  illiquidity discount / midpoint marks.

---

## Appendix — 2026-05-31 "polish + features" session (committed/pushed)

Frameless window + custom titlebar + app icon; Settings screen (Light/Dark theme, density, cache
actions); Trends decision surface (Prime Market hero index, z-score signals, exclude-outliers
winsorize); item drawer (OHLC candlestick + MA, live spread, resizable, Remove, Wiki ↗); sets-as-parts
valuation; Rotation live countdowns; real wfm item icons; global catalog search (`ininv:` prefix);
in-app wiki `WebviewWindow` (frameless, auto-closes on blur — `src/lib/wiki.ts`). Migration `0002`
added OHLC. These screens were not click-tested that session.

## Repo
Private GitHub **github.com/finneritter/WFIT**, branch `main`. `src-tauri/gen/` is gitignored.
