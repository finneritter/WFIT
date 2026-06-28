# Riven Value Estimator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estimate what a riven roll is worth (asks-anchored band, confidence-gated) and surface it as a per-listing Deal score plus a price-my-roll readout on the Riven Search screen.

**Architecture:** A pure Rust engine (`rivens/price.rs`) runs over the live auctions `rivens::search()` already fetched — no new API calls. It shrinks each comparable ask toward a likely-sale price (staleness + bids + seller signal), aggregates a winsorized low-percentile band, grade-positions individual listings within that band, and gates everything on a Low/Medium/High confidence derived from comp count + staleness. `search()` attaches a target-roll `estimate` to the response and a `deal` to each tier ≤ 1 result; the React screen renders a value readout and a Deal column.

**Tech Stack:** Rust (rusqlite-free; pure functions + chrono), Tauri command surface, React/TypeScript, Vite/Tailwind + `theme.css`.

## Global Constraints

- **Rust owns all domain logic; the frontend receives finished objects.** The engine lives in Rust; TS only renders.
- **Types mirror 1:1.** Every Rust `Serialize` struct/field added gets an exact counterpart in `src/lib/types.ts` (snake_case fields).
- **No new warframe.market calls.** The engine consumes the auctions already in `search()`; do not add network I/O.
- **No migration, no `PRICING_VERSION` bump.** The estimate is computed fresh per search and never cached.
- **No external data / scraping.** Asks-only; weapon-meta signal comes from the asks themselves.
- **Spec:** `docs/superpowers/specs/2026-06-27-riven-value-estimator-design.md`. All tunable constants are centralized as `const` at the top of `price.rs`.

---

## File Structure

- **Create** `src-tauri/src/rivens/price.rs` — the engine: tunable constants, `Confidence`/`Estimate`/`Deal` types, shrink helpers, `band`, `estimate_target`, `deal_for`, unit tests.
- **Modify** `src-tauri/src/rivens/mod.rs` — `pub mod price;`; add `estimate: Option<price::Estimate>` to `RivenSearchResponse`, `deal: Option<price::Deal>` to `RivenResult`; set `deal: None` in `build_result`; compute estimate + deals in `search()`.
- **Modify** `src/lib/types.ts` — `RivenEstimate`, `RivenDeal`; add `estimate`/`deal` fields.
- **Modify** `src/routes/RivenSearch.tsx` — value readout near the statband; `Deal` column.
- **Modify** `src/theme.css` — `.riven-estimate*` and `.deal*` styles.

---

### Task 1: Engine scaffold — types + per-comp shrink

**Files:**
- Create: `src-tauri/src/rivens/price.rs`
- Modify: `src-tauri/src/rivens/mod.rs` (add `pub mod price;` next to `pub mod watch;` near the top)

**Interfaces:**
- Consumes: `crate::rivens::RivenResult` (fields: `id: String`, `buyout_price/starting_price/top_bid: Option<i64>`, `is_direct_sell: bool`, `owner_status: String`, `owner_reputation: i64`, `grade: Option<f64>`, `match_tier: i64`, `updated: String`).
- Produces: `Confidence`, `Estimate`, `Deal` (pub structs); `fn shrunk_price(r: &RivenResult, now: DateTime<Utc>) -> Option<f64>`; helpers `ask_of`, `staleness_factor`, `seller_factor`.

- [ ] **Step 1: Register the module**

In `src-tauri/src/rivens/mod.rs`, find `pub mod watch;` and add below it:

```rust
pub mod price;
```

- [ ] **Step 2: Write `price.rs` with types, constants, shrink helpers, and failing tests**

Create `src-tauri/src/rivens/price.rs`:

