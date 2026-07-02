# Home Widgets — customizable dashboard grid

The Home screen's lower half is a **customizable widget grid**: an iOS-control-
panel-style board the user can add to (multi-select checklist), remove from,
**drag to move freely** (gaps allowed), and **resize by the corner** (snapping
to 1×1 … 2×2). Each widget is a glanceable **preview of a screen** — its header
navigates there, rows inside open the item drawer, and **clicking a tile's body
focuses it** (the row list uncaps and scrolls in place). The top of the screen
(`PortfolioHero` + `WorldStrip`) is unchanged.

Frontend-only. No Rust/DB/command changes; layout is a pure UI preference in
`localStorage`.

## Files

- `src/components/home/HomeWidgetGrid.tsx` — the grid host: layout state +
  persistence, edit mode (button, or **long-press** a tile), click-to-focus,
  the add-widget checklist modal + the edit-mode **ghost "+" tile**,
  pointer-event drag/move + corner-resize, and the FLIP animation.
- `src/components/home/widgets.tsx` — the widget **registry** (`WIDGETS` /
  `WIDGET_MAP`), the shared size-adaptive `WidgetBody`, the `HwRow`/`DeltaChip`
  primitives, the default layout (`DEFAULT_LAYOUT`), and one component per widget.
- `src/components/home/selectors.ts` — pure derivation helpers shared by
  widgets (`overMarketListings`, `atTargetWatches`, `oneAwaySets`, `liveCascade`,
  `within`, `sumSales`, `dailyEarnings`). Add cross-widget derivations here,
  not inline in components.
- `src/routes/Dashboard.tsx` — renders `PortfolioHero` + `WorldStrip` (fixed) then
  `<HomeWidgetGrid>`.
- `src/theme.css` — all `.hw-*` styles (tile chrome, card body, edit-mode grid
  backdrop, resize grip, ghost tile, delta chip, sparkline, search popover).

## Engine: CSS Grid + Pointer Events (NOT react-grid-layout)

> **Lesson learned — do not reintroduce react-grid-layout.** It was tried first
> and its drag/resize + `WidthProvider` width measurement **did not work in the
> app's WebKitGTK webview** (tiles collapsed to one column; drag/resize dead),
> even though it worked in Chromium. It was removed. The current engine is
> hand-built on primitives that are solid in WebKitGTK.

- **Layout = plain CSS Grid with freeform placement.** `.hw-grid` is
  `grid-template-columns: repeat(4,1fr)`, `grid-auto-rows: 150px`, `gap: 10px`.
  Each tile stores explicit `x`/`y` + spans and renders inline
  `grid-column: x+1 / span w`, `grid-row: y+1 / span h`. **Gaps are allowed** —
  tiles live where they're put. Dropping onto a tile pushes overlapped tiles
  straight down (`resolveDown`, cascading; always resolved from the committed
  layout so undisturbed tiles spring back). Adding a widget places it at the
  first open cell that fits (`firstFree`).
