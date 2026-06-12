# Plan: Dashboard redesign (Rotation-style overview) + Market search focus-box fix

> **Status: DONE — executed 2026-06-12** (commits `8fae99f` fix(theme), `77de905` refactor(ui),
> `92f8cf8` feat(dashboard) on `design-overhaul`).
> Effort tags: **S** ≤ half-day, **M** 1–3 days. Total ≈ one focused session (S+S+M).
> Authored 2026-06-12 after the code-health pass landed on `design-overhaul` (commits 719e00f…8efd447).

## Context & decisions (locked with the user)

The current Dashboard reads as passive numbers plus an 8-card launch grid that duplicates the sidebar. Decisions:
1. **Action-first content** — real item-level "do next" rows; the launch grid is **removed**.
2. **Presented in the Rotation page's visual idiom** — `.fwx` hero "watch" strip, `.rsetbar` strip of small countdown boxes, dense two-column `.rot-grid.v2` of `.tpanel`s with `.fgroup-h` sub-headers; "all the most important info at a glance".

Rotation's building blocks are unscoped, reusable CSS (verified): `.fwx*`, `.rsetbar`/`.rsetbox`, `.rot-grid.v2`/`.rot-col`, `.tpanel`/`.tpanel-h`, `.fgroup-h`, `.arb-now`/`.arbn-row`, `.tierb`, `.src-note`. Rotation also has the app's best ticking pattern: shared 1s tick + self-rendering `Countdown` leaf (Rotation.tsx:54–93) — only timer cells re-render per second.

