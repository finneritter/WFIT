//! Refreshable relic reference data. The bundled TSVs in `domain/relic` seed three DB
//! tables (`relic_ids`/`relic_drops`/`relic_vaults`); "Update game data" replaces them
//! from the live WFCD `warframe-items` Relics.json, then mirrors the DB into the
//! in-memory snapshot (`relic::install`) so new relics work without rebuilding the app.
//! Modeled on `db::vault` (network fetch + DB store + bundled fallback).
use crate::db::{meta, Db};
use crate::domain::relic::{self, RelicDropRow, RelicIdRow, RelicVaultRow};
use crate::error::AppResult;
use chrono::Utc;
use rusqlite::params;
use serde::Deserialize;
use std::collections::HashMap;

const RELICS_URL: &str =
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Relics.json";
/// Bump when the bundled relic TSVs change, so an app update re-seeds the DB baseline.
const RELIC_BUNDLE_VERSION: &str = "1";
/// The real void relic tiers; WFCD's Relics.json also carries legacy entries
/// (e.g. "Vanguard …") with no DE projection — skip those.
const TIERS: [&str; 5] = ["Lith", "Meso", "Neo", "Axi", "Requiem"];

#[derive(Deserialize)]
struct WfRelic {
    name: Option<String>,
    #[serde(rename = "uniqueName")]
    unique_name: Option<String>,
    vaulted: Option<bool>,
    #[serde(default)]
    rewards: Vec<WfReward>,
}
#[derive(Deserialize)]
struct WfReward {
    chance: Option<f64>,
    item: Option<WfRewardItem>,
}
#[derive(Deserialize)]
struct WfRewardItem {
    name: Option<String>,
}

type Rows = (Vec<RelicIdRow>, Vec<RelicDropRow>, Vec<RelicVaultRow>);

/// Split a WFCD relic `name` ("Axi A1 Exceptional") into (tier, relic_name, refinement),
/// keeping only the real void tiers.
fn parse_name(name: &str) -> Option<(String, String, String)> {
    let mut p = name.split_whitespace();
    let tier = p.next()?;
    let relic = p.next()?;
    let refinement = p.next()?;
    if !TIERS.contains(&tier) || !relic::REFINEMENTS.contains(&refinement) {
        return None;
    }
    Some((tier.to_string(), relic.to_string(), refinement.to_string()))
}

/// Fetch + parse Relics.json into the flat row sets. One source for ids, drops, vault.
async fn fetch_remote() -> AppResult<Rows> {
    let http = reqwest::Client::builder()
        .user_agent(crate::USER_AGENT)
        .timeout(std::time::Duration::from_secs(120))
        .build()?;
    let bytes = http
        .get(RELICS_URL)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    let relics: Vec<WfRelic> = serde_json::from_slice(&bytes)?;
    Ok(rows_from_wfcd(relics))
}

fn rows_from_wfcd(relics: Vec<WfRelic>) -> Rows {
    let (mut ids, mut drops) = (Vec::new(), Vec::new());
    let mut vaults: HashMap<(String, String), bool> = HashMap::new();
    for r in relics {
        let Some(name) = r.name.as_deref() else {
            continue;
        };
        let Some((tier, relic_name, refinement)) = parse_name(name) else {
            continue;
        };
        if let Some(un) = r.unique_name {
            ids.push(RelicIdRow {
                unique_name: un,
                tier: tier.clone(),
                relic_name: relic_name.clone(),
                refinement: refinement.clone(),
            });
        }
        // Vault is per-relic; OR across refinements (they agree in practice).
        let entry = vaults
            .entry((tier.clone(), relic_name.clone()))
            .or_insert(false);
        *entry = *entry || r.vaulted.unwrap_or(false);
        for rw in r.rewards {
            let (Some(item), Some(chance)) = (rw.item, rw.chance) else {
                continue;
            };
            let Some(reward_name) = item.name else {
                continue;
            };
            drops.push(RelicDropRow {
                tier: tier.clone(),
                relic_name: relic_name.clone(),
                refinement: refinement.clone(),
                reward_name,
                chance,
            });
        }
    }
    let vaults = vaults
        .into_iter()
        .map(|((tier, relic_name), vaulted)| RelicVaultRow {
            tier,
            relic_name,
            vaulted,
        })
        .collect();
    (ids, drops, vaults)
}

