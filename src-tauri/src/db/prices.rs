use crate::db::Db;
use crate::error::AppResult;
use crate::types::HistoryPoint;
use chrono::{Duration, Utc};
use rusqlite::params;

/// One day of the real 90-day statistics series.
#[derive(Debug, Clone)]
pub struct DayStat {
    pub day: String,
    pub median: Option<i64>,
    pub volume: Option<i64>,
}

/// A fully-derived price record: the cache figures + the daily series that
/// produced them. Written transactionally (history + cache together).
pub struct PriceUpsert {
    pub slug: String,
    pub median_plat: i64,
    pub trend: String, // 'up' | 'flat' | 'down'
    pub delta_7d: Option<f64>,
    pub volume_7d: Option<i64>,
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
                "INSERT INTO price_history (slug, day, median, volume)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(slug, day) DO UPDATE SET
                    median = excluded.median,
                    volume = excluded.volume",
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
                    hist_stmt.execute(params![p.slug, d.day, d.median, d.volume])?;
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
            "SELECT day, median, volume FROM (
                SELECT day, median, volume FROM price_history
                WHERE slug = ?1 ORDER BY day DESC LIMIT ?2
             ) ORDER BY day ASC",
        )?;
        let rows = stmt.query_map(params![slug, limit], |r| {
            Ok(HistoryPoint {
                day: r.get(0)?,
                median: r.get(1)?,
                volume: r.get(2)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}
