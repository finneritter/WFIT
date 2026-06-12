use crate::db::Db;
use crate::error::AppResult;
use crate::types::HistoryPoint;
use chrono::{Duration, Utc};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use std::collections::HashMap;

/// The valuation price for a slug at a given rank: prefer the live lowest SELL
/// listing (`order_cache`, populated for illiquid items), then the per-rank trade
/// median, then the headline median. `rank = None` means a non-ranked item.
/// This is what owned value is computed from — live asks beat stale/gameable trades.
pub fn effective_price(c: &Connection, slug: &str, rank: Option<i64>) -> AppResult<Option<i64>> {
    let order: Option<i64> = match rank {
        Some(r) => c
            .query_row(
                "SELECT sell FROM order_cache WHERE slug = ?1 AND rank >= 0
                 ORDER BY ABS(rank - ?2) ASC, rank DESC LIMIT 1",
                params![slug, r],
                |x| x.get(0),
            )
            .optional()?,
        // Non-ranked lookup: a true non-ranked item is stored at rank -1; a mod with
        // no owned rank breakdown still has per-rank asks, so fall back to rank 0
        // (the unranked price). -1 sorts before 0, so it wins when present.
        None => c
            .query_row(
                "SELECT sell FROM order_cache WHERE slug = ?1 AND rank IN (-1, 0)
                 ORDER BY rank ASC LIMIT 1",
                params![slug],
                |x| x.get(0),
            )
            .optional()?,
    };
    if order.is_some() {
        return Ok(order);
    }
    match rank {
        Some(r) => rank_price(c, slug, r),
        None => Ok(c
            .query_row(
                "SELECT median_plat FROM price_cache WHERE slug = ?1",
                params![slug],
                |x| x.get(0),
            )
            .optional()?),
    }
}

// Recommended "best" sell price tuning.
const LOWBALL_FRAC: f64 = 0.7; // ignore a live floor this far below the normal trade median
const UNDERCUT: i64 = 1; // sit 1p under the robust low to be the cheapest reasonable seller

/// Pure decision for the recommended sell price from the two robust signals:
/// `robust_low` = median of the cheapest 5 online asks (`order_cache`), `median` =
/// robust trade median. When the live floor is being lowballed far below the normal
/// price, anchor to the normal price instead of chasing the troll down; then undercut
/// by 1 to be the cheapest reasonable seller. `None` only when there's no signal at all.
pub fn fair_from(robust_low: Option<i64>, median: Option<i64>) -> Option<i64> {
    let base = match (robust_low, median) {
        (Some(low), Some(med)) if (low as f64) < LOWBALL_FRAC * (med as f64) => med,
        (Some(low), _) => low,
        (None, Some(med)) => med,
        (None, None) => return None,
    };
    Some((base - UNDERCUT).max(1))
}

/// The recommended sell price for a slug at a given rank — undercut the robust live
/// low, but never chase lowballers below the normal trade median. Reuses the same
/// `order_cache` / `price_rank` / `price_cache` lookups as `effective_price`.
pub fn fair_sell_price(c: &Connection, slug: &str, rank: Option<i64>) -> AppResult<Option<i64>> {
    let robust_low: Option<i64> = match rank {
        Some(r) => c
            .query_row(
                "SELECT sell FROM order_cache WHERE slug = ?1 AND rank >= 0
                 ORDER BY ABS(rank - ?2) ASC, rank DESC LIMIT 1",
                params![slug, r],
                |x| x.get(0),
            )
            .optional()?,
        None => c
            .query_row(
                "SELECT sell FROM order_cache WHERE slug = ?1 AND rank IN (-1, 0)
                 ORDER BY rank ASC LIMIT 1",
                params![slug],
                |x| x.get(0),
            )
            .optional()?,
    };
    let median: Option<i64> = match rank {
        Some(r) => rank_price(c, slug, r)?,
        None => c
            .query_row(
                "SELECT median_plat FROM price_cache WHERE slug = ?1",
                params![slug],
                |x| x.get(0),
            )
            .optional()?,
    };
    Ok(fair_from(robust_low, median))
}