```rust
//! Asks-anchored riven value estimator. Pure functions over the already-fetched,
//! ranked `RivenResult`s — no network. Shrinks each comparable ask toward a likely
//! sale price, aggregates a winsorized low-percentile band, grade-positions a single
//! listing within it, and gates on confidence. See the spec under docs/superpowers.
use crate::rivens::RivenResult;
use chrono::{DateTime, Utc};
use serde::Serialize;

// ---- tunable constants (the spec's "calibrate later" knobs) ----------------
const POINT_PCTL: f64 = 0.30; // cheapest non-outlier realistic listing is what sells
const HIGH_PCTL: f64 = 0.60;
const DEAL_BAND_PCT: f64 = 15.0; // ±% for great / overpriced
const GRADE_CONVEX: f64 = 1.5; // near-god rolls command outsized premiums
const GRADE_MULT_MIN: f64 = 0.6;
const GRADE_MULT_MAX: f64 = 1.8;
const STALE_FRESH_DAYS: i64 = 2;
const STALE_OLD_DAYS: i64 = 7;
const STALE_OLD_FACTOR: f64 = 0.70;
const STALE_MID_FACTOR: f64 = 0.85; // factor reached at STALE_OLD_DAYS via lerp
const SELLER_OFFLINE_FACTOR: f64 = 0.90;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Low,
    Medium,
    High,
}

/// A platinum value estimate for the searched roll.
#[derive(Debug, Clone, Serialize)]
pub struct Estimate {
    pub point: i64,
    pub low: i64,
    pub high: i64,
    pub confidence: Confidence,
    pub comps_used: i64,
    pub rationale: String,
}

/// A deal verdict for one listing vs its grade-positioned expected price.
#[derive(Debug, Clone, Serialize)]
pub struct Deal {
    pub kind: String,   // "great" | "fair" | "overpriced"
    pub delta_pct: i64, // + above expected, - below
    pub expected: i64,
}

/// Listed ask: buyout, else starting price.
fn ask_of(r: &RivenResult) -> Option<i64> {
    r.buyout_price.or(r.starting_price)
}

fn age_days(updated: &str, now: DateTime<Utc>) -> i64 {
    DateTime::parse_from_rfc3339(updated)
        .ok()
        .map(|t| (now - t.with_timezone(&Utc)).num_days())
        .unwrap_or(0) // unknown timestamp → treat as fresh, never over-shrink
}

/// A listing sitting unsold is overpriced; discount with age. 0..fresh, 7d+..old.
fn staleness_factor(updated: &str, now: DateTime<Utc>) -> f64 {
    let d = age_days(updated, now);
    if d <= STALE_FRESH_DAYS {
        1.0
    } else if d >= STALE_OLD_DAYS {
        STALE_OLD_FACTOR
    } else {
        let t = (d - STALE_FRESH_DAYS) as f64 / (STALE_OLD_DAYS - STALE_FRESH_DAYS) as f64;
        1.0 - t * (1.0 - STALE_MID_FACTOR)
    }
}

fn seller_factor(r: &RivenResult) -> f64 {
    match r.owner_status.as_str() {
        "ingame" | "online" => 1.0,
        _ => SELLER_OFFLINE_FACTOR,
    }
}

/// One comp's likely-sale price (shrunk ask). For a bid auction the realistic price
/// sits between the top bid (a real willingness-to-pay floor) and the ask. None when
/// the listing has no price at all.
fn shrunk_price(r: &RivenResult, now: DateTime<Utc>) -> Option<f64> {
    let realistic = if !r.is_direct_sell {
        match (r.top_bid, ask_of(r)) {
            (Some(b), Some(a)) => (b as f64 + a as f64) / 2.0,
            (Some(b), None) => b as f64,
            (None, Some(a)) => a as f64,
            (None, None) => return None,
        }
    } else {
        ask_of(r)? as f64
    };
    Some(realistic * staleness_factor(&r.updated, now) * seller_factor(r))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-06-27T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    /// Minimal RivenResult fixture for engine tests.
    fn comp(id: &str, price: i64, tier: i64, grade: f64, days_old: i64, status: &str) -> RivenResult {
        let updated = (now() - chrono::Duration::days(days_old)).to_rfc3339();
        RivenResult {
            id: id.into(),
            riven_name: "x".into(),
            weapon_url_name: "torid".into(),
            weapon_name: "Torid".into(),
            mastery_level: 8,
            mod_rank: 8,
            re_rolls: 0,
            polarity: "madurai".into(),
            attributes: vec![],
            buyout_price: Some(price),
            starting_price: None,
            top_bid: None,
            is_direct_sell: true,
            owner_name: "seller".into(),
            owner_status: status.into(),
            owner_reputation: 10,
            grade: Some(grade),
            match_tier: tier,
            matched_positives: 2,
            created: updated.clone(),
            updated,
            deal: None,
        }
    }

    #[test]
    fn staler_listings_shrink_more() {
        let fresh = comp("a", 100, 0, 80.0, 0, "ingame");
        let old = comp("b", 100, 0, 80.0, 30, "ingame");
        assert!(shrunk_price(&old, now()).unwrap() < shrunk_price(&fresh, now()).unwrap());
    }

    #[test]
    fn offline_seller_shrinks() {
        let online = comp("a", 100, 0, 80.0, 0, "ingame");
        let offline = comp("b", 100, 0, 80.0, 0, "offline");
        assert!(shrunk_price(&offline, now()).unwrap() < shrunk_price(&online, now()).unwrap());
    }

    #[test]
    fn bid_auction_uses_bid_floor() {
        let mut a = comp("a", 200, 0, 80.0, 0, "ingame");
        a.is_direct_sell = false;
        a.buyout_price = Some(200);
        a.top_bid = Some(100);
        // (100 + 200) / 2 = 150, no shrink (fresh, online)
        assert_eq!(shrunk_price(&a, now()).unwrap().round() as i64, 150);
    }
}
```

