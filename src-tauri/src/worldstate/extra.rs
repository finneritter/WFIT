//! Extra warframestat blocks — sortie, archon hunt, Steel Path (Teshin), the
//! two traders (Baro / Varzia), Nightwave and invasions. All parsed from the
//! SAME `/pc/` response the cycles/fissures already come from, so they cost
//! zero additional requests.
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
    pub rotation: Vec<SpReward>, // the full 8-week Teshin featured cycle
    pub evergreens: Vec<SpReward>, // the permanent Teshin Steel-Essence shop
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VendorItem {
    pub item: String,
    /// DE `uniqueName` — the stable id we resolve to a market slug via `game_ref`
    /// (the display `item` string is often mangled, e.g. "M P V Equinox Prime …").
    pub unique_name: Option<String>,
    /// Baro: ducats. Varzia: the wrapper puts DE's `PrimePrice` here — that is
    /// **Regal Aya** (verified 2026-07-02 vs DE raw `PrimeVaultTraders[].Manifest`).
    pub ducats: Option<i64>,
    /// Baro: the credits component. Varzia: DE's `RegularPrice` = **Aya** (relics).
    /// `db/vendor.rs::enrich` resolves the per-item currency from this pair.
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NightwaveChallenge {
    pub title: String,
    pub desc: Option<String>,
    pub reputation: i64,
    pub is_daily: bool,
    pub is_elite: bool,
    pub expiry: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nightwave {
    pub season: Option<i64>,
    pub expiry: Option<String>, // season end
    /// Active challenges, biggest standing first (elite → weekly → daily).
    pub challenges: Vec<NightwaveChallenge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invasion {
    pub node: String,
    pub attacker: String, // faction
    pub defender: String,
    pub attacker_reward: Option<String>, // "2 Fieldron" — None on the infested side
    pub defender_reward: Option<String>,
    /// Attacker-side progress, 0–100.
    pub completion: f64,
    pub eta: Option<String>,
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
    #[serde(default)]
    evergreens: Vec<RawSpReward>,
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
    #[serde(rename = "uniqueName")]
    unique_name: Option<String>,
    ducats: Option<i64>,
    credits: Option<i64>,
}

#[derive(Deserialize)]
struct RawNightwave {
    season: Option<i64>,
    expiry: Option<String>,
    #[serde(default, rename = "activeChallenges")]
    active_challenges: Vec<RawNwChallenge>,
}

#[derive(Deserialize)]
struct RawNwChallenge {
    title: Option<String>,
    desc: Option<String>,
    reputation: Option<i64>,
    #[serde(default, rename = "isDaily")]
    is_daily: bool,
    #[serde(default, rename = "isElite")]
    is_elite: bool,
    expiry: Option<String>,
}

#[derive(Deserialize)]
struct RawInvasion {
    node: Option<String>,
    #[serde(default)]
    completed: bool,
    completion: Option<f64>,
    eta: Option<String>,
    attacker: Option<RawInvSide>,
    defender: Option<RawInvSide>,
}

#[derive(Deserialize)]
struct RawInvSide {
    faction: Option<String>,
    reward: Option<RawInvReward>,
}

#[derive(Deserialize)]
struct RawInvReward {
    #[serde(rename = "asString")]
    as_string: Option<String>,
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
        evergreens: raw.evergreens.into_iter().map(reward).collect(),
    })
}

/// Varzia's aya-priced relics come through as raw projection names —
/// "T1 Void Projection Wukong Equinox Vault A Bronze". Rewrite to the in-game
/// vocabulary: "Lith Relic (Vault A)". T1..T4 = Lith/Meso/Neo/Axi; the trailing
/// refinement is always Bronze (= Intact), so it's dropped. Which *specific*
/// relic (e.g. "Lith W1") is not encoded anywhere in the payload. Returns None
/// for anything that isn't a projection name (leaves the item untouched).
fn prettify_relic_projection(name: &str) -> Option<String> {
    let rest = name.strip_prefix("T").and_then(|s| {
        let (tier, rest) = s.split_once(" Void Projection ")?;
        Some((tier, rest))
    });
    let (tier, rest) = rest?;
    let era = match tier {
        "1" => "Lith",
        "2" => "Meso",
        "3" => "Neo",
        "4" => "Axi",
        _ => return None,
    };
    // "…theme… Vault A Bronze" → keep the vault letter, drop theme + refinement.
    let vault = rest
        .rsplit_once(" Vault ")
        .map(|(_, tail)| tail.split_whitespace().next().unwrap_or(""))
        .filter(|l| !l.is_empty());
    Some(match vault {
        Some(letter) => format!("{era} Relic (Vault {letter})"),
        None => format!("{era} Relic"),
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
                let item = prettify_relic_projection(&item).unwrap_or(item);
                Some(VendorItem {
                    item,
                    unique_name: i.unique_name,
                    ducats: i.ducats,
                    credits: i.credits,
                })
            })
            .collect(),
    })
}

pub(super) fn nightwave_from(v: Option<Value>) -> Option<Nightwave> {
    let raw: RawNightwave = serde_json::from_value(v?).ok()?;
    let mut challenges: Vec<NightwaveChallenge> = raw
        .active_challenges
        .into_iter()
        .filter_map(|c| {
            Some(NightwaveChallenge {
                title: c.title?,
                desc: c.desc,
                reputation: c.reputation.unwrap_or(0),
                is_daily: c.is_daily,
                is_elite: c.is_elite,
                expiry: c.expiry,
            })
        })
        .collect();
    if challenges.is_empty() {
        return None; // between seasons / shape drift — hide the panel
    }
    // Biggest standing first: elite weeklies → weeklies → dailies.
    challenges.sort_by_key(|c| std::cmp::Reverse(c.reputation));
    Some(Nightwave {
        season: raw.season,
        expiry: raw.expiry,
        challenges,
    })
}

