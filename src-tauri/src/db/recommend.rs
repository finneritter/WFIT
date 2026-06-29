//! Listing recommendations: owned items the user should put up for plat sale.
//!
//! An owned item is recommended when it (1) actually moves — avg daily volume
//! ≥ `VOLUME_MIN`, (2) is NOT better turned into ducats (same verdict as
//! `commands::get_ducats`), (3) has a price signal so we can suggest a sell
//! price, and (4) isn't already listed. Outlier prints are excluded by the
//! volume floor plus `trends::winsorize` on the displayed median.

use crate::db::{inventory, prices, trends, Db};
use crate::error::{AppError, AppResult};
use crate::types::RecommendationRow;
use std::collections::HashMap;

/// Min avg daily trade volume to recommend listing — the user's "10+ sold a day".
/// Stricter than `trends::LIQUID_MIN` (3.0): a *recommendation* needs real depth.
const VOLUME_MIN: f64 = 10.0;
/// Mirror of `commands::get_ducats`: ≤ this median is "cheap" → ducat it.
const DUCAT_CHEAP_MAX: i64 = 8;
/// Mirror of `commands::get_ducats`: ≥ this ducats-per-plat is "efficient" → ducat it.
const DUCAT_EFFICIENT_MIN: f64 = 5.0;
/// Safety cap so a huge inventory can't return an unbounded list. The real
/// curation is the liquidity/ducat/exclusion gates plus the user's per-unit
/// sell-price floor (`settings::KEY_REC_MIN_PRICE`), so this rarely bites.
const MAX_ROWS: usize = 200;

/// An owned, not-already-listed candidate before the liquidity/ducat/price gates.
struct Cand {
    slug: String,
    display_name: String,
    part_type: String,
    category: String,
    mod_rarity: Option<String>,
    thumbnail_url: Option<String>,
    owned_qty: i64,
    ducats: Option<i64>,
    median_plat: Option<i64>,
    trend: Option<String>,
}

