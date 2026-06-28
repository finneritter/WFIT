//! Asks-anchored riven value estimator. Pure functions over the already-fetched,
//! ranked `RivenResult`s — no network. Shrinks each comparable ask toward a likely
//! sale price, aggregates a winsorized low-percentile band, grade-positions a single
//! listing within it, and gates on confidence. See the spec under docs/superpowers.
#![allow(dead_code)] // constants + types used by aggregation tasks (Tasks 2+)
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
pub fn shrunk_price(r: &RivenResult, now: DateTime<Utc>) -> Option<f64> {
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
    fn comp(
        id: &str,
        price: i64,
        tier: i64,
        grade: f64,
        days_old: i64,
        status: &str,
    ) -> RivenResult {
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
