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
        // Identity = ids ∪ drop tables: a relic can have a reward table without a
        // projection id (2026's Requiem Eterna ships drops-only in WFCD data) and
        // must still be known/browsable.
        let mut all: BTreeSet<(String, String)> = BTreeSet::new();
        for r in ids {
            all.insert((r.tier.clone(), r.relic_name.clone()));
        }
        for d in drops {
            all.insert((d.tier.clone(), d.relic_name.clone()));
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

// ---------------------------------------------------------------------------
// Squad (radshare) math. `rewards` = (chance in percent, value) pairs from one
// relic's reward table at one refinement. Chances may sum to less than 100
// (the 2026 Requiem Eterna table sums to 76) — the residual mass is a 0-value
// outcome. Values are whatever unit the caller prices in (plat, ducats).

/// Expected value of the squad's best pick when `squad` players crack a copy of
/// the same relic together and everyone claims the highest-value reveal.
/// Order statistics on the per-roll value distribution: E[max] =
/// Σᵢ vᵢ·(F(vᵢ)ᴺ − F(vᵢ₋₁)ᴺ) over distinct values ascending. `squad == 1` is
/// exactly the linear EV Σ chance × value.
pub fn squad_ev(rewards: &[(f64, i64)], squad: u32) -> f64 {
    let n = squad.max(1) as i32;
    // Collapse to a value → probability distribution (rewards can tie in value).
    let mut mass: HashMap<i64, f64> = HashMap::new();
    let mut total = 0.0;
    for &(chance, value) in rewards {
        let p = (chance / 100.0).max(0.0);
        *mass.entry(value.max(0)).or_default() += p;
        total += p;
    }
    if total <= 0.0 {
        return 0.0;
    }
    // Residual (unlisted/short) probability mass reveals nothing of value.
    if total < 1.0 {
        *mass.entry(0).or_default() += 1.0 - total;
    } else if total > 1.0 {
        // Chances are data, not axioms — renormalize a table that oversums.
        for p in mass.values_mut() {
            *p /= total;
        }
    }
    let mut values: Vec<i64> = mass.keys().copied().collect();
    values.sort_unstable();
    let mut ev = 0.0;
    let mut cdf_prev = 0.0f64;
    let mut cum = 0.0f64;
    for v in values {
        cum += mass[&v];
        let cdf = cum.min(1.0);
        ev += v as f64 * (cdf.powi(n) - cdf_prev.powi(n));
        cdf_prev = cdf;
    }
    ev
}

/// Probability that at least one of `squad` same-relic rolls reveals a reward
/// from the relic's rarest chance group (the rewards tied at the lowest listed
/// chance — the single 2%/4%/6%/10% rare on a standard relic): 1 − (1−p)ᴺ.
pub fn p_rare_at_least_one(rewards: &[(f64, i64)], squad: u32) -> f64 {
    let Some(min_chance) = rewards
        .iter()
        .map(|&(c, _)| c)
        .filter(|c| *c > 0.0)
        .min_by(|a, b| a.total_cmp(b))
    else {
        return 0.0;
    };
    let p_rare: f64 = rewards
        .iter()
        .filter(|(c, _)| (c - min_chance).abs() < 1e-9)
        .map(|(c, _)| c / 100.0)
        .sum();
    let p_rare = p_rare.clamp(0.0, 1.0);
    1.0 - (1.0 - p_rare).powi(squad.max(1) as i32)
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
    fn squad_of_one_is_exactly_linear_ev() {
        // Standard Intact table: 3 commons / 2 uncommons / 1 rare, per-item chances.
        let rewards = [
            (25.33, 3),
            (25.33, 5),
            (25.34, 0), // Forma-style unpriced common
            (11.0, 12),
            (11.0, 8),
            (2.0, 90),
        ];
        let linear: f64 = rewards.iter().map(|&(c, v)| c / 100.0 * v as f64).sum();
        assert!((squad_ev(&rewards, 1) - linear).abs() < 1e-9);
    }

    #[test]
    fn radshare_rare_union_matches_known_probability() {
        // 4-player radiant share: P(≥1 rare) = 1 − 0.9⁴ = 0.3439.
        let rewards = [
            (16.67, 3),
            (16.67, 5),
            (16.66, 0),
            (20.0, 12),
            (20.0, 8),
            (10.0, 90),
        ];
        assert!((p_rare_at_least_one(&rewards, 4) - 0.3439).abs() < 1e-4);
        assert!((p_rare_at_least_one(&rewards, 1) - 0.10).abs() < 1e-9);
    }

    #[test]
    fn best_of_two_on_a_coin_flip_table() {
        // Two equally likely outcomes 0 and 100: E[max of 2] = 100·(1−0.25) = 75.
        let rewards = [(50.0, 0), (50.0, 100)];
        assert!((squad_ev(&rewards, 1) - 50.0).abs() < 1e-9);
        assert!((squad_ev(&rewards, 2) - 75.0).abs() < 1e-9);
    }

    #[test]
    fn duplicate_values_group_before_order_statistics() {
        // Two distinct rewards worth the same plat must merge into one outcome:
        // max of N over a single-value distribution is that value.
        let rewards = [(50.0, 10), (50.0, 10)];
        for n in 1..=4 {
            assert!((squad_ev(&rewards, n) - 10.0).abs() < 1e-9);
        }
    }

    #[test]
    fn requiem_style_short_table_puts_residual_at_zero() {
        // Requiem Eterna: 8 equal ~9.5% rewards, Σ = 76% — the missing 24% is a
        // 0-value outcome, and N=1 still equals the linear EV.
        let rewards: Vec<(f64, i64)> = (0..8).map(|i| (9.5, i * 2)).collect();
        let linear: f64 = rewards.iter().map(|&(c, v)| c / 100.0 * v as f64).sum();
        assert!((squad_ev(&rewards, 1) - linear).abs() < 1e-9);
        assert!(squad_ev(&rewards, 4).is_finite());
    }

    #[test]
    fn squad_ev_is_monotone_in_squad_size() {
        let rewards = [
            (25.33, 3),
            (25.33, 5),
            (25.34, 1),
            (11.0, 12),
            (11.0, 8),
            (2.0, 90),
        ];
        let mut prev = 0.0;
        for n in 1..=4 {
            let ev = squad_ev(&rewards, n);
            assert!(ev >= prev - 1e-9, "EV decreased at squad {n}");
            prev = ev;
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
