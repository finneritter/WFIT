use crate::db::Db;
use crate::error::AppResult;
use rusqlite::{params, Connection};

/// app_settings is a simple key/value store for user preferences (budget,
/// density/accent, "include all mods" toggle). Distinct from app_meta, which
/// holds machine state like last-sync timestamps.
///
/// Reads run on the pooled read connections (`db.read` / the `_conn` twins) so
/// hot paths like `owned_holdings` never queue behind the writer mutex during a
/// sync; only `set` takes the writer.
pub fn get_conn(c: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(c.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .ok())
}

pub fn get(db: &Db, key: &str) -> AppResult<Option<String>> {
    db.read(|c| get_conn(c, key))
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
pub fn excluded_min_plat_conn(c: &Connection) -> AppResult<i64> {
    Ok(get_conn(c, KEY_EXCLUDED_MIN_PLAT)?
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0))
}

pub fn excluded_min_plat(db: &Db) -> AppResult<i64> {
    db.read(excluded_min_plat_conn)
}

/// Per-category cheap-item floor: items in a category whose unit price is at or
/// below its threshold are dropped from the portfolio value (and dimmed in the
/// grid). Stored as a JSON object `{ "mod": 2, "arcane": 5, … }`; 0/absent = off.
pub const KEY_EXCLUDED_MIN_PLAT_BY_CAT: &str = "excluded_min_plat_by_cat";

/// The per-category min-plat thresholds (category → plat floor). Empty when unset.
pub fn excluded_min_plat_by_cat_conn(
    c: &Connection,
) -> AppResult<std::collections::HashMap<String, i64>> {
    Ok(get_conn(c, KEY_EXCLUDED_MIN_PLAT_BY_CAT)?
        .and_then(|s| serde_json::from_str::<std::collections::HashMap<String, i64>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, v)| *v > 0)
        .collect())
}

pub fn excluded_min_plat_by_cat(db: &Db) -> AppResult<std::collections::HashMap<String, i64>> {
    db.read(excluded_min_plat_by_cat_conn)
}

/// Parsed list of excluded mod rarities (lowercase canonical slugs).
pub fn excluded_rarities_conn(c: &Connection) -> AppResult<Vec<String>> {
    Ok(get_conn(c, KEY_EXCLUDED_RARITIES)?
        .map(|s| {
            s.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default())
}

pub fn excluded_rarities(db: &Db) -> AppResult<Vec<String>> {
    db.read(excluded_rarities_conn)
}