// --- Batched valuation lookups ---------------------------------------------
// `effective_price` does 1-2 queries per call; valuing a 800-item inventory ran
// it hundreds of times. `PriceMaps` preloads the same three tables for all owned
// slugs in three queries, and `effective_price_from` reproduces the exact
// nearest-rank logic in memory. Keep the two in lockstep.

/// Preloaded order/rank/headline tables for the owned set, so per-item valuation
/// needs no per-item queries.
#[derive(Default)]
pub struct PriceMaps {
    orders: HashMap<String, Vec<(i64, i64)>>, // slug -> [(rank, sell)] from order_cache
    ranks: HashMap<String, Vec<(i64, i64)>>,  // slug -> [(rank, median)] from price_rank
    headline: HashMap<String, i64>,           // slug -> price_cache.median_plat
}

/// Load `PriceMaps` for every owned item (qty > 0) in three joined queries.
pub fn load_owned_price_maps(c: &Connection) -> AppResult<PriceMaps> {
    let mut m = PriceMaps::default();
    let by_pair = |sql: &str, into: &mut HashMap<String, Vec<(i64, i64)>>| -> AppResult<()> {
        let mut stmt = c.prepare(sql)?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?;
        for row in rows {
            let (slug, a, b) = row?;
            into.entry(slug).or_default().push((a, b));
        }
        Ok(())
    };
    by_pair(
        "SELECT oc.slug, oc.rank, oc.sell FROM order_cache oc
         JOIN inventory_items ii ON ii.slug = oc.slug WHERE ii.qty > 0",
        &mut m.orders,
    )?;
    by_pair(
        "SELECT pr.slug, pr.rank, pr.median FROM price_rank pr
         JOIN inventory_items ii ON ii.slug = pr.slug WHERE ii.qty > 0",
        &mut m.ranks,
    )?;
    let mut stmt = c.prepare(
        "SELECT pc.slug, pc.median_plat FROM price_cache pc
         JOIN inventory_items ii ON ii.slug = pc.slug
         WHERE ii.qty > 0 AND pc.median_plat IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    for row in rows {
        let (slug, med) = row?;
        m.headline.insert(slug, med);
    }
    Ok(m)
}

/// `ORDER BY ABS(rank - target) ASC, rank DESC LIMIT 1` over `(rank, value)` pairs.
fn nearest(entries: &[(i64, i64)], target: i64) -> Option<i64> {
    entries
        .iter()
        .min_by(|a, b| {
            (a.0 - target)
                .abs()
                .cmp(&(b.0 - target).abs())
                .then(b.0.cmp(&a.0))
        })
        .map(|&(_, v)| v)
}

/// In-memory twin of [`effective_price`] — same precedence: live ask
/// (`order_cache`) → per-rank trade median (`price_rank`) → headline median.
pub fn effective_price_from(maps: &PriceMaps, slug: &str, rank: Option<i64>) -> Option<i64> {
    if let Some(orders) = maps.orders.get(slug) {
        let order = match rank {
            // exact/nearest non-negative rank, tie → higher rank
            Some(r) => nearest(
                &orders
                    .iter()
                    .copied()
                    .filter(|&(rk, _)| rk >= 0)
                    .collect::<Vec<_>>(),
                r,
            ),
            // non-ranked: rank -1 (true unranked) preferred over 0
            None => orders
                .iter()
                .filter(|&&(rk, _)| rk == -1 || rk == 0)
                .min_by_key(|&&(rk, _)| rk)
                .map(|&(_, sell)| sell),
        };
        if order.is_some() {
            return order;
        }
    }
    match rank {
        Some(r) => maps
            .ranks
            .get(slug)
            .and_then(|rs| nearest(rs, r))
            .or_else(|| maps.headline.get(slug).copied()),
        None => maps.headline.get(slug).copied(),
    }
}

/// Σ qty_r × effective per-rank price for a slug's owned rank breakdown, using
/// preloaded maps. `None` when the slug has no breakdown (callers fall back to the
/// non-ranked effective price). In-memory twin of inventory's `rank_aware_value`.
pub fn rank_aware_value_from(
    maps: &PriceMaps,
    slug: &str,
    breakdown: &[(i64, i64)],
) -> Option<i64> {
    if breakdown.is_empty() {
        return None;
    }
    Some(
        breakdown
            .iter()
            .map(|&(rank, qty)| effective_price_from(maps, slug, Some(rank)).unwrap_or(0) * qty)
            .sum(),
    )
}

/// Build the `?,?,…` placeholder list for an `IN (…)` clause of `n` items.
fn placeholders(n: usize) -> String {
    std::iter::repeat("?").take(n).collect::<Vec<_>>().join(",")
}

/// Bid ladders (price DESC) for many slugs in one query. Batched twin of
/// [`bid_ladder`]; absent slugs simply don't appear in the map.
pub fn bid_ladders_for(
    c: &Connection,
    slugs: &[String],
) -> AppResult<HashMap<String, Vec<(i64, i64)>>> {
    let mut out: HashMap<String, Vec<(i64, i64)>> = HashMap::new();
    if slugs.is_empty() {
        return Ok(out);
    }
    let sql = format!(
        "SELECT slug, price, qty FROM buy_orders WHERE slug IN ({})
         ORDER BY slug, price DESC",
        placeholders(slugs.len())
    );
    let mut stmt = c.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(slugs.iter()), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
        ))
    })?;
    for row in rows {
        let (slug, price, qty) = row?;
        out.entry(slug).or_default().push((price, qty));
    }
    Ok(out)
}

