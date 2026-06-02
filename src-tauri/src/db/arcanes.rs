//! Arcanes / Vosfor dissolution dashboard. Combines the bundled Loid-collection
//! reference data (`domain::arcane`) with live warframe.market prices to answer:
//! which collection is the best expected platinum per 200 Vosfor, how much Vosfor
//! dissolving your unranked arcanes yields, and sell-vs-dissolve per owned arcane.
//! See `docs/ARCANE_DISSOLUTION.md`.
use crate::db::Db;
use crate::domain::arcane;
use crate::error::AppResult;
use crate::types::{ArcaneContribution, ArcaneDashboard, ArcaneSummary, CollectionEv, OwnedArcane};
use std::collections::HashMap;

/// slug → (display_name, rank-0 market price). Rank-0 is the traded unit for
/// arcanes (collections grant unranked copies); prefer the per-rank-0 median, else
/// the headline median.
fn arcane_prices(c: &rusqlite::Connection) -> AppResult<HashMap<String, (String, Option<i64>)>> {
    let mut stmt = c.prepare(
        "SELECT ci.slug, ci.display_name, COALESCE(pr.median, pc.median_plat)
         FROM catalog_items ci
         LEFT JOIN price_rank pr ON pr.slug = ci.slug AND pr.rank = 0
         LEFT JOIN price_cache pc ON pc.slug = ci.slug
         WHERE ci.category = 'arcane'",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<i64>>(2)?,
        ))
    })?;
    let mut m = HashMap::new();
    for row in rows {
        let (slug, name, price) = row?;
        m.insert(slug, (name, price));
    }
    Ok(m)
}

/// Per-collection expected value from one 200-Vosfor pull, ranked best-first.
fn collections(prices: &HashMap<String, (String, Option<i64>)>) -> Vec<CollectionEv> {
    let mut out: Vec<CollectionEv> = arcane::COLLECTIONS
        .iter()
        .map(|col| {
            let pools = arcane::collection_pools(col.key);
            let mut ev = 0.0_f64;
            let mut priced = 0i64;
            let mut pool_size = 0i64;
            // (slug, single-draw prob, plat, ev-contribution)
            let mut contribs: Vec<(String, f64, Option<i64>, f64)> = Vec::new();
            for (ri, pool) in pools.iter().enumerate() {
                let n = pool.len();
                if n == 0 {
                    continue;
                }
                let p = (col.weights[ri] / 100.0) / n as f64; // single-draw chance
                for slug in pool {
                    pool_size += 1;
                    let plat = prices.get(*slug).and_then(|(_, p)| *p);
                    if plat.is_some() {
                        priced += 1;
                    }
                    let contribution = arcane::ARCANES_PER_PULL * p * plat.unwrap_or(0) as f64;
                    ev += contribution;
                    contribs.push((slug.to_string(), p, plat, contribution));
                }
            }
            contribs.sort_by(|a, b| b.3.partial_cmp(&a.3).unwrap_or(std::cmp::Ordering::Equal));
            let top = contribs
                .iter()
                .take(3)
                .map(|(slug, prob, plat, _)| ArcaneContribution {
                    display_name: prices
                        .get(slug)
                        .map(|(n, _)| n.clone())
                        .unwrap_or_else(|| slug.clone()),
                    slug: slug.clone(),
                    prob: *prob,
                    plat: *plat,
                })
                .collect();
            CollectionEv {
                key: col.key.to_string(),
                name: col.name.to_string(),
                ev_plat_per_pull: ev,
                plat_per_vosfor: ev / arcane::VOSFOR_PER_PULL as f64,
                legendary_pct: col.weights[3],
                coverage: if pool_size > 0 {
                    priced as f64 / pool_size as f64
                } else {
                    0.0
                },
                pool_size,
                top,
            }
        })
        .collect();
    out.sort_by(|a, b| {
        b.ev_plat_per_pull
            .partial_cmp(&a.ev_plat_per_pull)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// Owned arcanes with sell-vs-dissolve verdicts, plus the portfolio summary.
/// `implied_rate` = best collection's plat-per-Vosfor (the value of 1 Vosfor).
fn owned(
    c: &rusqlite::Connection,
    prices: &HashMap<String, (String, Option<i64>)>,
    implied_rate: f64,
) -> AppResult<(Vec<OwnedArcane>, i64, i64)> {
    // rank-0 (unranked) copy counts, and which slugs have any rank breakdown.
    let mut rank0: HashMap<String, i64> = HashMap::new();
    let mut has_breakdown: std::collections::HashSet<String> = std::collections::HashSet::new();
    {
        let mut stmt = c.prepare("SELECT slug, rank, qty FROM inventory_ranks")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?;
        for row in rows {
            let (slug, rank, qty) = row?;
            has_breakdown.insert(slug.clone());
            if rank == 0 {
                rank0.insert(slug, qty);
            }
        }
    }

    let mut stmt = c.prepare(
        "SELECT ci.slug, ci.display_name, ii.qty, ci.thumbnail_url
         FROM inventory_items ii
         JOIN catalog_items ci ON ci.slug = ii.slug
         WHERE ii.qty > 0 AND ci.category = 'arcane'",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, Option<String>>(3)?,
        ))
    })?;

    let mut out = Vec::new();
    let mut total_vosfor = 0i64;
    let mut sell_plat = 0i64;
    for row in rows {
        let (slug, display_name, qty, thumbnail_url) = row?;
        // Unranked copies: explicit rank-0 count if we have a breakdown, else assume
        // the whole stack is unranked (manual adds carry no rank data).
        let rank0_copies = if has_breakdown.contains(&slug) {
            rank0.get(&slug).copied().unwrap_or(0)
        } else {
            qty
        };
        let plat = prices.get(&slug).and_then(|(_, p)| *p);
        let meta = arcane::meta_for(&slug);
        let vosfor = meta.map(|m| m.vosfor).unwrap_or(0);
        let vosfor_total = rank0_copies * vosfor;
        total_vosfor += vosfor_total;
        sell_plat += plat.unwrap_or(0) * qty;
        // Dissolve when the Vosfor you'd get is worth more (at the best collection's
        // implied rate) than selling the arcane for plat.
        let dissolve_plat = vosfor as f64 * implied_rate;
        let verdict = if dissolve_plat > plat.unwrap_or(0) as f64 {
            "dissolve"
        } else {
            "sell"
        };
        out.push(OwnedArcane {
            slug,
            display_name,
            qty,
            rank0_copies,
            plat,
            vosfor,
            vosfor_total,
            collection: meta
                .map(|m| m.collection)
                .filter(|c| *c != "none")
                .map(String::from),
            rarity: meta.map(|m| m.rarity.to_string()),
            verdict: verdict.to_string(),
            thumbnail_url,
        });
    }
    // Most Vosfor-on-the-table first.
    out.sort_by_key(|a| std::cmp::Reverse(a.vosfor_total));
    Ok((out, total_vosfor, sell_plat))
}

