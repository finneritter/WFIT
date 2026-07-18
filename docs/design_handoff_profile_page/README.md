# Handoff: Account / Tenno Trader Profile (WFIT / WFIT)

## Overview
A redesigned **Account profile page** for WFIT (the WFIT — Warframe Item Tracker app). It is a *Tenno trader profile*: an identity header, three info columns, a section tab bar, and a default **Overview** tab containing three Day/Week/Month stat cards over a sortable, selectable **trades table**. Four additional tabs (Resources, Armory, Codex, Stats) swap the body content in place.

The layout is modeled on the Koala UI "Profile / user management" page, re-skinned into WFIT's existing dark design system.

## About the Design Files
The files in this bundle are **design references created in HTML/React (Babel-in-browser)** — prototypes that show the intended look and behavior. They are **not** production code to copy directly. The task is to **recreate these designs in the target codebase's environment** (React, Vue, Svelte, etc.) using its established component patterns, then wire them to real data. If no app environment exists yet, pick the most appropriate framework and implement there.

`theme.css` **is** the real, shippable design system — use its CSS custom properties verbatim (or port them into the codebase's token system). Do not invent new colors/spacing.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, component styling, and interactions are all specified via `theme.css` tokens and the prototype. Recreate the UI pixel-accurately using the codebase's libraries. The data shown is placeholder — replace with live data.

The prototype's inline `style={{…}}` blocks (in `account-koala.html`) are the source of truth for any one-off measurement not covered by a `theme.css` class.

---

## Primary file to implement
**`account-koala.html`** — the chosen, final direction ("Koala direction"). Implement this one.

Other files are earlier explorations, included only for context — do **not** implement them:
- `account-explorations.html` — first 4 rough directions (A–D)
- `account-B.html` — three refinements of the centered layout
- `account-profile.html` — a centered-identity variant with the same 4 sub-sections

---

## Screen: Account Profile

Single scrolling page. Max content width is the app's main column; the prototype artboard is **1280px** wide. All vertical sections are full-width and separated by 1px `--line` rules.

### Layout (top → bottom)
1. **Breadcrumb bar** — 42px tall, `--bg-2` background, 1px bottom border `--line`, horizontal padding 24px. Left: a "‹ Back" affordance (`--soft`) + breadcrumb `Account / bigfinnn` (trail in `--faint`, current page in `--ink`). Right (pushed with flex spacer): a date-range chip (mono, `--line-2` border, padding 5px 10px) + a settings icon button.
2. **Header** — flex row, align-items flex-start, gap 16px, padding `22px 24px 16px`. Left: 64px square **emblem**. Center (flex:1): username `bigfinnn` (22px / weight 800 / letter-spacing −.02em) and market handle below (12.5px `--faint`). Right: three buttons — primary "⟳ Sync", secondary "Message", "Share".
3. **Info columns** — 3-column CSS grid, gap 24px, padding `0 24px 18px`, 1px bottom border. Columns: **About**, **Account**, **Links**. Each column has a `secH` label (see Design Tokens → text styles) then icon rows: 14px stroke icon (`--faint`) + 12px `--soft` text, 9px top margin between rows.
4. **Tab bar** — flex row, gap 2px, padding `0 24px`, 1px bottom border. Tabs: `Overview · Resources · Armory · Codex · Stats`. Active tab: `--ink` text, weight 700, 2px bottom border `--ink`, margin-bottom −1px to sit on the divider. Inactive: `--soft`, weight 500, transparent bottom border.
5. **Body** — padding `18px 24px 28px`. Renders the active tab.

### Tab: Overview (default)
- **Three stat cards** — flex row, gap 12px, margin-bottom 16px. Each card (`flex:1`, `--line-2` border, `--panel` bg, padding `13px 15px`):
  - Top row: 15px stroke icon (tinted to the card's accent), card label (12px `--soft`, flex:1), and a **D / W / M segmented toggle** (three 26×22px buttons in a `--line-2` bordered group; active button = `--accent` bg + `--accent-ink` text, weight 700).
  - Big value: mono, 32px, weight 800, letter-spacing −.03em, colored per card; trailing unit (15px `--faint`).
  - Caption: 11px `--faint` — the period label ("today" / "Jun 12 – Jun 18" / "May 18 – Jun 18").
  - Cards: **Platinum earned** (`--plat`, values D/W/M = 410 / 2,840 / 8,920 p), **Items sold** (`--ink`, 18 / 127 / 483), **Ducats earned** (`--ducat`, 640 / 6,420 / 21,300 d).
- **Toolbar** — `.filters` row: a search field (`.search`, max-width 320, height 30, mono input, magnifier icon), "⨯ Filter" and "⇅ Sort" chips, flex spacer, then "＋ New listing" (primary `.btn.pri.sm`), "Export", "Columns" (`.btn.sm`).
- **Trades table** — `.tpanel` wrapper + `.dtable`. Columns: checkbox · `# Trade` (sorted desc, mono) · Item (glyph + name via `.dnm`/`.gl`/`.di`) · Rarity (pill) · Type (pill w/ dot) · Price (right, mono, `--pos` for sold `+`, `--neg` for bought `−`) · Counterparty (22px glyph + handle) · When (right, `.when`) · Action (edit/view/⋯ stroke icons). Clicking a row toggles selection → row bg becomes `--hover`; checkbox reflects state.

**Pill component** (the reference's Priority/Status pills): inline-flex, `--line-2` border, `--panel` bg, padding `2px 7px`, 11px text. Leading marker = 7px square swatch (Rarity, colored by tier) or 6px round dot (Type — `--pos` sold / `--hot` bought), label in `--ink`, trailing 10px chevron in `--faint`.

### Tab: Resources
Two zones. **Tracked tray** (top): a dashed `--line-2` drop zone (`--bg-2` bg, min-height 104px) holding featured resource cards (156px wide, 2px top border in the tier color, mono 26px quantity, ✕ to remove). Dragging over it highlights border/bg to `--accent`/`--hover`. **All resources** (below): a `.dtable` with a drag handle (⠿) column; rows are `draggable` and set `dataTransfer` to their index — dropping on the tray (or clicking a row) features that resource.

### Tab: Armory
A `.filters` chip row (All / Warframes / Primary / Secondary / Melee — `aria-pressed` active state) filtering a `.dtable`: Item (glyph + name) · Type · Level · Forma (◆) · Mastery (`.badge.at`).

### Tab: Codex
Header: mono 30px "68%" + caption "complete · 412 / 631 entries", and a "View full codex →" chip. Then per-category progress rows (grid `120px 1fr 44px`): label · 6px track (`--line`) with fill (`--pos` if ≥70%, else `--soft`) · mono % value.

### Tab: Stats
- **Career band** — 4-column grid in one bordered panel with a subtle `linear-gradient(100deg, var(--panel-2), var(--panel))`. Each cell: mono 34px weight-800 value + unit, uppercase `--faint` label. (Hours played, Enemies defeated, Missions cleared, Star chart %.)
- **Two `.tpanel`s** side by side: "Most-used Warframes" and "Mission types" — each a list of **BarRow**s (label, 6px `--line` track with `--accent` fill, right-aligned mono %).
- **Secondary stats** — a `.statband` of 4 `.statbox`es (Accuracy, Deaths, Revives, Pickups).

---

## Interactions & Behavior
- **Tab switching** — local state `tab` selects which body component renders. No route change in the prototype; in the app, consider a nested route or query param per tab.
- **D/W/M toggle** — per-card local state `span` ('D'|'W'|'M'); switches the displayed value and caption.
- **Row selection** — `sel` map keyed by row index; toggled on row click; selected rows get `--hover` background and a checked checkbox. (In production, hook to bulk actions in the toolbar.)
- **Resource drag-to-feature** — HTML5 drag-and-drop: table rows are `draggable`, set `dataTransfer.setData('text/plain', index)`; the tray's `onDrop` reads the index and adds it to `pinned[]`; ✕ removes. Clicking a row also features it. De-dupes by index.
- **Armory filter** — `cat` state filters the flattened rows by weapon/frame type.
- No async/loading/error states are mocked — add them per the codebase's conventions (skeleton rows for the tables, empty states for the tray and filtered tables).
- **Responsive**: prototype is fixed-width. For production, collapse the 3 info columns to 1, wrap the 3 stat cards, and allow the tables to scroll horizontally on narrow viewports.

## State Management
| State | Scope | Purpose |
|---|---|---|
| `tab` | page | active section (Overview/Resources/Armory/Codex/Stats) |
| `span` | per stat card | D/W/M period selection |
| `sel` | Overview table | set of selected trade rows |
| `pinned` | Resources | indices of featured resources |
| `over` | Resources | drag-over highlight flag |
| `cat` | Armory | active type filter |

Data needs (replace placeholders): profile identity + market handle + region; balances (platinum/credits/endo/items/sets); trade history (id, item, rarity tier, sold|bought, price, counterparty, timestamp); resource inventory (name, tier, quantity); armory (frames/weapons with level + forma + mastery); codex completion per category; gameplay/career stats.

## Design Tokens (from `theme.css`, dark theme `:root`)
Use the CSS variables, not the raw hex — a `body.light` block redefines the same names for light mode.

**Surfaces** `--bg #0c0d10` · `--bg-2 #111216` · `--panel #15171b` · `--panel-2 #1b1d22` · `--hover #1f2127`
**Lines** `--line #24262e` · `--line-2 #31343d`
**Text** `--ink #e2e3e6` · `--soft #989ba2` · `--faint #62656d`
**Accent** `--accent #cfd2d8` (neutral) · `--accent-ink #15171b` (text on accent fill)
**Semantic** `--pos #5fc27e` (sold/gain) · `--neg #e0685c` (bought/loss) · `--hot #f0a93e` · `--blue #3d7df0`
**Currency** `--plat #6fa8d8` · `--ducat #d6b748`
**Value tiers** `--t-basic #71757f` (Common) · `--t-rare #5b90d8` (Uncommon) · `--t-exotic #d6b748` (Rare) · `--t-legend #9a83e0` (Special)
**Fonts** `--sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` · `--mono: ui-monospace, "SF Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace`
**Other** `--tile 46px` · `--nav 182px`

**Numbers are always mono** (`var(--mono)`), usually with negative letter-spacing (−.02em to −.04em) at large sizes.

**Recurring text styles**
- `secH` (column / section label): 11px, weight 700, uppercase, letter-spacing .06em, `--faint`, margin-bottom 8px.
- Eyebrow/caption: 10–11px, uppercase, letter-spacing .05–.06em, `--faint`.

**Spacing**: page section padding is `… 24px` horizontal; body `18px 24px 28px`; common gaps 8 / 12 / 14 / 16 / 24px.

## Reusable theme.css classes used
`.btn` (+ `.pri`, `.sm`) · `.chip` (+ `aria-pressed`) · `.filters` · `.search` · `.statband` / `.statbox` (`.k` / `.v` / `.u`) · `.tpanel` (+ `.tpanel-h` > `h3` + `.meta`) · `.dtable` with `.th-sort` (+ `.sorted`, `.sort-arr`), `.dnm` / `.gl .t-*` / `.di` / `.nm` / `.when`, alignment `.r`, numerics `.num` (+ `.pos` / `.neg`) · `.badge` (+ `.at`) · `.icon-btn`. Read `theme.css` for the full definitions before reimplementing.

## Assets
- **Emblem**: inline SVG placeholder (hexagon sigil over a diagonal-hatch fill). Replace with the user's real Warframe profile emblem/avatar. Provide a square image slot, 64px in the header.
- **Icons**: all inline 24×24 stroke SVGs (1.7 stroke, round caps) drawn in the prototype — substitute the codebase's icon set (Lucide/Heroicons-style) at matching sizes.
- No raster assets or web fonts; fonts are system stacks.

## Files in this bundle
- `account-koala.html` — **implement this** (final design).
- `account-profile.html`, `account-B.html`, `account-explorations.html` — earlier explorations, context only.
- `theme.css` — the design system (tokens + component classes). Ship/port this.
- `design-canvas.jsx` — the pan/zoom canvas the prototypes are mounted in. **Scaffold only — do not implement.** The actual page is the `Profile` component inside each HTML file.

> Note: the prototypes load React 18 + Babel from a CDN purely to render in-browser. Production should use the codebase's own build pipeline and component framework.