/// The recommended-to-list rows, biggest opportunity (suggested × qty) first.
pub fn list(db: &Db) -> AppResult<Vec<RecommendationRow>> {
    // 1) Owned items that aren't already up as a sell order.
    let cands: Vec<Cand> = db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT ci.slug, ci.display_name, ci.part_type, ci.category, ci.mod_rarity,
                    ci.thumbnail_url, ii.qty, ci.ducats, pc.median_plat, pc.trend
             FROM inventory_items ii
             JOIN catalog_items ci ON ci.slug = ii.slug
             LEFT JOIN price_cache pc ON pc.slug = ii.slug
             WHERE ii.qty > 0
               AND NOT EXISTS (
                 SELECT 1 FROM market_listings ml
                 WHERE ml.slug = ii.slug AND ml.order_type = 'sell'
               )",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Cand {
                slug: r.get(0)?,
                display_name: r.get(1)?,
                part_type: r.get(2)?,
                category: r.get(3)?,
                mod_rarity: r.get(4)?,
                thumbnail_url: r.get(5)?,
                owned_qty: r.get(6)?,
                ducats: r.get(7)?,
                median_plat: r.get(8)?,
                trend: r.get(9)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })?;
    if cands.is_empty() {
        return Ok(Vec::new());
    }

    // 2) Daily (median, volume) history for the owned set, bucketed by slug.
    //    Bounded to 90 days (the longest window any metric uses), like trends.rs.
    let (med_hist, vol_hist) = db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT ph.slug, ph.median, COALESCE(ph.volume, 0)
             FROM price_history ph
             JOIN inventory_items ii ON ii.slug = ph.slug
             WHERE ii.qty > 0 AND ph.median IS NOT NULL
               AND ph.day >= date('now', '-90 day')
             ORDER BY ph.slug, ph.day ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?;
        let mut med: HashMap<String, Vec<i64>> = HashMap::new();
        let mut vol: HashMap<String, Vec<i64>> = HashMap::new();
        for r in rows {
            let (slug, m, v) = r?;
            med.entry(slug.clone()).or_default().push(m);
            vol.entry(slug).or_default().push(v);
        }
        Ok::<_, AppError>((med, vol))
    })?;

    // 3) Apply the gates and derive the suggested price (one pooled read;
    //    fair_sell_price reuses order_cache/price_rank/price_cache).
    let mut out: Vec<RecommendationRow> = db.read(|c| {
        // Same value-exclusion the inventory/valuation uses, so an item the user has
        // excluded (cheap mods, etc.) never surfaces here as something to sell.
        let rules = inventory::ExclusionRules::load(c)?;
        // The user's "worth selling" floor: drop any row that would list below
        // this per unit, so the list is genuinely "what to sell", not everything.
        let min_price = crate::db::settings::rec_min_price_conn(c)?;
        // Owned (rank, qty) breakdown per slug. Mods/arcanes are priced PER RANK — a
        // rank-10 mod is a different good than rank 0 — so each owned rank becomes its
        // own row, priced and listed independently. Primes/sets have no inventory_ranks
        // rows → priced rank-agnostically as a single row.
        let owned_ranks: HashMap<String, Vec<(i64, i64)>> = {
            let mut stmt = c.prepare(
                "SELECT ir.slug, ir.rank, ir.qty FROM inventory_ranks ir
                 JOIN inventory_items ii ON ii.slug = ir.slug
                 WHERE ii.qty > 0 ORDER BY ir.slug, ir.rank",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?;
            let mut m: HashMap<String, Vec<(i64, i64)>> = HashMap::new();
            for row in rows {
                let (s, rk, q) = row?;
                m.entry(s).or_default().push((rk, q));
            }
            m
        };
        let mut rows = Vec::new();
        for cand in &cands {
            // Liquidity floor — per item (warframe.market volume isn't per-rank), so it
            // gates the whole item before we split it into rank rows.
            let avg_vol = match vol_hist.get(&cand.slug) {
                Some(v) if !v.is_empty() => v.iter().sum::<i64>() as f64 / v.len() as f64,
                _ => 0.0,
            };
            if avg_vol < VOLUME_MIN {
                continue;
            }
            // One (rank, qty) row per owned rank for ranked goods; a single non-ranked
            // row otherwise.
            let pairs: Vec<(Option<i64>, i64)> = match owned_ranks.get(&cand.slug) {
                Some(b) if !b.is_empty() => b.iter().map(|&(r, q)| (Some(r), q)).collect(),
                _ => vec![(None, cand.owned_qty)],
            };
            for (rank, qty) in pairs {
                // Rank-aware unit price (matches the inventory grid / drawer); falls
                // back to the headline median for non-ranked items.
                let eff_median = if rank.is_some() {
                    prices::effective_price(c, &cand.slug, rank)?.or(cand.median_plat)
                } else {
                    cand.median_plat
                };
                // Honor the user's exclusions (rarity list / per-category cheap floor).
                if rules.is_excluded(&cand.category, cand.mod_rarity.as_deref(), eff_median) {
                    continue;
                }
                // Not better ducated (only meaningful for items with a ducat value).
                if let Some(d) = cand.ducats {
                    if d > 0 && is_ducat_verdict(d, eff_median) {
                        continue;
                    }
                }
                // Need a price signal to suggest a listing price at all — at this rank.
                let Some(suggested) = prices::fair_sell_price(c, &cand.slug, rank)? else {
                    continue;
                };
                // Below the user's per-unit floor → not worth listing.
                if suggested < min_price {
                    continue;
                }
                // Displayed median: the rank-aware price for ranked goods; for
                // non-ranked, the outlier-cleaned (winsorized) last daily median.
                let clean_median = if rank.is_some() {
                    eff_median
                } else {
                    med_hist
                        .get(&cand.slug)
                        .and_then(|s| {
                            let mut s = s.clone();
                            trends::winsorize(&mut s);
                            s.last().copied()
                        })
                        .or(cand.median_plat)
                };
                let ducats_per_plat = cand
                    .ducats
                    .and_then(|d| eff_median.filter(|&m| m > 0).map(|m| d as f64 / m as f64));

                rows.push(RecommendationRow {
                    slug: cand.slug.clone(),
                    display_name: cand.display_name.clone(),
                    part_type: cand.part_type.clone(),
                    category: cand.category.clone(),
                    thumbnail_url: cand.thumbnail_url.clone(),
                    rank,
                    owned_qty: qty,
                    avg_daily_volume: avg_vol,
                    suggested_price: suggested,
                    median_plat: clean_median,
                    est_value: suggested.saturating_mul(qty),
                    ducats_per_plat,
                    trend: cand.trend.clone(),
                });
            }
        }
        Ok(rows)
    })?;

    out.sort_by_key(|r| std::cmp::Reverse(r.est_value));
    out.truncate(MAX_ROWS);
    Ok(out)
}