> Note: `comp(...)` sets `deal: None`, a field that does not exist yet — this test file will not compile until Task 5 adds the field. To keep Task 1 self-contained and compiling, **temporarily delete the `deal: None,` line** from the fixture; re-add it in Task 5 Step 3. (Subagent executors: do this.)

- [ ] **Step 3: Run the tests to verify they fail to compile / fail**

Run: `cd src-tauri && cargo test price:: 2>&1 | tail -20`
Expected: compile error or test failure (module/functions not yet wired, or assertions). Fix until the three tests pass.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test price:: 2>&1 | tail -8`
Expected: `test result: ok. 3 passed`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rivens/price.rs src-tauri/src/rivens/mod.rs
git commit -m "feat(rivens): value-engine scaffold — types + per-comp ask shrink"
```

---

### Task 2: Winsorized low-percentile band

**Files:**
- Modify: `src-tauri/src/rivens/price.rs`

**Interfaces:**
- Consumes: `shrunk_price` (Task 1).
- Produces: `fn pctl(sorted: &[f64], p: f64) -> f64`; `fn band(comps: &[&RivenResult], now: DateTime<Utc>) -> Option<(i64, i64, i64)>` returning `(point, low, high)`.

- [ ] **Step 1: Write the failing tests** — append to the `tests` module in `price.rs`:

```rust
#[test]
fn band_anchors_low_and_rejects_outliers() {
    // Prices 50,60,70,80, plus a 1000 aspirational outlier.
    let cs: Vec<RivenResult> = [50, 60, 70, 80, 1000]
        .iter()
        .enumerate()
        .map(|(i, p)| comp(&format!("c{i}"), *p, 0, 80.0, 0, "ingame"))
        .collect();
    let refs: Vec<&RivenResult> = cs.iter().collect();
    let (point, low, high) = band(&refs, now()).unwrap();
    assert!(point <= 70, "point {point} should anchor low, not at the mean");
    assert_eq!(low, 50);
    assert!(high < 1000, "outlier must be winsorized out of high {high}");
}

#[test]
fn band_empty_is_none() {
    assert!(band(&[], now()).is_none());
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test price::tests::band 2>&1 | tail -15`
Expected: compile error (`band`/`pctl` not defined).

- [ ] **Step 3: Implement `pctl` + `band`** — add to `price.rs` (above the `#[cfg(test)]` module):

