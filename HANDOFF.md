# WFIT — Session Handoff (2026-05-31, polish + features)

This supersedes the original first-implementation notes. WFIT went from "builds and runs" to a
feature-rich, installed desktop app over this session. Everything below is committed and pushed to
the **private GitHub repo `finneritter/WFIT`** (branch `main`), and the launchable app is installed.

> Read with `CLAUDE.md` (hard constraints) and `.claude/plans/i-just-added-the-noble-widget.md`
> (original roadmap). Newer plans: `.claude/plans/search-and-wiki.md`.

---

## Running it

```bash
npm run tauri:dev          # dev (bakes in the WebKitGTK/Wayland env vars; plain `tauri dev` crashes)
scripts/install.sh         # build optimized release + install as a launchable app (search "WFIT" in KRunner)
```

- **Linux prereq:** `webkit2gtk-4.1`. The dev/installed launch needs
  `WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1` (baked into both the
  `tauri:dev` script and the installed `.desktop` Exec).
- `scripts/install.sh` is the one-command update: rebuild + reinstall binary/icon/.desktop.

## Verification gates (all currently pass)

```bash
npx tsc --noEmit
npm run build
cd src-tauri && cargo check    # also validates the Tauri capability ACL
npx biome check .              # frontend lint/format (pre-existing a11y warnings on interactive divs are tolerated)
```

---

## What was built this session

**Window / shell**
- Frameless window (`decorations:false`) with a custom in-app titlebar (drag region + min/max/close):
  `src/components/TitleBar.tsx`, window ACL perms in `capabilities/default.json`.
- App **icon** (cat monogram) generated via `tauri icon` from `src-tauri/icons/source.png`.
- Sidebar brand panel removed (title now in the titlebar); syncbar/topbar seam aligned (both 42px).

**Settings + theming** (`src/routes/Settings.tsx`, `src/lib/prefs.ts`)
- New Settings screen (the sidebar footer used to mis-route to Listings). Sections: Appearance
  (**Light/Dark theme**, density, flat-deltas), Data & cache (refresh prices/catalog, sync set
  composition, **Rebuild cache**), Account, About.
- **Light mode** = `body.light` palette override in `theme.css`; introduced `--accent-ink` so the
  4 hardcoded on-accent text colors invert correctly. Prefs persist in localStorage, applied
  pre-paint in `main.tsx`.

**Trends → decision surface** (`src/routes/Trends.tsx`, `src-tauri/src/db/trends.rs`)
- Reframed: full-width **Prime Market hero** (big graph), Your-holdings band, then Sell signals /
  Buy candidates / **Unusual moves** (z-score ranked) / Category heat.
- Per-item signals computed from history: **z-score, range position, avg daily volume**.
- **Prime Market index**: spans the **selected timeframe** (responds to 24h/7d/30d/90d) and is a
  **consistent-membership, value-weighted basket** (only full-window items, summed, normalized);
  the headline % is its start→end change. Replaces an earlier broken median/ragged-spark index.
- **"Exclude outliers"** toggle (default on): winsorizes each series (median ± k·MAD, with a
  `center·0.5` fallback when MAD≈0) so a 50k-plat troll print on a 1p mod can't pollute the index,
  signals, or **Unusual moves** (and the displayed price uses the cleaned value).

**Item drawer — deep analytics** (`src/components/Drawer.tsx`, `src/components/charts.tsx`)
- Real **candlestick** chart (OHLC) with MA7/MA30 overlays, volume bars, period hi/lo lines.
  OHLC added via migration **`0002_ohlc.sql`** + `market.rs` parsing; backfills as prices drain.
- Stats: range position, avg volume, **live spread/best buy-sell** (`get_item_orders` →
  `/v2/orders/item`), ducat-efficiency verdict, owned stack, realized P&L from past sales.
- **Resizable** (drag the left-edge grip; width remembered).
- **Remove from inventory** button; **Wiki ↗** button (see below).

