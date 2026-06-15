//! Mapping: DE inventory `uniqueName` → catalog slug, via the `game_ref` column
//! stored in Pass A. The catalog only holds tracked, tradeable items, so resolving
//! through `game_ref` and dropping the misses *is* the prime-part/tradeable filter
//! — anything that doesn't resolve to a catalog slug is ignored.

use super::{RawInventory, RawItem, RelicScanItem, ScanItem};
use crate::domain::relic;
use serde_json::Value;
use std::collections::HashMap;

/// DE inventory arrays that hold tradeable items (confirmed against a live 2026
/// response). Each entry is `{ItemType, ItemCount?}` and `resolve` sums by slug,
/// so reading several arrays and letting unmapped items drop is correct:
/// - `MiscItems`   — prime components/blueprints + resources (have `ItemCount`).
/// - `Recipes`     — owned blueprints (have `ItemCount`).
/// - `RawUpgrades` — STACKED unranked mods/arcanes; the real count is in `ItemCount`.
///   This is where multi-copy mods/arcanes live; omitting it undercounted them to
///   the single ranked instance in `Upgrades` (or to 0).
/// - `Upgrades`    — individual RANKED mod/arcane instances (no `ItemCount`, so each
///   counts as 1 via the default); summed per slug they add the ranked copies.
/// - `Relics`      — void relic projections (have `ItemCount`). These never resolve to
///   a catalog slug (relics aren't traded), so `resolve` drops them; `resolve_relics`
///   picks them up instead. Listed here in case DE keys them separately from MiscItems.
const INVENTORY_ARRAYS: &[&str] = &["MiscItems", "Recipes", "RawUpgrades", "Upgrades", "Relics"];

/// Resolve raw `uniqueName` lines to catalog slugs, aggregating by (slug, rank)
/// and dropping anything not in the catalog. The result is the owned, tracked
/// subset — prime parts as a single (slug, None) line, mods/arcanes split per rank.
pub fn resolve(items: &[RawItem], gref_to_slug: &HashMap<String, String>) -> Vec<ScanItem> {
    let mut by: HashMap<(String, Option<i64>), i64> = HashMap::new();
    for it in items {
        if let Some(slug) = gref_to_slug.get(&it.unique_name) {
            *by.entry((slug.clone(), it.rank)).or_insert(0) += it.count.max(0);
        }
    }
    let mut out: Vec<ScanItem> = by
        .into_iter()
        .filter(|(_, qty)| *qty > 0)
        .map(|((slug, rank), qty)| ScanItem { slug, rank, qty })
        .collect();
    out.sort_by(|a, b| a.slug.cmp(&b.slug).then(a.rank.cmp(&b.rank)));
    out
}

/// Resolve raw `uniqueName` lines that are VOID RELIC projections to relic identities
/// (tier + name + refinement), aggregating quantity. Runs over the same `RawItem`s as
/// `resolve` — relics live in `MiscItems`/`Relics` and are dropped by the catalog
/// resolve, so this is the relic-specific second pass. Non-relic lines are ignored.
pub fn resolve_relics(items: &[RawItem]) -> Vec<RelicScanItem> {
    let mut by: HashMap<(String, String, String), i64> = HashMap::new();
    for it in items {
        if let Some(id) = relic::ident_for(&it.unique_name) {
            *by.entry((
                id.tier.to_string(),
                id.name.to_string(),
                id.refinement.to_string(),
            ))
            .or_insert(0) += it.count.max(0);
        }
    }
    let mut out: Vec<RelicScanItem> = by
        .into_iter()
        .filter(|(_, qty)| *qty > 0)
        .map(|((tier, name, refinement), qty)| RelicScanItem {
            tier,
            name,
            refinement,
            qty,
        })
        .collect();
    out.sort_by(|a, b| {
        a.tier
            .cmp(&b.tier)
            .then(a.name.cmp(&b.name))
            .then(a.refinement.cmp(&b.refinement))
    });
    out
}

