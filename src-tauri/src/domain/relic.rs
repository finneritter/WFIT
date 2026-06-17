//! Void relic reference data, originally bundled from WFCD (warframe-items). The
//! bundled TSVs (`relic_id.tsv`, `relic_drops.tsv`, `relic_vault.tsv`) seed a
//! runtime-swappable in-memory snapshot ([`STORE`]); after a "Update game data"
//! refresh, [`db::relic_data`] rebuilds that snapshot from the live WFCD `Relics.json`
//! and hot-swaps it via [`install`], so new relics work without rebuilding the app.
//!
//! - id map: DE projection `uniqueName` → (tier, relic name, refinement), so a
//!   memory-scan of the running game can identify owned relics.
//! - drop table: (tier, relic name, refinement) → reward table. Reward names are
//!   display names; they resolve to catalog slugs at runtime (so no warframe.market
//!   slugs are stored), and unpriceable rewards (Forma, Kuva) contribute nothing.
//! - vault: per (tier, relic name), whether the relic is vaulted (unfarmable).
//!
//! warframe.market does not trade relics, so their worth is inferred from drops.
//!
//! [`db::relic_data`]: crate::db::relic_data
use once_cell::sync::Lazy;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, RwLock};

const ID_DATA: &str = include_str!("data/relic_id.tsv");
const DROP_DATA: &str = include_str!("data/relic_drops.tsv");
const VAULT_DATA: &str = include_str!("data/relic_vault.tsv");

/// Refinement levels, worst → best (Intact is what an uncracked relic is owned as).
pub const REFINEMENTS: [&str; 4] = ["Intact", "Exceptional", "Flawless", "Radiant"];

/// The relic a DE projection `uniqueName` refers to.
#[derive(Debug, Clone)]
pub struct RelicIdent {
    pub tier: String,
    pub name: String,
    pub refinement: String,
}

/// One possible reward from cracking a relic.
#[derive(Debug, Clone)]
pub struct RelicReward {
    /// Catalog display name (resolved to a slug at runtime via `catalog::name_slug_map`).
    pub reward_name: String,
    /// Drop chance for this refinement, in percent (0–100).
    pub chance: f64,
}

// Flat rows mirroring the DB tables / bundled TSVs — the interchange shape between
// the bundled seed, a WFCD refresh (db::relic_data), and the in-memory snapshot.
#[derive(Debug, Clone)]
pub struct RelicIdRow {
    pub unique_name: String,
    pub tier: String,
    pub relic_name: String,
    pub refinement: String,
}
#[derive(Debug, Clone)]
pub struct RelicDropRow {
    pub tier: String,
    pub relic_name: String,
    pub refinement: String,
    pub reward_name: String,
    pub chance: f64,
}
#[derive(Debug, Clone)]
pub struct RelicVaultRow {
    pub tier: String,
    pub relic_name: String,
    pub vaulted: bool,
}

fn skip_comment(line: &str) -> bool {
    line.is_empty() || line.starts_with('#')
}

/// Map key = "tier\u{0}name\u{0}refinement". A single NUL-joined String (so no part
/// can collide) lets lookups use the same cheap join without a custom Borrow impl.
fn relic_key(tier: &str, name: &str, refinement: &str) -> String {
    format!("{tier}\u{0}{name}\u{0}{refinement}")
}

fn vault_key(tier: &str, name: &str) -> String {
    format!("{tier}\u{0}{name}")
}

/// The in-memory relic reference snapshot. Cheap-ish to clone fields out of; whole
/// thing is swapped behind an `Arc` on refresh.
pub struct RelicData {
    by_unique: HashMap<String, RelicIdent>,
    drops: HashMap<String, Vec<RelicReward>>,
    vaulted: HashSet<String>,   // "tier\0name"
    all: Vec<(String, String)>, // sorted, distinct (tier, name)
}

impl RelicData {
    /// Build a snapshot from flat rows (used by both the bundled seed and a refresh).
    pub fn from_rows(
        ids: &[RelicIdRow],
        drops: &[RelicDropRow],
        vaults: &[RelicVaultRow],
    ) -> RelicData {
        let by_unique = ids
            .iter()
            .map(|r| {
                (
                    r.unique_name.clone(),
                    RelicIdent {
                        tier: r.tier.clone(),
                        name: r.relic_name.clone(),
                        refinement: r.refinement.clone(),
                    },
                )
            })
            .collect();
        let mut dmap: HashMap<String, Vec<RelicReward>> = HashMap::new();
        for d in drops {
            dmap.entry(relic_key(&d.tier, &d.relic_name, &d.refinement))
                .or_default()
                .push(RelicReward {
                    reward_name: d.reward_name.clone(),
                    chance: d.chance,
                });
        }
        let vaulted = vaults
            .iter()
            .filter(|v| v.vaulted)
            .map(|v| vault_key(&v.tier, &v.relic_name))
            .collect();
        let mut all: BTreeSet<(String, String)> = BTreeSet::new();
        for r in ids {
            all.insert((r.tier.clone(), r.relic_name.clone()));
        }
        RelicData {
            by_unique,
            drops: dmap,
            vaulted,
            all: all.into_iter().collect(),
        }
    }
}

