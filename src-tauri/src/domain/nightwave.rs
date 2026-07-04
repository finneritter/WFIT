//! Nightwave cred-shop offerings — a bundled dataset, because no API exposes
//! Nora's shop stock (DE's `SeasonInfo` carries challenges only; warframestat
//! mirrors it). The list is the stable cross-season core (resources, Vauban
//! parts, the aura pool, the melee weapon blueprints); per-volume cosmetics are
//! deliberately omitted. Source: wiki.warframe.com/w/Nightwave/Offerings.
//!
//! Aura mod names match warframe.market display names exactly, so
//! `db/vendor.rs::enrich` resolves them to live prices; everything else is
//! account-bound and passes through untradeable (manual check-off only).

use once_cell::sync::Lazy;

pub struct CredOffer {
    pub name: &'static str,
    pub cost: i64,
}

pub static OFFERINGS: Lazy<Vec<CredOffer>> = Lazy::new(|| {
    include_str!("data/nightwave_offerings.tsv")
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .filter_map(|l| {
            let (name, cost) = l.split_once('\t')?;
            Some(CredOffer {
                name,
                cost: cost.trim().parse().ok()?,
            })
        })
        .collect()
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offerings_load_and_look_sane() {
        assert!(
            OFFERINGS.len() >= 30,
            "expected the full catalog, got {}",
            OFFERINGS.len()
        );
        let cp = OFFERINGS
            .iter()
            .find(|o| o.name == "Corrosive Projection")
            .expect("aura pool present");
        assert_eq!(cp.cost, 20);
        let nitain = OFFERINGS
            .iter()
            .find(|o| o.name.contains("Nitain"))
            .expect("nitain present");
        assert_eq!(nitain.cost, 15);
        // Every row parsed a positive cost — a malformed TSV line would have
        // been silently dropped by filter_map, so pin the exact count too.
        assert_eq!(OFFERINGS.len(), 35);
        assert!(OFFERINGS.iter().all(|o| o.cost > 0));
    }
}