```rust
/// Value at percentile `p` (0..1) of a sorted slice (nearest-rank).
fn pctl(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

/// Winsorized low-percentile band over comps' shrunk prices → (point, low, high).
fn band(comps: &[&RivenResult], now: DateTime<Utc>) -> Option<(i64, i64, i64)> {
    let mut prices: Vec<f64> = comps.iter().filter_map(|r| shrunk_price(r, now)).collect();
    if prices.is_empty() {
        return None;
    }
    prices.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    // Drop one extreme each side once there are enough samples.
    let w: &[f64] = if prices.len() >= 5 {
        &prices[1..prices.len() - 1]
    } else {
        &prices[..]
    };
    let point = pctl(w, POINT_PCTL);
    let low = w[0];
    let high = pctl(w, HIGH_PCTL).max(point);
    Some((point.round() as i64, low.round() as i64, high.round() as i64))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd src-tauri && cargo test price::tests::band 2>&1 | tail -8`
Expected: `test result: ok. 2 passed`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rivens/price.rs
git commit -m "feat(rivens): winsorized low-percentile price band"
```

---

### Task 3: Confidence + target estimate

**Files:**
- Modify: `src-tauri/src/rivens/price.rs`

**Interfaces:**
- Consumes: `band`, `age_days`, `Confidence`, `Estimate` (Tasks 1–2).
- Produces: `fn level(n: usize, max_stale_days: i64) -> Confidence`; `pub fn estimate_target(results: &[RivenResult], now: DateTime<Utc>) -> Option<Estimate>`.

- [ ] **Step 1: Write the failing tests** — append to the `tests` module:

```rust
#[test]
fn estimate_needs_comps_and_scales_confidence() {
    // Two tier-0 comps → Low confidence.
    let cs: Vec<RivenResult> = (0..2)
        .map(|i| comp(&format!("c{i}"), 100 + i as i64, 0, 80.0, 0, "ingame"))
        .collect();
    let e = estimate_target(&cs, now()).unwrap();
    assert_eq!(e.confidence, Confidence::Low);
    assert_eq!(e.comps_used, 2);

    // Six fresh tier-0 comps → High confidence.
    let many: Vec<RivenResult> = (0..6)
        .map(|i| comp(&format!("m{i}"), 100 + i as i64, 0, 80.0, 0, "ingame"))
        .collect();
    assert_eq!(estimate_target(&many, now()).unwrap().confidence, Confidence::High);
}