/// Parse the compile-time bundled TSVs into flat rows (the seed + offline fallback).
pub fn bundled_rows() -> (Vec<RelicIdRow>, Vec<RelicDropRow>, Vec<RelicVaultRow>) {
    let ids = ID_DATA
        .lines()
        .filter(|l| !skip_comment(l))
        .filter_map(|line| {
            let mut p = line.split('\t');
            Some(RelicIdRow {
                unique_name: p.next()?.to_string(),
                tier: p.next()?.to_string(),
                relic_name: p.next()?.to_string(),
                refinement: p.next()?.trim().to_string(),
            })
        })
        .collect();
    let drops = DROP_DATA
        .lines()
        .filter(|l| !skip_comment(l))
        .filter_map(|line| {
            let mut p = line.split('\t');
            let (tier, name, refinement, reward_name, chance) =
                (p.next()?, p.next()?, p.next()?, p.next()?, p.next()?);
            Some(RelicDropRow {
                tier: tier.to_string(),
                relic_name: name.to_string(),
                refinement: refinement.to_string(),
                reward_name: reward_name.to_string(),
                chance: chance.trim().parse::<f64>().ok()?,
            })
        })
        .collect();
    let vaults = VAULT_DATA
        .lines()
        .filter(|l| !skip_comment(l))
        .filter_map(|line| {
            let mut p = line.split('\t');
            Some(RelicVaultRow {
                tier: p.next()?.to_string(),
                relic_name: p.next()?.to_string(),
                vaulted: p.next()?.trim() == "1",
            })
        })
        .collect();
    (ids, drops, vaults)
}

fn bundled_data() -> RelicData {
    let (ids, drops, vaults) = bundled_rows();
    RelicData::from_rows(&ids, &drops, &vaults)
}

/// The live relic snapshot. Seeded from the bundled TSVs on first access; swapped to
/// the DB-backed data at startup and after a refresh ([`install`]).
static STORE: Lazy<RwLock<Arc<RelicData>>> = Lazy::new(|| RwLock::new(Arc::new(bundled_data())));

fn current() -> Arc<RelicData> {
    STORE.read().expect("relic store not poisoned").clone()
}

/// Hot-swap the in-memory relic snapshot (called after seeding/refreshing from the DB).
pub fn install(data: RelicData) {
    *STORE.write().expect("relic store not poisoned") = Arc::new(data);
}

/// True if `(tier, name)` is a vaulted relic — i.e. no longer farmable from fissures,
/// so cracking what you hold is the only way to get its drops. Unknown relics read as
/// not vaulted.
pub fn is_vaulted(tier: &str, name: &str) -> bool {
    current().vaulted.contains(&vault_key(tier, name))
}

/// Identify the relic an owned DE projection `uniqueName` refers to, or None if it's
/// not a known void relic projection.
pub fn ident_for(unique_name: &str) -> Option<RelicIdent> {
    current().by_unique.get(unique_name).cloned()
}

/// The reward table for a relic at a refinement, or None if unknown.
pub fn drops_for(tier: &str, name: &str, refinement: &str) -> Option<Vec<RelicReward>> {
    current()
        .drops
        .get(&relic_key(tier, name, refinement))
        .cloned()
}

/// True if `(tier, name)` is a known relic — guards manual relic entry.
pub fn is_known(tier: &str, name: &str) -> bool {
    current()
        .all
        .binary_search(&(tier.to_string(), name.to_string()))
        .is_ok()
}

/// All known relics as sorted `(tier, name)` pairs — powers the manual-add picker.
pub fn all_relics() -> Vec<(String, String)> {
    current().all.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_projection_resolves() {
        // Axi A1 Intact (verified against WFCD warframe-items).
        let id = ident_for("/Lotus/Types/Game/Projections/T4VoidProjectionEBronze")
            .expect("Axi A1 Intact present");
        assert_eq!(
            (id.tier.as_str(), id.name.as_str(), id.refinement.as_str()),
            ("Axi", "A1", "Intact")
        );
    }

    #[test]
    fn drops_present_for_all_refinements_of_a_relic() {
        for r in REFINEMENTS {
            let d = drops_for("Axi", "A1", r).unwrap_or_default();
            assert!(!d.is_empty(), "Axi A1 {r} has no drops");
        }
    }

    #[test]
    fn drop_chances_sum_near_100_for_radiant() {
        // Radiant tables are the canonical full-rotation ones; guard the bundled data.
        let d = drops_for("Lith", "S1", "Radiant").expect("Lith S1 Radiant present");
        let sum: f64 = d.iter().map(|r| r.chance).sum();
        assert!((sum - 100.0).abs() < 1.0, "Lith S1 Radiant sums to {sum}");
    }

    #[test]
    fn vault_map_is_populated_and_references_known_relics() {
        // Don't assert any specific relic's vault state — DE rotates it. Just guard the
        // bundled file: non-empty, and every vaulted relic is a real (known) relic.
        let (_, _, vaults) = bundled_rows();
        let any_vaulted = vaults.iter().any(|v| v.vaulted);
        assert!(any_vaulted, "relic_vault.tsv has no vaulted relics");
        for v in vaults.iter().filter(|v| v.vaulted) {
            assert!(
                is_known(&v.tier, &v.relic_name),
                "vaulted relic {} {} is not a known relic",
                v.tier,
                v.relic_name
            );
        }
    }

    #[test]
    fn every_identified_relic_has_a_drop_table() {
        // The bundled files must agree on (tier, name): a scanned relic with no reward
        // table would value at 0 and read as a data bug.
        let (ids, _, _) = bundled_rows();
        for id in &ids {
            assert!(
                drops_for(&id.tier, &id.relic_name, &id.refinement).is_some(),
                "no drops for {} {} {}",
                id.tier,
                id.relic_name,
                id.refinement
            );
        }
    }
}