/// Replace all relic tables with the given rows in one transaction.
fn store(db: &Db, rows: &Rows) -> AppResult<()> {
    let (ids, drops, vaults) = rows;
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM relic_ids", [])?;
        tx.execute("DELETE FROM relic_drops", [])?;
        tx.execute("DELETE FROM relic_vaults", [])?;
        {
            let mut s = tx.prepare(
                "INSERT OR REPLACE INTO relic_ids (unique_name, tier, relic_name, refinement)
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            for r in ids {
                s.execute(params![r.unique_name, r.tier, r.relic_name, r.refinement])?;
            }
        }
        {
            let mut s = tx.prepare(
                "INSERT OR REPLACE INTO relic_drops
                    (tier, relic_name, refinement, reward_name, chance)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for d in drops {
                s.execute(params![d.tier, d.relic_name, d.refinement, d.reward_name, d.chance])?;
            }
        }
        {
            let mut s = tx.prepare(
                "INSERT OR REPLACE INTO relic_vaults (tier, relic_name, vaulted) VALUES (?1, ?2, ?3)",
            )?;
            for v in vaults {
                s.execute(params![v.tier, v.relic_name, v.vaulted as i64])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

fn read_rows(db: &Db) -> AppResult<Rows> {
    db.read(|c| {
        let ids = c
            .prepare("SELECT unique_name, tier, relic_name, refinement FROM relic_ids")?
            .query_map([], |r| {
                Ok(RelicIdRow {
                    unique_name: r.get(0)?,
                    tier: r.get(1)?,
                    relic_name: r.get(2)?,
                    refinement: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let drops = c
            .prepare("SELECT tier, relic_name, refinement, reward_name, chance FROM relic_drops")?
            .query_map([], |r| {
                Ok(RelicDropRow {
                    tier: r.get(0)?,
                    relic_name: r.get(1)?,
                    refinement: r.get(2)?,
                    reward_name: r.get(3)?,
                    chance: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let vaults = c
            .prepare("SELECT tier, relic_name, vaulted FROM relic_vaults")?
            .query_map([], |r| {
                Ok(RelicVaultRow {
                    tier: r.get(0)?,
                    relic_name: r.get(1)?,
                    vaulted: r.get::<_, i64>(2)? != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok((ids, drops, vaults))
    })
}

fn is_empty(db: &Db) -> AppResult<bool> {
    db.with(|c| {
        let n: i64 = c.query_row("SELECT COUNT(*) FROM relic_ids", [], |r| r.get(0))?;
        Ok(n == 0)
    })
}

/// Distinct relic count (tier, relic_name) — for "+N relics" update deltas.
pub fn relic_count(db: &Db) -> AppResult<i64> {
    db.with(|c| {
        let n: i64 = c.query_row(
            "SELECT COUNT(*) FROM (SELECT DISTINCT tier, relic_name FROM relic_ids)",
            [],
            |r| r.get(0),
        )?;
        Ok(n)
    })
}

/// Build the in-memory snapshot from the DB tables and hot-swap it in.
pub fn load_into_memory(db: &Db) -> AppResult<()> {
    let (ids, drops, vaults) = read_rows(db)?;
    relic::install(relic::RelicData::from_rows(&ids, &drops, &vaults));
    Ok(())
}

/// Seed the relic tables from the bundled TSVs when empty, or when the bundled data
/// version changed (an app update shipped a newer baseline). No network.
pub fn seed_if_empty_or_stale(db: &Db) -> AppResult<()> {
    let stale =
        meta::get(db, meta::KEY_RELIC_BUNDLE_VERSION)?.as_deref() != Some(RELIC_BUNDLE_VERSION);
    if is_empty(db)? || stale {
        let (ids, drops, vaults) = relic::bundled_rows();
        store(db, &(ids, drops, vaults))?;
        meta::set(db, meta::KEY_RELIC_BUNDLE_VERSION, RELIC_BUNDLE_VERSION)?;
        tracing::info!("relic tables seeded from bundled snapshot");
    }
    Ok(())
}

/// Force a refresh from the live WFCD Relics.json. On success replaces the tables and
/// reloads the in-memory snapshot; on failure keeps the existing data. Returns whether
/// the network fetch succeeded.
pub async fn refresh(db: &Db) -> AppResult<bool> {
    match fetch_remote().await {
        Ok(rows) if !rows.0.is_empty() => {
            store(db, &rows)?;
            load_into_memory(db)?;
            meta::set(db, meta::KEY_LAST_RELIC_SYNC, &Utc::now().to_rfc3339())?;
            tracing::info!(n = rows.0.len(), "relic data refreshed from WFCD");
            Ok(true)
        }
        result => {
            tracing::warn!(
                ok = result.is_ok(),
                "relic refresh failed; keeping existing data"
            );
            Ok(false)
        }
    }
}
