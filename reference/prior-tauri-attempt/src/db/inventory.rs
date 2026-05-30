use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::types::InventoryRow;
use chrono::Utc;
use rusqlite::params;

pub fn add(db: &Db, slug: &str, qty: i64) -> AppResult<i64> {
    if qty <= 0 {
        return Err(AppError::Invalid("qty must be > 0".into()));
    }
    db.with(|c| {
        // catalog must exist for this slug
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
            "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(slug) DO UPDATE SET
                qty = inventory_items.qty + ?2,
                last_modified_at = ?3",
            params![slug, qty, now],
        )?;
        let new_qty: i64 = c.query_row(
            "SELECT qty FROM inventory_items WHERE slug = ?1",
            params![slug],
            |r| r.get(0),
        )?;
        Ok(new_qty)
    })
}

pub fn set_qty(db: &Db, slug: &str, qty: i64) -> AppResult<i64> {
    if qty < 0 {
        return Err(AppError::Invalid("qty must be >= 0".into()));
    }
    db.with(|c| {
        let now = Utc::now().to_rfc3339();
        if qty == 0 {
            c.execute(
                "DELETE FROM inventory_items WHERE slug = ?1",
                params![slug],
            )?;
            return Ok(0);
        }
        c.execute(
            "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(slug) DO UPDATE SET
                qty = ?2,
                last_modified_at = ?3",
            params![slug, qty, now],
        )?;
        Ok(qty)
    })
}

pub fn remove(db: &Db, slug: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "DELETE FROM inventory_items WHERE slug = ?1",
            params![slug],
        )?;
        Ok(())
    })
}

pub fn list_ranked(db: &Db) -> AppResult<Vec<InventoryRow>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT
                ci.slug, ci.display_name, ci.part_type, ci.set_slug,
                ii.qty, ci.ducats, ci.is_vaulted,
                pc.median_plat, pc.trend, ci.thumbnail_url, ii.last_modified_at
             FROM inventory_items ii
             JOIN catalog_items ci ON ci.slug = ii.slug
             LEFT JOIN price_cache pc ON pc.slug = ii.slug
             WHERE ii.qty > 0
             ORDER BY COALESCE(pc.median_plat, 0) * ii.qty DESC, ci.display_name ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(InventoryRow {
                slug: r.get(0)?,
                display_name: r.get(1)?,
                part_type: r.get(2)?,
                set_slug: r.get(3)?,
                qty: r.get(4)?,
                ducats: r.get(5)?,
                is_vaulted: r.get::<_, i64>(6)? != 0,
                median_plat: r.get(7)?,
                trend: r.get(8)?,
                thumbnail_url: r.get(9)?,
                last_modified_at: r.get(10)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    })
}