Separate bug (root cause CONFIRMED): theme.css ~5167 `input:focus-visible { outline: 1px solid var(--accent) }` draws a near-white (#cfd2d8) rectangle around the chromeless inner input of composite `.search` boxes. Market's search is the only auto-focused non-modal input → the reported "white box on focus, before typing". `.budget` (BuyList) has the same latent issue; `.lf-*`/`.set-num`/`.wipe-act` are safe (their own higher-specificity `:focus` rules win).

**Frontend-only — no Rust changes.** All data exists on current hooks (verified by exploration): listings undercut (`your_price > market_low`), watchlist at-target, sets one-away, arcane dissolve verdicts, `trends.sell_signals`/`unusual`/`index_spark`/`index_change`/`advancing`/`declining`, inventory `delta_7d` + `spark` for "your movers". React Query dedupes shared queries; `useInventory` on the dashboard is a warm cache read (Inventory stays mounted in App.tsx).

---

## 1. Focus-outline fix — **S** (independent; ship first, own commit)

In `src/theme.css`, immediately after the global `input:focus-visible` block (~5167):

```css
/* Composite field boxes: the chromeless inner input must not draw its own
   outline — the container border is the focus indicator. */
.search input:focus-visible,
.budget input:focus-visible { outline: none; }
.search:focus-within,
.budget:focus-within { border-color: var(--accent); }
```

Keyboard a11y does not regress — the container lights up instead.

## 2. Shared extraction — **S** (own commit; Rotation behavior unchanged)

Move from `src/routes/Rotation.tsx` into a new `src/components/Countdown.tsx`:
- `subscribeTick` (module-level shared 1s ticker, lines ~54–70),
- `Countdown` (memoized self-ticking leaf with `warnMs`/`soonMs` recoloring, ~72–93),
- `TierBadge` (~96–102).

Rotation imports them from there. Dashboard will drop its `useNow`/`WorldRail`-clock machinery entirely and use `Countdown` cells — per-second re-renders shrink to individual timer spans.

## 3. Dashboard rewrite — **M** (`src/routes/Dashboard.tsx`)

```
[ .fwx Portfolio hero ]                          ← FissureWatchHero shape
[ .rsetbar world strip: 5 .rsetbox cells ]       ← Rotation reset-bar shape
[ .rot-grid v2 ]
   left .rot-col                 right .rot-col
   └ tpanel "Do next"            ├ tpanel "Your movers · 7d"
      (.fgroup-h per category)   ├ tpanel "Arbitration"
                                 ├ tpanel "Market · 30d"
                                 └ tpanel "Market search"
```

Deleted: launch grid + `CardDef`/`cards`, old `lb-hero`, `WorldRail`, `ArbitrationBox`, `useNow`, `useBuyList` subscription. `MarketSearch` content survives, restyled as a tpanel.

### 3a. Portfolio hero (`.fwx` reuse + `.fwx--port` variant)

`<div className="fwx fwx--port">`:
- `.fwx-top`: `.led` + "Portfolio · realizable" + `{distinct_count} items · liquidation-adjusted` + `.status` `● LIVE · synced {age}` (coarse minutes from `summary.last_synced`; no 1s tick — recomputes on refetch).
- `.fwx-main`: left `.fwx-title` `~{fmtK(realizable_plat)}p` + `.fwx-meta` `ceiling {fmtK(total_plat)}p · {full_set_count} full sets`; right `.fwx-timer`: `.big` = `pct(portfolio_7d)` colored, `.tl` "7d change".
- `.fwx-counts` 4 cells: Liquid % (keep tooltip: realizable/ceiling) · Market 30d `pct(index_change)` · Hot movers `hot_count` · Sold 7d `{sold_7d}p`.
- New CSS: `.fwx--port` accent tint (clone `.fwx.hit` geometry with an `--accent` color-mix; few lines).

### 3b. World strip (`.rsetbar` reuse)

One wrapper `<button>` → `onNavigate("rotation")` containing five `.rsetbox` cells (k over v; v = `Countdown` where temporal):
Void Cascade ("Live" `.pos` when up, else Omnia-rotation countdown — reuse current cascade/omnia derivation from Dashboard.tsx) · Baro (countdown; k flips arrival/departure) · Daily reset (`nextUtc(0)`) · Fissures live (count) · Price data (age text).

### 3c. "Do next" tpanel (left column — the centerpiece)

One `tpanel`; `tpanel-h`: `<h3>Do next</h3>` + `.meta` total actionable count. Per **non-empty** category: a `.fgroup-h` header (count + "view all →"; header is a `<button>` → `onNavigate(screen)`) + capped rows. Order/caps (≤12 rows total):

| # | Group | Cap | Screen | Row click |
|---|---|---|---|---|
| 1 | Listings over market · N | 3 | listings | `onOpen(slug)` |
| 2 | Watchlist at target · N | 3 | watchlist | `onOpen(slug)` + inline `[+ buy]` |
| 3 | One part from a set · N | 3 | sets | `onOpen(missingPart.slug)` |
| 4 | Consider selling · N | 2 | trends | `onOpen(slug)` |
| 5 | Arcanes to dissolve | 1 summary row | arcanes | row → `onNavigate("arcanes")` |

Derivations (all `useMemo` on query data; hooks owned by a local `DoNextPanel` component):
- **(1)** `listings.filter(l => l.your_price != null && l.market_low != null && l.your_price > l.market_low)` sorted by overage desc (mirrors Listings.tsx "Undercut"). Row: `ItemName(name, your_price, thumb, sub: "yours Xp · market Yp")` + right mono `.neg` `+Zp over`.
- **(2)** at-target predicate from Watchlist.tsx:7 (`target_plat != null && median_plat != null && median_plat <= target_plat` — duplicate the one-liner with a comment), sorted by savings (target−median) desc. Right `.pos` `−Zp` + `+ buy` button: `useAddToBuyList().mutate({slug})`, `stopPropagation`, `disabled={isPending}` (mutation errors already toast globally).
- **(3)** `sets.filter(s => !s.complete && s.total_parts - s.owned_parts === 1)` sorted `missing_value` asc; missing part = `s.parts.find(p => !p.owned)`. Right: `+{fmt(missing_value)}p to complete`.
- **(4)** `trends.sell_signals.slice(0, 2)` (backend-ranked, owned+liquid). Sub `part_type · owned ×owned_qty`; right colored `pct(delta)` + price.
- **(5)** `Dissolve {count} arcanes → {fmtK(total_vosfor)} vf · ≈{Math.round(total_vosfor × plat_per_vosfor)}p` where count = `owned.filter(a => a.verdict === "dissolve").length`.

Row markup: new `.dx-row` class (grid `1fr auto auto`, `border-top: 1px solid var(--line)`, hover `var(--hover)`, ~6px padding — visual sibling of `.arb-row`/`.nw-row`). Rows without inner controls = `<button type="button">`; the watchlist row (contains `+ buy`) = `<div {...rowAction(() => onOpen(slug))}>` (biome `useKeyWithClickEvents` is at error — no ignores needed with this split). Reuse `ItemName` from ui.tsx (`.dnm` is unscoped).

Empty/loading rules:
- A group with zero items renders **nothing** (header included).
- Use each query's `isLoading` (NOT `isPending`) — a WFM-disconnected listings *error* must fall to `[]` and simply omit the group, never wedge the panel.
- Any source still loading → `BlockStatus` (ui.tsx) inside the panel.
- All settled and all five empty → exactly one `.dx-clear` line: "All clear — nothing needs attention right now."
- `.src-note` footer: "rows open the item · headers open the screen".

### 3d. Right column tpanels

- **Your movers · 7d**: `useInventory()`; `filter(r => r.delta_7d != null && !r.excluded && (r.realizable_plat ?? r.median_plat ?? 0) >= 10)`, sort `|delta_7d|` desc, top 5. Row (`.dx-row` button): `ItemName` + `Spark(r.spark, 60, 18, up)` + colored `pct(delta_7d)` + `fmt(realizable_plat)p` → `onOpen`. Header "view all" → inventory. Empty: `.empty` "No notable moves this week."
- **Arbitration**: reuse Rotation's panel shape — `.arb-now` (TierBadge + mission/node + `Countdown`), then `.fgroup-h` "Ones of note · S/A" + first 2 `.arbn-row`s. Header meta button → rotation.
- **Market · 30d** (new; uses previously-unused breadth): `MiniArea(trends.index_spark, ~260×56)` + 3 mini cells (advancing `.pos` / declining `.neg` / flat muted) + meta `pct(index_change)`. Header → trends.
- **Market search**: current MarketSearch content (input + suggestions + "Hot right now" top-3 from `trends.unusual`) wrapped in a tpanel with `tpanel-h`. Keep `.search`/`.search-results`/`.lb-hot-row` class names (rename only if trivially safe).

### 3e. CSS changes (`src/theme.css`, lb block ~3273–3935)

**Delete** (grep each for other consumers first; keep `.lb-search*`/`.lb-hot*` if the search tpanel reuses them): `.lb-hero*` (check `.lb-mini` consumers before deleting it), `.lb-chart-tag`, `.lb-pulse*`, `.lb-arb*`, `.lb-grid`, `.lb-card*`, `.lb-attn-dot`, `@keyframes lbPulse`, `.lb-section-*`, `.lb-tools`, `.lb-livedot`/`lbBreath` if the `.fwx` `.led` replaces the last consumer; prune the lb reduced-motion block (~3891) and media queries (~3906–3935).

**Add** (small): `.fwx--port`; `.dx-row` (+ hover; append `.dx-row:focus-visible` and the `.fgroup-h` header-button to the global focus-visible list ~5146); `.dx-val`; `.dx-act` (+ buy); `.dx-clear`; check `.rot-grid.v2` responsive behavior and add an ~820px collapse to 1fr if it lacks one. No new animations (universal reduced-motion guard at ~4470 covers hovers).

## 4. Sequence / commits

1. `fix(theme)`: §1 focus outline.
2. `refactor(ui)`: §2 Countdown/TierBadge extraction (gates; Rotation unchanged).
3. `feat(dashboard)`: §3 rewrite + CSS (single commit).

Dashboard.tsx imports: `Countdown`, `TierBadge`, `Spark`, `MiniArea`, `ItemName`, `rowAction`, `BlockStatus`, `useListings/useWatchlist/useSets/useInventory/useArcaneDashboard/useAddToBuyList`, `nextUtc/msUntil/fmt/fmtK/pct`, types `WatchRow`/`SetRow`. Lands ~550–650 lines; split into `src/routes/dashboard/` only if it crosses ~700.

## 5. Verification

- **Gates**: `npm run build` (tsc + vite), `npx biome check` clean (a11y at error, no new ignores); no `src-tauri/` diff.
- **Manual** (`npm run tauri:dev`):
  - Market screen: auto-focused search shows an accent *container* border — no white inner box; topbar/AddItems searches + BuyList budget same; `.lf-*` focus unchanged.
  - Rotation screen unchanged after the extraction (timers tick, recolor at warn/soon thresholds).
  - Dashboard: hero figures match the old screen's numbers; world-strip countdowns match Rotation's; "Do next" group counts match the owning screens (Listings "Undercut", Watchlist at-target, Sets one-away, Arcanes dissolve verdicts, Trends sell signals); row clicks open the right drawer (one-away opens the *missing part*); `+ buy` adds without opening the drawer; WFM signed out → listings group simply absent; all-empty → single "All clear" line.
  - Movers: ≤5 rows, no sub-10p junk, spark color matches the % sign. Market·30d breadth roughly sums to total priced.
  - Keyboard walk over every row/header (Enter/Space), focus rings visible; React DevTools render-highlight shows only Countdown cells ticking per second.
  - Responsive ~1100/820px; OS reduced-motion respected.
