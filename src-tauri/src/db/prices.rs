use crate::db::Db;
use crate::error::AppResult;
use crate::types::HistoryPoint;
use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};

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

/// Replace the cached live-sell prices for a slug (per rank).
pub fn store_sell_prices(db: &Db, slug: &str, prices: &[(i64, i64)]) -> AppResult<()> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM order_cache WHERE slug = ?1", params![slug])?;
        let now = Utc::now().to_rfc3339();
        for (rank, sell) in prices {
            tx.execute(
                "INSERT INTO order_cache (slug, rank, sell, fetched_at) VALUES (?1, ?2, ?3, ?4)",
                params![slug, rank, sell, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}

/// Owned slugs to fetch live sell orders for. The live order book is the reliable
/// price source (trade statistics are sparse/gameable), so we fetch it for ALL
/// owned items, not just suspected-illiquid ones. `fresh_cutoff` (RFC3339) skips
/// items whose order cache is newer than it — pass `now - ttl` for an incremental
/// launch refresh, or `now` to force-refetch everything.
pub fn owned_order_slugs(db: &Db, fresh_cutoff: &str) -> AppResult<Vec<String>> {
    db.with(|c| {
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
    Ok(c
        .query_row(
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

fn stale_for(db: &Db, table: &str) -> AppResult<Vec<String>> {
    db.with(|c| {
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
    db.with(|c| {
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
    db.with(|c| {
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