#[test]
fn estimate_none_without_comparable_rolls() {
    // Only tier-3 results (not comparable) → no estimate.
    let cs = vec![comp("a", 100, 3, 50.0, 0, "ingame")];
    assert!(estimate_target(&cs, now()).is_none());
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test price::tests::estimate 2>&1 | tail -15`
Expected: compile error (`estimate_target` not defined).

- [ ] **Step 3: Implement `level` + `estimate_target`** — add to `price.rs`:

```rust
/// Confidence from strong-comp count, downgraded one notch when comps are stale.
fn level(n: usize, max_stale_days: i64) -> Confidence {
    let base = match n {
        0..=2 => Confidence::Low,
        3..=5 => Confidence::Medium,
        _ => Confidence::High,
    };
    if max_stale_days > STALE_OLD_DAYS {
        match base {
            Confidence::High => Confidence::Medium,
            Confidence::Medium => Confidence::Low,
            Confidence::Low => Confidence::Low,
        }
    } else {
        base
    }
}

/// Estimate the searched roll's value from the comparable (tier ≤ 1) listings.
/// None when there are no comparable rolls to anchor on.
pub fn estimate_target(results: &[RivenResult], now: DateTime<Utc>) -> Option<Estimate> {
    let comps: Vec<&RivenResult> = results.iter().filter(|r| r.match_tier <= 1).collect();
    let (point, low, high) = band(&comps, now)?;
    let n = comps.len();
    let max_stale = comps
        .iter()
        .map(|r| age_days(&r.updated, now))
        .max()
        .unwrap_or(0);
    let confidence = level(n, max_stale);
    let rationale = match confidence {
        Confidence::Low => format!("{n} comparable listing(s) — thin market, positional estimate"),
        _ => format!("{n} comparable listings"),
    };
    Some(Estimate {
        point,
        low,
        high,
        confidence,
        comps_used: n as i64,
        rationale,
    })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd src-tauri && cargo test price::tests::estimate 2>&1 | tail -8`
Expected: `test result: ok. 2 passed`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rivens/price.rs
git commit -m "feat(rivens): confidence gating + target-roll estimate"
```

---

### Task 4: Grade-positioned deal score

**Files:**
- Modify: `src-tauri/src/rivens/price.rs`

**Interfaces:**
- Consumes: `band`, `level`, `age_days`, `ask_of`, `Deal` (Tasks 1–3).
- Produces: `fn grade_mult(g: Option<f64>, comps: &[&RivenResult]) -> f64`; `pub fn deal_for(listing: &RivenResult, results: &[RivenResult], now: DateTime<Utc>) -> Option<Deal>`.

- [ ] **Step 1: Write the failing tests** — append to the `tests` module:

```rust
fn pool(prices: &[i64]) -> Vec<RivenResult> {
    prices
        .iter()
        .enumerate()
        .map(|(i, p)| comp(&format!("p{i}"), *p, 0, 80.0, 0, "ingame"))
        .collect()
}

#[test]
fn cheap_listing_is_a_great_deal() {
    // Band ~100; a 50p listing of the same grade should read "great".
    let mut rs = pool(&[100, 105, 110, 115, 120]);
    let cheap = comp("cheap", 50, 0, 80.0, 0, "ingame");
    rs.push(cheap.clone());
    let d = deal_for(&cheap, &rs, now()).unwrap();
    assert_eq!(d.kind, "great");
    assert!(d.delta_pct < 0);
}

#[test]
fn expensive_listing_is_overpriced() {
    let mut rs = pool(&[100, 105, 110, 115, 120]);
    let dear = comp("dear", 400, 0, 80.0, 0, "ingame");
    rs.push(dear.clone());
    assert_eq!(deal_for(&dear, &rs, now()).unwrap().kind, "overpriced");
}

#[test]
fn higher_grade_raises_expected_price() {
    let rs = pool(&[100, 105, 110, 115, 120]);
    let low_grade = comp("lg", 100, 0, 60.0, 0, "ingame");
    let high_grade = comp("hg", 100, 0, 95.0, 0, "ingame");
    let e_low = deal_for(&low_grade, &rs, now()).unwrap().expected;
    let e_high = deal_for(&high_grade, &rs, now()).unwrap().expected;
    assert!(e_high > e_low, "a better roll should expect a higher price");
}

#[test]
fn no_deal_for_worse_rolls_or_thin_comps() {
    // Tier 2 listing → no badge.
    let rs = pool(&[100, 105, 110]);
    let worse = comp("w", 100, 2, 80.0, 0, "ingame");
    assert!(deal_for(&worse, &rs, now()).is_none());
    // Only one other comp (thin) → suppressed.
    let two = pool(&[100, 105]);
    assert!(deal_for(&two[0], &two, now()).is_none());
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test price::tests 2>&1 | tail -15`
Expected: compile error (`deal_for`/`grade_mult` not defined).

- [ ] **Step 3: Implement `grade_mult` + `deal_for`** — add to `price.rs`:

```rust
/// Multiplier on the band point for a roll's grade vs the comps' median grade.
/// Convex so near-max rolls command a premium; clamped. 1.0 when grades unknown.
fn grade_mult(g: Option<f64>, comps: &[&RivenResult]) -> f64 {
    let gl = match g {
        Some(x) if x > 0.0 => x,
        _ => return 1.0,
    };
    let mut grades: Vec<f64> = comps.iter().filter_map(|r| r.grade).collect();
    if grades.is_empty() {
        return 1.0;
    }
    grades.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let med = grades[grades.len() / 2];
    if med <= 0.0 {
        return 1.0;
    }
    (gl / med).powf(GRADE_CONVEX).clamp(GRADE_MULT_MIN, GRADE_MULT_MAX)
}

/// Score a single listing against its peers (same/looser-tier rolls, self-excluded),
/// grade-positioned. None for non-matching rolls (tier ≥ 2), thin peer sets, or when
/// peer confidence is Low (don't claim a deal on noise).
pub fn deal_for(listing: &RivenResult, results: &[RivenResult], now: DateTime<Utc>) -> Option<Deal> {
    if listing.match_tier > 1 {
        return None;
    }
    let price = ask_of(listing)? as f64;
    let comps: Vec<&RivenResult> = results
        .iter()
        .filter(|r| r.match_tier <= 1 && r.id != listing.id)
        .collect();
    if comps.len() < 2 {
        return None;
    }
    let max_stale = comps.iter().map(|r| age_days(&r.updated, now)).max().unwrap_or(0);
    if level(comps.len(), max_stale) == Confidence::Low {
        return None;
    }
    let (point, _, _) = band(&comps, now)?;
    let expected = (point as f64 * grade_mult(listing.grade, &comps)).max(1.0);
    let delta = (price - expected) / expected * 100.0;
    let kind = if delta <= -DEAL_BAND_PCT {
        "great"
    } else if delta >= DEAL_BAND_PCT {
        "overpriced"
    } else {
        "fair"
    };
    Some(Deal {
        kind: kind.into(),
        delta_pct: delta.round() as i64,
        expected: expected.round() as i64,
    })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd src-tauri && cargo test price::tests 2>&1 | tail -8`
Expected: all `price::tests` pass (≈11 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rivens/price.rs
git commit -m "feat(rivens): grade-positioned per-listing deal score"
```

---

### Task 5: Wire the engine into `search()`

**Files:**
- Modify: `src-tauri/src/rivens/mod.rs` (struct fields, `build_result`, `search`)
- Modify: `src-tauri/src/rivens/price.rs` (re-add `deal: None` to the test fixture)

**Interfaces:**
- Consumes: `price::estimate_target`, `price::deal_for`, `price::Estimate`, `price::Deal`.
- Produces: `RivenSearchResponse.estimate: Option<price::Estimate>`; `RivenResult.deal: Option<price::Deal>`.

- [ ] **Step 1: Add the struct fields** — in `src-tauri/src/rivens/mod.rs`:

In `RivenResult` (after `pub updated: String,`):

```rust
    pub updated: String,
    /// Deal verdict vs comparable listings (tier ≤ 1 rolls only; None otherwise).
    pub deal: Option<price::Deal>,
}
```

In `RivenSearchResponse` (after `pub graded: bool,`):

```rust
    pub graded: bool,
    /// Asks-anchored value estimate for the searched roll (None when no comps).
    pub estimate: Option<price::Estimate>,
}
```

- [ ] **Step 2: Default the field in `build_result`** — find the `RivenResult { ... }` literal constructed in `build_result` and add `deal: None,` as the last field (it's populated later in `search`):

```rust
        created: a.created,
        updated: a.updated,
        deal: None,
    }