/// Like `bid_ladders_for`, but restricted to a single `rank`. Arcanes (and mods)
/// trade as distinct goods per rank — an unranked (rank-0) copy and a maxed copy
/// have separate demand curves — so a per-rank decision must only see its own bids.
/// (`bid_ladders_for` stays rank-agnostic for the general inventory path.)
pub fn bid_ladders_for_rank(
    c: &Connection,
    slugs: &[String],
    rank: i64,
) -> AppResult<HashMap<String, Vec<(i64, i64)>>> {
    let mut out: HashMap<String, Vec<(i64, i64)>> = HashMap::new();
    if slugs.is_empty() {
        return Ok(out);
    }
    let sql = format!(
        "SELECT slug, price, qty FROM buy_orders WHERE rank = ? AND slug IN ({})
         ORDER BY slug, price DESC",
        placeholders(slugs.len())
    );
    let mut stmt = c.prepare(&sql)?;
    let mut bind: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(slugs.len() + 1);
    bind.push(&rank);
    for s in slugs {
        bind.push(s);
    }
    let rows = stmt.query_map(bind.as_slice(), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
        ))
    })?;
    for row in rows {
        let (slug, price, qty) = row?;
        out.entry(slug).or_default().push((price, qty));
    }
    Ok(out)
}

/// Recent daily medians (≤12, chronological) for many slugs in one query.
/// Batched twin of inventory's `recent_medians`.
pub fn recent_medians_for(
    c: &Connection,
    slugs: &[String],
) -> AppResult<HashMap<String, Vec<i64>>> {
    let mut out: HashMap<String, Vec<i64>> = HashMap::new();
    if slugs.is_empty() {
        return Ok(out);
    }
    let sql = format!(
        "SELECT slug, median FROM price_history
         WHERE slug IN ({}) AND median IS NOT NULL AND median > 0
         ORDER BY slug, day DESC",
        placeholders(slugs.len())
    );
    let mut stmt = c.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(slugs.iter()), |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
    for row in rows {
        let (slug, median) = row?;
        let series = out.entry(slug).or_default();
        if series.len() < 12 {
            series.push(median); // collected DESC; reversed below
        }
    }
    for series in out.values_mut() {
        series.reverse(); // DESC fetch → chronological
                          // Clamp troll-print spikes the same way the cached trend % does
                          // (market.rs winsorizes before deriving delta_7d) — otherwise the
                          // sparkline draws a spike the number next to it deliberately ignores.
        super::trends::winsorize(series);
    }
    Ok(out)
}

