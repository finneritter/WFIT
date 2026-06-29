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

/// Minimum per-unit suggested sell price (plat) for an owned item to surface in
/// the Listings → Recommended list. Below this it's not worth the trade hassle,
/// so it's hidden. User-tunable; defaults to `REC_MIN_PRICE_DEFAULT`.
pub const KEY_REC_MIN_PRICE: &str = "rec_min_sell_price";
pub const REC_MIN_PRICE_DEFAULT: i64 = 15;

/// The recommendation sell-price floor in plat (clamped ≥ 0; default when unset).
pub fn rec_min_price_conn(c: &Connection) -> AppResult<i64> {
    Ok(get_conn(c, KEY_REC_MIN_PRICE)?
        .and_then(|s| s.parse::<i64>().ok())
        .map(|n| n.max(0))
        .unwrap_or(REC_MIN_PRICE_DEFAULT))
}

pub fn rec_min_price(db: &Db) -> AppResult<i64> {
    db.read(rec_min_price_conn)
}

/// Desktop-notification preferences + the close-to-tray behavior toggle, stored
/// as one JSON blob (same approach as the per-category min-plat map above). The
/// backend `notify` engine reads this each tick; `close_to_tray` is also mirrored
/// into `AppState.close_to_tray` for the window-close handler.
pub const KEY_NOTIFICATION_PREFS: &str = "notification_prefs";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)] // missing fields fill from Default — adding a field can't break a stored blob
pub struct NotificationPrefs {
    pub master_enabled: bool,
    pub close_to_tray: bool,
    pub s_tier_arbitration: bool,
    pub void_cascade: bool,
    pub vendor_arrival: bool,
    pub daily_reset: bool,
    pub weekly_reset: bool,
}

impl Default for NotificationPrefs {
    fn default() -> Self {
        Self {
            master_enabled: true,
            close_to_tray: true, // the headline ask: closing hides to the tray
            s_tier_arbitration: true,
            void_cascade: true,
            vendor_arrival: true,
            daily_reset: false, // daily is noisy; opt-in
            weekly_reset: true,
        }
    }
}

pub fn notification_prefs_conn(c: &Connection) -> AppResult<NotificationPrefs> {
    Ok(get_conn(c, KEY_NOTIFICATION_PREFS)?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default())
}

pub fn notification_prefs(db: &Db) -> AppResult<NotificationPrefs> {
    db.read(notification_prefs_conn)
}

pub fn set_notification_prefs(db: &Db, prefs: &NotificationPrefs) -> AppResult<()> {
    let json = serde_json::to_string(prefs)?;
    set(db, KEY_NOTIFICATION_PREFS, &json)
}

/// The Void Cascade HUD overlay: a global-hotkey-triggered, always-on-top pill
/// that answers "is Cascade up?" without leaving the game. Stored as one JSON
/// blob (same approach as `NotificationPrefs`). `hotkey` is an accelerator string
/// in the `tauri-plugin-global-shortcut` grammar (e.g. "Alt+KeyC"). Read by the
/// `overlay` module on startup and whenever the setter re-registers the shortcut.
pub const KEY_OVERLAY_PREFS: &str = "overlay_prefs";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)] // missing fields fill from Default — adding a field can't break a stored blob
pub struct OverlayPrefs {
    pub enabled: bool,
    pub hotkey: String,
    pub duration_secs: u32,
}

impl Default for OverlayPrefs {
    fn default() -> Self {
        Self {
            // Off by default: a global key-grab is intrusive, so the user opts in.
            enabled: false,
            hotkey: "Alt+KeyC".into(), // C for Cascade; Alt rarely clashes with games
            duration_secs: 6,
        }
    }
}

pub fn overlay_prefs_conn(c: &Connection) -> AppResult<OverlayPrefs> {
    Ok(get_conn(c, KEY_OVERLAY_PREFS)?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default())
}

pub fn overlay_prefs(db: &Db) -> AppResult<OverlayPrefs> {
    db.read(overlay_prefs_conn)
}

pub fn set_overlay_prefs(db: &Db, prefs: &OverlayPrefs) -> AppResult<()> {
    let json = serde_json::to_string(prefs)?;
    set(db, KEY_OVERLAY_PREFS, &json)
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
