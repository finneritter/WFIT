# Handoff: WFIT — Warframe Item Tracker (Update 1)

> **Update 1** supersedes the original 4-screen handoff. The app now has **9 screens**, a connected **warframe.market** account model, and a full economic loop (acquire → track → understand market → sell). This document is self-sufficient — implement from it alone.

## Overview
WFIT is a **desktop application** for Warframe players to manage prime-parts: track what you own, see live market prices/trends, plan acquisitions, manage your warframe.market sell orders, convert parts to ducats, and watch live world-state (fissures/Baro). It's a dense, fast, information-first tool inspired by item managers like DIM. **No generic account/auth UI** — the only "sign-in" is connecting your warframe.market account (see Data Sources).

## About the Design Files
The bundled files are **design references** built in HTML + React (via in-browser Babel) with deterministic fake data. They are **not** production code to ship. Recreate this design in the target codebase's environment using its real patterns. For a data-dense desktop app with live APIs, a sensible stack is **React + Vite wrapped in Tauri or Electron**; replace the fake data layer with the real APIs in **Data Sources** below and add local persistence.

## Fidelity
**Low-to-mid fidelity wireframe.** Monochrome, utilitarian, density-first. The high-value parts are **layout, interactions, data model, and the API mapping** — not final visual polish. Apply the target app's real design system for production styling.

---

## Global Shell
Two-pane layout, full viewport height.

- **Sidebar** (left, fixed `182px`): brand → market-sync strip → highlighted **+ Add items** button → nav items → **Quick read** stats box → spacer → **Settings** (footer). Navigation lives **only** here (no top tabs).
- **Main**: sticky **top bar** (active screen title + global search + Refresh icon) over a scrollable **content** area (`padding: 12px 16px 48px`).

### Sidebar specifics
- **Brand**: `WFIT` (800 weight, letter-spacing `.14em`) + muted `item tracker`.
- **Market-sync strip** (`.syncbar`): green dot + `warframe.market` + right-aligned sync time. (In the Listings screen this is expanded into a full connection banner — see below.)
- **+ Add items** (`.nav-add`): the **primary action**, filled with `--accent`, dark text, full-width. Opens the Add Items modal.
- **Nav items** (`.nav-item`): icon + label + optional right-aligned mono count badge. Active = `--ink`/600, `--hover` bg, 2px left border. **Order:** Inventory, Sets, Trends, Watchlist, Buy List, Listings, Ducats, Rotation, Sold History.
- **Quick read** box (`.qr`): Hot parts / At watch target / Sold · 7d.

---

## Screens (9)

### 1. Inventory (default)
Dense tile grid of everything you own, grouped by category.
- **Stat band** (6 cols, → 3 under 900px): Total Platinum, Total Ducats, Parts (+"N distinct"), **Portfolio 7d** (value-weighted avg % change, green/red), Hot, Sold · 7d.
- **Filter row**: small live search + category chips (All, Hot, Warframe, Weapon, Set, Mod, Arcane) + sort chips (Value ▾/▴, Trend ▾, Name). Active chip = filled `--accent`.
- **Sections** (`.section`, collapsible): header = ▾/▸ + uppercase title + count + right-aligned "stack value N p"; body = wrapping flex grid of **tiles**.
- **Tile** (`.tile`, 54px / 46px dense): neutral `--panel-2` fill, **2px top border colored by value tier** (NOT a full rarity fill — deliberately toned down), centered 2-letter mono glyph, top-left ▲ if hot, top-right `×N` qty, bottom **value bar** showing `{plat}p`, 3px bottom-left **trend strip** (green up / red down / grey flat). Hover = `--accent` outline. Click → Drawer.
- **Legend** explaining tiers + markers.

### 2. Sets (Completion)
Track building full prime sets from owned parts (sets sell for more than loose parts).
- **Stat band** (4): Complete sets, One part away, Completable value, Avg completion %.
- **Filter chips**: All / Complete / Almost done / In progress.
- **Set rows** (`.setrow`, grid `210px 1fr 170px`): left = name + "cat · N/total parts" + progress bar (green when complete); middle = `.pchips` row of 4 **part chips** (owned = solid border + ✓; missing = dashed border + price, clickable to add to Buy List); right = full-set value (if complete) or **"Buy N missing"** button + "+Xp to complete". Owned chip click → Drawer.
- Nav badge = count of sets you're exactly **one part away** from.

