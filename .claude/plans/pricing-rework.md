# Pricing reliability rework

**Goal:** make owned-item pricing reliable. Date: 2026-06-01.

## Diagnosis (why earlier fixes didn't take)

Two compounding failures:
1. **Formula** — trade-statistics median is sparse/gameable for illiquid mods (a lone 50000p wash
   print becomes "the price").
2. **Refresh** — every fix was TTL-gated, so already-cached values (like disruptor's 50000 from the
   first sync) were never recomputed. The app was showing old-code output the whole time. Proof from
   the live DB: disruptor `price_cache=50000` fetched at the first sync, with **no** `price_rank` or
   `order_cache` rows despite later code that writes them.

## Research

- **warframe.market / WF tools** (Quantframe, WarMAC, warframedata): no algorithmic price — it's
  player orders. The de-facto price = **lowest sell order among online sellers**. The 90-day
  median/avg statistics are for *trends*, not for valuing a specific item.
- **Finance (thinly-traded assets):** liquid → mark-to-market (last/median trade); illiquid → the
  **order book** (bid/ask), because the last trade is unreliable. The bid-ask spread is the liquidity
  signal, and a last-trade wildly out of line with the book is treated as stale and overridden by it.

→ The order book is ground truth; trade statistics are the fallback. A 50000 median next to a 1p
lowest-ask is internally impossible.

## What was built (2026-06-01)

### Part A — pricing-version auto-reprice (the refresh fix)
- `PRICING_VERSION` const (`lib.rs`) + `KEY_PRICING_VERSION` meta. On launch, a mismatch **wipes
  `price_cache` / `price_rank` / `order_cache`** and bumps the stamp, so the normal launch refresh
  recomputes everything with current logic — owned first, the rest via the drain. **Pricing changes
  now take effect on restart; stale old-logic values can't survive behind the TTL.** No manual
  "rebuild cache" needed.

### Part B — orders-primary pricing for all owned
- `refresh_owned_orders` now fetches the live order book for **all** owned items (was: only
  suspected-illiquid — which missed disruptor, vol 59). TTL-gated on launch, forced by "Refresh
  prices". `prices::owned_order_slugs`.
- `effective_price(slug, rank)` resolves: **live lowest ask (`order_cache`) → per-rank trade median →
  headline median.** Lowest ask = `robust_low` = median of the cheapest 5 asks (online preferred), so
  one troll-low or troll-high ask can't move it. Non-ranked items fall back rank -1 → rank 0.
- Valuation + the drawer use it; the displayed per-unit price is the blended effective price so
  `price × qty == stack value` everywhere.

### Result
disruptor → live asks rank-0 **1p** (vs the 50000 stat). Liquid items unchanged (ask ≈ median).

## Decisions taken
- Valuation basis = **lowest ask** (WF convention / user's ask).
- **No** illiquidity discount in v1.

## Verify
After rebuild+restart, the launch log shows `pricing logic changed → clearing price caches` then
`live sell orders refreshed`. Confirm in the DB: `order_cache` has disruptor rows (~1p), and the
inventory value is sane. Liquid item (e.g. primed_continuity) unchanged.

## Possible follow-ups (not built)
- Store highest **bid** + show full spread/liquidity/source in the drawer (transparency).
- Liquidity-discount option; midpoint-based marks.
