# Riven value estimator (asks-anchored band)

**Date:** 2026-06-27
**Status:** DESIGN — approved, ready for implementation plan
**Scope:** a value/price estimator for the Riven Search screen. One Rust engine, two
frontend surfaces. No new API calls, no migration, no background work in v1.

## Context

WFIT's Riven Search lets a user describe a desired riven roll and browse live
warframe.market auctions for it, ranked by closeness and graded. What it does NOT do
is tell you **what a roll is worth** — so you can't tell an underpriced buy from an
overpriced one, or know what to list your own riven for.

Riven pricing is genuinely hard and easy to get dangerously wrong, so the design is
deliberately conservative. The hard facts (established during research):

- **Asks, not sales.** The riven APIs expose only live auctions (buyouts + bids), never
  completed sales. A median of asks systematically overprices.
- **Near-zero liquidity.** A specific weapon + stat-combo usually has 0–3 live listings.
  You cannot lean on statistics; you must model from features.
- **The dominant value drivers aren't in our data.** Weapon meta desirability and
  per-weapon stat priority drive most of the price and are not derivable from the three
  endpoints. Roll grade % alone is NOT a price.
- **No reliable external sale feed.** Scraping Semlar / trade chat is fragile and
  ToS-gray — a bad dependency for a local single-user binary.

**Key design insight:** the market has *already* priced weapon-desirability and
disposition into the asks for that weapon. So instead of reconstructing those factors
from external data we can't get, we let the **asks carry them** and shrink asks toward
likely-sale. This mirrors WFIT's existing "realizable value, gate on confidence"
philosophy (`db/inventory.rs::owned_holdings`, `market.rs::robust_price`).

## The engine — `src-tauri/src/rivens/price.rs` (pure, unit-tested)

Runs over the auctions `rivens::search()` already fetched (`market.search_riven_auctions`)
— **no extra network**. One core function:

```
expected_price(roll, comps, weapon_dist) -> Estimate { point, low, high, confidence, comps_used }
```