### 3. Trends
Market overview with a timeframe toggle that scales every figure.
- **Timeframe row**: chips 24h / 7d / 30d / 90d. Factor table `{24h:0.35, 7d:1, 30d:2.1, 90d:3.4}` multiplies all deltas/index/heat/impact.
- **Row 1** (`.trow-idx`, `minmax(0,1.7fr) 1fr`, stacks <1040px): **Prime Market Index** (big mono level = `1000×(1+weightedAvgChange/100)`, change %, breadth stats advancing/declining/flat/orders-per-day, area+line chart) + **Category heat** (per-category **diverging bar** around a zero line, green right / red left, signed %).
- **Row 2** (`.trow2`, 2 cols): **Top gainers** / **Top losers** — ranked `.mrow.mover` (rank, glyph, name+sub, mini sparkline, price, %).
- **Row 3**: **Most traded** (`.mrow.vol`, volume bar + N/d) + **Your inventory in motion** (`.mrow.imp`, plat value impact = `qty × price × change% / 100`).
- All rows click → Drawer.

### 4. Watchlist
Buy-target tracking with "ready to buy" alerts.
- **Stat band** (4): Watching, At buy target (green), Buy-now spend, Avg gap to target %.
- Panel with sort chips (status / value / trend / name) + table: **Item, Price, 7d, Target, Status, actions**. Status = green **"at target"** if `price ≤ target`, else muted **"+X% to go"** (`round((price−target)/target×100)`). Actions per row: **+ buy** (adds to Buy List) and **✕** (remove). Added via the Drawer's "Add to watchlist" (default target = 90% of current price). Default sort puts at-target first.

### 5. Buy List
A planning cart with a budget.
- **Stat band** (4): Items, Units, Total cost, Remaining budget (red if negative).
- Panel header holds an editable **budget** number input + **Purchase all → inventory** + **Clear**.
- Table: Item, Unit price, **Qty stepper**, Line total, actions (**Bought** = move that item into Inventory; **✕** remove). Fed from Sets' missing parts, Watchlist "+ buy", and the Drawer.

### 6. Listings (warframe.market)
Manage your live sell orders on your connected account.
- **Connection banner** (`.conn`): status dot + "Connected to **warframe.market** as **{ingameName}** · rep {n}" + a **segmented status control** (Offline / Online / In Game — drives buyer visibility) + **Sync now**. When Offline, a `.conn-note` warns listings are hidden.
- **Stat band** (4): Active listings, Listed value, **At best price** (green), **Undercut** (red).
- **Your listings** table: Item (+"upd {when}"), **Your price** with ± stepper, Qty, **Market low**, **Rank** (`#rank/sellers`), **Status** (green "best price" if `price ≤ marketLow`, else "+Np over"), actions (**Match** = set price to market low when undercut; **✕** remove). Created from the Drawer's "List on market".

### 7. Ducats
Ducat-conversion efficiency for owned parts.
- **Stat band** (4): Inventory ducats, Trash-tier ducats (parts ≤8p), Trash candidates, Avg ducats/part.
- **Best ducat value** table: Part (+"part · ×qty"), Plat, Ducats, **d/p** ratio, **Verdict** (green "ducat it" when `plat ≤ 8 || d/p ≥ 5`, else "sell for plat"). Sorted by efficiency, tie-broken by qty. Only parts with a ducat value appear (Warframe/Weapon parts).

### 8. Rotation (live world-state)
Timers and rotating content.
- **Cycle cards** (`.cyclebar`, 4 cols): Cetus / Orb Vallis / Cambion Drift / Duviri — state + countdown.
- **Void Fissures** panel: tier filter chips (All/Lith/Meso/Neo/Axi/Requiem) + **Steel Path** toggle; table of Tier (colored marker), Mission, Location, Steel Path badge, Time left.
- **Baro Ki'Teer** panel: arrival **countdown** + relay location. **Important:** shows only countdown/location — Baro's stock is NOT known until he arrives, so there is intentionally no inventory list (a note explains this).

### 9. Sold History
Realized-sales ledger + earnings summary.
- **Stat band** (5): Earned · 7d (green), Earned · 30d, Units sold, Avg sale, Best sale.
- Table: When (relative: today/yesterday/Nd ago), Item, Qty, Unit, Total. Today's sales show an **undo ↺**. Newest-first; new sales prepend via the Drawer's "Sell 1".