/// Live (uncompleted) invasions; an unparseable payload degrades to empty.
pub(super) fn invasions_from(v: Option<Value>) -> Vec<Invasion> {
    let Some(v) = v else { return Vec::new() };
    let raw: Vec<RawInvasion> = serde_json::from_value(v).unwrap_or_default();
    let reward = |s: &Option<RawInvSide>| {
        s.as_ref()
            .and_then(|x| x.reward.as_ref())
            .and_then(|r| r.as_string.clone())
            .filter(|s| !s.is_empty())
    };
    raw.into_iter()
        .filter(|i| !i.completed)
        .filter_map(|i| {
            Some(Invasion {
                node: i.node?,
                attacker: i
                    .attacker
                    .as_ref()
                    .and_then(|s| s.faction.clone())
                    .unwrap_or_default(),
                defender: i
                    .defender
                    .as_ref()
                    .and_then(|s| s.faction.clone())
                    .unwrap_or_default(),
                attacker_reward: reward(&i.attacker),
                defender_reward: reward(&i.defender),
                completion: i.completion.unwrap_or(0.0).clamp(0.0, 100.0),
                eta: i.eta,
            })
        })
        .collect()
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
                {"uniqueName": "/y", "item": "Boltor Prime", "ducats": 2, "credits": null},
                {"uniqueName": "/z", "item": "T1 Void Projection Wukong Equinox Vault A Bronze", "ducats": null, "credits": 1}
            ]
        })))
        .expect("varzia");
        assert!(t.active); // now is inside the window
        assert_eq!(t.inventory[0].item, "Rhino Prime Single Pack");
        assert_eq!(t.inventory[1].item, "Boltor Prime");
        assert_eq!(t.inventory[0].ducats, Some(6)); // Regal Aya (DE PrimePrice)
        assert_eq!(t.inventory[1].unique_name.as_deref(), Some("/y")); // captured for game_ref resolution
                                                                       // Aya-priced relic projection: readable name, credits carries the aya cost.
        assert_eq!(t.inventory[2].item, "Lith Relic (Vault A)");
        assert_eq!(t.inventory[2].credits, Some(1));
        assert_eq!(t.inventory[2].unique_name.as_deref(), Some("/z")); // item_ref unchanged
    }

    #[test]
    fn prettifies_relic_projections_only() {
        assert_eq!(
            prettify_relic_projection("T4 Void Projection Wukong Equinox Vault B Bronze")
                .as_deref(),
            Some("Axi Relic (Vault B)")
        );
        assert_eq!(prettify_relic_projection("Boltor Prime"), None);
        assert_eq!(prettify_relic_projection("Tipedo Prime Weapon"), None);
    }

    #[test]
    fn parses_nightwave_sorted_by_standing() {
        let nw = nightwave_from(Some(json!({
            "season": 8, "expiry": "2026-07-01T00:00:00.000Z",
            "activeChallenges": [
                {"title": "Complete 3 different missions", "reputation": 1000, "isDaily": true},
                {"title": "Complete 3 Sorties or Archon Hunt missions", "reputation": 7000, "isElite": true},
                {"title": "Kill 150 enemies with a status effect", "reputation": 4500}
            ]
        })))
        .expect("nightwave");
        assert_eq!(nw.season, Some(8));
        assert_eq!(nw.challenges.len(), 3);
        assert_eq!(nw.challenges[0].reputation, 7000); // elite first
        assert!(nw.challenges[0].is_elite);
        assert!(nw.challenges[2].is_daily);
    }

    #[test]
    fn parses_invasions_and_drops_completed() {
        let inv = invasions_from(Some(json!([
            {"node": "Sangeru (Sedna)", "completed": false, "completion": 62.4,
             "attacker": {"faction": "Grineer", "reward": {"asString": "2 Fieldron"}},
             "defender": {"faction": "Corpus", "reward": {"asString": "2 Detonite Injector"}}},
            {"node": "Naeglar (Eris)", "completed": false, "completion": 10.0,
             "attacker": {"faction": "Infested", "reward": null},
             "defender": {"faction": "Corpus", "reward": {"asString": "3 Mutagen Mass"}}},
            {"node": "Done (Mars)", "completed": true, "completion": 100.0}
        ])));
        assert_eq!(inv.len(), 2);
        assert_eq!(inv[0].attacker_reward.as_deref(), Some("2 Fieldron"));
        assert_eq!(inv[1].attacker_reward, None); // infested side pays nothing
        assert_eq!(inv[1].defender_reward.as_deref(), Some("3 Mutagen Mass"));
    }

    #[test]
    fn bad_shapes_degrade_to_none() {
        assert!(sortie_from(None).is_none());
        assert!(sortie_from(Some(json!("not an object"))).is_none());
        assert!(steel_path_from(Some(json!(42))).is_none());
        assert!(trader_from(Some(json!([]))).is_none());
        // sortie with no missions at all → None (panel hidden)
        assert!(sortie_from(Some(json!({"boss": "X", "variants": [], "missions": []}))).is_none());
        // nightwave with no challenges → None; junk invasions → empty
        assert!(nightwave_from(Some(json!({"season": 8, "activeChallenges": []}))).is_none());
        assert!(invasions_from(Some(json!("junk"))).is_empty());
        assert!(invasions_from(None).is_empty());
    }
}
