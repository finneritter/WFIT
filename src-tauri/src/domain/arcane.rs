//! Arcane dissolution / Vosfor reference data, bundled from the Warframe wiki
//! (Loid collections + per-arcane Vosfor dissolution values). Pure data — no I/O.
//! See `docs/ARCANE_DISSOLUTION.md`. warframe.market exposes none of this.
use once_cell::sync::Lazy;
use std::collections::HashMap;

/// `slug \t collection \t rarity \t vosfor`. `collection = "none"` for arcanes not
/// sold in any Loid collection (still carries a vosfor value for dissolution).
const DATA: &str = include_str!("data/arcane_dissolution.tsv");

#[derive(Debug, Clone)]
pub struct ArcaneMeta {
    pub collection: &'static str,
    /// Drop-pool rarity within its collection (what the EV weights key on).
    pub rarity: &'static str,
    pub vosfor: i64,
}

static ARCANES: Lazy<HashMap<&'static str, ArcaneMeta>> = Lazy::new(|| {
    DATA.lines()
        .filter_map(|line| {
            let mut p = line.split('\t');
            let slug = p.next()?;
            let collection = p.next()?;
            let rarity = p.next()?;
            let vosfor = p.next()?.trim().parse().ok()?;
            Some((
                slug,
                ArcaneMeta {
                    collection,
                    rarity,
                    vosfor,
                },
            ))
        })
        .collect()
});

/// Reference data for one arcane slug, or None if it's not a known arcane.
pub fn meta_for(slug: &str) -> Option<&'static ArcaneMeta> {
    ARCANES.get(slug)
}

/// The Loid collection a single purchase costs (200 Vosfor + 50k credits) and the
/// number of arcanes it grants per pull. Source: wiki /w/Arcane_Enhancement.
pub const VOSFOR_PER_PULL: i64 = 200;
pub const ARCANES_PER_PULL: f64 = 3.0;

/// Canonical rarity order; index into `Collection::weights`.
pub const RARITIES: [&str; 4] = ["common", "uncommon", "rare", "legendary"];

pub fn rarity_index(rarity: &str) -> Option<usize> {
    RARITIES.iter().position(|&r| r == rarity)
}

/// A Loid Vosfor collection: per-rarity drop chance (% of one of the 3 draws).
/// Within a tier every arcane is equally likely, so a specific arcane's chance is
/// `weights[rarity]/100 ÷ (# arcanes of that rarity in this collection)`.
pub struct Collection {
    pub key: &'static str,
    pub name: &'static str,
    pub weights: [f64; 4], // common, uncommon, rare, legendary (sum ≈ 100)
}

/// The 9 collections, with rarity weights verified against the per-arcane drop
/// percentages on wiki /w/Arcane_Enhancement.
pub const COLLECTIONS: [Collection; 9] = [
    Collection {
        key: "eidolon",
        name: "Eidolon",
        weights: [40.0, 35.0, 20.0, 5.0],
    },
    Collection {
        key: "duviri",
        name: "Duviri",
        weights: [0.0, 45.0, 50.0, 5.0],
    },
    Collection {
        key: "cavia",
        name: "Cavia",
        weights: [0.0, 45.0, 50.0, 5.0],
    },
    Collection {
        key: "necralisk",
        name: "Necralisk",
        weights: [0.0, 0.0, 100.0, 0.0],
    },
    Collection {
        key: "holdfasts",
        name: "Holdfasts",
        weights: [0.0, 0.0, 100.0, 0.0],
    },
    Collection {
        key: "hollvania",
        name: "Höllvania",
        weights: [0.0, 0.0, 95.0, 5.0],
    },
    Collection {
        key: "ostron",
        name: "Ostron",
        weights: [10.0, 30.0, 60.0, 0.0],
    },
    Collection {
        key: "solaris",
        name: "Solaris",
        weights: [15.0, 15.0, 70.0, 0.0],
    },
    Collection {
        key: "steel",
        name: "Steel",
        weights: [0.0, 0.0, 100.0, 0.0],
    },
];

/// Slugs belonging to a collection, grouped by rarity index (0=common … 3=legendary).
pub fn collection_pools(key: &str) -> [Vec<&'static str>; 4] {
    let mut pools: [Vec<&'static str>; 4] = Default::default();
    for (slug, m) in ARCANES.iter() {
        if m.collection == key {
            if let Some(i) = rarity_index(m.rarity) {
                pools[i].push(slug);
            }
        }
    }
    pools
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_arcanes_resolve() {
        let e = meta_for("arcane_energize").expect("energize present");
        assert_eq!(e.vosfor, 98);
        assert_eq!(e.collection, "eidolon");
        assert_eq!(e.rarity, "legendary");
    }

    #[test]
    fn collection_pool_counts_match_wiki_checksums() {
        // The per-rarity counts are the wiki's drop-table tier sizes; the EV math
        // depends on them, so guard the bundled data against silent drift.
        let expect: &[(&str, [usize; 4])] = &[
            ("eidolon", [6, 13, 8, 3]),
            ("duviri", [0, 2, 7, 3]),
            ("cavia", [0, 2, 9, 2]),
            ("necralisk", [0, 0, 12, 0]),
            ("holdfasts", [0, 0, 19, 0]),
            ("hollvania", [0, 0, 8, 3]),
            ("ostron", [4, 7, 8, 0]),
            ("solaris", [7, 4, 8, 0]),
            ("steel", [0, 0, 11, 0]),
        ];
        for (key, counts) in expect {
            let pools = collection_pools(key);
            let got = [
                pools[0].len(),
                pools[1].len(),
                pools[2].len(),
                pools[3].len(),
            ];
            assert_eq!(&got, counts, "collection {key} pool counts drifted");
        }
    }
}