```

> If `build_result` returns the struct via field init shorthand at the end, add `deal: None,` before the closing brace of the `RivenResult { ... }` literal.

- [ ] **Step 3: Re-add `deal: None` to the price.rs test fixture**

In `src-tauri/src/rivens/price.rs`, in the `comp(...)` test helper, restore the final field:

```rust
            created: updated.clone(),
            updated,
            deal: None,
        }
```

- [ ] **Step 4: Compute estimate + deals in `search`** — in `mod.rs`, in `search()`, after `results.dedup_by(|a, b| a.id == b.id);` and before the `Ok(RivenSearchResponse { ... })`:

```rust
    results.dedup_by(|a, b| a.id == b.id);

    // Asks-anchored value estimate for the searched roll + per-listing deal score.
    let now = Utc::now();
    let estimate = price::estimate_target(&results, now);
    let deals: Vec<Option<price::Deal>> =
        results.iter().map(|r| price::deal_for(r, &results, now)).collect();
    for (r, d) in results.iter_mut().zip(deals) {
        r.deal = d;
    }

    Ok(RivenSearchResponse {
        results,
        summary,
        graded: disposition.is_some(),
        estimate,
    })
```

> `Utc` is already imported in `mod.rs` if used elsewhere; if not, add `use chrono::Utc;` at the top.

- [ ] **Step 5: Build, clippy, full test run**

Run: `cd src-tauri && cargo test 2>&1 | grep -E "test result:|error" | head`
Expected: all pass (≈148 + the new ~11). Then:
Run: `cd src-tauri && cargo clippy --message-format=short 2>&1 | grep -E "error|warning:" | head`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/rivens/mod.rs src-tauri/src/rivens/price.rs
git commit -m "feat(rivens): attach value estimate + deal scores to search results"
```