---

## Detail Drawer (shared)
Right-side overlay opened by clicking any item. Header (glyph, name, "part · category", close) → big price + colored change % → timeframe chips + chart → 2×2 detail grid (You own ×qty, Ducat value, 7d range ≈`price×0.82–1.15`, Stack value) → **context-aware actions** (`.drawer-actions`, wraps):
- **Owned** item: **Sell 1 · {plat}p** (logs a sale, decrements qty, removes at 0) + **List on market** (creates a listing; disabled/"Listed" if already listed) + **Add to watchlist** (disabled/"On watchlist" if present).
- **Not owned** (e.g. opened from Watchlist): **Add to buy list** + **Add to watchlist**.

## Add Items Modal
Opened by the sidebar **+ Add items**. Large centered modal, **5 columns** (`repeat(5, minmax(0,1fr))` — the `minmax(0,…)` prevents overflow): Warframe, Weapon, Sets, Mods, Arcanes. Header search filters all columns (auto-expands matching groups); per-column owned/total count + **+ all / clear**.
- **Warframe & Weapon** columns are **expandable groups** (`.agrp`): parent set (e.g. "Volt Prime") with a ▸/▾ disclosure + owned/total-parts badge; expanding reveals indented **part rows** where the part name is the label.
- **Sets/Mods/Arcanes** are single rows.
- **Each row** (`.crow`): checkbox (✓ when owned) + label + EITHER muted "{plat}p" (not owned) OR a **qty stepper** (− N +, max 99; 0 removes). Click row toggles owned (0↔1).
- Footer: inventory vs catalog totals + Done.

---

## Interactions & Behavior
- Sidebar sets the active screen; one screen renders at a time; top-bar title reflects it.
- Inventory filtering/sorting/search compose client-side; empty sections hide when filtered/searched.
- Trends timeframe scales all figures and re-sorts movers.
- Selling: Drawer "Sell 1" → prepend sale, decrement inventory (auto-close drawer if it hits 0).
- Watchlist/Buy List/Listings all mutate shared state and update nav badges + cross-screen stats live.
- Listings: ± edits price; **Match** sets price = market low; status control toggles visibility (Offline shows the hidden warning).
- Modal/drawer dismiss via scrim click or ✕. No animations beyond hover; this is a fast, static-feeling tool.

## State Management
All local React `useState` in `App` (lift to a store + persistence + API in production):
- `screen` — active view id.
- `items` — owned inventory (`id, name, part, cat, plat, duc, qty, d (7d %), hot, spark`).
- `sel` — drawer selection (resolved live from `items`, falls back to the selected object so non-owned items still open).
- `adding` — Add Items modal open.
- `watch` — watchlist (catalog items + `target`).
- `sales` — sold ledger (`name, part, cat, qty, plat, daysAgo`).
- `buy` + `budget` — buy list (`…, buyQty`) and budget number.
- `listings` + `mktStatus` — your sell orders (`…, price, qty, marketLow, sellers, updated`) and account status (`offline|online|ingame`).
- Derived `useMemo`: `ownedMap`, `watchedIds`, `listedIds`, `setsProg` (set completion), `counts` (nav badges).

### Fake data → replace with real APIs
- `CATALOG` (~215 items) generated from source arrays (`FRAMES, WEAPONS, SETS, MODS, ARCANES` as `[name, basePlat, hot]`); Warframe/Weapon explode into 4 parts via `makePart`, others are singles via `single`.
- `seed(string)` hash drives all pseudo-random fields (deltas, qty, sparkline, market-low) so the prototype is stable across reloads. `genSpark(delta)` builds the 7-point sparkline.
- Tiers: `tier(plat)` → exotic ≥120 / legend ≥45 / rare ≥15 / basic (drives only the accent edge).
- `buildSetProgress`, `buildWatch`, `buildBuy`, `buildListings`, `SALES`, `CYCLES`, `FISSURES`, `BARO`, `ACCOUNT` are all seeded stand-ins.

---

## Data Sources (production wiring)
None of this is an official DE API; the community stack:

