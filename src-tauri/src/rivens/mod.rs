//! Riven search: query warframe.market's live riven auctions for the weapon + stat
//! roll the user wants, rank the results by closeness, and grade each roll.
//!
//! Rivens use a SEPARATE warframe.market API from the rest of WFIT (see the
//! `wfit-riven-api` reference): reference data is v2 (`/v2/riven/weapons`,
//! `/v2/riven/attributes`, disposition included), auction search is v1
//! (`/v1/auctions/search`). All calls reuse the one `market.rs` throttle.
//!
//! The orchestrator issues ONE broad server query (weapon only, cheapest-first) and
//! ranks client-side, so partial ("closest") matches still surface — the v1 search
//! has no `operation` param and otherwise matches ALL given positives (exact only).
//!
//! Disposition (for grading) is part of the v2 weapons payload, cached in the DB —
//! no separate source needed. There's no offline fallback because searching live
//! auctions requires the network regardless.
pub mod grade;
pub mod price;
pub mod watch;

use crate::db::rivens as db_rivens;
use crate::error::AppResult;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;

/// A riven-capable weapon (v2 `/riven/weapons`). `disposition` drives grading.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RivenWeapon {
    pub slug: String,
    pub name: String,
    pub riven_type: String,
    pub group: String,
    pub disposition: f64,
}

/// A riven attribute / stat (v2 `/riven/attributes`). `exclusive_to` None means it
/// can roll on any weapon; otherwise it's limited to those riven types.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RivenAttribute {
    pub slug: String,
    pub name: String,
    pub unit: Option<String>,
    pub exclusive_to: Option<Vec<String>>,
    /// True for stats where a "positive" roll is actually bad (e.g. recoil).
    pub positive_is_negative: bool,
}

/// One rolled stat on an auctioned riven.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuctionAttr {
    pub url_name: String,
    pub value: f64,
    pub positive: bool,
}

/// A single live riven auction (flattened from the v1 search payload).
#[derive(Debug, Clone)]
pub struct RivenAuction {
    pub id: String,
    pub riven_name: String,
    pub weapon_url_name: String,
    pub mastery_level: i64,
    pub mod_rank: i64,
    pub re_rolls: i64,
    pub polarity: String,
    pub attributes: Vec<AuctionAttr>,
    pub buyout_price: Option<i64>,
    pub starting_price: Option<i64>,
    pub top_bid: Option<i64>,
    pub is_direct_sell: bool,
    pub owner_name: String,
    pub owner_status: String,
    pub owner_reputation: i64,
    pub created: String,
    pub updated: String,
}

/// What the user is shopping for. `weapon` is the only required field.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct RivenQuery {
    pub weapon: String,
    #[serde(default)]
    pub positives: Vec<String>,
    pub negative: Option<String>,
    pub polarity: Option<String>,
    pub re_rolls_max: Option<i64>,
    pub mastery_rank_max: Option<i64>,
}

/// A persisted riven search (the user's saved roll watch). `min_values` maps an
/// attribute slug to a value threshold (positive = minimum %, negative = maximum
/// magnitude) — a client-side filter, not part of the API query.
#[derive(Debug, Clone, Serialize)]
pub struct SavedSearch {
    pub id: i64,
    pub label: String,
    pub weapon: String,
    pub positives: Vec<String>,
    pub negative: Option<String>,
    pub polarity: Option<String>,
    pub re_rolls_max: Option<i64>,
    pub mastery_rank_max: Option<i64>,
    pub min_values: std::collections::HashMap<String, f64>,
    /// When true, the background watcher checks this search and files a
    /// notification on a matching auction.
    pub notify: bool,
    pub created_at: String,
}

/// A rolled stat as shown to the user — enriched with display name, unit, and (for
/// positives) a per-stat grade %.
#[derive(Debug, Clone, Serialize)]
pub struct ResultAttr {
    pub slug: String,
    pub name: String,
    pub value: f64,
    pub positive: bool,
    pub unit: Option<String>,
    pub grade: Option<f64>,
    /// Matches one of the user's desired positives, or their desired negative.
    pub wanted: bool,
}