---

### Task 6: Frontend types

**Files:**
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces: `RivenEstimate`, `RivenDeal`; `RivenResult.deal`, `RivenSearchResponse.estimate`.

- [ ] **Step 1: Add the types** — in `src/lib/types.ts`, near the other `Riven*` interfaces:

```typescript
export interface RivenEstimate {
  point: number;
  low: number;
  high: number;
  confidence: "low" | "medium" | "high";
  comps_used: number;
  rationale: string;
}
export interface RivenDeal {
  kind: "great" | "fair" | "overpriced";
  delta_pct: number; // + above expected, - below
  expected: number;
}
```

In `RivenResult` add (after `updated: string;`):

```typescript
  deal: RivenDeal | null;
```

In `RivenSearchResponse` add (after `graded: boolean;`):

```typescript
  estimate: RivenEstimate | null;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -5; echo exit=$?`
Expected: `exit=0` (no consumer yet; types compile).

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(rivens): frontend types for value estimate + deal"
```

---

### Task 7: Render the readout + Deal column

**Files:**
- Modify: `src/routes/RivenSearch.tsx`
- Modify: `src/theme.css`

**Interfaces:**
- Consumes: `RivenSearchResponse.estimate`, `RivenResult.deal` (Task 6).

> No component test runner exists; verification is `tsc` + `biome` + `npm run build` + a headless screenshot of the real built CSS (the established pattern in this repo).

- [ ] **Step 1: Add the value readout** — in `src/routes/RivenSearch.tsx`, in `Results`, immediately after the `</div>` closing the `statband` and before the `{data && !data.graded ? (...)}` note, insert:

```tsx
      {data?.estimate ? (
        <div className="riven-estimate">
          <span className="re-label">Est. value</span>
          <span className="re-point">{fmt(data.estimate.point)}p</span>
          <span className="re-range">
            {fmt(data.estimate.low)}–{fmt(data.estimate.high)}
          </span>
          <span className={clsx("re-conf", data.estimate.confidence)}>
            {data.estimate.confidence}
          </span>
          <span className="re-note muted">{data.estimate.rationale}</span>
        </div>
      ) : data ? (
        <div className="riven-estimate muted">
          Not enough comparable listings to estimate a value.
        </div>
      ) : null}
```

- [ ] **Step 2: Add the Deal column header** — in the results table `<thead>`, after the Price `SortTh` and before `<th>Seller</th>`:

```tsx
              <SortTh<SortKey> label="Price" col="price" sort={colSort} onSort={setSort} right />
              <th className="r">Deal</th>
              <th>Seller</th>