where `roll` is any roll (the user's target, or a specific listing), `comps` is the
comparable auctions, and `weapon_dist` is the weapon's full ask distribution. Steps:

1. **Comparable set** — reuse the existing `match_tier` (`rivens::rank_*`): tier 0–1
   (all wanted positives present) = *strong* comps; tier 2 (one short) = *weak*, used
   only to widen when strong comps are below a threshold `K` (e.g. 4).

2. **Per-comp likely-sale price** (shrink each ask toward what it'd actually sell for):
   - **direct-sell** → `buyout_price`, scaled by a **staleness factor** from
     `created`/`updated` age (fresh ≈ 1.0; a listing sitting unsold for days is
     overpriced → shrink toward ~0.6–0.75). Curve is a tunable constant.
   - **bid auction** → anchor on `top_bid` (a real willingness-to-pay floor) blended
     toward `starting_price`; if no bid, use `starting_price` shrunk harder.
   - **seller factor** — in-game/online + high `reputation` → trust the price (≈1.0);
     offline / low-rep → shrink more. Tunable.

3. **Aggregate** the shrunk comp prices: winsorize (reject outliers, the
   `market.rs::robust_price` philosophy), then take a **low percentile (~30th) as the
   point** (the cheapest non-outlier realistic listing is what sells — not the median),
   with `low`/`high` from the winsorized IQR. The percentile is a tunable constant.

4. **Grade positioning (the always-available fallback).** Because comps are usually
   sparse, also compute a weapon-level estimate: take the weapon's whole ask
   distribution and **position the roll by its grade percentile within the weapon**
   (`rivens::grade` already gives per-stat + overall grade, disposition-aware). A
   90th-grade roll sits high in the weapon's price spread; a 40th-grade roll low. This is
   where the market's asks supply the meta/disposition signal we can't compute. The
   grade→price mapping is mildly **convex** (near-god rolls command outsized premiums) —
   a tunable exponent.

5. **Blend** comp-based and grade-positioned by comp strength: `< K` strong comps → lean
   grade-positioned; `>= K` → lean comp-based. (`point` is the blended value; `low/high`
   widen as comp strength drops.)

## Confidence (invest here — it is the product's honesty)

`confidence = f(#strong comps, agreement between comp-based & grade-positioned estimates,
comp staleness, whether bids exist)` → **Low / Medium / High**, plus an explicit
**"thin market — positional estimate only"** state (few/no comps) that widens the range
and is labelled as such. **Never emit a tight absolute number on Low.** The estimate
always ships with its band and a one-line rationale string (e.g. "1 live ask, no bids,
grade mid-range → positional estimate").

## Two surfaces, one engine

- **Deal score per listing** (`Deal` column in the results table). For each **tier ≤ 1**
  listing (a roll matching what you searched for), compute its `expected_price` *positioned
  by its own grade*, with the listing **self-excluded** from the comp band, then compare
  to its actual price → **Great deal / Fair / Overpriced (±%)** (default thresholds: ≥15%
  below expected = great deal, within ±15% = fair, >15% above = overpriced; tunable;
  suppressed when confidence is Low). This correctly rewards a cheap *high-grade* roll and
  doesn't flag a cheap *low-grade* roll as a deal. Tier ≥ 2 rows (lesser rolls than
  wanted) show no badge.
- **Price-my-roll readout** — a compact panel by the `statband`: **Est 270p · 200–350 ·
  Confidence: Low · based on N comps**, for the target roll in the form, with the
  comparable listings expandable. Doubles as "what should I list this for."

## Architecture / data flow

- New `src-tauri/src/rivens/price.rs`: the engine + unit tests on synthetic
  `RivenAuction`/`RivenResult` fixtures (sparse-comps, stale-listing, bid-vs-buyout,
  grade-positioning, confidence-state cases).
- `rivens::search()` computes, from the auctions already in hand: a top-level
  `estimate: Estimate` (for the target roll) on `RivenSearchResponse`, and a
  `deal: Option<Deal>` on each `RivenResult` (tier ≤ 1 only).
- Types mirror 1:1 in `src/lib/types.ts`. `src/routes/RivenSearch.tsx` renders the
  readout near the statband and a `Deal` badge column (color-coded: deal = green,
  overpriced = red, fair = neutral — reuse the existing stat-color tokens).
- **No new endpoints, no migration, no heartbeat/watcher work.**

## Scope / non-goals

**In v1:** asks-anchored band, grade positioning, confidence gating, both surfaces, all
tunable constants centralized with sane defaults.

**Out (v2+), explicitly deferred:**
- Curated per-weapon stat-desirability weights (external meta that decays with patches).
- **Self-calibration from the user's own riven trades.** `sale_events` is inventory-slug-
  bound and rivens aren't tracked as owned, so this needs a *new* riven-trade log — real
  scope, deferred. (When built, it becomes the one ToS-safe ground-truth source.)
- Cross-weapon "riven mod" (unrolled, 0-reroll) expected-value pricing.
- Any external-source scraping.

## Verification

- **Backend:** `cargo test` (engine unit tests above — assert ordering/monotonicity:
  a higher-grade roll prices ≥ a lower one in the same comp set; a staler comp shrinks
  more; Low-confidence state triggers on `< K` comps and widens the band) + `cargo clippy`.
- **Frontend:** `tsc`, `biome`, `npm run build`.
- **Live (the careful part — data, not just gates):** on the dev app, run searches on
  (a) a high-liquidity meta weapon (many comps → Medium/High confidence, tight band) and
  (b) a thin/niche roll (→ Low / "thin market", wide band). Sanity-check that obvious
  underpriced listings read as "Great deal" and aspirational ones as "Overpriced", and
  that the price-my-roll estimate is plausible vs the visible asks. Spot-check that the
  estimate never claims false precision when liquidity is thin.
