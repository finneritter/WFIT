//! Manual vendor check-offs — "I've already grabbed this from that vendor".
//! Mirrors the watchlist/buylist pattern: a small user-owned table, not a cache.
//! Only manual checks are stored; ownership-derived checks come live from
//! `inventory_items` in `db::vendor::enrich`, so game-scan imports need no write here.

use crate::db::Db;
use crate::error::AppResult;
use chrono::Utc;
use rusqlite::params;
use std::collections::HashSet;

/// Mark an item as grabbed from a vendor (idempotent).
pub fn set(db: &Db, vendor_key: &str, item_ref: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO vendor_checkoff (vendor_key, item_ref, checked_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(vendor_key, item_ref) DO NOTHING",
            params![vendor_key, item_ref, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    })
}

/// Clear a single manual check.
pub fn unset(db: &Db, vendor_key: &str, item_ref: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "DELETE FROM vendor_checkoff WHERE vendor_key = ?1 AND item_ref = ?2",
            params![vendor_key, item_ref],
        )?;
        Ok(())
    })
}

/// Clear every manual check for a vendor (the column's "Clear" button).
pub fn clear(db: &Db, vendor_key: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "DELETE FROM vendor_checkoff WHERE vendor_key = ?1",
            params![vendor_key],
        )?;
        Ok(())
    })
}

/// The set of manually-checked `item_ref`s for a vendor, used by enrich.
pub fn set_for(db: &Db, vendor_key: &str) -> AppResult<HashSet<String>> {
    db.read(|c| {
        let mut stmt = c.prepare("SELECT item_ref FROM vendor_checkoff WHERE vendor_key = ?1")?;
        let rows = stmt.query_map(params![vendor_key], |r| r.get::<_, String>(0))?;
        let mut out = HashSet::new();
        for r in rows {
            out.insert(r?);
        }
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::testutil::test_db;

    #[test]
    fn set_clear_roundtrip() {
        let db = test_db("vendor-checkoff");
        set(&db, "baro", "/Lotus/Types/Item/A").unwrap();
        set(&db, "baro", "/Lotus/Types/Item/A").unwrap(); // idempotent
        set(&db, "baro", "ash_prime_set").unwrap();
        set(&db, "varzia", "mag_prime_set").unwrap();

        let baro = set_for(&db, "baro").unwrap();
        assert_eq!(baro.len(), 2);
        assert!(baro.contains("ash_prime_set"));
        assert_eq!(set_for(&db, "varzia").unwrap().len(), 1);

        unset(&db, "baro", "ash_prime_set").unwrap();
        assert_eq!(set_for(&db, "baro").unwrap().len(), 1);

        clear(&db, "baro").unwrap();
        assert!(set_for(&db, "baro").unwrap().is_empty());
        assert_eq!(set_for(&db, "varzia").unwrap().len(), 1); // other vendor untouched
    }
}