/// The full Arcanes dashboard: collection EV leaderboard + owned arcanes + summary.
pub fn dashboard(db: &Db) -> AppResult<ArcaneDashboard> {
    db.read(|c| {
        let prices = arcane_prices(c)?;
        let cols = collections(&prices);
        let best = cols.first();
        let implied_rate = best.map(|b| b.plat_per_vosfor).unwrap_or(0.0);
        let (owned_rows, total_vosfor, sell_plat) = owned(c, &prices, implied_rate)?;
        let summary = ArcaneSummary {
            total_vosfor,
            owned_count: owned_rows.len() as i64,
            sell_plat,
            best_collection: best.map(|b| b.name.clone()),
            best_plat_per_200: best.map(|b| b.ev_plat_per_pull).unwrap_or(0.0),
            plat_per_vosfor: implied_rate,
        };
        Ok(ArcaneDashboard {
            collections: cols,
            owned: owned_rows,
            summary,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ev_weights_a_synthetic_collection() {
        // Eidolon: legendary tier 5% over 3 arcanes → 1.667% each per draw. If only
        // Energize is priced at 120p, EV ≈ 3 draws × 0.01667 × 120 = ~6.0p/pull.
        let mut prices = HashMap::new();
        prices.insert(
            "arcane_energize".to_string(),
            ("Arcane Energize".to_string(), Some(120)),
        );
        let cols = collections(&prices);
        let eidolon = cols.iter().find(|c| c.key == "eidolon").unwrap();
        let expected = 3.0 * (0.05 / 3.0) * 120.0;
        assert!(
            (eidolon.ev_plat_per_pull - expected).abs() < 0.01,
            "got {}",
            eidolon.ev_plat_per_pull
        );
        assert!(eidolon.coverage > 0.0 && eidolon.coverage < 0.1); // only 1 of 30 priced
    }

    // Live spot-check against a real DB copy:
    //   WFIT_PROBE_DB=/path/to/wfit.sqlite cargo test --lib probe_arcanes -- --ignored --nocapture
    #[test]
    #[ignore]
    fn probe_arcanes() {
        let path = std::env::var("WFIT_PROBE_DB").expect("set WFIT_PROBE_DB");
        let db = crate::db::Db::open(std::path::Path::new(&path)).unwrap();
        let d = dashboard(&db).unwrap();
        println!(
            "SUMMARY total_vosfor={} owned={} sell_plat={} best={:?} best/200={:.1} p/vf={:.3}",
            d.summary.total_vosfor,
            d.summary.owned_count,
            d.summary.sell_plat,
            d.summary.best_collection,
            d.summary.best_plat_per_200,
            d.summary.plat_per_vosfor,
        );
        println!("--- collections (best first) ---");
        for c in &d.collections {
            println!(
                "  {:10} {:7.1}p/200  {:.3}p/vf  leg={:>3}%  priced={:.0}%  top: {}",
                c.name,
                c.ev_plat_per_pull,
                c.plat_per_vosfor,
                c.legendary_pct,
                c.coverage * 100.0,
                c.top.iter().map(|t| t.display_name.as_str()).collect::<Vec<_>>().join(", "),
            );
        }
        println!("--- top owned by Vosfor ---");
        for a in d.owned.iter().take(8) {
            println!(
                "  {:28} x{:<3} {:>4}p  {:>4}vf  -> {}",
                a.display_name,
                a.qty,
                a.plat.unwrap_or(-1),
                a.vosfor_total,
                a.verdict
            );
        }
    }
}
