use crate::db::Db;
use crate::error::AppResult;
use crate::types::{HeatRow, TrendRow, TrendsData};
use std::collections::{HashMap, HashSet};

/// Days in each timeframe window (drives the headline % move).
fn window_days(tf: &str) -> i64 {
    match tf {
        "24h" => 1,
        "7d" => 7,
        "30d" => 30,
        _ => 90,
    }
}

/// Min avg-daily volume for an item to count as liquid enough to act on.
/// Below this a price move is noise — nobody's actually trading it.
const LIQUID_MIN: f64 = 3.0;

struct Item {
    slug: String,
    display_name: String,
    part_type: String,
    category: String,
    median_plat: i64,
    owned_qty: i64,
    on_watchlist: bool,
    thumbnail_url: Option<String>,
    medians: Vec<i64>, // daily median series, oldest-first
    volumes: Vec<i64>, // daily volume series, oldest-first (parallel to medians)
}

struct Metrics {
    current: i64,   // latest median (cleaned, when outliers excluded)
    delta: f64,     // % move over the timeframe
    z: f64,         // volatility-normalized move
    range_pos: f64, // 0..1 within lookback low..high
    range_low: i64,
    range_high: i64,
    avg_vol: f64, // avg daily volume over the lookback
}

/// Aggregate the priced subset into the Trends payload for one timeframe.
/// When `exclude_outliers`, each item's daily series is winsorized first so a
/// single troll/fat-finger print (a common mod "selling" for 50k plat) can't
/// pollute the move, the index, or the signals.
pub fn get(db: &Db, timeframe: &str, exclude_outliers: bool) -> AppResult<TrendsData> {
    let days = window_days(timeframe);

    let mut items: Vec<Item> = db.with(|c| {
        let watched: HashSet<String> = {
            let mut stmt = c.prepare("SELECT slug FROM watchlist")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<_, _>>()?
        };
        let mut stmt = c.prepare(
            "SELECT pc.slug, ci.display_name, ci.part_type, ci.category,
                    pc.median_plat, COALESCE(ii.qty, 0), ci.thumbnail_url
             FROM price_cache pc
             JOIN catalog_items ci ON ci.slug = pc.slug
             LEFT JOIN inventory_items ii ON ii.slug = pc.slug",
        )?;
        let rows = stmt.query_map([], |r| {
            let slug: String = r.get(0)?;
            Ok(Item {
                on_watchlist: watched.contains(&slug),
                slug,
                display_name: r.get(1)?,
                part_type: r.get(2)?,
                category: r.get(3)?,
                median_plat: r.get(4)?,
                owned_qty: r.get(5)?,
                thumbnail_url: r.get(6)?,
                medians: Vec::new(),
                volumes: Vec::new(),
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })?;

    // Pull the daily (median, volume) history once and bucket by slug.
    let (med_hist, vol_hist) = db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT slug, median, COALESCE(volume, 0) FROM price_history
             WHERE median IS NOT NULL ORDER BY slug, day ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
        })?;
        let mut med: HashMap<String, Vec<i64>> = HashMap::new();
        let mut vol: HashMap<String, Vec<i64>> = HashMap::new();
        for r in rows {
            let (slug, m, v) = r?;
            med.entry(slug.clone()).or_default().push(m);
            vol.entry(slug).or_default().push(v);
        }
        Ok::<_, crate::error::AppError>((med, vol))
    })?;
    for it in &mut items {
        if let Some(s) = med_hist.get(&it.slug) {
            it.medians = s.clone();
        }
        if let Some(s) = vol_hist.get(&it.slug) {
            it.volumes = s.clone();
        }
        if exclude_outliers {
            winsorize(&mut it.medians);
        }
    }

    // Per-item metrics. Volatility + range use the full available series (≤90d)
    // so they're stable; only the headline % move respects the timeframe.
    let metrics: HashMap<String, Metrics> = items
        .iter()
        .filter_map(|it| metrics_of(it, days).map(|m| (it.slug.clone(), m)))
        .collect();

    let liquid = |it: &Item| metrics.get(&it.slug).is_some_and(|m| m.avg_vol >= LIQUID_MIN);
    let liquid_count = items.iter().filter(|it| liquid(it)).count() as i64;

    // Market read over the LIQUID subset only — breadth + a robust median move.
    // (A value-weighted mean explodes when a 1p item ticks to Np; the median doesn't.)
    let (mut advancing, mut declining, mut flat) = (0i64, 0i64, 0i64);
    for it in &items {
        if !liquid(it) {
            continue;
        }
        if let Some(m) = metrics.get(&it.slug) {
            if m.delta > 1.0 {
                advancing += 1;
            } else if m.delta < -1.0 {
                declining += 1;
            } else {
                flat += 1;
            }
        }
    }
    // The index is the priced basket's 90-day trajectory; its change is the
    // start→end move of that curve — a price-level average, robust by
    // construction (not a mean of per-item % moves) and consistent with the
    // graph the user sees.
    let index_spark = build_index_spark(&items, 90);
    let index_change = spark_change(&index_spark);

    let make_row = |it: &Item, m: &Metrics| TrendRow {
        slug: it.slug.clone(),
        display_name: it.display_name.clone(),
        part_type: it.part_type.clone(),
        category: it.category.clone(),
        // cleaned current (winsorized when outliers are excluded) so a spiked
        // print never shows as the price in any panel
        median_plat: m.current,
        delta: m.delta,
        z: m.z,
        range_pos: m.range_pos,
        range_low: m.range_low,
        range_high: m.range_high,
        volume: m.avg_vol.round() as i64,
        owned_qty: it.owned_qty,
        on_watchlist: it.on_watchlist,
        spark: spark_of(it),
        thumbnail_url: it.thumbnail_url.clone(),
    };

    // Sell signals: liquid items you OWN that are elevated — high in their range
    // or a strong positive volatility-adjusted move. Ranked by plat at stake.
    let mut sell: Vec<(f64, TrendRow)> = items
        .iter()
        .filter(|it| it.owned_qty > 0 && liquid(it))
        .filter_map(|it| metrics.get(&it.slug).map(|m| (it, m)))
        .filter(|(_, m)| m.range_pos >= 0.7 || m.z >= 1.0)
        .map(|(it, m)| {
            let stake = it.owned_qty as f64 * it.median_plat as f64;
            // weight by how elevated and how much plat is on the table
            let score = stake * (0.5 + m.range_pos);
            (score, make_row(it, m))
        })
        .collect();
    sell.sort_by(|a, b| b.0.total_cmp(&a.0));
    let sell_signals: Vec<TrendRow> = sell.into_iter().map(|(_, r)| r).take(6).collect();

    // Buy candidates: liquid items trading LOW in their range (deep-value / dip),
    // not already owned. Watchlist items float to the top. Ranked by cheapness.
    let mut buy: Vec<(f64, TrendRow)> = items
        .iter()
        .filter(|it| it.owned_qty == 0 && liquid(it))
        .filter_map(|it| metrics.get(&it.slug).map(|m| (it, m)))
        .filter(|(_, m)| m.range_pos <= 0.3 || m.z <= -1.0)
        .map(|(it, m)| {
            // lower range_pos = cheaper = better; watchlist gets a boost
            let score = (1.0 - m.range_pos) + if it.on_watchlist { 1.0 } else { 0.0 };
            (score, make_row(it, m))
        })
        .collect();
    buy.sort_by(|a, b| b.0.total_cmp(&a.0));
    let buy_candidates: Vec<TrendRow> = buy.into_iter().map(|(_, r)| r).take(6).collect();

    // Unusual moves: liquid items ranked by |z| — the biggest volatility-adjusted
    // moves, so a real Prime swing beats a 1p mod blip.
    let mut unusual: Vec<TrendRow> = items
        .iter()
        .filter(|it| liquid(it))
        .filter_map(|it| metrics.get(&it.slug).map(|m| make_row(it, m)))
        .collect();
    unusual.sort_by(|a, b| b.z.abs().total_cmp(&a.z.abs()));
    unusual.truncate(8);

    // Category heat (timeframe deltas, all priced items).
    let mut heat_acc: HashMap<String, (f64, i64)> = HashMap::new();
    for it in &items {
        if let Some(m) = metrics.get(&it.slug) {
            let e = heat_acc.entry(it.category.clone()).or_insert((0.0, 0));
            e.0 += m.delta;
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

    // Holdings band: value of owned priced items + value-weighted % move.
    let (mut hv, mut hnum, mut hden) = (0i64, 0.0f64, 0.0f64);
    for it in &items {
        if it.owned_qty > 0 {
            let val = it.owned_qty * it.median_plat;
            hv += val;
            if let Some(m) = metrics.get(&it.slug) {
                hnum += m.delta * val as f64;
                hden += val as f64;
            }
        }
    }
    let holdings_change = if hden > 0.0 { hnum / hden } else { 0.0 };

    Ok(TrendsData {
        index_change,
        advancing,
        declining,
        flat,
        index_spark,
        liquid_count,
        total_priced: items.len() as i64,
        holdings_value: hv,
        holdings_change,
        sell_signal_count: sell_signals.len() as i64,
        sell_signals,
        buy_candidates,
        unusual,
        category_heat,
    })
}

/// Percent change between the first and last non-zero points of the index curve.
fn spark_change(spark: &[f64]) -> f64 {
    let first = spark.iter().copied().find(|v| *v > 0.0);
    let last = spark.iter().rev().copied().find(|v| *v > 0.0);
    match (first, last) {
        (Some(f), Some(l)) if f > 0.0 => (l - f) / f * 100.0,
        _ => 0.0,
    }
}

/// Median of a slice (robust to the percent-change outliers cheap items produce).
fn median(v: &mut [f64]) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(f64::total_cmp);
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

/// Clamp gross outliers in a daily price series toward the item's own center,
/// using a robust median ± k·(scaled MAD) band. Leaves normal series untouched.
fn winsorize(series: &mut [i64]) {
    if series.len() < 4 {
        return;
    }
    let mut sorted: Vec<f64> = series.iter().map(|&v| v as f64).collect();
    let center = median(&mut sorted);
    let mut devs: Vec<f64> = series.iter().map(|&v| (v as f64 - center).abs()).collect();
    let mad = median(&mut devs);
    // Fall back to a fraction of the center when MAD ≈ 0 — a mostly-flat series
    // with a single spike (a common 1p mod with a 50k-plat troll print) has
    // MAD 0, so a pure-MAD band would skip clamping and let the spike through.
    let spread = (1.4826 * mad).max(center.abs() * 0.5);
    if spread <= 0.0 {
        return; // genuinely flat (or 0-priced) — nothing to clamp
    }
    let (lo, hi) = (center - 6.0 * spread, center + 6.0 * spread);
    for v in series.iter_mut() {
        let f = *v as f64;
        if f > hi {
            *v = hi.round() as i64;
        } else if f < lo {
            *v = lo.round() as i64;
        }
    }
}

/// Recent median series (≤12 points) for the row sparkline.
fn spark_of(it: &Item) -> Vec<i64> {
    let n = it.medians.len();
    it.medians[n - n.min(12)..].to_vec()
}

/// Per-item signal metrics, or None if there isn't enough history.
fn metrics_of(it: &Item, days: i64) -> Option<Metrics> {
    let s = &it.medians;
    if s.len() < 2 {
        return None;
    }
    let current = *s.last().unwrap() as f64;

    // Headline % move over the timeframe.
    let base_idx = s.len().saturating_sub(1 + days as usize);
    let baseline = s[base_idx] as f64;
    let delta = if baseline > 0.0 {
        (current - baseline) / baseline * 100.0
    } else {
        0.0
    };

    // Volatility: std dev of daily % returns over the full series, scaled to the
    // timeframe (σ_tf = σ_daily · √days). z = move / σ_tf — how many std devs.
    let mut returns: Vec<f64> = Vec::with_capacity(s.len());
    for w in s.windows(2) {
        if w[0] > 0 {
            returns.push((w[1] - w[0]) as f64 / w[0] as f64 * 100.0);
        }
    }
    let z = if returns.len() >= 2 {
        let mean = returns.iter().sum::<f64>() / returns.len() as f64;
        let var = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / returns.len() as f64;
        let sd_daily = var.sqrt();
        let sd_tf = sd_daily * (days as f64).sqrt();
        if sd_tf > 1e-6 { delta / sd_tf } else { 0.0 }
    } else {
        0.0
    };

    // Range position over the full available series.
    let lo = *s.iter().min().unwrap();
    let hi = *s.iter().max().unwrap();
    let range_pos = if hi > lo {
        (current - lo as f64) / (hi - lo) as f64
    } else {
        0.5
    };

    // Avg daily volume over the lookback.
    let avg_vol = if it.volumes.is_empty() {
        0.0
    } else {
        it.volumes.iter().sum::<i64>() as f64 / it.volumes.len() as f64
    };

    Some(Metrics {
        current: current.round() as i64,
        delta,
        z,
        range_pos,
        range_low: lo,
        range_high: hi,
        avg_vol,
    })
}

/// Weighted-average median across items per recent day, normalized to 1000.
fn build_index_spark(items: &[Item], points: usize) -> Vec<f64> {
    let points = points.clamp(7, 90);
    let mut sums = vec![0.0f64; points];
    let mut counts = vec![0u32; points];
    for it in items {
        let n = it.medians.len();
        if n == 0 {
            continue;
        }
        for (p, sum) in sums.iter_mut().enumerate() {
            if points - p > n {
                continue;
            }
            let idx = n - (points - p);
            if let Some(v) = it.medians.get(idx) {
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
