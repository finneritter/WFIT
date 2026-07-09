//! Static vendor registry — bundled offering datasets for vendors whose stock
//! never rotates (syndicates now; open worlds/Zariman/Höllvania as their tabs
//! ship). Seeded from wiki.warframe.com by `scripts/scrape_vendors.py` into
//! committed, hand-reviewed TSVs under `data/vendors/` — the app never touches
//! the wiki at runtime (same contract as `nightwave.rs`).
//!
//! Offer names are cleaned to warframe.market display names where one exists
//! (the scraper drops "(Hek)"-style weapon parentheticals), so
//! `db/vendor.rs::enrich_static` resolves live prices; `slug_hint` overrides
//! the fuzzy matcher for the stragglers.

use once_cell::sync::Lazy;

pub struct StaticVendor {
    pub key: &'static str,
    pub name: &'static str,
    /// Tab the vendor renders under (frontend group id, e.g. "syndicates").
    pub group: &'static str,
    pub location: &'static str,
    /// Base currency for the footer "to go" sum (every offer names its own).
    pub currency: &'static str,
    pub offers: &'static Lazy<Vec<StaticOffer>>,
}

pub struct StaticOffer {
    pub item: String,
    pub cost: i64,
    pub currency: String,
    /// Required syndicate rank gate (None = available at any rank).
    pub rank: Option<u8>,
    /// Explicit warframe.market slug when the fuzzy name matcher would miss.
    pub slug_hint: Option<String>,
}

fn parse_tsv(raw: &'static str) -> Vec<StaticOffer> {
    raw.lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .filter_map(|l| {
            let mut f = l.split('\t');
            let item = f.next()?.trim();
            let cost: i64 = f.next()?.trim().parse().ok()?;
            let currency = f.next()?.trim();
            let rank = f.next().and_then(|r| r.trim().parse::<u8>().ok());
            let slug_hint = f
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from);
            (!item.is_empty()).then(|| StaticOffer {
                item: item.to_string(),
                cost,
                currency: currency.to_string(),
                rank,
                slug_hint,
            })
        })
        .collect()
}

macro_rules! offers {
    ($file:literal) => {
        Lazy::new(|| parse_tsv(include_str!(concat!("data/vendors/", $file))))
    };
}

static STEEL_MERIDIAN: Lazy<Vec<StaticOffer>> = offers!("steel_meridian.tsv");
static ARBITERS_OF_HEXIS: Lazy<Vec<StaticOffer>> = offers!("arbiters_of_hexis.tsv");
static CEPHALON_SUDA: Lazy<Vec<StaticOffer>> = offers!("cephalon_suda.tsv");
static PERRIN_SEQUENCE: Lazy<Vec<StaticOffer>> = offers!("perrin_sequence.tsv");
static RED_VEIL: Lazy<Vec<StaticOffer>> = offers!("red_veil.tsv");
static NEW_LOKA: Lazy<Vec<StaticOffer>> = offers!("new_loka.tsv");

/// Every static vendor, in display order. A tab = the subset with its `group`.
pub static REGISTRY: &[StaticVendor] = &[
    StaticVendor {
        key: "steel_meridian",
        name: "Steel Meridian",
        group: "syndicates",
        location: "Relays",
        currency: "standing",
        offers: &STEEL_MERIDIAN,
    },
    StaticVendor {
        key: "arbiters_of_hexis",
        name: "Arbiters of Hexis",
        group: "syndicates",
        location: "Relays",
        currency: "standing",
        offers: &ARBITERS_OF_HEXIS,
    },
    StaticVendor {
        key: "cephalon_suda",
        name: "Cephalon Suda",
        group: "syndicates",
        location: "Relays",
        currency: "standing",
        offers: &CEPHALON_SUDA,
    },
    StaticVendor {
        key: "perrin_sequence",
        name: "The Perrin Sequence",
        group: "syndicates",
        location: "Relays",
        currency: "standing",
        offers: &PERRIN_SEQUENCE,
    },
    StaticVendor {
        key: "red_veil",
        name: "Red Veil",
        group: "syndicates",
        location: "Relays",
        currency: "standing",
        offers: &RED_VEIL,
    },
    StaticVendor {
        key: "new_loka",
        name: "New Loka",
        group: "syndicates",
        location: "Relays",
        currency: "standing",
        offers: &NEW_LOKA,
    },
];

pub fn group(group: &str) -> impl Iterator<Item = &'static StaticVendor> + use<'_> {
    REGISTRY.iter().filter(move |v| v.group == group)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn syndicate_datasets_load_and_look_sane() {
        for v in group("syndicates") {
            let offers = v.offers;
            assert!(
                offers.len() >= 80,
                "{}: expected the full catalog, got {} rows (malformed lines \
                 are silently dropped — check the TSV)",
                v.key,
                offers.len()
            );
            assert!(offers
                .iter()
                .all(|o| o.cost > 0 && o.currency == "standing"));
            assert!(
                offers.iter().any(|o| o.rank == Some(5)),
                "{}: no rank-5 gate parsed",
                v.key
            );
        }
        // Known-row spot checks: signature weapons at their real cost + gate.
        let hek = STEEL_MERIDIAN
            .iter()
            .find(|o| o.item == "Vaykor Hek")
            .expect("Vaykor Hek present");
        assert_eq!((hek.cost, hek.rank), (125_000, Some(5)));
        let gammacor = CEPHALON_SUDA
            .iter()
            .find(|o| o.item == "Synoid Gammacor")
            .expect("Synoid Gammacor present");
        assert_eq!((gammacor.cost, gammacor.rank), (100_000, Some(5)));
        assert_eq!(group("syndicates").count(), 6);
    }
}
