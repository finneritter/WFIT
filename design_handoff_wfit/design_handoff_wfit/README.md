# Handoff: WFIT — Warframe Item Tracker

## Overview
WFIT is a **desktop application** for Warframe players to track the prime-parts they own, see live market prices/trends (sourced conceptually from warframe.market), maintain a buy **watchlist** with price targets, and log **sales**. It is a dense, fast, information-first tool inspired by item managers like DIM (Destiny Item Manager) — many small tiles, collapsible sections, keyboard-fast filtering. There is **no authentication / no account** (it's a local desktop app that syncs market data).

## About the Design Files
The files in this bundle are **design references created in HTML/React-via-Babel** — a working prototype showing the intended look, layout, and behavior. They are **not** production code to ship directly. The task is to **recreate this design in the target codebase's environment** (e.g. a real React + bundler setup, Tauri/Electron for desktop, Vue, etc.) using that project's established patterns, component library, and state management. If no environment exists yet, pick the most appropriate stack for a data-dense desktop app (React + Vite, optionally wrapped in Tauri/Electron) and implement there.

The prototype runs React 18 through an in-browser Babel transform and fakes all data deterministically. In production you would replace the fake data layer with real warframe.market API calls and a local persistence layer.

## Fidelity
**Low-to-mid fidelity wireframe.** This is intentionally a monochrome, utilitarian wireframe — the priority is **information density, layout, and interaction**, not final visual polish. Treat colors/spacing here as a sensible starting point, but the developer should apply the target app's real design system for production styling. The *structure, behaviors, and data model* are the high-value part of this handoff.

---

## Global Layout / Shell
A two-pane shell, full viewport height:

- **Sidebar** (left, fixed `198px`, `body.dense` does not change it): brand, market-sync strip, highlighted "+ Add items" button, primary nav, a "Quick read" stats box, and a Settings item pinned to the bottom.
- **Main** (fills remaining width): a sticky **top bar** (current screen title + global search + Refresh icon) above a scrollable **content** area (`padding: 12px 16px 48px`).

Navigation lives **only** in the sidebar (there are intentionally no duplicate top tabs). The top bar shows the active screen's title on the left.

### Sidebar contents (top → bottom)
1. **Brand**: `WFIT` (800 weight, letter-spacing `.14em`) + small muted `item tracker` subtitle. Bottom border.
2. **Market-sync strip** (`.syncbar`): green status dot + `warframe.market` (source, in `--ink`) on the left, sync time (`2m ago`, mono, `--faint`) pushed to the right. Replaces any user/profile/account UI.
3. **"+ Add items" button** (`.nav-add`): **highlighted** — filled with `--accent`, dark text (`#15171b`), 700 weight, full-width within `9px 10px` margins. This is the primary action; opens the Add Items modal.
4. **Nav items** (`.nav-item`): Inventory, Trends, Sold History, Watchlist. Each: 15px stroke icon + label + optional right-aligned mono count. Active state = `--ink` text, 600 weight, `--hover` background, 2px left border in `--ink`.
5. **Quick read** box (`.qr`): bordered mini-panel with label rows — Hot parts, At watch target, Sold · 7d.
6. **Spacer** then **Settings** nav item in a top-bordered footer (`.nav-foot`). This is the only Settings entry (there is no gear in the top bar).

---

## Screens / Views

### 1. Inventory (default)
**Purpose:** Browse everything you own as a dense tile grid, grouped by category; filter/sort/search; click any item for details.

**Layout:**
- **Stat band** (`.statband`): 6-column grid (`repeat(6, 1fr)`, collapses to 3 cols under 900px), each a bordered box with an uppercase label and a large mono value. Boxes: **Total Platinum**, **Total Ducats**, **Parts** (with "N distinct" subtext), **Portfolio 7d** (value-weighted avg % change, green/red), **Hot** (trending count), **Sold · 7d**.
- **Filter row** (`.filters`): a small search input (live `is:hot`-style placeholder), category filter chips (`All, Hot, Warframe, Weapon, Set, Mod, Arcane`), a spacer, then sort chips (`Value ▾, Value ▴, Trend ▾, Name`). Active chip = filled `--accent` with dark text.
- **Sections** (`.section`): one per category present. Header (`.sec-h`) = disclosure triangle ▾/▸ + uppercase title + item count + right-aligned "stack value N p". Click header to collapse/expand. Body = a wrapping **flex grid of tiles** (`gap: 4px`).
- **Legend** at the bottom explaining tile color tiers and the ▲ hot / trend-bar / ×N markers.

**Tile** (`.tile`, square `var(--tile)` = 54px, 46px in dense mode):
- Neutral dark fill (`--panel-2`) with a **2px top border colored by value tier** (NOT a full rarity fill — this was deliberately toned down from a DIM clone).
- Centered 2-letter mono glyph (item initials).
- Top-left ▲ in `--hot` if the item is "hot" (trending).
- Top-right `×N` qty (mono, faint) when qty > 1.
- A **value bar** pinned to the bottom (`.vbar`, 13px tall, `--bg` with top border) showing `{plat}p` right-aligned.
- A 3px **trend strip** on the bottom-left edge: green `up` / red `down` / grey `flat` based on 7d change.
- Hover: 2px `--accent` outline (inset).
- Click → opens the detail **Drawer**.

### 2. Trends
**Purpose:** Market overview and movers, with a timeframe toggle that scales every figure.

**Layout (top → bottom):**
- **Timeframe row** (`.tf-row`): label "timeframe" + chips `24h / 7d / 30d / 90d`, spacer, and a right-aligned `warframe.market · PC · synced 2m ago` note. The selected timeframe multiplies all displayed deltas by a factor: `{24h:0.35, 7d:1, 30d:2.1, 90d:3.4}`.
- **Row 1** (`.trow-idx`, grid `minmax(0,1.7fr) 1fr`, stacks under 1040px):
  - **Prime Market Index** panel: big mono index level (`1000 × (1 + weightedAvgChange/100)`), colored change %, a sub-row of breadth stats (advancing / declining / flat / orders-per-day), and a large area+line chart.
  - **Category heat** panel: one row per category with a **diverging bar** centered on a zero line — green fills right for positive avg change, red fills left for negative — plus the signed % at the right.
- **Row 2** (`.trow2`, two equal columns): **Top gainers** and **Top losers** — ranked rows (`.mrow.mover`): rank, tier glyph, name + "part · cat", mini sparkline (green/red), price, and % change.
- **Row 3** (`.trow2`): **Most traded** (`.mrow.vol` — rank, glyph, name, a volume bar, "N/d") and **Your inventory in motion** (`.mrow.imp` — glyph, name + "×qty owned", price, and **plat value impact** = `qty × price × change% / 100`, colored).

All rows are clickable → Drawer.

### 3. Sold History
**Purpose:** Realized-sales ledger + earnings summary.

**Layout:**
- **Stat band** (5 cols): **Earned · 7d** (green), **Earned · 30d**, **Units sold**, **Avg sale**, **Best sale** (all in platinum).
- **Sold history panel** with a data table (`.dtable`): columns **When** (relative: "today" / "yesterday" / "Nd ago"), **Item** (tier glyph + name + part sub-line), **Qty** (×N), **Unit** (plat), **Total** (plat, bold). Rows for `daysAgo === 0` (logged this session) get an **undo ↺** button in the last cell.
- Sales are newest-first (seeded historical data; new sales prepend with `daysAgo: 0`).

### 4. Watchlist
**Purpose:** Track parts you want to buy, with a target buy price and "ready to buy" alerts.

**Layout:**
- **Stat band** (4 cols): **Watching** (count), **At buy target** (green count), **Buy-now spend** (sum of current prices of at-target items), **Avg gap to target** (%).
- **Watchlist panel** with sort chips in its header (`status / value / trend / name`) and a data table: **Item**, **Price**, **7d** (colored), **Target**, **Status**, and a remove **✕**.
  - **Status badge**: if `currentPrice ≤ target` → green **"at target"** badge (`.badge.at`); otherwise muted **"+X% to go"** where `X = round((price − target)/target × 100)`.
  - Default sort "status" puts at-target items first, then smallest gap.
- Items are added via the Drawer's "Add to watchlist" (default target = 90% of current price) and removed via the ✕.

---

## Detail Drawer (shared by all screens)
A right-side overlay (`.scrim` dim + `.drawer` 420px panel, slides over content) opened by clicking any item anywhere.

- **Header**: tier-colored square glyph, item name (16px/700), sub-line "part · category", close ✕.
- **Price row**: large mono price `{plat} p` + colored ▲/▼ change %.
- **Chart**: timeframe chips (`24h/7d/30d/90d`) + a large area+line chart (`BigChart`).
- **Detail grid** (`.dgrid`, 2×2): **You own** (×qty), **Ducat value**, **7d range** (≈ `price×0.82`–`price×1.15`), **Stack value** (`price × qty`).
- **Actions**:
  - **"Sell 1 · {plat}p"** (primary): logs a sale of 1 unit at the current price (prepended to the sold ledger with `daysAgo: 0`), and **decrements owned qty** by 1 (removing the item if it hits 0). If the item is removed, the drawer closes automatically.
  - **"Add to watchlist"** (secondary): adds the item to the watchlist; **disabled** + relabeled "On watchlist" if already present.

---

## Add Items Modal
Opened by the highlighted sidebar "+ Add items" button. A large centered modal (`.modal`, max-width 1200px, `28px` scrim padding) for browsing the full catalog and choosing what you own.

- **Header**: title "Add items" + a search input (filters all columns live; searching auto-expands matching groups) + close ✕.
- **Body**: a **5-column grid** (`repeat(5, minmax(0,1fr))` — the `minmax(0,…)` is required so columns shrink instead of overflowing), one column per category: **Warframe, Weapon, Sets, Mods, Arcanes**. Each column:
  - Header: category name + owned/total count + a **"+ all" / "clear"** toggle (adds qty-1 of every part, or removes all in the category).
  - Scrollable body.
- **Warframe & Weapon** columns are **grouped & expandable** (`.agrp`): each parent set (e.g. "Volt Prime") is a collapsible header (disclosure ▸/▾ + name + owned/total parts badge like 2/4). Expanding reveals indented **part rows** (`.crow.leaf`) — the **part name is the row label** (Blueprint, Neuroptics, Chassis, Systems).
- **Sets / Mods / Arcanes** are single rows (no expansion); the full item name is the label.
- **Each ownable row** (`.crow`): a checkbox cell (filled ✓ when owned), the label, and EITHER a muted "{plat}p" when not owned OR a **quantity stepper** (`.qstep`: − {n} +) when owned. Clicking the row toggles owned (0↔1); the stepper changes quantity (down to 0 removes it). Qty capped at 99.
- **Footer**: "{N} items in inventory · {M} in catalog" + a **Done** button.

---

## Interactions & Behavior
- **Navigation**: sidebar items set the active screen; only one screen renders at a time. Top-bar title reflects the active screen.
- **Filtering/sorting** (Inventory): pure client-side over the owned items; category chips, sort chips, and the inline search all compose. Sections with no matches hide when a non-"All" filter or a query is active.
- **Timeframe** (Trends): scales all deltas/index/heat/impact by the factor table above; re-sorts movers.
- **Selling**: drawer "Sell 1" → prepend to sales, decrement inventory qty, possibly remove item + auto-close drawer.
- **Watchlist add/remove**: drawer button add (with default target), table ✕ remove; "at target" computed live from current price vs target.
- **Add Items**: live search; per-row toggle + quantity stepper; per-column "+ all"/"clear"; group expand/collapse (forced open while searching).
- **Drawer/modal dismissal**: click the scrim/backdrop or the ✕.
- No animations beyond default; hover states use `--hover` background and `--accent`/`--soft` accents. This is a fast, static-feeling tool by design.

## State Management
All state is local React `useState` in the root `App` (in production, lift to a store + persistence + API layer):
- `screen` — active view id (`inventory|trends|history|watchlist`).
- `items` — **owned inventory** array (each: `id, name, part, cat, plat, duc, qty, d (7d % change), hot, spark, …`). Inventory/StatBand/Trends derive from this.
- `sel` — selected item for the Drawer (re-resolved live from `items` so it reflects qty changes; becomes null when the item is removed, closing the drawer).
- `adding` — Add Items modal open boolean.
- `watch` — watchlist array (catalog items + a `target` price).
- `sales` — sold ledger array (`name, part, cat, qty, plat, daysAgo`).
- Derived (`useMemo`): `ownedMap` (id→qty), `watchedIds` (Set), `counts` (nav badges).
- Tweaks state via `useTweaks` (see Tweaks below).

### Data model / fake data (replace with real API)
- A `CATALOG` is generated deterministically from source arrays (`FRAMES, WEAPONS, SETS, MODS, ARCANES` — each `[name, basePlat, hot]`). Warframe/Weapon entries explode into 4 parts each (`WF_PARTS`/`WP_PARTS`) via `makePart`; Sets/Mods/Arcanes are singles via `single`. ~215 catalog items total.
- A `seed(string)` hash drives all pseudo-random fields (price deltas, qty, sparkline) so the prototype is stable across reloads.
- Initial inventory = ~70% of the catalog (`seed(id+"own")%10 < 7`).
- `genSpark(delta)` builds a 7-point sparkline string trending in the sign of the change.
- Tiers: `tier(plat)` → `exotic ≥120`, `legend ≥45`, `rare ≥15`, else `basic`. Used only for the small tier-colored accent edge/glyph border.

In production: replace `CATALOG`/`seed`/`genSpark` with warframe.market item data + real price history; persist `items`, `watch`, `sales` locally (e.g. SQLite/Tauri store or localStorage).

---

## Design Tokens
Defined as CSS variables on `:root` (dark theme). `--tile` shrinks under `body.dense`. `--accent` is overridable via Tweaks.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0c0d10` | app background (near-black) |
| `--bg-2` | `#111216` | sidebar / topbar / drawer / modal bg |
| `--panel` | `#15171b` | panels, stat boxes, inputs |
| `--panel-2` | `#1b1d22` | tile fill, glyph chips |
| `--line` | `#24262e` | hairline separators |
| `--line-2` | `#31343d` | stronger borders |
| `--ink` | `#e2e3e6` | primary text |
| `--soft` | `#989ba2` | secondary text |
| `--faint` | `#62656d` | muted text / labels |
| `--hover` | `#1f2127` | hover background |
| `--accent` | `#cfd2d8` | highlights (neutral light-grey by default; Tweakable to `#f0883e`/`#4f9dde`/`#5fc27e`) |
| `--pos` | `#5fc27e` | positive change / at-target |
| `--neg` | `#e0685c` | negative change |
| `--hot` | `#f0a93e` | "hot" ▲ marker |
| `--t-exotic` | `#d6b748` | tier edge ≥120p |
| `--t-legend` | `#9a83e0` | tier edge 45–119p |
| `--t-rare` | `#5b90d8` | tier edge 15–44p |
| `--t-basic` | `#71757f` | tier edge <15p |
| `--nav` | `182px` | sidebar width |
| `--tile` | `54px` (dense `46px`) | inventory tile size |

**Typography:** system UI sans (`--sans`) for everything; **monospace** (`--mono`, tabular-nums) for all numbers/prices/counts. Base font-size **12px**. Notable sizes: brand 13px/800; stat value ~21px/600 mono; index level 30px/700 mono; drawer price 32px/700 mono; section/panel titles 11–13px/700 uppercase; tile glyph 14px/700; labels 9.5–10px uppercase, letter-spacing ~.05–.07em.

**Spacing:** content padding `12px 16px 48px`; grid gaps mostly `8–12px`; tile grid gap `4px`; common control padding `5–8px`. **No border radius anywhere** (deliberately square/utilitarian). **No shadows** except the drawer/modal sit over a dim scrim (`rgba(0,0,0,.5–.6)`).

## Assets
- **No external image assets.** All item art is faked with 2-letter mono initials on a tier-colored chip — in production, swap in real item icons from warframe.market or the Warframe asset CDN.
- **Icons** are inline SVGs defined in the `Icon` component (`inventory, trends, history, watchlist, settings, search, refresh, coin, box, tag, sold`) — 24×24 viewBox, `stroke: currentColor`, no fill, 1.7–1.8 stroke width. Replace with the codebase's icon set as needed.
- **Fonts**: system stacks only; no web fonts loaded.

## Files
- **`WFIT Wireframe.html`** — the shell: all CSS (design tokens + every component's styles live in the `<style>` block), the React/Babel script tags, and mounts `wireframe.jsx`. This is the entry point — open it to see the design.
- **`wireframe.jsx`** — the entire app: fake data layer, all components (`Sidebar, StatBand, Inventory, Section, Tile, Trends, MoverRow/VolRow/ImpactRow, MiniSpark, BigChart, SoldHistory, Watchlist, Drawer, AddItems, QtyRow, App`), and state.
- **`tweaks-panel.jsx`** — a prototype-only "Tweaks" panel (host-integration helper). **Not part of the product** — it provides the in-prototype controls below and can be ignored when implementing.

### Tweaks (prototype-only, safe to ignore)
Toggles wired in the prototype: **Compact tiles** (`body.dense`), **Mute trend colors** (`body.flat-deltas` — greys the pos/neg), and **Accent** color swatches. These demonstrate options; they are not product features unless you want them as user settings.
