# Arcanes: liquidity-adjusted Vosfor value & realizable collection EV

## Context

The Arcanes screen overstates how much a Vosfor is worth, which (a) flips genuinely
sellable arcanes to "dissolve" and (b) mis-ranks the "best collection to buy"
(Solaris shows #1, which the user knows is wrong).

**Root cause (confirmed against the live DB):** the collection EV credits every arcane
its *full* rank-0 market median, with **no liquidity/realizability discount** — directly
contradicting the app's core valuation philosophy ("a median is a marginal price; ×qty
overvalues; haircut illiquid demand"). The implied Vosfor rate is then
`best_collection_gross_EV / 200`.

Live numbers today (arcane market has crashed — every arcane is single-digit plat at rank 0):
- Implied rate = **0.091 p/vosfor**, from Solaris's gross EV of 18.2p/pull (barely ahead of
  Ostron 17.9p, Necralisk 13.7p — a razor-thin, noisy lead driven by ~5p rares).
- Secondary Shiver: unranked median **5p**, dissolve floor = `84 × 0.091 = 7.6p` → "dissolve".
  (Its value lives in the *maxed* rank-5 copy ≈ 60–100p, which needs 21 fused copies — out of
  the recommender's scope by design, per `docs/ARCANE_DISSOLUTION.md`.)

**Two real bugs also found:**
1. `db/prices.rs::bid_ladders_for` (and `volume_7d`) are **not rank-filtered**. For arcanes,
   maxed (rank-5) buy orders at 30–75p leak into the *unranked* sell-vs-dissolve decision
   (`buy_orders.rank` exists but is ignored). e.g. Secondary Shiver's only standing bids are
   rank-5 at 30–60p — wrong demand curve for an unranked copy.
2. The EV's `coverage` says "priced", but "priced" ≠ "liquid".

**Decisions taken (user):** value Vosfor via a **liquidity-adjusted EV**; rank "best collection"
by **realizable sell value**. Both are the *same* fix: compute the EV on the app's existing
realizable curve instead of raw medians. The implied rate falls out lower (~0.03/vf predicted),
and collections re-rank by realizable, not nominal, value.

## Approach

Reuse the app's existing realizable machinery (`db/inventory.rs::realizable_value` — bids
best-first, then a volume-capped off-book tail at `TAIL_FACTOR=0.35`) to value **one** unranked
copy of each arcane, and feed *that* into the EV instead of the raw median.

### 1. Rank-aware bid ladders (fixes the leakage bug) — `db/prices.rs`
Add a new fn `bid_ladders_for_rank(c, slugs, rank: i64)` — identical to `bid_ladders_for` but
with `AND rank = ?` in the WHERE. **Do not change `bid_ladders_for`'s signature** (it's also
called by the general inventory path at `inventory.rs:632`; leave that untouched — out of scope).

### 2. A default-params realizable wrapper — `db/inventory.rs`
The `WINDOW_DAYS / K / TAIL_FACTOR` consts are module-private. Add a pub wrapper mirroring the
existing `split_sell_dissolve_default`:
```rust
pub fn realizable_value_default(per_unit: i64, qty: i64, volume_7d: Option<i64>, bids: &[(i64,i64)]) -> i64 {
    realizable_value(per_unit, qty, volume_7d, bids, WINDOW_DAYS, K, TAIL_FACTOR)
}
```

### 3. Realizable collection EV — `db/arcanes.rs`
- Extend `arcane_prices()` to also return `pc.volume_7d`: map `slug → (name, price, volume_7d)`.
- In `dashboard()`, fetch rank-0 bids for all arcanes once:
  `prices::bid_ladders_for_rank(c, &all_arcane_slugs, 0)`, and pass both the volume map and the
  bid map into `collections()`.
