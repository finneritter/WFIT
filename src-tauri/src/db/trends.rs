use crate::db::Db;
use crate::error::AppResult;
use crate::types::{HeatRow, ImpactRow, MoverRow, TrendsData, VolRow};
use std::collections::HashMap;

/// Days in each timeframe window.
fn window_days(tf: &str) -> i64 {
    match tf {
        "24h" => 1,
        "7d" => 7,
        "30d" => 30,
        _ => 90,
    }
}

struct Priced {
    slug: String,
    display_name: String,
    part_type: String,
    category: String,
    median_plat: i64,
    volume_7d: i64,
    owned_qty: i64,
    series: Vec<i64>, // median series, oldest-first
}

/// Aggregate the priced subset into the Trends screen payload for one timeframe.
pub fn get(db: &Db, timeframe: &str) -> AppResult<TrendsData> {
    let days = window_days(timeframe);

    // Priced items joined with ownership.
    let mut items: Vec<Priced> = db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT pc.slug, ci.display_name, ci.part_type, ci.category,
                    pc.median_plat, COALESCE(pc.volume_7d, 0), COALESCE(ii.qty, 0)
             FROM price_cache pc
             JOIN catalog_items ci ON ci.slug = pc.slug
             LEFT JOIN inventory_items ii ON ii.slug = pc.slug",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Priced {
                slug: r.get(0)?,
                display_name: r.get(1)?,
                part_type: r.get(2)?,
                category: r.get(3)?,
                median_plat: r.get(4)?,
                volume_7d: r.get(5)?,
                owned_qty: r.get(6)?,
                series: Vec::new(),
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })?;

    // Pull all history once and bucket by slug (oldest-first).
    let history: HashMap<String, Vec<i64>> = db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT slug, median FROM price_history
             WHERE median IS NOT NULL ORDER BY slug, day ASC",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        let mut map: HashMap<String, Vec<i64>> = HashMap::new();
        for r in rows {
            let (slug, median) = r?;
            map.entry(slug).or_default().push(median);
        }
        Ok(map)
    })?;

    for it in &mut items {
        if let Some(series) = history.get(&it.slug) {
            it.series = series.clone();
        }
    }

    // Per-item delta over the window.
    let delta_of = |it: &Priced| -> Option<f64> {
        if it.series.len() < 2 {
            return None;
        }
        let current = *it.series.last().unwrap() as f64;
        let idx = it.series.len().saturating_sub(1 + days as usize);
        let baseline = it.series[idx] as f64;
        if baseline <= 0.0 {
            return None;
        }
        Some((current - baseline) / baseline * 100.0)
    };

    // Breadth + weighted index change.
    let mut advancing = 0i64;
    let mut declining = 0i64;
    let mut flat = 0i64;
    let mut weighted_change_num = 0.0f64;
    let mut weighted_change_den = 0.0f64;
    let mut deltas: HashMap<String, f64> = HashMap::new();
    for it in &items {
        if let Some(d) = delta_of(it) {
            deltas.insert(it.slug.clone(), d);
            if d > 1.0 {
                advancing += 1;
            } else if d < -1.0 {
                declining += 1;
            } else {
                flat += 1;
            }
            let w = it.median_plat as f64;
            weighted_change_num += d * w;
            weighted_change_den += w;
        }
    }
    let index_change = if weighted_change_den > 0.0 {
        weighted_change_num / weighted_change_den
    } else {
        0.0
    };
    let index_level = 1000.0 * (1.0 + index_change / 100.0);

    // Index sparkline: weighted-average median per recent day, normalized to 1000.
    let index_spark = build_index_spark(&items, days.max(7) as usize);

    // Movers.
    let spark_of = |it: &Priced| -> Vec<i64> {
        let n = it.series.len();
        let take = n.min(12);
        it.series[n - take..].to_vec()
    };
    let mut movers: Vec<MoverRow> = items
        .iter()
        .filter_map(|it| {
            deltas.get(&it.slug).map(|&d| MoverRow {
                slug: it.slug.clone(),
                display_name: it.display_name.clone(),
                part_type: it.part_type.clone(),
                category: it.category.clone(),
                median_plat: Some(it.median_plat),
                delta: d,
                spark: spark_of(it),
            })
        })
        .collect();
    movers.sort_by(|a, b| {
        b.delta
            .partial_cmp(&a.delta)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let gainers: Vec<MoverRow> = movers.iter().take(8).cloned().collect();
    let losers: Vec<MoverRow> = movers.iter().rev().take(8).cloned().collect();

    // Most traded.
    let mut vol: Vec<VolRow> = items
        .iter()
        .map(|it| VolRow {
            slug: it.slug.clone(),
            display_name: it.display_name.clone(),
            part_type: it.part_type.clone(),
            category: it.category.clone(),
            median_plat: Some(it.median_plat),
            volume: it.volume_7d,
        })
        .collect();
    vol.sort_by_key(|v| std::cmp::Reverse(v.volume));
    let most_traded: Vec<VolRow> = vol.into_iter().take(8).collect();

    // Category heat.
    let mut heat_acc: HashMap<String, (f64, i64)> = HashMap::new();
    for it in &items {
        if let Some(&d) = deltas.get(&it.slug) {
            let e = heat_acc.entry(it.category.clone()).or_insert((0.0, 0));
            e.0 += d;
            e.1 += 1;
        }
    }
    let mut category_heat: Vec<HeatRow> = heat_acc
        .into_iter()
        .map(|(category, (sum, count))| HeatRow {
            category,
            avg_delta: if count > 0 { sum / count as f64 } else { 0.0 },
            count,
        })
        .collect();
    category_heat.sort_by(|a, b| a.category.cmp(&b.category));

    // Inventory in motion (owned items only).
    let mut motion: Vec<ImpactRow> = items
        .iter()
        .filter(|it| it.owned_qty > 0)
        .filter_map(|it| {
            deltas.get(&it.slug).map(|&d| ImpactRow {
                slug: it.slug.clone(),
                display_name: it.display_name.clone(),
                category: it.category.clone(),
                impact: it.owned_qty as f64 * it.median_plat as f64 * d / 100.0,
            })
        })
        .collect();
    motion.sort_by(|a, b| {
        b.impact
            .abs()
            .partial_cmp(&a.impact.abs())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let inventory_motion: Vec<ImpactRow> = motion.into_iter().take(8).collect();

    Ok(TrendsData {
        index_level,
        index_change,
        advancing,
        declining,
        flat,
        index_spark,
        gainers,
        losers,
        most_traded,
        category_heat,
        inventory_motion,
    })
}

/// Weighted-average median across items for each of the last `points` days,
/// normalized so the first non-zero point is 1000.
fn build_index_spark(items: &[Priced], points: usize) -> Vec<f64> {
    let points = points.clamp(7, 30);
    let mut sums = vec![0.0f64; points];
    let mut counts = vec![0u32; points];
    for it in items {
        let n = it.series.len();
        if n == 0 {
            continue;
        }
        for (p, sum) in sums.iter_mut().enumerate() {
            if points - p > n {
                continue; // not enough history for this slot
            }
            let idx = n - (points - p);
            if let Some(v) = it.series.get(idx) {
                *sum += *v as f64;
                counts[p] += 1;
            }
        }
    }
    let avgs: Vec<f64> = sums
        .iter()
        .zip(counts.iter())
        .map(|(s, c)| if *c > 0 { s / *c as f64 } else { 0.0 })
        .collect();
    let base = avgs.iter().find(|v| **v > 0.0).copied().unwrap_or(0.0);
    if base <= 0.0 {
        return vec![1000.0; points];
    }
    avgs.into_iter().map(|v| 1000.0 * v / base).collect()
}
