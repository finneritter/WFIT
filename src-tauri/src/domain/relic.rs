//! Void relic reference data, bundled from WFCD (warframe-items + warframe-drop-data).
//! Pure data — no I/O. Two tables:
//!
//! - `relic_id.tsv`: DE projection `uniqueName` → (tier, relic name, refinement),
//!   so a memory-scan of the running game can identify owned relics.
//! - `relic_drops.tsv`: (tier, relic name, refinement) → reward drop table. Reward
//!   names are display names; they resolve to catalog slugs at runtime (so this
//!   file carries no warframe.market slugs), and unpriceable rewards (Forma, Kuva)
//!   simply contribute nothing to a relic's expected value.
//!
//! warframe.market does not trade relics, so their worth is inferred from drops.
use once_cell::sync::Lazy;
use std::collections::HashMap;

const ID_DATA: &str = include_str!("data/relic_id.tsv");
const DROP_DATA: &str = include_str!("data/relic_drops.tsv");

/// Refinement levels, worst → best (Intact is what an uncracked relic is owned as).
pub const REFINEMENTS: [&str; 4] = ["Intact", "Exceptional", "Flawless", "Radiant"];

/// The relic a DE projection `uniqueName` refers to.
#[derive(Debug, Clone, Copy)]
pub struct RelicIdent {
    pub tier: &'static str,
    pub name: &'static str,
    pub refinement: &'static str,
}

/// One possible reward from cracking a relic.
#[derive(Debug, Clone, Copy)]
pub struct RelicReward {
    /// Catalog display name (resolved to a slug at runtime via `catalog::name_slug_map`).
    pub reward_name: &'static str,
    /// Drop chance for this refinement, in percent (0–100).
    pub chance: f64,
}

fn skip_comment(line: &str) -> bool {
    line.is_empty() || line.starts_with('#')
}

static BY_UNIQUE_NAME: Lazy<HashMap<&'static str, RelicIdent>> = Lazy::new(|| {
    ID_DATA
        .lines()
        .filter(|l| !skip_comment(l))
        .filter_map(|line| {
            let mut p = line.split('\t');
            let unique_name = p.next()?;
            let tier = p.next()?;
            let name = p.next()?;
            let refinement = p.next()?.trim();
            Some((
                unique_name,
                RelicIdent {
                    tier,
                    name,
                    refinement,
                },
            ))
        })
        .collect()
});

/// Map key = "tier\u{0}name\u{0}refinement", interned from the bundled data. Using a
/// single joined String (NUL-separated, so no part can collide) lets `drops_for`
/// look up by the same cheap join without a custom Borrow impl.
fn relic_key(tier: &str, name: &str, refinement: &str) -> String {
    format!("{tier}\u{0}{name}\u{0}{refinement}")
}

static DROPS: Lazy<HashMap<String, Vec<RelicReward>>> = Lazy::new(|| {
    let mut m: HashMap<String, Vec<RelicReward>> = HashMap::new();
    for line in DROP_DATA.lines().filter(|l| !skip_comment(l)) {
        let mut p = line.split('\t');
        let (Some(tier), Some(name), Some(refinement), Some(reward_name), Some(chance)) =
            (p.next(), p.next(), p.next(), p.next(), p.next())
        else {
            continue;
        };
        let Ok(chance) = chance.trim().parse::<f64>() else {
            continue;
        };
        m.entry(relic_key(tier, name, refinement))
            .or_default()
            .push(RelicReward {
                reward_name,
                chance,
            });
    }
    m
});

/// Identify the relic an owned DE projection `uniqueName` refers to, or None if it's
/// not a known void relic projection.
pub fn ident_for(unique_name: &str) -> Option<RelicIdent> {
    BY_UNIQUE_NAME.get(unique_name).copied()
}

/// The reward table for a relic at a refinement, or None if unknown.
pub fn drops_for(tier: &str, name: &str, refinement: &str) -> Option<&'static [RelicReward]> {
    DROPS
        .get(&relic_key(tier, name, refinement))
        .map(Vec::as_slice)
}

/// True if `(tier, name)` is a known relic — guards manual relic entry.
pub fn is_known(tier: &str, name: &str) -> bool {
    BY_UNIQUE_NAME
        .values()
        .any(|id| id.tier == tier && id.name == name)
}

/// All known relics as sorted `(tier, name)` pairs — powers the manual-add picker.
pub fn all_relics() -> Vec<(&'static str, &'static str)> {
    let mut set: std::collections::BTreeSet<(&'static str, &'static str)> =
        std::collections::BTreeSet::new();
    for id in BY_UNIQUE_NAME.values() {
        set.insert((id.tier, id.name));
    }
    set.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_projection_resolves() {
        // Axi A1 Intact (verified against WFCD warframe-items).
        let id = ident_for("/Lotus/Types/Game/Projections/T4VoidProjectionEBronze")
            .expect("Axi A1 Intact present");
        assert_eq!((id.tier, id.name, id.refinement), ("Axi", "A1", "Intact"));
    }

    #[test]
    fn drops_present_for_all_refinements_of_a_relic() {
        for r in REFINEMENTS {
            let d = drops_for("Axi", "A1", r).unwrap_or(&[]);
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
    fn every_identified_relic_has_a_drop_table() {
        // The two bundled files must agree on (tier, name): a scanned relic with no
        // reward table would value at 0 and read as a data bug.
        for id in BY_UNIQUE_NAME.values() {
            assert!(
                drops_for(id.tier, id.name, id.refinement).is_some(),
                "no drops for {} {} {}",
                id.tier,
                id.name,
                id.refinement
            );
        }
    }
}
