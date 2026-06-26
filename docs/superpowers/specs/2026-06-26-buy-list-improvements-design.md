# Buy List improvements — design

Date: 2026-06-26

## Goal

Polish the Buy list screen: add a per-row "view on warframe.market" action, make the
budget feature more useful and better-looking, and drop the "Purchase all → inventory"
bulk action.

## Scope

Frontend only. All data needed already exists (`BuyRow`, `budget` setting). No new
Tauri commands, no DB changes.

- `src/routes/BuyList.tsx`
- `src/theme.css`

## Changes

### 1. Per-row "View on market" button

In the Actions cell, **before** the `Bought` button, add a `Market ↗` button
(`btn sm`) that calls `openMarketExternal(r.slug)` from `src/lib/wiki.ts` — the same
helper the Market screen uses to open an item's warframe.market page in the system
browser. The Actions `<td>` already stops row-click propagation.

### 2. Remove "Purchase all → inventory"

Delete the bulk button in the panel header (current `BuyList.tsx` lines ~119–128).
No backend removal needed — it was a client-side loop over `purchase.mutate`. The
per-row `Bought` button stays.

### 3. Budget saves on Enter

Add `onKeyDown` to the budget input: Enter commits the budget (`commitBudget`) and
blurs the field. The existing `onBlur` save stays.

### 4. Cumulative-fit computation (drives 5–7)

Walk the **filtered + sorted** list (`view`) top-to-bottom, accumulating each row's
line total. The row where the running total first exceeds the budget is the "budget
line." Interpretation is greedy / in-display-order (sort by price to prioritise cheap
items). Computed over the full `view`, not the paged `visible` slice, so paging never
shifts results. Only meaningful when a budget > 0 is set.

Produces:
- `fitsCount` — number of rows fully within budget (before the line).
- `overSlugs` — `Set<string>` of slugs at/after the line (over budget).

### 5. Visual spend bar

A thin full-width bar rendered under the panel header, shown only when a budget > 0 is
set. Fill = `min(total / budget, 1)`. Label: `<total> / <budget>p (<pct>%)`. Fill
colour shifts with usage (under → near → over); clamps full and turns red when over
budget (`total > budget`).

### 6. Flag over-budget rows

Rows whose slug is in `overSlugs` get an `over-budget` class on the `<tr>` — a subtle
red left border / tint. Only applied when a budget is set.

### 7. "Fits budget" stat box

Add a 5th `StatBox` to the stat band: `Fits budget` = `fitsCount` items. Shows `—`
when no budget is set.

### 8. Restyle the budget input box

Rework `.budget` in `theme.css`: a visible "Budget" label, a clearer/larger input, a
theme-matching focus ring, and clean alignment in the header so it reads as an
intentional control rather than a cramped inline field.

## Non-goals

- No optimisation of which items to buy (no knapsack) — strictly display-order greedy.
- No backend / schema / command changes.
- No change to the per-row Bought / remove / qty-stepper behaviour.

## Verification

- `npm run build` (tsc + vite) and `npx biome check` clean.
- Manual: set a budget, confirm Enter saves; bar reflects total vs budget and goes red
  when over; rows past the budget line are flagged; "Fits budget" count matches; Market
  button opens the correct page; "Purchase all" is gone; per-row Bought still works.
