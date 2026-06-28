//! Riven roll grading. warframe.market exposes no base stat values, so we bundle
//! a static table (per weapon class, at disposition 1.0, max rank, single positive)
//! generated from the A-DYB `riven_stats.json` community dataset. Disposition itself
//! IS in the v2 weapons endpoint, so it's passed in (cached in DB) — not bundled.
//!
//! Key facts (verified live against torid, disposition 1.3 — see `wfit-riven-api`):
//!  - warframe.market stores stat `value` at MAX RANK, so mod_rank is irrelevant here.
//!  - A stat's theoretical max = base × disposition × buffMult × 1.1 (the +10% roll cap).
//!  - buffMult by (#positives, #negatives): (2,0)→1.0, (3,0)→0.75, (2,1)→1.2375, (3,1)→0.9375.
//!    (Verified: crit 149.99 × 1.3 × 1.2375 × 1.1 = 265.5 ≈ observed market max 266.1.)
//!
//! Only *positive* stats are graded (the curse uses different magnitude rules and a
//! smaller curse is better — different semantics). Stats absent from the table
//! (utility rolls: range, combo, recoil, zoom, faction multipliers, …) grade to None.
use once_cell::sync::Lazy;
use std::collections::HashMap;

/// `slug \t rifle \t shotgun \t pistol \t melee \t archgun` — base value at
/// disposition 1.0. A `-` cell means the stat doesn't exist for that class.
const DATA: &str = include_str!("data/riven_base_stats.tsv");

/// Class column order in the bundled TSV.
const CLASSES: [&str; 5] = ["rifle", "shotgun", "pistol", "melee", "archgun"];

static BASE: Lazy<HashMap<&'static str, [Option<f64>; 5]>> = Lazy::new(|| {
    DATA.lines()
        .filter_map(|line| {
            let mut it = line.split('\t');
            let slug = it.next()?;
            let mut cols = [None; 5];
            for c in cols.iter_mut() {
                *c = it.next().and_then(|v| v.trim().parse::<f64>().ok());
            }
            Some((slug, cols))
        })
        .collect()
});

/// Map a warframe.market `rivenType` to a base-table column. Modular weapons reuse
/// the closest base class: zaw→melee, kitgun→pistol.
fn class_index(riven_type: &str) -> Option<usize> {
    let key = match riven_type {
        "zaw" => "melee",
        "kitgun" => "pistol",
        other => other,
    };
    CLASSES.iter().position(|c| *c == key)
}

/// Base value for an attribute slug on a weapon class, or None when unknown.
pub fn base_value(slug: &str, riven_type: &str) -> Option<f64> {
    let idx = class_index(riven_type)?;
    BASE.get(slug).and_then(|cols| cols[idx])
}

/// The buff (positive) magnitude multiplier for a roll with the given positive and
/// negative counts. A negative ("curse") boosts the positives as compensation.
fn buff_mult(n_pos: usize, n_neg: usize) -> f64 {
    match (n_pos, n_neg) {
        (3, 0) => 0.75,
        (3, 1) => 0.9375,
        (2, 1) => 1.2375,
        // (2,0) and any single-positive / unusual layout: no buff scaling.
        _ => 1.0,
    }
}

/// Grade one positive stat as a percentage of its god-roll value (0..=100), or None
/// when the stat has no bundled base value. `value` is taken at max rank (the wfm
/// convention), so no rank normalization is applied.
pub fn stat_grade(
    value: f64,
    slug: &str,
    riven_type: &str,
    disposition: f64,
    n_pos: usize,
    n_neg: usize,
) -> Option<f64> {
    let base = base_value(slug, riven_type)?;
    let max = base * disposition * buff_mult(n_pos, n_neg) * 1.1;
    if max <= 0.0 {
        return None;
    }
    Some((value / max * 100.0).clamp(0.0, 100.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_base_values_resolve() {
        // Critical chance differs by class (verified against the dataset).
        assert_eq!(base_value("critical_chance", "rifle"), Some(149.99));
        assert_eq!(base_value("critical_chance", "melee"), Some(180.0));
        // Melee has no multishot column.
        assert_eq!(base_value("multishot", "melee"), None);
        // Modular fallbacks.
        assert_eq!(
            base_value("critical_chance", "zaw"),
            base_value("critical_chance", "melee")
        );
        assert_eq!(
            base_value("multishot", "kitgun"),
            base_value("multishot", "pistol")
        );
        assert_eq!(base_value("not_a_stat", "rifle"), None);
    }

    #[test]
    fn grade_matches_live_calibration() {
        // torid (rifle, disp 1.3), a 2-positive/1-curse roll with crit_chance 247.6.
        // god roll = 149.99 × 1.3 × 1.2375 × 1.1 = 265.5 → ~93%.
        let g = stat_grade(247.6, "critical_chance", "rifle", 1.3, 2, 1).unwrap();
        assert!((90.0..=96.0).contains(&g), "crit grade was {g}");
        // A value at/above god roll clamps to 100.
        let cap = stat_grade(9999.0, "critical_chance", "rifle", 1.3, 3, 0).unwrap();
        assert_eq!(cap, 100.0);
        // Ungradeable stat → None.
        assert_eq!(stat_grade(50.0, "zoom", "rifle", 1.3, 3, 0), None);
    }

    #[test]
    fn buff_mult_table() {
        assert_eq!(buff_mult(2, 0), 1.0);
        assert_eq!(buff_mult(3, 0), 0.75);
        assert_eq!(buff_mult(2, 1), 1.2375);
        assert_eq!(buff_mult(3, 1), 0.9375);
    }
}
