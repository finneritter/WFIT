> **⚠️ These files are a VISUAL prototype only — not a data source.** The `CATALOG`, prices,
> ducats, sparklines, set/"hot"/trend flags, and every other value in `primely.jsx` are **mock/static
> placeholders**. Do NOT hardcode or seed any of them into the app. Every real value (which primes
> exist, prices, ducats, sets) comes from **warframe.market** at runtime — see
> [`../DATA_SOURCING_MASTER_PLAN.md`](../DATA_SOURCING_MASTER_PLAN.md). Take from these files only the
> look: layout, typography, color tokens, motion, and component anatomy.

# Handoff: Primely — Prime Trading Dashboard

## Overview
Primely is a web app for Warframe traders to manage their prime-part inventory and track the in-game trading market (platinum/ducats). This handoff covers the full authenticated app: a left-nav shell with five screens — **Dashboard, Inventory, Trends & Analytics, Sold History, Watchlist** — plus a global **item price-history modal** and an **add-to-watchlist modal**. It ships with light & dark themes and a small in-app "Tweaks" panel for previewing theme/accent/font.

## About the Design Files
The files in this bundle are **design references created in HTML/React-via-Babel** — a working prototype that demonstrates the intended look, layout, and interactions. They are **not production code to copy directly**. The Babel-in-the-browser setup, inline `<script>` tags, and single-file JSX are prototype conveniences only.

Your task is to **recreate these designs in the target codebase's existing environment** (e.g. a real React/Next + bundler setup, Vue, SwiftUI, etc.), using its established component library, routing, state, and styling conventions. If no app environment exists yet, choose an appropriate modern stack (React + Vite + TypeScript + CSS variables or Tailwind is a natural fit) and implement there.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, motion, and interactions are all specified below and present in the prototype. Recreate the UI faithfully, but swap the prototype's mechanics (browser Babel, hand-rolled charts, localStorage) for the codebase's real equivalents (build step, a charting lib if preferred, real data layer).

---

## Global Layout / App Shell
- **Two-column shell**: fixed left **sidebar** (width `244px`) + fluid **main** column.
- Sidebar is `position: sticky; top: 0; height: 100vh`, `1px` right border, surface background.
- Main column centers content at `max-width: 1280px` with `34px` horizontal padding (`24px` under 1080px).
- **Topbar** per screen: large page title (display font, 27px) + muted subtitle.
- Background: page `--bg` with a subtle radial accent glow in the top-right (`--bg-grad`).

### Sidebar contents (top → bottom)
1. **Brand**: 38px rounded-square gradient mark with "P" (Space Grotesk 600) + wordmark "Primely." (the period uses `--accent`).
2. **Primary CTA**: "+ Add a part" — solid accent button, full width, `--r-md` radius. Opens the **Add-a-Part menu** (`AddPartModal`).
3. **Menu group label** ("MENU"), then nav items:
   - Dashboard, Inventory (badge "86"), Trends, Sold History, Watchlist (badge = live tracked count).
   - Nav item: 14.5px, icon (19px stroke) + label + optional pill badge. Active state: accent-ink text, `--accent-weak` bg, and a 3px accent bar on the far left.
4. **Footer** (pinned bottom, separated by `1px` top border):
   - **Theme toggle** pill (sun/moon icon in a round knob + "Light/Dark mode" label).
   - Settings nav item.
   - Account chip: 30px glyph + username + "MR 27".

---

## Screens / Views

