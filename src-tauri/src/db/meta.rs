use crate::db::Db;
use crate::error::AppResult;
use rusqlite::params;

pub fn get(db: &Db, key: &str) -> AppResult<Option<String>> {
    db.with(|c| {
        let v: Option<String> = c
            .query_row(
                "SELECT value FROM app_meta WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .ok();
        Ok(v)
    })
}

pub fn set(db: &Db, key: &str, value: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    })
}

pub const KEY_LAST_CATALOG_SYNC: &str = "last_catalog_sync";
pub const KEY_LAST_PRICE_SYNC: &str = "last_price_sync";
/// Stamp of the pricing logic that produced the cached prices. When the code's
/// PRICING_VERSION differs, the derived price caches are wiped and recomputed —
/// so changes to how prices are derived take effect on the next launch without a
/// manual rebuild, instead of stale values surviving behind the TTL.
pub const KEY_PRICING_VERSION: &str = "pricing_version";
