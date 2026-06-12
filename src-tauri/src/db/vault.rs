//! Vault status — which Primes are currently vaulted. warframe.market exposes none,
//! so we source it from the WFCD `warframe-items` dataset, keyed by the game
//! `uniqueName` (== our `catalog_items.game_ref`). It's dynamic (DE rotates the
//! vault), so we refresh from the network on a long TTL with a bundled offline
//! fallback, then apply it onto `catalog_items.is_vaulted`: set rows by game_ref,
//! propagated to member parts via set_slug.
use crate::db::{meta, Db};
use crate::error::AppResult;
use chrono::{DateTime, Duration, Utc};
use rusqlite::params;
use serde::Deserialize;

const VAULT_URL: &str =
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/All.json";
const VAULT_TTL_DAYS: i64 = 30;
/// Offline fallback snapshot (`game_ref \t 0|1`), generated from warframe-items.
const BUNDLED: &str = include_str!("../domain/data/vault.tsv");

#[derive(Deserialize)]
struct WfItem {
    #[serde(rename = "uniqueName")]
    unique_name: Option<String>,
    vaulted: Option<bool>,
}

fn bundled_map() -> Vec<(String, bool)> {
    BUNDLED
        .lines()
        .filter_map(|l| l.split_once('\t'))
        .map(|(k, v)| (k.to_string(), v.trim() == "1"))
        .collect()
}

/// Live map from warframe-items — every item carrying a `vaulted` flag. One ~53 MB
/// request, but TTL-gated to ~monthly so it almost always no-ops.
async fn fetch_remote() -> AppResult<Vec<(String, bool)>> {
    let http = reqwest::Client::builder()
        .user_agent(crate::USER_AGENT)
        .timeout(std::time::Duration::from_secs(120))
        .build()?;
    let bytes = http
        .get(VAULT_URL)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    let items: Vec<WfItem> = serde_json::from_slice(&bytes)?;
    Ok(items
        .into_iter()
        .filter_map(|it| match (it.unique_name, it.vaulted) {
            (Some(n), Some(v)) => Some((n, v)),
            _ => None,
        })
        .collect())
}

fn store_map(db: &Db, map: &[(String, bool)]) -> AppResult<()> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO vault_status (game_ref, vaulted) VALUES (?1, ?2)
                 ON CONFLICT(game_ref) DO UPDATE SET vaulted = excluded.vaulted",
            )?;
            for (gr, v) in map {
                stmt.execute(params![gr, *v as i64])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

fn is_empty(db: &Db) -> AppResult<bool> {
    db.with(|c| {
        let n: i64 = c.query_row("SELECT COUNT(*) FROM vault_status", [], |r| r.get(0))?;
        Ok(n == 0)
    })
}

/// Apply `vault_status` onto `catalog_items.is_vaulted`: set rows by game_ref, then
/// propagate to member parts via set_slug. Cheap; safe to run every launch.
pub fn apply(db: &Db) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "UPDATE catalog_items SET is_vaulted = COALESCE(
                (SELECT v.vaulted FROM vault_status v WHERE v.game_ref = catalog_items.game_ref), 0)
             WHERE category = 'set'",
            [],
        )?;
        c.execute(
            "UPDATE catalog_items SET is_vaulted = COALESCE(
                (SELECT s.is_vaulted FROM catalog_items s WHERE s.slug = catalog_items.set_slug), 0)
             WHERE set_slug IS NOT NULL",
            [],
        )?;
        Ok(())
    })
}

/// Refresh `vault_status` from warframe-items when stale/empty (TTL-gated), falling
/// back to the bundled snapshot only when the table is empty and the fetch fails.
/// Always applies the result onto `catalog_items`.
pub async fn refresh_if_stale(db: &Db) -> AppResult<()> {
    let have = !is_empty(db)?;
    let fresh = match meta::get(db, meta::KEY_LAST_VAULT_SYNC)? {
        Some(ts) => DateTime::parse_from_rfc3339(&ts)
            .map(|t| {
                Utc::now().signed_duration_since(t.with_timezone(&Utc))
                    < Duration::days(VAULT_TTL_DAYS)
            })
            .unwrap_or(false),
        None => false,
    };
    if have && fresh {
        return apply(db);
    }
    match fetch_remote().await {
        Ok(map) if !map.is_empty() => {
            store_map(db, &map)?;
            meta::set(db, meta::KEY_LAST_VAULT_SYNC, &Utc::now().to_rfc3339())?;
            tracing::info!(n = map.len(), "vault status refreshed from warframe-items");
        }
        result => {
            if have {
                tracing::warn!(
                    ok = result.is_ok(),
                    "vault refresh failed; keeping existing map"
                );
            } else {
                let b = bundled_map();
                store_map(db, &b)?;
                tracing::warn!(
                    n = b.len(),
                    "vault fetch unavailable; seeded from bundled snapshot"
                );
            }
        }
    }
    apply(db)
}