/// Replace the cached order book for a slug: robust asks (`order_cache`) + the
/// online bid ladder (`buy_orders`).
pub fn store_order_book(
    db: &Db,
    slug: &str,
    sells: &[(i64, i64)],
    bids: &[(i64, i64, i64)],
) -> AppResult<()> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        tx.execute("DELETE FROM order_cache WHERE slug = ?1", params![slug])?;
        tx.execute("DELETE FROM buy_orders WHERE slug = ?1", params![slug])?;
        for (rank, sell) in sells {
            tx.execute(
                "INSERT INTO order_cache (slug, rank, sell, fetched_at) VALUES (?1, ?2, ?3, ?4)",
                params![slug, rank, sell, now],
            )?;
        }
        for (rank, price, qty) in bids {
            tx.execute(
                "INSERT INTO buy_orders (slug, rank, price, qty, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(slug, rank, price) DO UPDATE SET qty = excluded.qty",
                params![slug, rank, price, qty, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}

/// The online bid ladder for a slug (all ranks), best price first — the demand
/// curve a holding is liquidated into.
pub fn bid_ladder(c: &Connection, slug: &str) -> AppResult<Vec<(i64, i64)>> {
    let mut stmt =
        c.prepare("SELECT price, qty FROM buy_orders WHERE slug = ?1 ORDER BY price DESC")?;
    let rows = stmt.query_map(params![slug], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Owned slugs to fetch live sell orders for. The live order book is the reliable
/// price source (trade statistics are sparse/gameable), so we fetch it for ALL
/// owned items, not just suspected-illiquid ones. `fresh_cutoff` (RFC3339) skips
/// items whose order cache is newer than it — pass `now - ttl` for an incremental
/// launch refresh, or `now` to force-refetch everything.
pub fn owned_order_slugs(db: &Db, fresh_cutoff: &str) -> AppResult<Vec<String>> {
    db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT ii.slug FROM inventory_items ii
             WHERE ii.qty > 0
             AND NOT EXISTS (
                 SELECT 1 FROM order_cache oc WHERE oc.slug = ii.slug AND oc.fetched_at > ?1
             )",
        )?;
        let rows = stmt.query_map(params![fresh_cutoff], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// Per-rank market median for a mod/arcane at `rank`: the exact rank if priced,
/// else the nearest rank that is (tie → the higher rank). Falls back to the
/// headline `price_cache` median when there's no per-rank data. `None` only when
/// the item has no price at all.
pub fn rank_price(c: &Connection, slug: &str, rank: i64) -> AppResult<Option<i64>> {
    let exact_or_nearest: Option<i64> = c
        .query_row(
            "SELECT median FROM price_rank WHERE slug = ?1
             ORDER BY ABS(rank - ?2) ASC, rank DESC LIMIT 1",
            params![slug, rank],
            |r| r.get(0),
        )
        .optional()?;
    if exact_or_nearest.is_some() {
        return Ok(exact_or_nearest);
    }
    Ok(c.query_row(
        "SELECT median_plat FROM price_cache WHERE slug = ?1",
        params![slug],
        |r| r.get(0),
    )
    .optional()?)
}

/// One day of the real 90-day statistics series.
#[derive(Debug, Clone)]
pub struct DayStat {
    pub day: String,
    pub median: Option<i64>,
    pub volume: Option<i64>,
    pub open: Option<i64>,
    pub high: Option<i64>,
    pub low: Option<i64>,
    pub close: Option<i64>,
}

/// A fully-derived price record: the cache figures + the daily series that
/// produced them. Written transactionally (history + cache together).
pub struct PriceUpsert {
    pub slug: String,
    pub median_plat: i64,
    pub trend: String, // 'up' | 'flat' | 'down'
    pub delta_7d: Option<f64>,
    pub volume_7d: Option<i64>,
    pub ranks: Vec<(i64, i64)>, // (rank, median) for mods/arcanes; empty otherwise
    pub history: Vec<DayStat>,
}

pub fn upsert_many(db: &Db, prices: &[PriceUpsert], ttl: Duration) -> AppResult<usize> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        let now = Utc::now();
        let fetched_at = now.to_rfc3339();
        let expires_at = (now + ttl).to_rfc3339();
        {
            let mut cache_stmt = tx.prepare(
                "INSERT INTO price_cache (slug, median_plat, trend, delta_7d, volume_7d, fetched_at, expires_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(slug) DO UPDATE SET
                    median_plat = excluded.median_plat,
                    trend       = excluded.trend,
                    delta_7d    = excluded.delta_7d,
                    volume_7d   = excluded.volume_7d,
                    fetched_at  = excluded.fetched_at,
                    expires_at  = excluded.expires_at",
            )?;
            let mut hist_stmt = tx.prepare(
                "INSERT INTO price_history (slug, day, median, volume, open, high, low, close)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(slug, day) DO UPDATE SET
                    median = excluded.median,
                    volume = excluded.volume,
                    open   = excluded.open,
                    high   = excluded.high,
                    low    = excluded.low,
                    close  = excluded.close",
            )?;
            let mut rank_stmt = tx.prepare(
                "INSERT INTO price_rank (slug, rank, median) VALUES (?1, ?2, ?3)
                 ON CONFLICT(slug, rank) DO UPDATE SET median = excluded.median",
            )?;
            for p in prices {
                cache_stmt.execute(params![
                    p.slug,
                    p.median_plat,
                    p.trend,
                    p.delta_7d,
                    p.volume_7d,
                    fetched_at,
                    expires_at
                ])?;
                for d in &p.history {
                    hist_stmt.execute(params![
                        p.slug, d.day, d.median, d.volume, d.open, d.high, d.low, d.close
                    ])?;
                }
                for (rank, median) in &p.ranks {
                    rank_stmt.execute(params![p.slug, rank, median])?;
                }
            }
        }
        tx.commit()?;
        Ok(prices.len())
    })
}

/// Owned inventory slugs whose price is missing or stale. Refresh priority #1.
pub fn stale_inventory_slugs(db: &Db) -> AppResult<Vec<String>> {
    stale_for(db, "inventory_items")
}

/// Watchlist slugs whose price is missing or stale. Refresh priority #2.
pub fn stale_watchlist_slugs(db: &Db) -> AppResult<Vec<String>> {
    stale_for(db, "watchlist")
}

/// Slugs from `table` whose cached price is missing or was fetched before
/// `cutoff`, oldest-first — the live heartbeat's per-tier freshness query.
/// Tighter than `stale_*` (which only sees hard `expires_at` expiry), so the
/// heartbeat can keep watchlist/owned prices fresher than the cache TTL.
pub fn slugs_older_than(db: &Db, table: &str, cutoff: &str, limit: i64) -> AppResult<Vec<String>> {
    db.read(|c| {
        let sql = format!(
            "SELECT t.slug FROM {table} t
             LEFT JOIN price_cache pc ON pc.slug = t.slug
             WHERE pc.slug IS NULL OR pc.fetched_at < ?1
             ORDER BY pc.fetched_at IS NOT NULL, pc.fetched_at ASC
             LIMIT ?2"
        );
        let mut stmt = c.prepare(&sql)?;
        let rows = stmt.query_map(params![cutoff, limit], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

fn stale_for(db: &Db, table: &str) -> AppResult<Vec<String>> {
    db.read(|c| {
        let now = Utc::now().to_rfc3339();
        let sql = format!(
            "SELECT t.slug FROM {table} t
             LEFT JOIN price_cache pc ON pc.slug = t.slug
             WHERE pc.slug IS NULL OR pc.expires_at < ?1"
        );
        let mut stmt = c.prepare(&sql)?;
        let rows = stmt.query_map(params![now], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// Catalog slugs with no price or an expired one, oldest-first — the background
/// drain. `limit` caps a single batch.
pub fn stale_catalog_slugs(db: &Db, limit: i64) -> AppResult<Vec<String>> {
    db.read(|c| {
        let now = Utc::now().to_rfc3339();
        let mut stmt = c.prepare(
            "SELECT ci.slug FROM catalog_items ci
             LEFT JOIN price_cache pc ON pc.slug = ci.slug
             WHERE pc.slug IS NULL OR pc.expires_at < ?1
             ORDER BY pc.fetched_at IS NOT NULL, pc.fetched_at ASC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![now, limit], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// The stored daily history for one slug, oldest-first.
pub fn history(db: &Db, slug: &str, limit: i64) -> AppResult<Vec<HistoryPoint>> {
    db.read(|c| {
        // Pull the most recent `limit` days, then return them ascending.
        let mut stmt = c.prepare(
            "SELECT day, median, volume, open, high, low, close FROM (
                SELECT day, median, volume, open, high, low, close FROM price_history
                WHERE slug = ?1 ORDER BY day DESC LIMIT ?2
             ) ORDER BY day ASC",
        )?;
        let rows = stmt.query_map(params![slug, limit], |r| {
            Ok(HistoryPoint {
                day: r.get(0)?,
                median: r.get(1)?,
                volume: r.get(2)?,
                open: r.get(3)?,
                high: r.get(4)?,
                low: r.get(5)?,
                close: r.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    // Minimal schema covering exactly the columns the valuation queries read.
    fn fixture() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE inventory_items (slug TEXT PRIMARY KEY, qty INTEGER);
             CREATE TABLE order_cache (slug TEXT, rank INTEGER, sell INTEGER, PRIMARY KEY(slug,rank));
             CREATE TABLE price_rank (slug TEXT, rank INTEGER, median INTEGER, PRIMARY KEY(slug,rank));
             CREATE TABLE price_cache (slug TEXT PRIMARY KEY, median_plat INTEGER);",
        )
        .unwrap();
        c
    }

    // The recommended-price rule must undercut a healthy live floor but refuse to
    // chase lowballers below the normal trade median.
    #[test]
    fn fair_from_resists_lowballers() {
        // Healthy market: cheapest-5 median ~15, normal ~16 → undercut to 14.
        assert_eq!(fair_from(Some(15), Some(16)), Some(14));
        // One troll only nudges the median-of-5 a little (still ~15) → still ~14, not 4.
        assert_eq!(fair_from(Some(15), Some(16)), Some(14));
        // Many trolls drag the live floor far below normal (5 < 0.7*16) → anchor to 16 → 15.
        assert_eq!(fair_from(Some(5), Some(16)), Some(15));
        // No live asks → list at the normal price, undercut by 1.
        assert_eq!(fair_from(None, Some(18)), Some(17));
        // Rising market: live floor above the historical median → track the live floor.
        assert_eq!(fair_from(Some(40), Some(16)), Some(39));
        // Never below 1p, never None when any signal exists.
        assert_eq!(fair_from(Some(1), None), Some(1));
        assert_eq!(fair_from(None, None), None);
    }

    // Prove the in-memory `effective_price_from` is a faithful twin of the SQL
    // `effective_price` across every precedence path (live ask by rank, unranked
    // ask, per-rank median, headline fallback, nothing).
    #[test]
    fn effective_price_from_matches_sql() {
        let c = fixture();
        c.execute_batch(
            "INSERT INTO inventory_items VALUES
                ('liveask', 1), ('unranked', 1), ('rankmed', 1), ('headline', 1), ('nada', 1);
             -- live per-rank asks (nearest-rank, tie→higher)
             INSERT INTO order_cache VALUES ('liveask', 0, 100), ('liveask', 5, 140);
             -- true-unranked ask at rank -1, plus a rank-0 ask (−1 must win for None)
             INSERT INTO order_cache VALUES ('unranked', -1, 50), ('unranked', 0, 70);
             -- no ask → per-rank trade median
             INSERT INTO price_rank VALUES ('rankmed', 0, 30), ('rankmed', 10, 90);
             -- no ask, no per-rank → headline median
             INSERT INTO price_cache VALUES ('headline', 25), ('rankmed', 7), ('liveask', 9);",
        )
        .unwrap();

        let maps = load_owned_price_maps(&c).unwrap();
        let slugs = ["liveask", "unranked", "rankmed", "headline", "nada"];
        let ranks = [None, Some(0), Some(3), Some(5), Some(10)];
        for slug in slugs {
            for rank in ranks {
                let sql = effective_price(&c, slug, rank).unwrap();
                let mem = effective_price_from(&maps, slug, rank);
                assert_eq!(sql, mem, "slug={slug} rank={rank:?}");
            }
        }
    }

    #[test]
    fn rank_aware_value_from_sums_per_rank() {
        let c = fixture();
        c.execute_batch(
            "INSERT INTO inventory_items VALUES ('mod', 1);
             INSERT INTO order_cache VALUES ('mod', 0, 10), ('mod', 5, 40);",
        )
        .unwrap();
        let maps = load_owned_price_maps(&c).unwrap();
        // 2 @ rank0 (10) + 1 @ rank5 (40) = 60
        let total = rank_aware_value_from(&maps, "mod", &[(0, 2), (5, 1)]);
        assert_eq!(total, Some(60));
        // empty breakdown → None (caller falls back to non-ranked price)
        assert_eq!(rank_aware_value_from(&maps, "mod", &[]), None);
    }
}