### 1. Dashboard (Layout "A")
- **Purpose**: at-a-glance account overview + trending inventory.
- **Layout**: vertical stack, `16px` gaps:
  1. **Header bar card**: left = profile (50px glyph + username + "Mastery Rank 27" + sync badge); right = "Portfolio value · 7d" eyebrow, big value `1,240 p` (display 25px) + up-delta chip, and a 150×42 sparkline.
  2. **Stat row**: 3 equal cards (`repeat(3,1fr)`, 16px gap). Each: label + optional delta chip (top), big value (display 33px) with unit, then a context note + a 76×26 sparkline.
     - Total Platinum — `1,240 p`, ▲11%, "+138 p this week"
     - Total Ducats — `3,755 d`, ▲6%, "≈ 12 relics to spare"
     - Prime Parts — `86`, no delta, "14 trending · 5 sets ready"
  3. **Trending table card** (full width). Columns: `Prime Part | Plat | 7d | Qty | Ducats | Trend | Inventory`. Grid template: `minmax(0,1.5fr) 90px 84px 52px 78px 84px 116px`, 14px gap. Each row: 34px glyph + name (clickable → price modal) + sub (part · optional "↑ Hot" pill); platinum value in accent; 7d delta (green/red triangle); qty; ducats; a 70×24 trend sparkline; "Mark sold" pill button.

### 2. Inventory
- **Purpose**: full searchable list of every owned part.
- **Toolbar**: a **live search field with autocomplete** (`PartSearch`) + filter chips (All / Warframe / Weapon / Hot / Sold) + "Sort: Plat ▾" chip.
  - The search is a real `<input>`: typing filters the table live (matches name + part + category), with a clear (✕) button.
  - It also shows an **autocomplete dropdown** of up to 6 matching parts (glyph + name + sub + plat). Keyboard support: ↑/↓ to move, Enter to pick, Esc to dismiss; hover highlights. Picking a suggestion opens that part's price-history modal.
- **Table card**: columns `Prime Part | Plat | Qty | Ducats | 7d | Inventory`, grid `minmax(0,1fr) 90px 56px 78px 92px 116px`. Row anatomy: glyph, clickable name, plat, qty, ducats, 7d delta, Mark-sold. Empty state when nothing matches.

### 3. Trends & Analytics
- **Purpose**: market movement, sortable by item category.
- **Category sorter** (chips): Prime Parts / Sets / Mods / Arcanes — switches both the chart and the movers list.
- **Two-column** (`1fr 352px`, 22px gap):
  - **Chart card**: "{category} · market index" eyebrow + subtitle; timeframe segmented control (24h/7d/30d/90d); big index value (display 46px) + delta chip + "vs last {tf}"; large area+line chart (`BigChart`, height 232).
  - **Top movers card**: list of items, each = name + plat (accent) + a small sparkline (green/red) + delta. Rows are clickable → price modal.

### 4. Sold History
- **Purpose**: realized sales + earnings.
- **Timeframe** segmented control (7d / 30d / All time), right-aligned.
- **3 summary stat cards**: Platinum earned (accent value, count-up), Items sold, Best sale.
- **Sale history table**: `Prime Part | Sold for | Qty | Buyer | Date`, grid `minmax(0,1fr) 104px 56px 132px 84px`. "Sold for" shown as `+{plat} p` in positive/green.

### 5. Watchlist
- **Purpose**: track parts you don't own and get alerted at a target price.
- **Toolbar**: filter segmented control (All / At target / Watching) + "+ Add to watchlist" primary button.
- **Tracked-parts table**: columns `Prime Part | Current | Target | Status | Alert | (remove)`, grid `minmax(0,1.5fr) 92px 150px minmax(0,150px) 44px 40px`.
  - **Target** is editable via −/+ stepper buttons (±5 p, min 1).
  - **Status**: if `current <= target` → green "✓ At target — buy now"; else muted "`{diff} p` to go".
  - **Alert**: bell icon-button toggle (on = accent-tinted).
  - **Remove**: ✕ icon-button.
- **Empty state**: glyph + "Nothing tracked yet" + CTA.
- **Add modal** (`AddWatchModal`): title + search field + scrollable candidate list (parts not already tracked), each with glyph, name (clickable → price modal), current plat, and a "+ Add" button. Adding sets default target = `round(plat * 0.85)`, alert on.
- Header count: "{atTarget} at target · {total} tracked". Sidebar badge reflects the live count.

