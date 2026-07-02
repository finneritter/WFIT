# Home Dashboard — Widget Logic Refactor, Design Polish & New Widgets

**Status: DONE — executed and verified 2026-07-01 (second session), committed + pushed.**
(Approved plan from 2026-07-01 session; original at `~/.claude/plans/can-you-go-through-temporal-hummingbird.md`.)

Verification: biome/tsc/`npm run build` green, plus a 15/15-pass headless Brave run
(search popover + Enter/arrows, focus-to-scroll, long-press → edit, ghost tile,
drag commit, static-row cursor, layout v4 reload, Add-checklist grouping).

## Context

The home screen (Dashboard = fixed PortfolioHero + WorldStrip + customizable `HomeWidgetGrid`) had: duplicated derivations across widgets, inert-but-clickable rows, uneven loading/empty handling, no error states, freshness gaps, stale docs — and two user-reported items: **the Market search widget was broken** (results hard-gated behind `h >= 2` while its min height is 1, and no Enter handler — widgets.tsx old :691/:1024) and **click-a-widget-body-to-focus-and-scroll** was requested. Plus 8 approved widget additions/reworks. All frontend-only, existing hooks, no LAYOUT_VERSION bump.

Key files: `src/components/home/widgets.tsx`, `src/components/home/HomeWidgetGrid.tsx`, `src/components/home/selectors.ts` (new), `src/hooks/queries.ts`, `src/theme.css` (`.hw-*` ~6631+), `docs/HOME_WIDGETS.md`.

---

## ✅ DONE (verified by tsc at the widgets.tsx checkpoint)

### selectors.ts (new file, complete)
`overMarketListings`, `atTargetWatches`, `oneAwaySets`, `liveCascade`, `within`, `sumSales`, `dailyEarnings(sales, days) → number[]` (daily buckets, oldest→newest).

### widgets.tsx (complete)
- **WidgetBody**: new props `error` (branch order loading → error → empty → content; renders "Couldn't load — retrying."), `stale` (dims body via `.hw-b.stale` + title attr — CSS NOT YET WRITTEN), `focused` (rows uncap + `.hw-rows.scroll` class — CSS NOT YET WRITTEN).
- **HwRow**: `slug`/`onOpen` now optional + new `onClick`; `act = onClick ?? (slug && onOpen ...)`; no action → static `<div class="hw-row hw-row-static">`.
- **WidgetProps**: `focused?: boolean` threaded into EVERY widget (destructured + passed to WidgetBody).
- `ROW_POOL = 24` — widgets hand WidgetBody a generous list; WidgetBody caps unfocused render at 4/5.
- **Part 0 — MarketSearchWidget reworked**: results at any height (h<2 → `.hw-search-pop` popover inside `.hw-search-box`, CSS NOT YET WRITTEN); Enter opens `results[active] ?? results[0]`; ArrowUp/Down move `active` highlight (wrapper div `.hw-row-active`, CSS NOT YET WRITTEN); "Type 2+ characters…" hint at 1 char.
- **RelicsWidget reworked** (same key, default now 1×2): headline EV from `useRelics`, rows = `useCrackPlan` sorted crackable-now-first then score, rows `onClick → onNavigate("relics")`, cells {Relics, Crackable (pos), Best}.
- Memo pass: Arcanes, Ducats, BuyList (incl. its inline JSX sort → memoized `top`), Sold (via `sumSales`), Listings (`listed` + `overMarketListings`).
- Selector rewires: Watchlist (`atTargetWatches`), Sets (`oneAwaySets` + conditional `onOpen` only when `missing?.slug`), DoNext (all three selectors + set rows use `onClick` fallback to `onNavigate("sets")` — no more `onOpen("")`), Rotation + Dashboard-equivalent (`liveCascade`).
- Error wiring `error={isError && !data}` on all data widgets; `stale` on listings/rotation/arbitration.
- Fixed gates: Inventory `loading={(!summary && !sum.isError) || inv.isLoading}` + empty "No items tracked yet."; Listings connected-but-empty "No active listings."; Rotation empty "Worldstate unavailable.".
- Sold spark: `spark={earned30 > 0 ? dailyEarnings(list,30) : undefined}`.
- **6 new widgets built + registered**: `alerts` (bell, Overview, 1×2; unread hot; rows deep-link via nav_slug→onOpen / nav_screen→onNavigate), `wanted-now` "Farm now" (timer, Planning, 1×2, screen rotation; Countdown ETAs), `list-next` (tag, Trading, 1×2, screen listings; useListingRecommendations), `vendor-picks` (coin, World, 1×2, screen vendors; unowned/unchecked active-vendor stock, watch/buy-list overlap first then median_plat desc; VENDOR_CUR label map), `category-heat` (chips, Trading, 2×1 min 2×1, screen trends; cells top-4 by |avg_delta|, rows static), `riven-watches` (bookmark, Trading, 1×1, screen rivens; rows onClick→rivens).
- DEFAULT_LAYOUT stale "Order-based (no x/y)" JSDoc deleted.

