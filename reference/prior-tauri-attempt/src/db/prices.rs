use crate::db::Db;
use crate::error::AppResult;
use chrono::{Duration, Utc};
use rusqlite::params;

pub struct PriceUpsert {
    pub slug: String,
    pub median_plat: i64,
    pub trend: String, // 'up' | 'flat' | 'down'
}

pub fn upsert_many(db: &Db, prices: &[PriceUpsert], ttl: Duration) -> AppResult<usize> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        let now = Utc::now();
        let fetched_at = now.to_rfc3339();
        let expires_at = (now + ttl).to_rfc3339();
        {
            let mut stmt = tx.prepare(
                "INSERT INTO price_cache (slug, median_plat, trend, fetched_at, expires_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(slug) DO UPDATE SET
                    median_plat = excluded.median_plat,
                    trend       = excluded.trend,
                    fetched_at  = excluded.fetched_at,
                    expires_at  = excluded.expires_at",
            )?;
            for p in prices {
                stmt.execute(params![p.slug, p.median_plat, p.trend, fetched_at, expires_at])?;
            }
        }
        tx.commit()?;
        Ok(prices.len())
    })
}

pub fn stale_slugs(db: &Db) -> AppResult<Vec<String>> {
    db.with(|c| {
        let now = Utc::now().to_rfc3339();
        let mut stmt = c.prepare(
            "SELECT ii.slug FROM inventory_items ii
             LEFT JOIN price_cache pc ON pc.slug = ii.slug
             WHERE pc.slug IS NULL OR pc.expires_at < ?1",
        )?;
        let rows = stmt.query_map(params![now], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}