- In `collections()`, replace the per-arcane value used in the EV:
  - **was:** `contribution = ARCANES_PER_PULL * p * plat`
  - **now:** `let r = inventory::realizable_value_default(median, 1, volume_7d, rank0_bids);`
            `contribution = ARCANES_PER_PULL * p * r as f64;`
  - `r` = the realizable value of one unranked copy: best standing rank-0 bid if any (usually
    tiny, 1–7p), else the volume-gated tail `≈ 0.35 × median` (0 when `volume_7d` is 0/None).
- `plat_per_vosfor` (= EV/200) and the implied `rate` then update automatically; the `top`
  contributions become realizable-weighted (more honest). Keep `coverage` as-is.

### 4. Fix the owned sell-vs-dissolve to use rank-0 demand — `db/arcanes.rs::owned`
Change line 176 from `prices::bid_ladders_for(c, &slugs)` to
`prices::bid_ladders_for_rank(c, &slugs, 0)`. `per_unit` already passes the rank-0 median; this
stops maxed bids from polluting unranked decisions. (`volume_7d` stays whole-slug — no per-rank
volume exists; note this limitation, it only over-credits the tail slightly.)

### 5. Frontend (light) — `src/routes/Arcanes.tsx`
No structural change. Optionally relabel the "Vosfor rate" / "Plat/200vf" columns or add a
one-line caption noting the EV is **realizable (liquidity-adjusted)**, so the now-lower numbers
read as intentional rather than a regression. Fields are unchanged.

## Critical files
- `src-tauri/src/db/prices.rs` — add `bid_ladders_for_rank`.
- `src-tauri/src/db/inventory.rs` — add `realizable_value_default` pub wrapper.
- `src-tauri/src/db/arcanes.rs` — realizable EV in `collections()`, volume in `arcane_prices()`,
  rank-0 bids in `owned()` and `dashboard()`; update the `ev_weights_a_synthetic_collection` test.
- `src/routes/Arcanes.tsx` — optional caption/relabel only.

## Verification
- **Gates:** `cargo test` (the existing `ev_weights_a_synthetic_collection` test asserts the *gross*
  formula `3×(0.05/3)×120` — it must be updated to the realizable model: pass a bid and/or volume
  and assert the realizable EV, else it computes 0), `cargo clippy`, `tsc`, `npm run build`, `biome`.
- **Live data spot-check (required — this class of bug is invisible to unit tests):** run the
  bundled probe against the real DB and read off the new numbers:
  `WFIT_PROBE_DB=<path-to>/wfit.sqlite cargo test --lib probe_arcanes -- --ignored --nocapture`
  (Linux DB path: `~/.local/share/dev.finn.wfit/wfit.sqlite`.)
  Confirm: (a) implied `p/vf` dropped (expected ≈0.03 vs 0.091), (b) the collection ranking is
  now realizable-weighted, (c) most owned arcanes flip toward "sell".
- **Build & run** the app (`scripts/install.sh` or `npm run tauri:dev`) and eyeball the Arcanes
  screen against the probe output.

## Honest caveat to flag to the user
Because an **unranked** Secondary Shiver has *no* standing rank-0 buy demand (its only bids are
for the maxed rank-5), its realizable sell value stays ~`0.35 × 5p ≈ 1.75p`. Even with the lower
rate, that can remain **below** the dissolve floor, so Shiver may still read "dissolve". That is
the economically honest answer for a *single unranked copy* under the realizable model the user
chose — the 60–100p figure is the maxed arcane (21 copies), which the "max-rank lottery" model
(explicitly declined) would be needed to surface. The fix removes the *overstatement* and flips
the genuinely-sellable arcanes; if Shiver specifically must read "sell", that's a follow-up
decision about adding a max-rank note.

---
*Investigation evidence (live DB, 2026-06-09): legendary arcanes crashed to 3–6p unranked
(Energize 6, Grace 5, Barrier 3, Shiver 5; Shiver maxed=100). Only ~18 of ~150 arcanes have any
rank-0 buy order, all 1–7p — so the realizable EV is mostly the 0.35× volume-gated tail, which
uniformly lowers the rate and re-ranks where real bids exist.*