### HomeWidgetGrid.tsx (partial)
- Header comment rewritten (freeform model + focus/long-press note).
- `focusedKey` state; `startEditing` clears it.
- Effect: Escape + outside-pointerdown release focus.
- `onTileClick` (ignores clicks on `button, input, a`; toggles focus).
- Long-press: `beginPress` (500ms, 8px cancel radius) → `startEditing()` + `suppressClick` ref; `onTileClickCapture` swallows the follow-up click.
- Tile element wired: `.focused` class, `onPointerDown={editing ? startDrag : beginPress}`, `onClickCapture`, `onClick`.

---

## ⬜ REMAINING (in order)

1. **HomeWidgetGrid.tsx — finish Part D wiring:**
   - Pass `focused={focusedKey === it.key}` into `<Render …>` (the tile div gets the class but Render does NOT receive it yet — focus does nothing until this lands). Line ~510: `<Render w={it.w} h={it.h} onOpen={onOpen} onNavigate={onNavigate} />`.
   - Ghost "+" add tile while editing: after the `order.map(...)` block, render a `button.hw.hw-ghost` at `firstFree(order, 1, 1)` (inline gridColumn/gridRow like `place`), `onClick={() => setAdding(true)}`. No `data-key` so FLIP ignores it.

2. **theme.css — all new classes (nothing written yet), keep monochrome/no-radius:**
   - `.hw.focused .hw-card` — hairline highlight (`border-color: var(--line-2)` or inset box-shadow; NO accent color).
   - `.hw-rows.scroll` — `overflow-y: auto; overscroll-behavior: contain;` (unfocused `.hw-rows` presumably `overflow: hidden`).
   - `.hw-b.stale` — `opacity: .75` (title attr already set in JSX).
   - `.hw-search-pop` — absolutely-positioned popover under the input (anchor `.hw-search-box` needs `position: relative`): `--bg-2` bg, 1px `--line-2` border, z-index above grid tiles, max-height ~4-5 rows, overflow-y auto. Mirror `.riven-menu` idiom (~theme.css:5721).
   - `.hw-row-active .hw-row` (or `> .hw-row`) — `background: var(--hover)` keyboard highlight.
   - `.hw-ghost` — dashed 1px `--line-2` border, faint "+" label, hover → `--hover`.
   - Verify `.hw-row-static` (theme.css ~6977) neutralizes hover bg AND cursor now that real static rows exist.
   - Mono audit: `.hw-big`, `.hw-cv`, `.hw-row-v`, DeltaChip get `.num`-equivalent mono/tabular treatment.

3. **queries.ts A5 freshness:** in `invalidateInventoryDerived` (~line 77-95) add `keys.sales` to the loop list and `qc.invalidateQueries({ queryKey: ["searchCatalog"], refetchType: "none" })` (key factory is `searchCatalog: (q, limit) => ["searchCatalog", q, limit]` so the prefix `["searchCatalog"]` is right).

4. **docs/HOME_WIDGETS.md sync (A6):** LAYOUT_VERSION 3→4; order-flow `{key,w,h}`/`grid-auto-flow: dense` description → freeform `{key,x,y,w,h}` + resolveDown; document WidgetBody `error`/`stale`/`focused` props, HwRow `onClick`/static mode, `ROW_POOL`, selectors.ts, empty-copy convention (sentence case, ≤6 words, states the fact), focus-to-scroll + long-press + ghost-tile behaviors, and the 6 new widgets.

5. **Verify (task #6):**
   - `npx biome check --write src/` (my edits have known indent drift in BuyList/Listings row blocks — biome will fix), then `npx tsc --noEmit` and `npm run build`.
   - Headless screenshots: reuse the session recipe — `npx vite --port 5199 --strictPort` + playwright-core via `createRequire("<repo>/package.json")`, `executablePath: /usr/bin/brave`, `addInitScript` shim: `__TAURI_INTERNALS__` (invoke: canned map, unknown commands → `[]` NEVER null — null crashes always-mounted Inventory through the root boundary; `startup_status` `{ok:true,...}`; full-shape `get_summary`) + `__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(){} }`. A working script skeleton was at scratchpad `shot-vendors.mjs` (session 3a745eef — /tmp, likely gone; pattern re-creatable). Extend canned data: `get_wanted_now`, `get_crack_plan`, `list_notifications`, `get_listing_recommendations`, `get_vendor_board`, `get_trends` (with category_heat + unusual), `list_riven_searches`, `search_catalog`, `get_sales`.
   - Acceptance: market-search at 2×1 shows popover, Enter opens top result, arrows move highlight; focus-click uncaps + scrolls rows, row clicks still open drawer, Escape/outside releases, edit-drag unaffected; long-press enters edit; static rows show no pointer cursor; layout v4 survives reload; new widgets appear in Add checklist under their groups.

6. After everything green: update this file's Status to DONE. Commit + push (Finn's rule: commit means push) — suggested as one commit or the plan's 4-PR split if he prefers.

## Design rules recap (for whoever resumes)
Monochrome chrome, color semantic-only (pos/neg/hot, tier edges); no border-radius, no shadows (except over scrim); numbers mono `.num`; micro-animations 0.06–0.28s with the global `prefers-reduced-motion` kill switch; no skeletons (rejected); no per-widget accent colors (HOME_WIDGETS.md rule).