1. **warframe.market** (unofficial REST + WebSocket) — item prices, live buy/sell **orders**, statistics, and **your account orders**.
   - Powers: Trends, Watchlist pricing, Listings, the Drawer order data.
   - **Auth (for Listings):** unofficial — sign in via `POST /auth/signin` (email/password → JWT cookie); read your orders from `GET /profile/{ingameName}/orders`; create/update/delete via the orders endpoints; set visibility with the account **status** (`offline/online/ingame`). There is **no official OAuth**.
   - Rate-limited (~a few req/s) — cache aggressively; fetch an item's live orders only when its Drawer opens.
2. **warframestat.us** (WFCD; parses DE's raw `WorldState.php`) — **void fissures**, **Baro Ki'Teer** arrival/location (and stock only once active), world **cycles** (Cetus/Vallis/Cambion/Duviri), sortie, invasions, etc. Public, no auth. Poll on a timer.
   - Powers: the Rotation screen. **Note:** Baro's inventory is only present in worldstate while he's active — never before arrival (the design reflects this).
3. **WFCD static datasets** — `warframe-items` (every item, parts, **ducat values**, set relationships) and `warframe-drop-data` (relic → part drop tables/rarity). Bundle locally, refresh on update.
   - Powers: Sets/Completion, Ducats, and any future Relic/acquisition features.

**Architecture:** poll warframestat.us for world state, hit warframe.market on demand (cached) for prices/orders/account, bundle WFCD static data locally. Persist `items`, `watch`, `sales`, `buy`, `listings` in a local store (SQLite via Tauri, or localStorage).

---

## Design Tokens
CSS variables on `:root` (dark). `--tile` shrinks under `body.dense`; `--accent` is Tweakable.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0c0d10` | app background |
| `--bg-2` | `#111216` | sidebar / topbar / drawer / modal |
| `--panel` | `#15171b` | panels, stat boxes, inputs |
| `--panel-2` | `#1b1d22` | tile fill, glyph chips |
| `--line` / `--line-2` | `#24262e` / `#31343d` | hairlines / stronger borders |
| `--ink` / `--soft` / `--faint` | `#e2e3e6` / `#989ba2` / `#62656d` | text scale |
| `--hover` | `#1f2127` | hover bg |
| `--accent` | `#cfd2d8` | highlights (neutral grey; Tweakable to `#f0883e`/`#4f9dde`/`#5fc27e`) |
| `--pos` / `--neg` / `--hot` | `#5fc27e` / `#e0685c` / `#f0a93e` | up / down / hot+warnings |
| `--t-exotic/legend/rare/basic` | `#d6b748` / `#9a83e0` / `#5b90d8` / `#71757f` | value-tier edges (≥120 / 45 / 15 / <15 p) |
| fissure tiers | Lith `#8a8f98`, Meso `#6f9bd1`, Neo `#c9a84a`, Axi `#9a83e0`, Requiem `#d0685c` | rotation markers |
| `--nav` / `--tile` | `182px` / `54px` (dense `46px`) | sidebar width / tile size |

**Type:** system sans for UI; **mono** (tabular-nums) for all numbers. Base **12px**. No border-radius anywhere (square/utilitarian). No shadows except drawer/modal over a dim scrim.

**Spacing:** content `12px 16px 48px`; grid gaps `8–12px`; tile gap `4px`; control padding `5–8px`.

## Assets
- **No external images.** Item art is faked with 2-letter mono initials on a tier-edged chip — swap in real warframe.market / Warframe CDN icons in production.
- **Icons**: inline SVGs in the `Icon` component (`inventory, sets, trends, watchlist, buy, tag, coin, timer, history, settings, search, refresh, box, sold`). 24×24, `stroke: currentColor`, no fill. Replace with the codebase's icon set.
- **Fonts**: system stacks only.

## Files
- **`WFIT Wireframe.html`** — shell + all CSS (tokens and every component's styles) + React/Babel script tags; mounts `wireframe.jsx`. Open this to view the design.
- **`wireframe.jsx`** — the entire app: fake data layer, all components, and state. (~1130 lines.) Key components: `Sidebar, StatBand, Inventory/Section/Tile, SetsScreen, Trends (+MoverRow/VolRow/ImpactRow/MiniSpark/BigChart), Watchlist, BuyList, Listings, Ducats, Rotation, SoldHistory, Drawer, AddItems/QtyRow, App`.
- **`tweaks-panel.jsx`** — prototype-only Tweaks shell. **Not a product feature.** Provides: Compact tiles (`body.dense`), Mute trend colors (`body.flat-deltas`), Accent swatches. Ignore when implementing (or expose as user settings if desired).