### Global: Item Price-History Modal (`ItemDetail`)
- Opens when any part **name** is clicked anywhere in the app (via React context `OpenPartContext` → `setSelected`).
- Centered sheet (max-width 660px, radius 22px, pop shadow), scrim with `backdrop-filter: blur(3px)`, animates in (fade scrim + `translateY(18px) scale(.97)` → none, 0.32s).
- Contents: glyph + name + sub + close ✕; big current value (accent, 46px) + delta chip; "Price history" eyebrow + timeframe segmented control; large `BigChart` (height 196); three tiles (7d range `≈82%–115% of price`, Ducat value, You own); actions: owned parts → primary **"Mark sold"**; unowned → primary **"+ Add to inventory"**; both show a secondary **"+ Add to watchlist"**. (The app does **not** create sale listings — parts are added/tracked only.)

### Global: Add-a-Part Menu (`AddPartModal`)
- Triggered by the sidebar **"+ Add a part"** CTA. Purpose: **add a prime part you own to your inventory** (this is *not* a sale-listing flow — listings cannot be created from the site).
- **Step 1 — pick**: a `PartSearch` autocomplete over the prime **catalog** (`CATALOG`, ~16 parts) + a scrollable catalog list below. Each catalog row shows glyph + name + part·category + market plat, and an **"owned ×N"** pill if it's already in inventory.
- **Step 2 — quantity**: selected part shown in a "picked" card (with "Change" to go back); a **quantity stepper** (−/+ and editable number, min 1); a live "Inventory value added" = `market plat × qty`. If already owned, the card notes "already own ×N".
- **Confirm**: "Add {qty}× to inventory" → success state ("Added to inventory") with **"Add another"** and **"Done"**.
- **Behavior**: adding updates the app's `parts` state — if the part (matched by name + part) already exists, its **quantity increments** (no duplicate row); otherwise a new inventory entry is created (`plat`/`duc`/`d`/`spark` from the catalog, `hot:false`, `sold:false`). The new/updated part appears immediately in Inventory and Dashboard tables.

---

## Interactions & Behavior
- **Navigation**: sidebar sets the active `screen`; main content is keyed by screen so it remounts (re-triggers reveal animation).
- **Search (Inventory, Add-a-part, Add-to-watchlist)**: real controlled inputs. `PartSearch` = input + clear + autocomplete dropdown (keyboard navigable) used where picking a result is the goal; `SearchInput` = plain input that filters an adjacent list (used in the watchlist add modal). Matching is case-insensitive over name + part/sub + category.
- **Theme toggle**: switches `light`/`dark`, persisted to `localStorage('primely-theme')`, applied via `document.documentElement.dataset.theme`.
- **Mark sold**: toggles a part's `sold` flag → row dims to 0.6 opacity, name gets strikethrough, button flips to "✓ Sold".
- **Add a part**: `AddPartModal` adds/increments inventory (see above).
- **Click name → modal**: opens price-history detail for that item.
- **Watchlist**: add (modal), remove (✕), adjust target (±5 stepper), toggle alert (bell). All client-side state.
- **Category / timeframe / filter controls**: client-side, instant.

### Motion (rich, on purpose)
- **Staggered reveal** on each screen mount: elements with `.reveal` animate `opacity 0→1` + `translateY(14px)→0` over `0.6s`, eased `cubic-bezier(.22,.61,.36,1)`, with per-element `animation-delay` (~60–280ms stagger). A `1.5s` fallback adds `html.revealed` to force final state (guards against throttled timelines). Respect `prefers-reduced-motion` (all reveal/draw disabled).
- **Chart line draw-in**: stroke `dasharray/dashoffset` animates over 1.1s; data dots pop in with staggered delay.
- **Count-up**: big numeric values animate 0 → target over ~1.1s (cubic ease-out) on mount.
- **Hover**: `.lift` cards translateY(-3px) + larger shadow; table rows get `--surface-2` bg; buttons brighten/translate.

