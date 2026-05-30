use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::types::SaleRow;
use chrono::Utc;
use rusqlite::params;

pub struct SaleRecord {
    pub slug: String,
    pub qty: i64,
    pub plat_per_unit: Option<i64>,
    pub notes: Option<String>,
}

/// Record a sale: writes a sale_events row, decrements inventory.qty, snapshots
/// the current cached median for the item. Returns the new inventory qty.
pub fn record(db: &Db, sale: SaleRecord) -> AppResult<i64> {
    if sale.qty <= 0 {
        return Err(AppError::Invalid("qty must be > 0".into()));
    }
    db.with_mut(|conn| {
        let tx = conn.transaction()?;

        let cur_qty: i64 = tx
            .query_row(
                "SELECT qty FROM inventory_items WHERE slug = ?1",
                params![sale.slug],
                |r| r.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("not in inventory: {}", sale.slug))
                }
                other => AppError::Sqlite(other),
            })?;
        if cur_qty < sale.qty {
            return Err(AppError::Invalid(format!(
                "can't sell {} (have {})",
                sale.qty, cur_qty
            )));
        }

        let cached_median: Option<i64> = tx
            .query_row(
                "SELECT median_plat FROM price_cache WHERE slug = ?1",
                params![sale.slug],
                |r| r.get(0),
            )
            .ok();
        let plat_per_unit = sale.plat_per_unit.or(cached_median);
        let now = Utc::now().to_rfc3339();

        tx.execute(
            "INSERT INTO sale_events
                (slug, qty, plat_per_unit, market_median_at_sale_time, sold_at, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                sale.slug,
                sale.qty,
                plat_per_unit,
                cached_median,
                now,
                sale.notes,
            ],
        )?;

        let new_qty = cur_qty - sale.qty;
        if new_qty == 0 {
            tx.execute(
                "DELETE FROM inventory_items WHERE slug = ?1",
                params![sale.slug],
            )?;
        } else {
            tx.execute(
                "UPDATE inventory_items SET qty = ?1, last_modified_at = ?2 WHERE slug = ?3",
                params![new_qty, now, sale.slug],
            )?;
        }
        tx.commit()?;
        Ok(new_qty)
    })
}

pub fn list_recent(db: &Db, limit: i64) -> AppResult<Vec<SaleRow>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT se.id, se.slug, ci.display_name, se.qty, se.plat_per_unit,
                    se.market_median_at_sale_time, se.sold_at, se.notes
             FROM sale_events se
             JOIN catalog_items ci ON ci.slug = se.slug
             ORDER BY se.sold_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            Ok(SaleRow {
                id: r.get(0)?,
                slug: r.get(1)?,
                display_name: r.get(2)?,
                qty: r.get(3)?,
                plat_per_unit: r.get(4)?,
                market_median_at_sale_time: r.get(5)?,
                sold_at: r.get(6)?,
                notes: r.get(7)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}
