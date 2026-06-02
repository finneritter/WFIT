# WFIT — Warframe Item Tracker

A single-user **desktop app** for tracking your owned Warframe tradeable items, with live
[warframe.market](https://warframe.market) prices, trends, set completion, ducat-conversion
efficiency, a buy watchlist, sales history, your market sell orders, and live world-state
(fissures / cycles / Baro).

It's a local-first rewrite of an old React + Supabase webapp — the entire cloud backend is gone in
favor of **one binary + one local SQLite file**. No auth, no hosting, no deploy.

- **Stack:** Tauri 2 (Rust core) · SQLite (rusqlite) · React + Vite + TypeScript · TanStack Query
- **Data source:** warframe.market is the sole source for items/prices/ducats/sets (global 350ms
  throttle, ~3 req/s). World-state comes from `api.warframestat.us` (isolated, read-only).
- **Platform:** built and run on Linux (CachyOS/Arch); macOS must be built on macOS.

## Screens

Inventory (tile grid) · Sets (completion tracker) · Trends · Watchlist · Buy List (cart + budget) ·
Listings (your warframe.market orders, read-only) · Ducats (conversion efficiency) ·
Rotation (live world-state) · Sold History · Settings.

### Honest ("realizable") inventory value

A market price is a *marginal* price, so `price × quantity` wildly overvalues common hoards — 500
copies of a mod that trades once a week is not worth 500 × its sticker price. WFIT instead values each
holding by **liquidating it into the live buy orders** (the actual demand), then a small volume-capped
tail; items nobody is bidding on collapse to near-zero. The Inventory headline shows this **realizable**
estimate (with the optimistic `× qty` "ceiling" alongside), a *"what's driving your value"* breakdown,
and per-item confidence + days-to-sell. Mods/arcanes are priced per rank. The economics behind it is in
`reference/CLAUDE_ECONOMIC_RESEARCH/`.

### Game inventory import (opt-in, beta)

Settings → **Game inventory** can read your *real* owned counts directly from the running Warframe
client (memory-scan → DE mobile inventory endpoint), the one thing warframe.market listings can't
give. **This violates DE's Terms of Service and could get your account banned** — it is opt-in,
consent-gated behind a typed acknowledgment, Linux-only, and off by default. It never logs in (it
reuses the live game session). The full path (memory scan → DE inventory endpoint → mapped diff) is
implemented and verified against a real client. On a locked-down kernel, `kernel.yama.ptrace_scope`
may need to be `0` for the memory read to work. See `docs/GAME_INVENTORY_IMPORT.md`.

## Develop

```bash
npm install                 # first time
npm run tauri:dev           # run the desktop app (Vite + Rust)
npm run dev                 # frontend only (no Rust window)
npm run build               # tsc typecheck + Vite production build
```

`npm run tauri:dev` wraps `tauri dev` with the WebKitGTK/Wayland env vars this machine needs
(`WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1`); plain `tauri dev` crashes on
Wayland with a renderer bug.

**Linux prereq:** `webkit2gtk-4.1` (`sudo pacman -S webkit2gtk-4.1` on CachyOS).

### Lint / format

```bash
npm run lint                # Biome check (frontend)
npm run format              # Biome check --write
cd src-tauri && cargo fmt && cargo clippy
```

## Install as a desktop app

Build an optimized standalone binary and register it as a launchable app (searchable in
KRunner / the application menu):

```bash
scripts/install.sh
```

This installs `~/.local/bin/wfit`, an icon, and a `.desktop` entry. Re-run it any time to update to
the latest code. To build a shareable installer (AppImage / `.deb` / `.rpm`) instead, run
`npm run tauri build` (needs extra bundler tooling on Arch).

## Layout

```
src/                  React frontend
  routes/             one component per screen
  components/         Sidebar, TitleBar, Drawer, AddItems, charts, ui
  hooks/queries.ts    TanStack Query reads + mutations
  lib/                api (invoke wrappers), types, format helpers
  theme.css           dense monochrome design tokens + component styles
src-tauri/src/        Rust core
  market.rs           warframe.market v2 client + global throttle (prices, orders, statistics)
  worldstate.rs       api.warframestat.us client (isolated)
  wfm_account.rs      market account / orders + JWT in OS keychain
  gamescan/           opt-in game memory-scan inventory import (Linux; isolated)
  domain/             pure classify / part-name logic
  db/inventory.rs     ownership + realizable (liquidation-adjusted) valuation
  db/                 one module per table, transactional writes
  commands.rs         the #[command] surface
  lib.rs              AppState + launch orchestration
  migrations/         SQLite schema
```

The local database lives at `$APPDATA/dev.finn.wfit/wfit.sqlite` (e.g.
`~/.local/share/dev.finn.wfit/` on Linux), created and migrated on first launch. Everything except
inventory / sales / watchlist / buy-list is a rebuildable cache of the APIs.

## Docs

- `docs/HANDOFF.md` — **current-state handoff; read first.**
- `CLAUDE.md` — working guidance, hard constraints, and the pricing/valuation model.
- `reference/CLAUDE_ECONOMIC_RESEARCH/` — the economics behind realizable valuation (liquidity,
  market impact, honest presentation).
- `docs/DATA_SOURCING_MASTER_PLAN.md` — the warframe.market data contract.
- `docs/GAME_INVENTORY_IMPORT.md` — the game memory-scan import spec.
- `docs/GAMESTATE_WORLDSTATE.md` / `docs/WFM_ACCOUNT_SIGNIN.md` — world-state and account-connect specs.
- `docs/` — the rest of the design/spec docs (DESKTOP_REWRITE_PRD, INVENTORY_REDESIGN, …).
- `reference/` — code scaffolds (prior-tauri-attempt, market-proxy) + retired/target design handoffs.
- `.claude/plans/` — historical design notes (game-inventory-import, pricing-rework, etc.).