## State Management
- `theme`: 'light' | 'dark' (persisted).
- `screen`: which of the 5 views is active.
- `parts`: array of inventory parts (incl. `sold` flag toggled by Mark-sold; `qty` incremented / new entries appended by Add-a-part).
- `watch`: watchlist array (add/remove/target/alert mutations). Sidebar badge derives from `watch.length`.
- `selected`: the item shown in the price-history modal (null = closed); provided app-wide via React context.
- Tweaks (`accent`, `font`, `defaultTheme`) — prototype-only preview controls; in production these map to user settings or are dropped.
- All data is **mock/static** in the prototype. In production, wire to the real API: inventory, market prices + history, sold trades, watchlist CRUD, price alerts.

## Design Tokens
Defined as CSS custom properties, themed via `html[data-theme="light"|"dark"]`.

**Light** — bg `#f5f6f8`, surface `#ffffff`, surface-2 `#f4f6f8`, surface-3 `#eceff3`, border `#e7e9ee`, border-strong `#d6dae2`, text `#11151d`, text-soft `#58616f`, text-faint `#98a0ad`, accent `#0d9488` (accent-ink `#0a7d72`), positive `#128a5e`, negative `#d6493f`.

**Dark** — bg `#0a0d12`, surface `#131922`, surface-2 `#1a212c`, surface-3 `#212a37`, border `#232b38`, border-strong `#313c4b`, text `#eef2f7`, text-soft `#9aa4b3`, text-faint `#5f6a7a`, accent `#2dd4bf` (accent-ink `#5eead4`), positive `#35d399`, negative `#f87166`. Dark adds an accent **glow** (`0 0 22px rgba(accent,.30)`) on key elements.

**Accent presets** (Tweaks): teal `#0d9488` (default), indigo `#4f46e5`, violet `#7c3aed`, emerald `#059669`. Accent-ink/weak/glow are derived per-theme in JS (`applyAccent`): dark brightens the base by mixing ~30% white; light darkens ink ~12%.

**Radii**: card `16px`, md `12px`, sm `9px`, pill `999px`. **Shadows**: subtle `--shadow-1`, lifted `--shadow-2`, modal `--shadow-pop` (values differ per theme — see CSS). **Spacing**: 8px-based rhythm (gaps 8/12/14/16/22). **Ease**: `cubic-bezier(.22,.61,.36,1)`.

## Typography
- **Display** (`--font-display`): **Space Grotesk** (weights 500/600) — headings, big numbers, glyph monograms. Tweaks can swap to "Editorial" (Newsreader serif) or "Clean" (Hanken only).
- **Body/UI** (`--font-sans`): **Hanken Grotesk** (400–800).
- Numbers use tabular figures (`font-variant-numeric: tabular-nums`).
- Sizes (px): page title 27, section title 18–19, big stat 33, modal price 46, body 14–15.5, labels/sub 12.5–13.5, eyebrow 11.5–12.5 uppercase tracked.

## Assets / Icons
- **No external image assets.** Item artwork is intentionally a **glyph placeholder**: an accent-tinted rounded square containing the first ~2 letters of the part name (display font). In production, replace with real item icons (e.g. from the Warframe API/wiki); keep the rounded-square framing.
- **Icons** are inline SVGs (stroke 1.8, round caps): dashboard, inventory (cube), trends, history (clock), watchlist (star), settings (gear), search, sun, moon, bell, plus. Swap for the codebase's icon set if it has one.
- Charts (`BigChart`, `Spark`) are hand-rolled SVG (smoothed area+line). A charting library is fine in production as long as the look (soft area gradient, accent line, dot markers, draw-in) is preserved.

## Files
- `Primely Dashboard.html` — app shell, full CSS token system + component styles, font imports, script wiring.
- `primely.jsx` — all React components, mock data, charts, theme/accent/font logic, screens, modals, App.
- `tweaks-panel.jsx` — the in-prototype Tweaks panel (preview only; not part of the product).

A previous low-fidelity wireframe also exists in the project (`Primely Dashboard Wireframes.html` + `dashboard.jsx`/`app.jsx`) — ignore for implementation; the hi-fi files above are the source of truth.
