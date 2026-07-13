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
/// Version marker of the set-membership pass. "2" = per-part quantity_in_set
/// from /v2/items/<slug>/set (the v1 pass parsed nothing — camelCase bug). On
/// launch a mismatch schedules a background re-pass so quantity-aware set
/// completion (issue #1) works without the user re-running "Update game data".
pub const KEY_SET_MEMBERSHIP_PASS: &str = "set_membership_pass";
pub const KEY_LAST_PRICE_SYNC: &str = "last_price_sync";
/// Stamp of the last vault-status sync from warframe-items (long TTL).
pub const KEY_LAST_VAULT_SYNC: &str = "last_vault_sync";
/// Stamp of the last relic-data refresh from WFCD Relics.json (manual, via
/// "Update game data").
pub const KEY_LAST_RELIC_SYNC: &str = "last_relic_sync";
/// Version marker of the bundled relic TSVs. When the code's RELIC_BUNDLE_VERSION
/// differs (i.e. an app update shipped newer bundled relic data), the relic DB tables
/// are re-seeded from the bundle on the next launch — so a binary update refreshes the
/// baseline even if the user never clicks "Update game data".
pub const KEY_RELIC_BUNDLE_VERSION: &str = "relic_bundle_version";
/// Version marker of the bundled item_manifest.tsv. Re-seeds the item_manifest table
/// from the bundle on launch when the code's ITEM_MANIFEST_BUNDLE_VERSION differs.
pub const KEY_ITEM_MANIFEST_BUNDLE_VERSION: &str = "item_manifest_bundle_version";
/// Stamp of the last item-manifest refresh from WFCD (manual, via "Update game data").
pub const KEY_LAST_MANIFEST_SYNC: &str = "last_manifest_sync";
/// Stamp of the last account-snapshot scan (game scan → account_* tables).
pub const KEY_LAST_ACCOUNT_SCAN: &str = "last_account_scan";
/// Stamp of the last riven reference (weapons + attributes) refresh from
/// warframe.market v2. Long TTL — disposition only changes per Prime Access.
pub const KEY_LAST_RIVEN_REF_SYNC: &str = "last_riven_ref_sync";
/// Stamp of the pricing logic that produced the cached prices. When the code's
/// PRICING_VERSION differs, the derived price caches are wiped and recomputed —
/// so changes to how prices are derived take effect on the next launch without a
/// manual rebuild, instead of stale values surviving behind the TTL.
pub const KEY_PRICING_VERSION: &str = "pricing_version";
