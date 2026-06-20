# Home Widgets — customizable dashboard grid

The Home screen's lower half is a **customizable widget grid**: an iOS-control-
panel-style board the user can add to (multi-select checklist), remove from,
**drag to reorder**, and **resize by the corner** (snapping to 1×1 / 2×1 / 1×2 /
2×2). Each widget is a glanceable **preview of a screen** — its header navigates
there, rows inside open the item drawer. The top of the screen (`PortfolioHero`
+ `WorldStrip`) is unchanged.

Frontend-only. No Rust/DB/command changes; layout is a pure UI preference in
`localStorage`.

## Files

- `src/components/home/HomeWidgetGrid.tsx` — the grid host: layout state +
  persistence, edit mode, the add-widget checklist modal, pointer-event
  drag/reorder + corner-resize, and the FLIP animation.
- `src/components/home/widgets.tsx` — the widget **registry** (`WIDGETS` /
  `WIDGET_MAP`), the shared size-adaptive `WidgetBody`, the `HwRow`/`DeltaChip`
  primitives, the default layout (`DEFAULT_LAYOUT`), and one component per widget.
- `src/routes/Dashboard.tsx` — renders `PortfolioHero` + `WorldStrip` (fixed) then
  `<HomeWidgetGrid>`.
- `src/theme.css` — all `.hw-*` styles (tile chrome, card body, edit-mode grid
  backdrop + wobble, resize grip, delta chip, sparkline).

## Engine: CSS Grid + Pointer Events (NOT react-grid-layout)

> **Lesson learned — do not reintroduce react-grid-layout.** It was tried first
> and its drag/resize + `WidthProvider` width measurement **did not work in the
> app's WebKitGTK webview** (tiles collapsed to one column; drag/resize dead),
> even though it worked in Chromium. It was removed. The current engine is
> hand-built on primitives that are solid in WebKitGTK.

- **Layout = plain CSS Grid.** `.hw-grid` is `grid-template-columns: repeat(4,1fr)`,
  `grid-auto-rows: 150px`, `grid-auto-flow: row dense`, `gap: 10px`. Each tile sets
  `--w`/`--h` and spans `grid-column: span var(--w)` / `grid-row: span var(--h)`.
  Tiles **flow across and fill gaps** automatically — this is why adding a widget
  lands it in the flow, not a column.
- **Drag-reorder + resize = Pointer Events.** `pointerdown` on a tile starts a
  drag; `pointerdown` on the corner grip (`.hw-resize`) starts a resize. Both
  attach `pointermove`/`pointerup` listeners on `window` (robust, no
  `setPointerCapture` needed) and update the layout. Reorder is **geometry-based**
  (insertion index from the other tiles' rects vs. the pointer), so it doesn't
  depend on `elementFromPoint`. Resize is **delta-based** (pointer delta ÷ cell
  pitch → ±cells, clamped to each widget's `min`…2).
- **Width** is measured by our own `ResizeObserver` on `.hw-wrap` (sets
  `--hw-pitch-x/y` for the edit-mode backdrop and `colWRef` for resize math) —
  not by any library HOC.

## Persistence + migration

- `localStorage` key **`wfit.homeLayout`** via `usePersistedJSON` (`src/lib/persist.ts`):
  `{ version: number, items: Array<{ key, w, h }> }`. Order in `items` == render
  order == grid flow order. (One-time hint flag: `wfit.homeHintSeen`.)
- **`LAYOUT_VERSION`** (currently `3`) gates the schema. On a version mismatch the
  stored layout is discarded and reset to `DEFAULT_LAYOUT` (a corrupted/legacy
  layout can't stick). Bump it if the `items` shape changes. Unknown widget keys
  are filtered out defensively.

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
(→ `MiniArea`, 1×1 only), `sub`, `cells: {k,v,tone}[]`, `rows: ReactNode[]`,
`loading`, `empty`. It auto-decides which blocks to show from `w`/`h`.

**Color is semantic + data-viz** (intentional — the app chrome is monochrome):
toned numbers (`pos`/`neg`/`hot`), the green/red `DeltaChip`, sparklines
(`Spark`/`MiniArea` from `components/charts.tsx`, colored by trend), and
tier-edged item glyphs (`Glyph` from `components/ui.tsx`). No per-widget accent
colors. A few widgets keep a custom body (`MarketPulse` shows its index chart at
all tall sizes; `MarketSearch` is a live search input).

## Animation: FLIP (Web Animations API)

CSS can't transition CSS-Grid placement/span changes, so reorder/resize are
animated with **FLIP** in `HomeWidgetGrid.tsx`: a `useLayoutEffect` keyed on
`items` records each tile's rect, and after the layout changes it plays the
inverse `translate + scale` → identity via `element.animate(...)` (200ms,
WebKitGTK-safe). Reorder → slide; resize → grow/shrink with neighbors sliding.
Guarded by `prefers-reduced-motion`. The grabbed tile gets a shadow lift only
(no `transform`, which would fight the FLIP). The effect intentionally depends on
`items` (re-run on change) even though its body reads the DOM — hence the
`biome-ignore useExhaustiveDependencies` there.

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