```

- [ ] **Step 3: Bump the empty/loading colspan** — change `span={8}` to `span={9}` in the `<TableStatus ... />` inside the results table.

- [ ] **Step 4: Add the Deal cell** — in the row body, after the Price `<td>` (`{price == null ? "—" : ...}`) and before the Seller `<td>{r.owner_name}</td>`:

```tsx
                    <td className="r">
                      {r.deal ? (
                        <span className={clsx("deal", r.deal.kind)}>
                          {r.deal.kind === "great"
                            ? "Great deal"
                            : r.deal.kind === "overpriced"
                              ? "Overpriced"
                              : "Fair"}
                          <b>
                            {" "}
                            {r.deal.delta_pct > 0 ? "+" : ""}
                            {r.deal.delta_pct}%
                          </b>
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
```

- [ ] **Step 5: Add styles** — in `src/theme.css`, after the `.riven-rtable` block:

```css
/* Value estimate readout + per-listing deal badge (Riven Search). */
.riven-estimate {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 2px 2px 6px;
  font-size: 12.5px;
}
.re-label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--soft);
}
.re-point {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--ink);
}
.re-range {
  font-family: var(--mono);
  color: var(--soft);
}
.re-conf {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .05em;
  padding: 1px 5px;
  border: 1px solid var(--line-2);
  color: var(--soft);
}
.re-conf.low {
  color: var(--neg);
  border-color: var(--neg);
}
.re-conf.high {
  color: var(--pos);
  border-color: var(--pos);
}
.re-note {
  font-size: 11px;
}
.deal {
  font-size: 11.5px;
  white-space: nowrap;
}
.deal.great {
  color: var(--pos);
}
.deal.overpriced {
  color: var(--neg);
}
.deal.fair {
  color: var(--soft);
}
.deal b {
  font-family: var(--mono);
  font-weight: 600;
}
```

- [ ] **Step 6: Verify gates**

Run: `npx tsc --noEmit 2>&1 | tail -3; echo tsc=$?`
Expected: `tsc=0`
Run: `npx biome check src/routes/RivenSearch.tsx 2>&1 | tail -3`
Expected: no errors.
Run: `npm run build 2>&1 | tail -2`
Expected: `✓ built`.

- [ ] **Step 7: Commit**

```bash
git add src/routes/RivenSearch.tsx src/theme.css
git commit -m "feat(rivens): value readout + Deal column on the results table"
```

---

### Task 8: Live verification + push

**Files:** none (verification only)

- [ ] **Step 1: Run the dev app** (or rely on the running Tauri watcher rebuild). Search a high-liquidity meta weapon (e.g. Kuva Bramma) with a couple of positives.

- [ ] **Step 2: Confirm data-level correctness** (the careful part — not just gates):
  - The "Est. value" readout shows a point + range + confidence; confidence is Medium/High with a tight band when many comps exist.
  - Search a thin/niche roll → confidence Low and the "thin market — positional estimate" rationale with a wide band, or the "Not enough comparable listings" message.
  - In the Deal column, an obviously cheap matching roll reads **Great deal** and an aspirational one **Overpriced**; lesser rolls (tier ≥ 2) show **—**.
  - Spot-check the estimate is plausible against the visible asks and never claims false precision on thin data.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Self-Review

**Spec coverage:**
- Asks-anchored band (shrink: staleness + bids + seller; winsorized low-percentile) → Tasks 1–2. ✓
- Grade positioning within the comp/weapon distribution → Task 4 (`grade_mult`). ✓
- Confidence gating + "thin market" state → Task 3 (`level`, rationale). ✓
- Deal score per listing (tier ≤ 1, self-excluded, suppressed on Low, ±15%) → Task 4. ✓
- Price-my-roll readout + Deal column → Task 7. ✓
- No new API/migration/cache; types mirror 1:1 → Tasks 5–6, Global Constraints. ✓
- Deferred v2 items (curated weights, sales self-calibration, unrolled EV) → not in any task, by design. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; constants are concrete. ✓

**Type consistency:** `Estimate`/`Deal`/`Confidence` (Rust) ↔ `RivenEstimate`/`RivenDeal`/`"low"|"medium"|"high"` (TS) match; `estimate`/`deal` field names consistent across Tasks 5–7; `deal_for`/`estimate_target`/`band`/`level`/`grade_mult`/`shrunk_price` names used consistently. ✓

**Note on Task 1 fixture:** the `deal: None` field is intentionally removed in Task 1 and restored in Task 5 Step 3 so each task compiles standalone — called out explicitly in both tasks.