/// An item is better turned into ducats when it's cheap (median ≤ `DUCAT_CHEAP_MAX`)
/// or ducat-efficient (≥ `DUCAT_EFFICIENT_MIN` ducats per plat). Kept identical to
/// `commands::get_ducats` so the two screens never disagree on the same item.
fn is_ducat_verdict(ducats: i64, median: Option<i64>) -> bool {
    let dpp = median.filter(|&m| m > 0).map(|m| ducats as f64 / m as f64);
    let cheap = median.map(|m| m <= DUCAT_CHEAP_MAX).unwrap_or(true);
    let efficient = dpp.map(|d| d >= DUCAT_EFFICIENT_MIN).unwrap_or(false);
    cheap || efficient
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::testutil::test_db;
    use rusqlite::params;

    /// Seed an owned, priced item plus `days` of `vol`/day history.
    fn seed(db: &Db, slug: &str, qty: i64, ducats: Option<i64>, median: i64, vol: i64, days: i64) {
        db.with(|c| {
            c.execute(
                "INSERT INTO catalog_items (slug, display_name, part_type, category, ducats)
                 VALUES (?1, ?1, 'Set', 'set', ?2)",
                params![slug, ducats],
            )?;
            c.execute(
                "INSERT INTO price_cache (slug, median_plat, trend, fetched_at, expires_at)
                 VALUES (?1, ?2, 'flat', '2026-01-01', '2099-01-01')",
                params![slug, median],
            )?;
            c.execute(
                "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at)
                 VALUES (?1, ?2, '2026-01-01', '2026-01-01')",
                params![slug, qty],
            )?;
            for i in 0..days {
                c.execute(
                    "INSERT INTO price_history (slug, day, median, volume)
                     VALUES (?1, date('now', ?2), ?3, ?4)",
                    params![slug, format!("-{i} day"), median, vol],
                )?;
            }
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn recommends_only_liquid_non_ducat_unlisted_items() {
        let db = test_db("recommend");
        // Recommended: liquid (12/day), no ducat value, priced, not listed.
        seed(&db, "liquid-good", 5, None, 50, 12, 14);
        // Excluded: thin (2/day < 10).
        seed(&db, "thin-item", 3, None, 50, 2, 14);
        // Excluded: cheap ducat part (median 5 ≤ 8 → ducat verdict) despite 20/day.
        seed(&db, "cheap-ducat", 10, Some(45), 5, 20, 14);
        // Excluded: liquid but already has a sell order up.
        seed(&db, "already-listed", 4, None, 100, 30, 14);
        db.with(|c| {
            c.execute(
                "INSERT INTO market_listings (order_id, slug, order_type, your_price, qty, visible)
                 VALUES ('o1', 'already-listed', 'sell', 99, 4, 1)",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        let rows = list(&db).unwrap();
        let slugs: Vec<&str> = rows.iter().map(|r| r.slug.as_str()).collect();
        assert_eq!(slugs, vec!["liquid-good"]);
        let r = &rows[0];
        assert_eq!(r.owned_qty, 5);
        assert_eq!(r.suggested_price, 49); // headline 50, undercut by 1
        assert_eq!(r.est_value, 49 * 5);
        assert!((r.avg_daily_volume - 12.0).abs() < 1e-9);
    }

    #[test]
    fn excluded_items_never_recommended() {
        let db = test_db("recommend-excluded");
        // Liquid, non-ducat, unlisted — would qualify, but the user has excluded the
        // 'set' category below 100p, so it must be dropped (same rule as inventory).
        seed(&db, "excluded-set", 5, None, 50, 12, 14);
        db.with(|c| {
            c.execute(
                "INSERT INTO app_settings (key, value) VALUES (?1, '{\"set\": 100}')",
                params![crate::db::settings::KEY_EXCLUDED_MIN_PLAT_BY_CAT],
            )?;
            Ok(())
        })
        .unwrap();
        assert!(list(&db).unwrap().is_empty());
    }

    #[test]
    fn ranked_mod_priced_at_owned_rank_not_rank0() {
        let db = test_db("recommend-rank");
        db.with(|c| {
            c.execute(
                "INSERT INTO catalog_items (slug, display_name, part_type, category)
                 VALUES ('zoom', 'Zoom', 'Mod', 'mod')",
                [],
            )?;
            // Headline + rank-0 are cheap; the owned rank 10 is the valuable copy.
            c.execute(
                "INSERT INTO price_cache (slug, median_plat, trend, fetched_at, expires_at)
                 VALUES ('zoom', 5, 'flat', '2026-01-01', '2099-01-01')",
                [],
            )?;
            c.execute(
                "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at)
                 VALUES ('zoom', 1, '2026-01-01', '2026-01-01')",
                [],
            )?;
            c.execute(
                "INSERT INTO inventory_ranks (slug, rank, qty) VALUES ('zoom', 10, 1)",
                [],
            )?;
            c.execute(
                "INSERT INTO price_rank (slug, rank, median) VALUES ('zoom', 0, 5)",
                [],
            )?;
            c.execute(
                "INSERT INTO price_rank (slug, rank, median) VALUES ('zoom', 10, 120)",
                [],
            )?;
            for i in 0..14 {
                c.execute(
                    "INSERT INTO price_history (slug, day, median, volume)
                     VALUES ('zoom', date('now', ?1), 120, 12)",
                    params![format!("-{i} day")],
                )?;
            }
            Ok(())
        })
        .unwrap();
        let rows = list(&db).unwrap();
        assert_eq!(rows.len(), 1);
        // Priced at the owned rank 10 (median 120, undercut 1) — NOT rank-0's 5.
        assert_eq!(rows[0].rank, Some(10));
        assert_eq!(rows[0].suggested_price, 119);
        assert_eq!(rows[0].median_plat, Some(120));
    }

    #[test]
    fn same_item_at_two_ranks_splits_into_two_rows() {
        let db = test_db("recommend-split");
        db.with(|c| {
            // Disable the sell-price floor: this test exercises rank-splitting, and
            // the rank-0 copy (9p) is below the default 15p floor.
            c.execute(
                "INSERT INTO app_settings (key, value) VALUES (?1, '0')",
                params![crate::db::settings::KEY_REC_MIN_PRICE],
            )?;
            c.execute(
                "INSERT INTO catalog_items (slug, display_name, part_type, category)
                 VALUES ('molt', 'Molt Augmented', 'Arcane', 'arcane')",
                [],
            )?;
            c.execute(
                "INSERT INTO price_cache (slug, median_plat, trend, fetched_at, expires_at)
                 VALUES ('molt', 10, 'flat', '2026-01-01', '2099-01-01')",
                [],
            )?;
            c.execute(
                "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at)
                 VALUES ('molt', 2, '2026-01-01', '2026-01-01')",
                [],
            )?;
            // One copy unranked, one maxed — distinct goods, distinct prices.
            c.execute(
                "INSERT INTO inventory_ranks (slug, rank, qty) VALUES ('molt', 0, 1)",
                [],
            )?;
            c.execute(
                "INSERT INTO inventory_ranks (slug, rank, qty) VALUES ('molt', 5, 1)",
                [],
            )?;
            c.execute(
                "INSERT INTO price_rank (slug, rank, median) VALUES ('molt', 0, 10)",
                [],
            )?;
            c.execute(
                "INSERT INTO price_rank (slug, rank, median) VALUES ('molt', 5, 200)",
                [],
            )?;
            for i in 0..14 {
                c.execute(
                    "INSERT INTO price_history (slug, day, median, volume)
                     VALUES ('molt', date('now', ?1), 200, 12)",
                    params![format!("-{i} day")],
                )?;
            }
            Ok(())
        })
        .unwrap();
        let rows = list(&db).unwrap();
        assert_eq!(rows.len(), 2, "one row per owned rank");
        // Sorted by est_value desc → rank 5 first (199p) then rank 0 (9p).
        assert_eq!(rows[0].rank, Some(5));
        assert_eq!(rows[0].suggested_price, 199);
        assert_eq!(rows[1].rank, Some(0));
        assert_eq!(rows[1].suggested_price, 9);
    }

    #[test]
    fn respects_min_sell_price_floor() {
        let db = test_db("recommend-floor");
        // Two liquid, non-ducat, unlisted items: one above the floor, one below.
        seed(&db, "worth-it", 1, None, 40, 12, 14); // suggested 39 ≥ floor
        seed(&db, "too-cheap", 1, None, 12, 12, 14); // suggested 11 < floor
                                                     // Floor of 20p: only the 39p item survives.
        db.with(|c| {
            c.execute(
                "INSERT INTO app_settings (key, value) VALUES (?1, '20')",
                params![crate::db::settings::KEY_REC_MIN_PRICE],
            )?;
            Ok(())
        })
        .unwrap();
        let slugs: Vec<String> = list(&db).unwrap().into_iter().map(|r| r.slug).collect();
        assert_eq!(slugs, vec!["worth-it"]);
    }

    #[test]
    fn keeps_efficient_prime_that_should_sell_for_plat() {
        let db = test_db("recommend-plat");
        // Has a ducat value but pricey (median 60): not cheap, dpp = 45/60 < 5 → keep.
        seed(&db, "good-prime", 2, Some(45), 60, 15, 14);
        let rows = list(&db).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].slug, "good-prime");
        assert!(rows[0].ducats_per_plat.unwrap() < DUCAT_EFFICIENT_MIN);
    }
}
