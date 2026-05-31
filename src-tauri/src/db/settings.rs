use crate::db::Db;
use crate::error::AppResult;
use rusqlite::params;

/// app_settings is a simple key/value store for user preferences (budget,
/// density/accent, "include all mods" toggle). Distinct from app_meta, which
/// holds machine state like last-sync timestamps.
pub fn get(db: &Db, key: &str) -> AppResult<Option<String>> {
    db.with(|c| {
        let v: Option<String> = c
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
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
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    })
}

pub const KEY_BUDGET: &str = "budget";