- **Drag-move + resize = Pointer Events.** In edit mode, `pointerdown` on a tile
  starts a drag; `pointerdown` on the corner grip (`.hw-resize`) starts a resize.
  Both attach `pointermove`/`pointerup` listeners on `window` (robust, no
  `setPointerCapture` needed). The grabbed tile becomes a floating overlay that
  follows the cursor (moved imperatively via `translate3d`, no re-render); a
  dashed placeholder holds its slot. The drop target is the overlay's top-left
  **snapped to the nearest cell**, resolved through `resolveDown` into a draft
  layout the grid renders live; localStorage is written **once on drop**. Resize
  is **delta-based** (pointer delta ÷ cell pitch → ±cells, clamped to each
  widget's `min`…2) through the same draft/commit model.
- **Width** is measured by our own `ResizeObserver` on `.hw-wrap` (sets
  `--hw-pitch-x/y` for the edit-mode backdrop and `colWRef` for drag/resize
  math) — not by any library HOC.

## Persistence + migration

- `localStorage` key **`wfit.homeLayout`** via `usePersistedJSON` (`src/lib/persist.ts`):
  `{ version: number, items: Array<{ key, x, y, w, h }> }`. Placement is
  absolute (`x` = column 0..3, `y` = row 0..); array order only affects React
  keying/FLIP diffing, not position. (One-time hint flag: `wfit.homeHintSeen`.)
- **`LAYOUT_VERSION`** (currently `4` = freeform x/y) gates the schema. On a
  version mismatch the stored layout is discarded and reset to `DEFAULT_LAYOUT`
  (a corrupted/legacy layout can't stick). Bump it if the `items` shape changes.
  Unknown widget keys are filtered out defensively.

## Interactions outside edit mode

- **Click-to-focus:** clicking a tile's body (not a row/button/input/link)
  focuses it — the `.hw-card` border steps up, the row cap comes off, and the
  list scrolls inside the tile (`.hw-rows.scroll`). Escape, a click outside the
  tile, or a second body click releases focus. Entering edit mode clears it.
- **Long-press to edit:** holding a tile ~500ms (≤8px movement) enters edit
  mode — the gesture users try first. The click that follows the release is
  swallowed so it can't also focus a tile or open a row.
- **Ghost "+" tile (edit mode):** the first open 1×1 cell renders a dashed
  `+` button that opens the Add-widget checklist.

## Cards: size tiers + color (`WidgetBody`)

`WidgetBody` renders a headline number and scales content to the tile, filling it
(no dead space — the list/strip flexes):

| Size | Shows |
|------|-------|
| 1×1 | headline number (+ delta chip, + sparkline if the widget passes `spark`) |
| 2×1 | headline + stat strip (`cells`) |
| 1×2 | headline + list (`rows`) |
| 2×2 | headline + strip + list |

`WidgetBody` props: `big`, `unit`, `bigTone`, `delta` (→ `DeltaChip`), `spark`
(→ `MiniArea`, 1×1 only), `sub`, `cells: {k,v,tone}[]`, `rows: ReactNode[]`, and
four state props. It auto-decides which blocks to show from `w`/`h`.

**State props (branch order = loading → error → empty → content):**

- `loading` — "Loading…". Gate it so it can't mask an error: the idiom is
  `loading={isLoading}` (or `(!data && !isError) || isLoading` when a second
  query feeds the headline).
- `error` — pass **`isError && !data`** (failed with nothing cached) →
  "Couldn't load — retrying."
- `stale` — pass **`isError && !!data`** (failed but cached data shown) → the
  body dims (`.hw-b.stale`) with a "Data may be stale" title. Used by
  listings/rotation/arbitration; add it to any widget whose data can outlive a
  dead connection.
- `empty` — the no-data message. **Copy convention: sentence case, ≤6 words,
  states the fact** ("No items tracked yet.", "No active listings.",
  "Worldstate unavailable.") — no instructions, no exclamation marks.

**Rows:** widgets hand `rows` a generous pool (`ROW_POOL = 24`, pre-sorted);
`WidgetBody` caps the unfocused render (4 narrow / 5 wide) and renders the whole
pool scrollable when `focused` (threaded from the grid into every widget via
`WidgetProps.focused`).

**`HwRow`:** clickable only when it has somewhere to go — `onClick` wins, else a
truthy `slug` + `onOpen` opens the item drawer; with neither it renders as a
**static line** (`.hw-row-static`: no button, no hover, default cursor). Never
wire a row to `onOpen("")`.

**Color is semantic + data-viz** (intentional — the app chrome is monochrome):
toned numbers (`pos`/`neg`/`hot`), the green/red `DeltaChip`, sparklines
(`Spark`/`MiniArea` from `components/charts.tsx`, colored by trend), and
tier-edged item glyphs (`Glyph` from `components/ui.tsx`). No per-widget accent
colors. A few widgets keep a custom body (`MarketPulse` shows its index chart at
all tall sizes; `MarketSearch` is a live search input — results render inline
when the tile is ≥2 tall, else as a popover under the input (`.hw-search-pop`),
with Enter opening the highlighted/top result and ArrowUp/Down moving the
`.hw-row-active` highlight).

## Animation: FLIP (Web Animations API)

CSS can't transition CSS-Grid placement/span changes, so move/resize are
animated with **FLIP** in `HomeWidgetGrid.tsx`: a `useLayoutEffect` keyed on the
layout signature (`orderSig`) records each tile's rect, and after the layout
changes it plays the inverse `translate + scale` → identity via
`element.animate(...)` (180ms, WebKitGTK-safe). Move → slide; resize →
grow/shrink with pushed neighbors sliding. Guarded by `prefers-reduced-motion`.
The floating drag overlay has no `data-key`, so FLIP ignores it (same for the
ghost tile); on drop, the overlay's last rect seeds the dropped tile's "from"
rect so it glides into its slot. The effect intentionally re-runs on the
signature even though its body reads the DOM — hence the
`biome-ignore useExhaustiveDependencies` there.

## Widget catalog notes

Most widgets are self-describing previews of their screen. The 2026-07 overhaul
added six:

- **`alerts`** (Overview, 1×2) — unread notifications; unread count runs hot.
  Rows deep-link: `nav_slug` → item drawer, `nav_screen` → navigate.
- **`wanted-now`** "Farm now" (Planning, 1×2, → Rotation) — wanted items
  farmable right now, with `Countdown` ETAs.
- **`list-next`** (Trading, 1×2, → Listings) — top listing recommendations
  (`useListingRecommendations`).
- **`vendor-picks`** (World, 1×2, → Vendors) — unowned/unchecked stock at
  active vendors; watch/buy-list overlap sorts first, then median plat.
- **`category-heat`** (Trading, 2×1, min 2×1, → Trends) — top 4 categories by
  `|avg_delta|` as stat cells; rows are static (nothing to open).
- **`riven-watches`** (Trading, 1×1, → Rivens) — saved riven searches; rows
  navigate to the Rivens screen.

## Adding a new widget

1. In `widgets.tsx`, write a component `(p: WidgetProps) => <WidgetBody .../>`
   reusing an existing React Query hook from `src/hooks/queries.ts` (no new
   backend). Pass `delta`/`spark`/`cells`/`rows` to get color + density for free.
2. Append a `WidgetDef` to `WIDGETS`: `{ key, title, icon, screen?, group,
   default:{w,h}, min?, Render }`. `icon` is a key in `components/Icon.tsx`;
   `group` is one of Overview/Portfolio/Trading/Planning/World (controls the
   add-widget checklist section); `screen` makes the header navigate.
3. It appears in the **+ Add widget** checklist automatically. No schema bump
   needed (the registry is keyed by `key`).

## Verify

- Gates: `npm run build` (tsc + Vite) and `npx biome check --write`.
- App: `npm run tauri:dev` → Home → **Customize**. Confirm tiles flow across,
  drag **slides** to reorder, the corner grip **resizes** with animation, the
  add-widget checklist toggles several at once, and the layout survives a reload.
- Headless (when needed): a Chromium + `playwright-core` harness with a
  `window.__TAURI_INTERNALS__.invoke` shim can drive `vite preview` to assert
  reorder/resize/flow at the DOM level (the app needs the Tauri shim or it
  crashes on boot). WebKitGTK itself can't be driven here (Playwright's bundled
  WebKit hits a system ICU-version mismatch on this box).
