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
/// the current cached median. Returns the new inventory qty.
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
                sale.notes
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

/// Sell a complete set: verify each member part is owned, decrement one of each
/// by `qty`, and record a single sale_events row against the set slug (priced at
/// the set median). Returns `qty` sold.
pub fn record_set(
    db: &Db,
    set_slug: &str,
    members: &[String],
    qty: i64,
    plat_per_unit: Option<i64>,
    notes: Option<String>,
) -> AppResult<i64> {
    if qty <= 0 {
        return Err(AppError::Invalid("qty must be > 0".into()));
    }
    if members.is_empty() {
        return Err(AppError::Invalid("unknown set composition".into()));
    }
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        for m in members {
            let q: i64 = tx
                .query_row(
                    "SELECT qty FROM inventory_items WHERE slug = ?1",
                    params![m],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if q < qty {
                return Err(AppError::Invalid(format!(
                    "incomplete set — not enough {m}"
                )));
            }
        }
        let set_median: Option<i64> = tx
            .query_row(
                "SELECT median_plat FROM price_cache WHERE slug = ?1",
                params![set_slug],
                |r| r.get(0),
            )
            .ok();
        let plat = plat_per_unit.or(set_median);
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO sale_events
                (slug, qty, plat_per_unit, market_median_at_sale_time, sold_at, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![set_slug, qty, plat, set_median, now, notes],
        )?;
        for m in members {
            let q: i64 = tx
                .query_row(
                    "SELECT qty FROM inventory_items WHERE slug = ?1",
                    params![m],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let nq = q - qty;
            if nq <= 0 {
                tx.execute("DELETE FROM inventory_items WHERE slug = ?1", params![m])?;
            } else {
                tx.execute(
                    "UPDATE inventory_items SET qty = ?1, last_modified_at = ?2 WHERE slug = ?3",
                    params![nq, now, m],
                )?;
            }
        }
        tx.commit()?;
        Ok(qty)
    })
}

/// Undo a sale recorded today: delete the event and add its qty back to inventory.
/// Restricted to same-UTC-day rows so the ledger stays trustworthy.
pub fn undo(db: &Db, id: i64) -> AppResult<()> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        let (slug, qty, sold_at): (String, i64, String) = tx
            .query_row(
                "SELECT slug, qty, sold_at FROM sale_events WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("no sale with id {id}"))
                }
                other => AppError::Sqlite(other),
            })?;

        let today = Utc::now().format("%Y-%m-%d").to_string();
        if !sold_at.starts_with(&today) {
            return Err(AppError::Invalid("can only undo sales from today".into()));
        }

        tx.execute("DELETE FROM sale_events WHERE id = ?1", params![id])?;
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at, source)
             VALUES (?1, ?2, ?3, ?3, 'manual')
             ON CONFLICT(slug) DO UPDATE SET
                qty = inventory_items.qty + ?2,
                last_modified_at = ?3",
            params![slug, qty, now],
        )?;
        tx.commit()?;
        Ok(())
    })
}

pub fn list_recent(db: &Db, limit: i64) -> AppResult<Vec<SaleRow>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT se.id, se.slug, ci.display_name, ci.category, se.qty, se.plat_per_unit,
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
                category: r.get(3)?,
                qty: r.get(4)?,
                plat_per_unit: r.get(5)?,
                market_median_at_sale_time: r.get(6)?,
                sold_at: r.get(7)?,
                notes: r.get(8)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// Total plat earned within the last `days` days (for the Sold·7d stat).
pub fn earned_since(db: &Db, days: i64) -> AppResult<i64> {
    db.with(|c| {
        let cutoff = (Utc::now() - chrono::Duration::days(days)).to_rfc3339();
        let total: i64 = c.query_row(
            "SELECT COALESCE(SUM(COALESCE(plat_per_unit, 0) * qty), 0)
             FROM sale_events WHERE sold_at >= ?1",
            params![cutoff],
            |r| r.get(0),
        )?;
        Ok(total)
    })
}