/// Flatten a raw DE inventory JSON blob into `RawItem`s from the known category
/// arrays. **Provisional (B2):** tolerant of `ItemType`/`ItemCount` casing and
/// missing fields; the real key/count names get pinned against a live response.
#[allow(dead_code)] // wired into the live scan path in B2 (api.rs); exercised by tests now
pub fn parse_inventory(json: &Value) -> RawInventory {
    let account_id = json
        .get("AccountId")
        .or_else(|| json.get("accountId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut items = Vec::new();
    for key in INVENTORY_ARRAYS {
        let Some(arr) = json.get(key).and_then(|v| v.as_array()) else {
            continue;
        };
        for entry in arr {
            let unique_name = entry
                .get("ItemType")
                .or_else(|| entry.get("itemType"))
                .and_then(|v| v.as_str());
            let count = entry
                .get("ItemCount")
                .or_else(|| entry.get("itemCount"))
                .and_then(|v| v.as_i64())
                .unwrap_or(1);
            if let Some(name) = unique_name {
                items.push(RawItem {
                    unique_name: name.to_string(),
                    count,
                    rank: rank_for(key, entry),
                });
            }
        }
    }
    RawInventory { account_id, items }
}

/// The rank of an inventory entry: 0 for stacked unranked copies (`RawUpgrades`),
/// the `lvl` from the `UpgradeFingerprint` for individual ranked instances
/// (`Upgrades`), and None for non-ranked items (prime parts in MiscItems/Recipes).
fn rank_for(array_key: &str, entry: &Value) -> Option<i64> {
    match array_key {
        "RawUpgrades" => Some(0),
        "Upgrades" => {
            let lvl = entry
                .get("UpgradeFingerprint")
                .and_then(|v| v.as_str())
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .and_then(|fp| fp.get("lvl").and_then(|v| v.as_i64()))
                .unwrap_or(0);
            Some(lvl)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_map() -> HashMap<String, String> {
        HashMap::from([
            (
                "/Lotus/Types/Recipes/Weapons/SomaPrimeBarrel".to_string(),
                "soma_prime_barrel".to_string(),
            ),
            (
                "/Lotus/Types/Recipes/Weapons/SomaPrimeReceiver".to_string(),
                "soma_prime_receiver".to_string(),
            ),
            (
                "/Lotus/Upgrades/Mods/Pistol/WeaponCritChanceMod".to_string(),
                "pistol_gambit".to_string(),
            ),
        ])
    }

    #[test]
    fn resolves_known_and_drops_unknown() {
        let items = vec![
            RawItem {
                unique_name: "/Lotus/Types/Recipes/Weapons/SomaPrimeBarrel".into(),
                count: 3,
                rank: None,
            },
            RawItem {
                unique_name: "/Lotus/Types/Items/MiscItems/Ferrite".into(), // not tracked
                count: 9999,
                rank: None,
            },
        ];
        let out = resolve(&items, &sample_map());
        assert_eq!(
            out,
            vec![ScanItem {
                slug: "soma_prime_barrel".into(),
                rank: None,
                qty: 3
            }]
        );
    }

    #[test]
    fn sums_duplicate_same_rank_keeps_ranks_separate() {
        let items = vec![
            RawItem {
                unique_name: "/Lotus/Upgrades/Mods/Pistol/WeaponCritChanceMod".into(),
                count: 2,
                rank: Some(0),
            },
            RawItem {
                unique_name: "/Lotus/Upgrades/Mods/Pistol/WeaponCritChanceMod".into(),
                count: 1,
                rank: Some(0),
            },
            RawItem {
                unique_name: "/Lotus/Upgrades/Mods/Pistol/WeaponCritChanceMod".into(),
                count: 1,
                rank: Some(5),
            },
        ];
        let out = resolve(&items, &sample_map());
        // rank 0 entries sum to 3; rank 5 stays separate at 1.
        assert_eq!(out.len(), 2);
        let r0 = out.iter().find(|i| i.rank == Some(0)).unwrap();
        let r5 = out.iter().find(|i| i.rank == Some(5)).unwrap();
        assert_eq!(r0.qty, 3);
        assert_eq!(r5.qty, 1);
    }

    #[test]
    fn resolve_relics_maps_projections_and_sums() {
        // Two Axi A1 Intact projections + an unrelated item; sums to qty 5, drops the rest.
        let items = vec![
            RawItem {
                unique_name: "/Lotus/Types/Game/Projections/T4VoidProjectionEBronze".into(),
                count: 3,
                rank: None,
            },
            RawItem {
                unique_name: "/Lotus/Types/Game/Projections/T4VoidProjectionEBronze".into(),
                count: 2,
                rank: None,
            },
            RawItem {
                unique_name: "/Lotus/Types/Recipes/Weapons/SomaPrimeBarrel".into(),
                count: 1,
                rank: None,
            },
        ];
        let out = resolve_relics(&items);
        assert_eq!(
            out,
            vec![RelicScanItem {
                tier: "Axi".into(),
                name: "A1".into(),
                refinement: "Intact".into(),
                qty: 5,
            }]
        );
    }

    #[test]
    fn parses_de_shape_with_ranks() {
        let sample = include_str!("testdata/inventory_sample.json");
        let json: Value = serde_json::from_str(sample).expect("valid fixture json");
        let raw = parse_inventory(&json);
        assert_eq!(raw.account_id.as_deref(), Some("abc123"));
        let out = resolve(&raw.items, &sample_map());
        // Barrel x3 (rank None) + Receiver x1 + mod rank0 x9 + mod rank5 x1; resource dropped.
        assert_eq!(out.len(), 4);
        let barrel = out.iter().find(|i| i.slug == "soma_prime_barrel").unwrap();
        assert_eq!((barrel.rank, barrel.qty), (None, 3));
        // The mod splits by rank: 9 stacked unranked (RawUpgrades) + 1 at lvl 5 (Upgrades).
        let r0 = out
            .iter()
            .find(|i| i.slug == "pistol_gambit" && i.rank == Some(0))
            .unwrap();
        let r5 = out
            .iter()
            .find(|i| i.slug == "pistol_gambit" && i.rank == Some(5))
            .unwrap();
        assert_eq!(r0.qty, 9);
        assert_eq!(r5.qty, 1);
    }
}
