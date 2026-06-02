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

/// Mod rarities the user excludes from portfolio valuation, stored as a CSV of
/// canonical rarity slugs (e.g. "common,uncommon"). Empty/unset = exclude nothing.
pub const KEY_EXCLUDED_RARITIES: &str = "excluded_mod_rarities";

/// Bump when the bundled mod-rarity dataset changes to force a one-time re-backfill.
pub const KEY_MOD_RARITY_VER: &str = "mod_rarity_ver";

/// Value floor (plat) for the rarity exclusion: a mod of an excluded rarity is kept
/// when its unit price is ≥ this. 0 = no floor (exclude the whole rarity).
pub const KEY_EXCLUDED_MIN_PLAT: &str = "excluded_min_plat";

/// The exclusion value floor in plat (0 when unset / disabled).
pub fn excluded_min_plat(db: &Db) -> AppResult<i64> {
    Ok(get(db, KEY_EXCLUDED_MIN_PLAT)?
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0))
}

/// Parsed list of excluded mod rarities (lowercase canonical slugs).
pub fn excluded_rarities(db: &Db) -> AppResult<Vec<String>> {
    Ok(get(db, KEY_EXCLUDED_RARITIES)?
        .map(|s| {
            s.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default())
}
