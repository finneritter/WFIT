use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::types::WatchRow;
use chrono::Utc;
use rusqlite::params;

pub fn add(db: &Db, slug: &str, target_plat: Option<i64>) -> AppResult<()> {
    db.with(|c| {
        let exists: i64 = c.query_row(
            "SELECT COUNT(*) FROM catalog_items WHERE slug = ?1",
            params![slug],
            |r| r.get(0),
        )?;
        if exists == 0 {
            return Err(AppError::NotFound(format!("unknown slug: {slug}")));
        }
        let now = Utc::now().to_rfc3339();
        c.execute(
            "INSERT INTO watchlist (slug, target_plat, added_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(slug) DO UPDATE SET target_plat = COALESCE(excluded.target_plat, watchlist.target_plat)",
            params![slug, target_plat, now],
        )?;
        Ok(())
    })
}

pub fn remove(db: &Db, slug: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM watchlist WHERE slug = ?1", params![slug])?;
        Ok(())
    })
}

pub fn set_target(db: &Db, slug: &str, target_plat: Option<i64>) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "UPDATE watchlist SET target_plat = ?2 WHERE slug = ?1",
            params![slug, target_plat],
        )?;
        Ok(())
    })
}

pub fn list(db: &Db) -> AppResult<Vec<WatchRow>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT w.slug, ci.display_name, ci.part_type, ci.category,
                    pc.median_plat, pc.trend, pc.delta_7d, w.target_plat,
                    ci.is_vaulted, ci.thumbnail_url, w.added_at
             FROM watchlist w
             JOIN catalog_items ci ON ci.slug = w.slug
             LEFT JOIN price_cache pc ON pc.slug = w.slug
             ORDER BY ci.display_name ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(WatchRow {
                slug: r.get(0)?,
                display_name: r.get(1)?,
                part_type: r.get(2)?,
                category: r.get(3)?,
                median_plat: r.get(4)?,
                trend: r.get(5)?,
                delta_7d: r.get(6)?,
                target_plat: r.get(7)?,
                is_vaulted: r.get::<_, i64>(8)? != 0,
                thumbnail_url: r.get(9)?,
                added_at: r.get(10)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn is_watched(db: &Db, slug: &str) -> AppResult<bool> {
    db.with(|c| {
        let n: i64 = c.query_row(
            "SELECT COUNT(*) FROM watchlist WHERE slug = ?1",
            params![slug],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    })
}

/// Count of watched items whose current price is at or below the target.
pub fn at_target_count(db: &Db) -> AppResult<i64> {
    db.with(|c| {
        let n: i64 = c.query_row(
            "SELECT COUNT(*) FROM watchlist w
             JOIN price_cache pc ON pc.slug = w.slug
             WHERE w.target_plat IS NOT NULL AND pc.median_plat <= w.target_plat",
            [],
            |r| r.get(0),
        )?;
        Ok(n)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::testutil::{seed_item, test_db};

    #[test]
    fn add_list_target_remove_roundtrip() {
        let db = test_db("watch-roundtrip");
        seed_item(&db, "volt_prime_set", "set", Some(80));

        add(&db, "volt_prime_set", Some(70)).unwrap();
        assert!(is_watched(&db, "volt_prime_set").unwrap());
        let rows = list(&db).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].target_plat, Some(70));
        // median 80 > target 70 → not at target yet
        assert_eq!(at_target_count(&db).unwrap(), 0);

        // Raising the target above the median flips the at-target signal.
        set_target(&db, "volt_prime_set", Some(90)).unwrap();
        assert_eq!(at_target_count(&db).unwrap(), 1);

        remove(&db, "volt_prime_set").unwrap();
        assert!(!is_watched(&db, "volt_prime_set").unwrap());
        assert!(list(&db).unwrap().is_empty());
    }
}
