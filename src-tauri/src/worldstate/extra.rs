//! Extra warframestat blocks — sortie, archon hunt, Steel Path (Teshin) and the
//! two traders (Baro / Varzia). All parsed from the SAME `/pc/` response the
//! cycles/fissures already come from, so they cost zero additional requests.
//!
//! Each block arrives as an untyped `serde_json::Value` and is parsed here with
//! `from_value(..).ok()` — a shape change in one block degrades that block to
//! `None` instead of failing the whole worldstate payload.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Frontend-facing shapes.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortieMission {
    pub node: String,
    pub mission_type: String,
    pub modifier: Option<String>,
    pub modifier_desc: Option<String>,
}

/// One shape for both the daily sortie and the weekly archon hunt — the hunt is
/// just a sortie with `missions[]` instead of `variants[]` and no modifiers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sortie {
    pub boss: String,
    pub faction: String,
    pub activation: Option<String>,
    pub expiry: Option<String>,
    pub missions: Vec<SortieMission>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpReward {
    pub name: String,
    pub cost: Option<i64>, // Steel Essence
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteelPath {
    pub current_reward: Option<SpReward>,
    pub activation: Option<String>,
    pub expiry: Option<String>,
    pub rotation: Vec<SpReward>, // the full 8-week Teshin cycle
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VendorItem {
    pub item: String,
    /// Baro: ducats. Varzia: the wrapper reuses this key for the AYA cost —
    /// the UI labels it accordingly.
    pub ducats: Option<i64>,
    pub credits: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trader {
    pub active: bool,
    pub activation: Option<String>, // ISO — arrival / rotation start
    pub expiry: Option<String>,     // ISO — departure / rotation end
    pub location: Option<String>,
    pub character: Option<String>,
    pub inventory: Vec<VendorItem>,
}

// ---------------------------------------------------------------------------
// Raw warframestat shapes (camelCase).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RawSortie {
    boss: Option<String>,
    faction: Option<String>,
    activation: Option<String>,
    expiry: Option<String>,
    #[serde(default)]
    variants: Vec<RawVariant>, // daily sortie
    #[serde(default)]
    missions: Vec<RawArchonMission>, // archon hunt
}

#[derive(Deserialize)]
struct RawVariant {
    #[serde(rename = "missionType")]
    mission_type: Option<String>,
    modifier: Option<String>,
    #[serde(rename = "modifierDescription")]
    modifier_description: Option<String>,
    node: Option<String>,
}

#[derive(Deserialize)]
struct RawArchonMission {
    node: Option<String>,
    #[serde(rename = "type")]
    mission_type: Option<String>,
}

#[derive(Deserialize)]
struct RawSteelPath {
    #[serde(rename = "currentReward")]
    current_reward: Option<RawSpReward>,
    activation: Option<String>,
    expiry: Option<String>,
    #[serde(default)]
    rotation: Vec<RawSpReward>,
}

#[derive(Deserialize)]
struct RawSpReward {
    name: Option<String>,
    cost: Option<i64>,
}

#[derive(Deserialize)]
struct RawTrader {
    activation: Option<String>,
    expiry: Option<String>,
    location: Option<String>,
    character: Option<String>,
    #[serde(default)]
    inventory: Vec<RawVendorItem>,
}

#[derive(Deserialize)]
struct RawVendorItem {
    item: Option<String>,
    ducats: Option<i64>,
    credits: Option<i64>,
}

// ---------------------------------------------------------------------------
// Parsers — Option in, Option out; never error.
// ---------------------------------------------------------------------------

/// Daily sortie AND weekly archon hunt (missions come from whichever of
/// `variants[]` / `missions[]` is populated).
pub(super) fn sortie_from(v: Option<Value>) -> Option<Sortie> {
    let raw: RawSortie = serde_json::from_value(v?).ok()?;
    let missions: Vec<SortieMission> = if raw.variants.is_empty() {
        raw.missions
            .into_iter()
            .map(|m| SortieMission {
                node: m.node.unwrap_or_default(),
                mission_type: m.mission_type.unwrap_or_default(),
                modifier: None,
                modifier_desc: None,
            })
            .collect()
    } else {
        raw.variants
            .into_iter()
            .map(|m| SortieMission {
                node: m.node.unwrap_or_default(),
                mission_type: m.mission_type.unwrap_or_default(),
                modifier: m.modifier,
                modifier_desc: m.modifier_description,
            })
            .collect()
    };
    if missions.is_empty() {
        return None; // between rotations / shape drift — hide the panel
    }
    Some(Sortie {
        boss: raw.boss.unwrap_or_default(),
        faction: raw.faction.unwrap_or_default(),
        activation: raw.activation,
        expiry: raw.expiry,
        missions,
    })
}

pub(super) fn steel_path_from(v: Option<Value>) -> Option<SteelPath> {
    let raw: RawSteelPath = serde_json::from_value(v?).ok()?;
    let reward = |r: RawSpReward| SpReward {
        name: r.name.unwrap_or_default(),
        cost: r.cost,
    };
    Some(SteelPath {
        current_reward: raw.current_reward.map(reward),
        activation: raw.activation,
        expiry: raw.expiry,
        rotation: raw.rotation.into_iter().map(reward).collect(),
    })
}

pub(super) fn trader_from(v: Option<Value>) -> Option<Trader> {
    let raw: RawTrader = serde_json::from_value(v?).ok()?;
    let now = Utc::now();
    let parse = |s: &str| chrono::DateTime::parse_from_rfc3339(s).ok();
    let active = match (raw.activation.as_deref(), raw.expiry.as_deref()) {
        (Some(a), Some(e)) => {
            matches!((parse(a), parse(e)), (Some(a), Some(e)) if a <= now && now < e)
        }
        _ => false,
    };
    Some(Trader {
        active,
        activation: raw.activation,
        expiry: raw.expiry,
        location: raw.location,
        character: raw.character,
        inventory: raw
            .inventory
            .into_iter()
            .filter_map(|i| {
                let item = i.item?;
                // Varzia's vault packs come through name-mangled ("M P V Rhino
                // Prime Single Pack") — drop the internal MPV prefix.
                let item = item.strip_prefix("M P V ").unwrap_or(&item).to_string();
                Some(VendorItem {
                    item,
                    ducats: i.ducats,
                    credits: i.credits,
                })
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_sortie_variants() {
        let s = sortie_from(Some(json!({
            "boss": "Mutalist Alad V", "faction": "Infestation",
            "activation": "2026-06-05T16:00:00.000Z", "expiry": "2026-06-06T16:00:00.000Z",
            "variants": [
                {"missionType": "Interception", "modifier": "Weapon Restriction: Assault Rifle Only",
                 "modifierDescription": "Only assault rifles.", "node": "Cassini (Saturn)"},
                {"missionType": "Assassination", "modifier": "Eximus Stronghold", "node": "Nimus (Eris)"}
            ],
            "missions": []
        })))
        .expect("sortie");
        assert_eq!(s.boss, "Mutalist Alad V");
        assert_eq!(s.missions.len(), 2);
        assert_eq!(s.missions[0].mission_type, "Interception");
        assert!(s.missions[0]
            .modifier
            .as_deref()
            .unwrap()
            .starts_with("Weapon"));
    }

    #[test]
    fn parses_archon_missions() {
        let a = sortie_from(Some(json!({
            "boss": "Archon Nira", "faction": "Narmer",
            "expiry": "2026-06-08T00:00:00.000Z",
            "variants": [],
            "missions": [
                {"node": "Carme (Jupiter)", "type": "Spy"},
                {"node": "Themisto (Jupiter)", "type": "Assassination"}
            ]
        })))
        .expect("archon");
        assert_eq!(a.missions.len(), 2);
        assert_eq!(a.missions[0].mission_type, "Spy");
        assert!(a.missions[0].modifier.is_none());
    }

    #[test]
    fn parses_steel_path() {
        let sp = steel_path_from(Some(json!({
            "currentReward": {"name": "50,000 Kuva", "cost": 55},
            "activation": "2026-06-01T00:00:00.000Z", "expiry": "2026-06-07T23:59:59.000Z",
            "rotation": [{"name": "Umbra Forma Blueprint", "cost": 150}, {"name": "50,000 Kuva", "cost": 55}]
        })))
        .expect("steel path");
        assert_eq!(sp.current_reward.unwrap().name, "50,000 Kuva");
        assert_eq!(sp.rotation.len(), 2);
    }

    #[test]
    fn parses_varzia_and_cleans_mpv_names() {
        let t = trader_from(Some(json!({
            "activation": "2026-05-14T18:00:00.000Z", "expiry": "2099-06-11T18:00:00.000Z",
            "character": "Varzia", "location": "Maroo's Bazaar (Mars)",
            "inventory": [
                {"uniqueName": "/x", "item": "M P V Rhino Prime Single Pack", "ducats": 6, "credits": null},
                {"uniqueName": "/y", "item": "Boltor Prime", "ducats": 2, "credits": null}
            ]
        })))
        .expect("varzia");
        assert!(t.active); // now is inside the window
        assert_eq!(t.inventory[0].item, "Rhino Prime Single Pack");
        assert_eq!(t.inventory[1].item, "Boltor Prime");
        assert_eq!(t.inventory[0].ducats, Some(6)); // aya, labeled by the UI
    }

    #[test]
    fn bad_shapes_degrade_to_none() {
        assert!(sortie_from(None).is_none());
        assert!(sortie_from(Some(json!("not an object"))).is_none());
        assert!(steel_path_from(Some(json!(42))).is_none());
        assert!(trader_from(Some(json!([]))).is_none());
        // sortie with no missions at all → None (panel hidden)
        assert!(sortie_from(Some(json!({"boss": "X", "variants": [], "missions": []}))).is_none());
    }
}
