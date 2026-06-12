use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::types::BuyRow;
use chrono::Utc;
use rusqlite::params;

pub fn add(db: &Db, slug: &str, buy_qty: i64) -> AppResult<()> {
    if buy_qty <= 0 {
        return Err(AppError::Invalid("buy_qty must be > 0".into()));
    }
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
            "INSERT INTO buy_list (slug, buy_qty, added_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(slug) DO UPDATE SET buy_qty = buy_list.buy_qty + ?2",
            params![slug, buy_qty, now],
        )?;
        Ok(())
    })
}

pub fn set_qty(db: &Db, slug: &str, buy_qty: i64) -> AppResult<()> {
    db.with(|c| {
        if buy_qty <= 0 {
            c.execute("DELETE FROM buy_list WHERE slug = ?1", params![slug])?;
            return Ok(());
        }
        c.execute(
            "UPDATE buy_list SET buy_qty = ?2 WHERE slug = ?1",
            params![slug, buy_qty],
        )?;
        Ok(())
    })
}

pub fn remove(db: &Db, slug: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM buy_list WHERE slug = ?1", params![slug])?;
        Ok(())
    })
}

/// "Bought": move a buy-list line into inventory and drop it from the list.
pub fn purchase(db: &Db, slug: &str) -> AppResult<i64> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        let buy_qty: i64 = tx
            .query_row(
                "SELECT buy_qty FROM buy_list WHERE slug = ?1",
                params![slug],
                |r| r.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("not on buy list: {slug}"))
                }
                other => AppError::Sqlite(other),
            })?;
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at, source)
             VALUES (?1, ?2, ?3, ?3, 'manual')
             ON CONFLICT(slug) DO UPDATE SET
                qty = inventory_items.qty + ?2,
                last_modified_at = ?3",
            params![slug, buy_qty, now],
        )?;
        tx.execute("DELETE FROM buy_list WHERE slug = ?1", params![slug])?;
        let new_qty: i64 = tx.query_row(
            "SELECT qty FROM inventory_items WHERE slug = ?1",
            params![slug],
            |r| r.get(0),
        )?;
        tx.commit()?;
        Ok(new_qty)
    })
}

pub fn list(db: &Db) -> AppResult<Vec<BuyRow>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT b.slug, ci.display_name, ci.part_type, ci.category,
                    pc.median_plat, pc.trend, ci.is_vaulted, b.buy_qty, ci.thumbnail_url, b.added_at
             FROM buy_list b
             JOIN catalog_items ci ON ci.slug = b.slug
             LEFT JOIN price_cache pc ON pc.slug = b.slug
             ORDER BY ci.display_name ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(BuyRow {
                slug: r.get(0)?,
                display_name: r.get(1)?,
                part_type: r.get(2)?,
                category: r.get(3)?,
                median_plat: r.get(4)?,
                trend: r.get(5)?,
                is_vaulted: r.get::<_, i64>(6)? != 0,
                buy_qty: r.get(7)?,
                thumbnail_url: r.get(8)?,
                added_at: r.get(9)?,
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
    use crate::db::testutil::{seed_item, test_db};

    #[test]
    fn add_accumulates_and_set_qty_zero_removes() {
        let db = test_db("buy-add");
        seed_item(&db, "wisp_prime_set", "set", Some(120));
        add(&db, "wisp_prime_set", 1).unwrap();
        add(&db, "wisp_prime_set", 2).unwrap(); // accumulates, not replaces
        assert_eq!(list(&db).unwrap()[0].buy_qty, 3);
        set_qty(&db, "wisp_prime_set", 0).unwrap();
        assert!(list(&db).unwrap().is_empty());
        assert!(add(&db, "unknown_slug", 1).is_err());
    }

    #[test]
    fn purchase_moves_the_line_into_inventory() {
        let db = test_db("buy-purchase");
        seed_item(&db, "nova_prime_set", "set", Some(55));
        add(&db, "nova_prime_set", 2).unwrap();
        purchase(&db, "nova_prime_set").unwrap();
        assert!(
            list(&db).unwrap().is_empty(),
            "purchased line leaves the buy list"
        );
        // A set purchase lands as owned parts/sets — assert SOMETHING was added.
        let owned: i64 = db
            .read(|c| {
                Ok(c.query_row(
                    "SELECT COALESCE(SUM(qty),0) FROM inventory_items",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert!(
            owned >= 2,
            "expected inventory rows after purchase, got {owned}"
        );
    }
}