/// One ranked auction in the result set.
#[derive(Debug, Clone, Serialize)]
pub struct RivenResult {
    pub id: String,
    pub riven_name: String,
    pub weapon_url_name: String,
    pub weapon_name: String,
    pub mastery_level: i64,
    pub mod_rank: i64,
    pub re_rolls: i64,
    pub polarity: String,
    pub attributes: Vec<ResultAttr>,
    pub buyout_price: Option<i64>,
    pub starting_price: Option<i64>,
    pub top_bid: Option<i64>,
    pub is_direct_sell: bool,
    pub owner_name: String,
    pub owner_status: String,
    pub owner_reputation: i64,
    /// Mean grade of the gradeable positive stats (0..=100), None when none gradeable.
    pub grade: Option<f64>,
    /// 0 = exact, 1 = all positives (neg differs/extra), 2 = one short, 3 = ≥1, 4 = weapon only.
    pub match_tier: i64,
    pub matched_positives: i64,
    pub created: String,
    pub updated: String,
}

/// Min / median buyout and listing count over the good (tier ≤ 1) matches — the
/// "what's this roll worth" header.
#[derive(Debug, Clone, Default, Serialize)]
pub struct PriceSummary {
    pub min: Option<i64>,
    pub median: Option<i64>,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RivenSearchResponse {
    pub results: Vec<RivenResult>,
    pub summary: PriceSummary,
    /// True when grading was possible (disposition known for the weapon).
    pub graded: bool,
}

/// Effective price for ranking/summary: buyout, else starting price.
fn price_of(a: &RivenAuction) -> Option<i64> {
    a.buyout_price.or(a.starting_price)
}

/// Closeness tier + within-tier score for one auction against the desired roll.
/// Returns (tier, score) — lower tier first, then higher score, then cheaper.
fn rank_one(
    a: &RivenAuction,
    want_pos: &[String],
    want_neg: Option<&str>,
    want_pol: Option<&str>,
) -> (i64, i64) {
    let apos: HashSet<&str> = a
        .attributes
        .iter()
        .filter(|x| x.positive)
        .map(|x| x.url_name.as_str())
        .collect();
    let aneg: HashSet<&str> = a
        .attributes
        .iter()
        .filter(|x| !x.positive)
        .map(|x| x.url_name.as_str())
        .collect();

    let matched = want_pos
        .iter()
        .filter(|p| apos.contains(p.as_str()))
        .count();
    let want_n = want_pos.len();
    let extra_pos = apos.len().saturating_sub(matched);

    let neg_ok = match want_neg {
        Some(n) => aneg.contains(n) && aneg.len() == 1,
        None => aneg.is_empty(),
    };
    let neg_present = want_neg.map(|n| aneg.contains(n)).unwrap_or(false);
    let pol_ok = want_pol.map(|p| a.polarity == p).unwrap_or(false);

    let all_pos = matched == want_n; // vacuously true when want_n == 0
    let exact = all_pos && extra_pos == 0 && neg_ok;

    let tier = if want_n == 0 {
        if neg_ok {
            0
        } else {
            1
        }
    } else if exact {
        0
    } else if all_pos {
        1
    } else if matched + 1 >= want_n && matched > 0 {
        2
    } else if matched > 0 {
        3
    } else {
        4
    };

    // Within a tier: more matched positives, the wanted negative, matching polarity,
    // and fewer junk positives all rank higher.
    let mut score = (matched as i64) * 100;
    if neg_present {
        score += 40;
    }
    if pol_ok {
        score += 10;
    }
    score -= extra_pos as i64 * 5;

    (tier, score)
}

/// Rank auctions against the desired roll (pure; unit-tested). Drops auctions with
/// no matching positive only when the user actually specified positives — a
/// weapon-only search keeps everything.
fn rank_auctions(mut auctions: Vec<RivenAuction>, q: &RivenQuery) -> Vec<(RivenAuction, i64, i64)> {
    let want_pol = q.polarity.as_deref();
    let want_neg = q.negative.as_deref();
    let mut scored: Vec<(RivenAuction, i64, i64)> = Vec::with_capacity(auctions.len());
    for a in auctions.drain(..) {
        let (tier, score) = rank_one(&a, &q.positives, want_neg, want_pol);
        // Tier 4 = no desired positive present; only keep it for weapon-only searches.
        if tier == 4 && !q.positives.is_empty() {
            continue;
        }
        scored.push((a, tier, score));
    }
    scored.sort_by(|x, y| {
        x.1.cmp(&y.1) // tier asc
            .then(y.2.cmp(&x.2)) // score desc
            .then_with(|| match (price_of(&x.0), price_of(&y.0)) {
                (Some(a), Some(b)) => a.cmp(&b), // price asc
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            })
    });
    scored
}

/// Median of a sorted-able slice of prices.
fn median(mut v: Vec<i64>) -> Option<i64> {
    if v.is_empty() {
        return None;
    }
    v.sort_unstable();
    Some(v[v.len() / 2])
}

/// Build a display result, computing per-stat + overall grade. `disposition` None
/// disables grading (degrades to "—").
fn build_result(
    a: RivenAuction,
    tier: i64,
    weapon: &RivenWeapon,
    disposition: Option<f64>,
    attr_meta: &std::collections::HashMap<String, RivenAttribute>,
    want_pos: &HashSet<String>,
    want_neg: Option<&str>,
) -> RivenResult {
    let n_pos = a.attributes.iter().filter(|x| x.positive).count();
    let n_neg = a.attributes.iter().filter(|x| !x.positive).count();
    let matched = a
        .attributes
        .iter()
        .filter(|x| x.positive && want_pos.contains(&x.url_name))
        .count() as i64;

    let mut grades: Vec<f64> = Vec::new();
    let attributes: Vec<ResultAttr> = a
        .attributes
        .iter()
        .map(|x| {
            let g = if x.positive {
                disposition.and_then(|d| {
                    grade::stat_grade(x.value, &x.url_name, &weapon.riven_type, d, n_pos, n_neg)
                })
            } else {
                None
            };
            if let Some(g) = g {
                grades.push(g);
            }
            let meta = attr_meta.get(&x.url_name);
            let wanted = (x.positive && want_pos.contains(&x.url_name))
                || (!x.positive && want_neg == Some(x.url_name.as_str()));
            ResultAttr {
                slug: x.url_name.clone(),
                name: meta
                    .map(|m| m.name.clone())
                    .unwrap_or_else(|| x.url_name.clone()),
                value: x.value,
                positive: x.positive,
                unit: meta.and_then(|m| m.unit.clone()),
                grade: g,
                wanted,
            }
        })
        .collect();

    let grade = if grades.is_empty() {
        None
    } else {
        Some(grades.iter().sum::<f64>() / grades.len() as f64)
    };

    RivenResult {
        id: a.id,
        riven_name: a.riven_name,
        weapon_url_name: a.weapon_url_name,
        weapon_name: weapon.name.clone(),
        mastery_level: a.mastery_level,
        mod_rank: a.mod_rank,
        re_rolls: a.re_rolls,
        polarity: a.polarity,
        attributes,
        buyout_price: a.buyout_price,
        starting_price: a.starting_price,
        top_bid: a.top_bid,
        is_direct_sell: a.is_direct_sell,
        owner_name: a.owner_name,
        owner_status: a.owner_status,
        owner_reputation: a.owner_reputation,
        grade,
        match_tier: tier,
        matched_positives: matched,
        created: a.created,
        updated: a.updated,
    }
}

/// The whole search: resolve weapon/disposition + attribute metadata from the DB
/// cache, fetch the live auctions (one broad call), filter hard constraints, rank,
/// grade, and summarize.
pub async fn search(
    state: &Arc<AppState>,
    q: RivenQuery,
    limit: usize,
) -> AppResult<RivenSearchResponse> {
    let weapon = match db_rivens::weapon(&state.db, &q.weapon)? {
        Some(w) => w,
        None => {
            // Reference cache empty/missing weapon → refresh once and retry.
            ensure_reference(state).await?;
            db_rivens::weapon(&state.db, &q.weapon)?.ok_or_else(|| {
                crate::error::AppError::NotFound(format!("unknown riven weapon: {}", q.weapon))
            })?
        }
    };
    let attr_meta = db_rivens::attributes_map(&state.db)?;
    let disposition = if weapon.disposition > 0.0 {
        Some(weapon.disposition)
    } else {
        None
    };

    // One broad server query: cheapest-first, weapon only. Client-side ranking does
    // the "closest match" work; hard constraints (rerolls/MR) filter below.
    let raw = state.market.search_riven_auctions(&q.weapon).await?;
    let filtered: Vec<RivenAuction> = raw
        .into_iter()
        .filter(|a| {
            q.re_rolls_max.map(|m| a.re_rolls <= m).unwrap_or(true)
                && q.mastery_rank_max
                    .map(|m| a.mastery_level <= m)
                    .unwrap_or(true)
        })
        .collect();

    let want_pos_set: HashSet<String> = q.positives.iter().cloned().collect();
    let scored = rank_auctions(filtered, &q);

    let mut results: Vec<RivenResult> = scored
        .into_iter()
        .take(limit)
        .map(|(a, tier, _score)| {
            build_result(
                a,
                tier,
                &weapon,
                disposition,
                &attr_meta,
                &want_pos_set,
                q.negative.as_deref(),
            )
        })
        .collect();

    // Price summary over the good matches (tier ≤ 1), falling back to tier ≤ 2.
    let good: Vec<i64> = results
        .iter()
        .filter(|r| r.match_tier <= 1)
        .filter_map(|r| r.buyout_price.or(r.starting_price))
        .collect();
    let pool = if good.is_empty() {
        results
            .iter()
            .filter(|r| r.match_tier <= 2)
            .filter_map(|r| r.buyout_price.or(r.starting_price))
            .collect()
    } else {
        good
    };
    let summary = PriceSummary {
        min: pool.iter().min().copied(),
        median: median(pool.clone()),
        count: pool.len() as i64,
    };

    // Stable id ordering already by rank; trim any duplicate ids defensively.
    results.dedup_by(|a, b| a.id == b.id);

    Ok(RivenSearchResponse {
        results,
        summary,
        graded: disposition.is_some(),
    })
}

/// Refresh the weapon + attribute reference caches from warframe.market (v2). Best
/// kept long-lived; called on launch and lazily when a search hits an empty cache.
pub async fn ensure_reference(state: &Arc<AppState>) -> AppResult<()> {
    let weapons = state.market.fetch_riven_weapons().await?;
    let attrs = state.market.fetch_riven_attributes().await?;
    db_rivens::replace_weapons(&state.db, &weapons)?;
    db_rivens::replace_attributes(&state.db, &attrs)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attr(name: &str, value: f64, positive: bool) -> AuctionAttr {
        AuctionAttr {
            url_name: name.into(),
            value,
            positive,
        }
    }

    fn auction(id: &str, price: i64, pos: &[&str], neg: &[&str], pol: &str) -> RivenAuction {
        let mut attributes: Vec<AuctionAttr> = pos.iter().map(|p| attr(p, 100.0, true)).collect();
        attributes.extend(neg.iter().map(|n| attr(n, -50.0, false)));
        RivenAuction {
            id: id.into(),
            riven_name: "cronibin".into(),
            weapon_url_name: "torid".into(),
            mastery_level: 8,
            mod_rank: 8,
            re_rolls: 0,
            polarity: pol.into(),
            attributes,
            buyout_price: Some(price),
            starting_price: Some(price),
            top_bid: None,
            is_direct_sell: true,
            owner_name: "seller".into(),
            owner_status: "ingame".into(),
            owner_reputation: 10,
            created: "x".into(),
            updated: "x".into(),
        }
    }

    #[test]
    fn exact_beats_partial_beats_price() {
        let q = RivenQuery {
            weapon: "torid".into(),
            positives: vec![
                "critical_chance".into(),
                "multishot".into(),
                "damage".into(),
            ],
            negative: Some("zoom".into()),
            polarity: None,
            re_rolls_max: None,
            mastery_rank_max: None,
        };
        let auctions = vec![
            // cheapest but only 2 of 3 → tier 2
            auction(
                "partial",
                5,
                &["critical_chance", "multishot"],
                &[],
                "madurai",
            ),
            // exact: all 3 + the negative, costs more → tier 0, must rank first
            auction(
                "exact",
                500,
                &["critical_chance", "multishot", "damage"],
                &["zoom"],
                "madurai",
            ),
            // all 3 positives but a different negative → tier 1
            auction(
                "allpos",
                50,
                &["critical_chance", "multishot", "damage"],
                &["recoil"],
                "madurai",
            ),
        ];
        let ranked = rank_auctions(auctions, &q);
        let ids: Vec<&str> = ranked.iter().map(|(a, _, _)| a.id.as_str()).collect();
        assert_eq!(ids, vec!["exact", "allpos", "partial"]);
        assert_eq!(ranked[0].1, 0);
        assert_eq!(ranked[1].1, 1);
        assert_eq!(ranked[2].1, 2);
    }

    #[test]
    fn no_matching_positive_dropped_when_positives_requested() {
        let q = RivenQuery {
            weapon: "torid".into(),
            positives: vec!["critical_chance".into()],
            ..Default::default()
        };
        let auctions = vec![
            auction("hit", 10, &["critical_chance"], &[], "madurai"),
            auction("miss", 1, &["status_chance"], &[], "madurai"),
        ];
        let ranked = rank_auctions(auctions, &q);
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].0.id, "hit");
    }

    #[test]
    fn weapon_only_search_keeps_all_sorted_by_price() {
        let q = RivenQuery {
            weapon: "torid".into(),
            ..Default::default()
        };
        let auctions = vec![
            auction("b", 80, &["status_chance"], &[], "madurai"),
            auction("a", 20, &["critical_chance"], &[], "madurai"),
        ];
        let ranked = rank_auctions(auctions, &q);
        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0].0.id, "a"); // cheaper first
    }
}