**Sets as parts** (`src-tauri/src/db/inventory.rs`, `sales.rs`, `catalog.rs`)
- Adding a set adds its component parts; a complete set is **recognized and valued at the set
  price** (not the part-sum). Inventory collapses complete sets into one set tile. Set-aware
  `set_qty`/`remove`/`record_sale` (selling a set decrements one of each part). Composition from
  the `catalog_items.set_slug` heuristic (Pass B available via `sets_refresh` but not required).

**Rotation** (`src-tauri/src/worldstate.rs`, `src/routes/Rotation.tsx`)
- Fixed (was dead): warframestat.us dropped the per-fissure `active` flag (we filtered all out)
  and the void-trader string fields. Now surfaces ISO timestamps (cycle/fissure/Baro
  `expiry`/`activation`) and a 1s `useNow` ticker drives **live countdowns**.
- **Per-tier fissure refresh strip** with **Omnia highlighted** and a "⚡ Void Cascade" flag.

**Icons + search + wiki**
- Real **warframe.market item icons** everywhere (Glyph renders the thumbnail, monogram fallback);
  threaded `thumbnail_url` through all row types (TrendRow/DucatRow/SaleRow/ListingRow + queries).
- **Global search** (`src/components/SearchResults.tsx`): top-bar search is now a command palette
  over the whole tradable catalog (`search_catalog`); results dropdown, click opens the drawer
  (owned or not), `ininv:` prefix scopes to owned.
- **In-app wiki**: `src/lib/wiki.ts` opens an item's `wiki.warframe.com` page in a dedicated reused
  `WebviewWindow` (iframing is blocked by the wiki's `X-Frame-Options: DENY`). "Wiki ↗" on the
  drawer. Perms: `core:webview:allow-create-webview-window`, `core:window:allow-set-focus`.
- Add-items picker: shows **specific part names** ("Neuroptics Blueprint", not "Blueprint") and is
  **target-aware** — on Watchlist/Buy List it adds to that list; catalog rows carry
  `on_watchlist`/`buy_qty`.

## New backend surface (since first handoff)
- Migrations: `0001_init.sql`, **`0002_ohlc.sql`** (adds open/high/low/close to price_history).
- New commands: `rebuild_cache`, `get_item_orders`, plus `sets_refresh` now wired in Settings.
- `total_value`/`owned_holdings` (set-aware valuation) in `db/inventory.rs`.

## Known gaps / next steps
- **Pass B set composition** (`sets_refresh` → `set_membership`) is available but Sets/valuation
  still use the `set_slug` heuristic (`quantity_in_set` assumed 1). Wiring it in is a TODO.
- **Listings write actions** (price edit / status / list-on-market) remain v1-deferred (read-only).
- **Set-sale undo** re-adds against the set slug, not the member parts (edge case).
- **Wiki page mapping** is heuristic (prime parts → "<X> Prime"); some items may land on a wiki
  search page. Refine names case-by-case.
- **macOS build** not done (needs a Mac).
- **Search**: tradable catalog only (warframe.market). Non-tradable items aren't indexed.

## Environment gotchas (important for the next session)
- **Could not visually verify most UI this session.** The dev window repeatedly got buried behind
  the editor and there is no window-raise/input-injection tool on this box (no wmctrl/ydotool/
  xdotool; only screenshot tools). Changes were verified via build gates + replicating logic
  against the live SQLite DB. **Next session should click-test:** the Trends hero/timeframes, the
  candle drawer + Wiki button (does the WebviewWindow actually open?), light mode across screens,
  global search + `ininv:`, set tiles, and the Rotation strip.
- Shell stdout on this box can be unreliable — route to temp files / trust exit codes.
- Stop the dev server with exact-name kills (`pkill -x wfit`, `pkill -x node`).
- Live DB: `~/.local/share/dev.finn.wfit/wfit.sqlite`.

## Repo
- Private GitHub: **github.com/finneritter/WFIT**, branch `main` (origin set, `git push` works).
- `src-tauri/gen/` is gitignored (regenerated each build).
