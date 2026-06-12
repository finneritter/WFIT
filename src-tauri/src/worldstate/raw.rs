//! DE's raw worldstate — the AUTHORITATIVE fissure source, used to cross-check
//! (and replace) warframestat.us's fissure list, whose origin ingest lags real
//! time by minutes. The raw feed is undocumented internal-ID JSON, so only the
//! few fields we need are parsed, decoded via two bundled maps:
//!
//! - `data/sol_nodes.tsv` — SolNode### → "Name (Planet)" + enemy + node
//!   mission type (regenerate from WFCD warframe-worldstate-data
//!   solNodes.json; see docs/GAMESTATE_WORLDSTATE.md).
//! - `MISSION_TYPES` — MT_* → display name (small, hardcoded).
//!
//! Both are the same data warframestat itself decodes with, so display strings
//! stay identical to the wrapper's. Unknown IDs degrade to the raw ID rather
//! than dropping the row — new content stays visible, just less pretty.

use super::extra::{Invasion, Sortie, SortieMission};
use super::Fissure;
use crate::error::AppResult;
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;

// Host moved off content.warframe.com/dynamic (now a 301). DE serves this with
// `Cache-Control: max-age=43`, which we respect — ≤43s of CDN staleness is
// negligible against fissure lifetimes; no cache-buster needed here.
const RAW_URL: &str = "https://api.warframe.com/cdn/worldState.php";

// MT_* → display name, per WFCD warframe-worldstate-data missionTypes.json.
const MISSION_TYPES: &[(&str, &str)] = &[
    ("MT_ALCHEMY", "Alchemy"),
    ("MT_ARENA", "Rathuum"),
    ("MT_ARTIFACT", "Disruption"),
    ("MT_ASCENSION", "Ascension"),
    ("MT_ASSASSINATION", "Assassination"),
    ("MT_ASSAULT", "Assault"),
    ("MT_CAPTURE", "Capture"),
    ("MT_CORRUPTION", "Void Flood"),
    ("MT_DEFAULT", "Unknown"),
    ("MT_DEFENSE", "Defense"),
    ("MT_DISRUPTION", "Disruption"),
    ("MT_ENDLESS_CAPTURE", "Legacyte Harvest"),
    ("MT_EVACUATION", "Defection"),
    ("MT_EXCAVATE", "Excavation"),
    ("MT_EXTERMINATION", "Extermination"),
    ("MT_HIVE", "Hive"),
    ("MT_INTEL", "Spy"),
    ("MT_LANDSCAPE", "Free Roam"),
    ("MT_MOBILE_DEFENSE", "Mobile Defense"),
    ("MT_PVP", "Conclave"),
    ("MT_RESCUE", "Rescue"),
    ("MT_RETRIEVAL", "Hijack"),
    ("MT_SABOTAGE", "Sabotage"),
    ("MT_SECTOR", "Dark Sector"),
    ("MT_SURVIVAL", "Survival"),
    ("MT_TERRITORY", "Interception"),
    ("MT_VOID_CASCADE", "Void Cascade"),
];

// SORTIE_BOSS_* → (display name, faction) — warframestat's own translations.
const SORTIE_BOSSES: &[(&str, &str, &str)] = &[
    ("SORTIE_BOSS_VOR", "Captain Vor", "Grineer"),
    ("SORTIE_BOSS_HEK", "Councilor Vay Hek", "Grineer"),
    ("SORTIE_BOSS_RUK", "General Sargas Ruk", "Grineer"),
    ("SORTIE_BOSS_KELA", "Kela De Thaym", "Grineer"),
    ("SORTIE_BOSS_KRIL", "Lieutenant Lech Kril", "Grineer"),
    ("SORTIE_BOSS_TYL", "Tyl Regor", "Grineer"),
    ("SORTIE_BOSS_ALAD", "Alad V", "Corpus"),
    ("SORTIE_BOSS_AMBULAS", "Ambulas", "Corpus"),
    ("SORTIE_BOSS_HYENA", "Hyena Pack", "Corpus"),
    ("SORTIE_BOSS_NEF", "Nef Anyo", "Corpus"),
    ("SORTIE_BOSS_RAPTOR", "Raptor", "Corpus"),
    ("SORTIE_BOSS_JACKAL", "Jackal", "Corpus"),
    ("SORTIE_BOSS_PHORID", "Phorid", "Infested"),
    ("SORTIE_BOSS_LEPHANTIS", "Lephantis", "Infested"),
    ("SORTIE_BOSS_INFALAD", "Mutalist Alad V", "Infestation"),
    ("SORTIE_BOSS_CORRUPTED_VOR", "Corrupted Vor", "Corrupted"),
    ("SORTIE_BOSS_AMAR", "Archon Amar", "Narmer"),
    ("SORTIE_BOSS_NIRA", "Archon Nira", "Narmer"),
    ("SORTIE_BOSS_BOREAL", "Archon Boreal", "Narmer"),
];

// SORTIE_MODIFIER_* → display text. Unknowns degrade via prettify().
const SORTIE_MODIFIERS: &[(&str, &str)] = &[
    ("SORTIE_MODIFIER_LOW_ENERGY", "Energy Reduction"),
    (
        "SORTIE_MODIFIER_IMPACT",
        "Enemy Physical Enhancement: Impact",
    ),
    ("SORTIE_MODIFIER_SLASH", "Enemy Physical Enhancement: Slash"),
    (
        "SORTIE_MODIFIER_PUNCTURE",
        "Enemy Physical Enhancement: Puncture",
    ),
    ("SORTIE_MODIFIER_EXIMUS", "Eximus Stronghold"),
    (
        "SORTIE_MODIFIER_MAGNETIC",
        "Enemy Elemental Enhancement: Magnetic",
    ),
    (
        "SORTIE_MODIFIER_CORROSIVE",
        "Enemy Elemental Enhancement: Corrosive",
    ),
    (
        "SORTIE_MODIFIER_VIRAL",
        "Enemy Elemental Enhancement: Viral",
    ),
    (
        "SORTIE_MODIFIER_ELECTRICITY",
        "Enemy Elemental Enhancement: Electricity",
    ),
    (
        "SORTIE_MODIFIER_RADIATION",
        "Enemy Elemental Enhancement: Radiation",
    ),
    ("SORTIE_MODIFIER_GAS", "Enemy Elemental Enhancement: Gas"),
    ("SORTIE_MODIFIER_FIRE", "Enemy Elemental Enhancement: Heat"),
    ("SORTIE_MODIFIER_ICE", "Enemy Elemental Enhancement: Cold"),
    (
        "SORTIE_MODIFIER_TOXIN",
        "Enemy Elemental Enhancement: Toxin",
    ),
    ("SORTIE_MODIFIER_ARMOR", "Augmented Enemy Armor"),
    ("SORTIE_MODIFIER_SHIELDS", "Enhanced Enemy Shields"),
    (
        "SORTIE_MODIFIER_SECONDARY_ONLY",
        "Weapon Restriction: Secondary Only",
    ),
    (
        "SORTIE_MODIFIER_SHOTGUN_ONLY",
        "Weapon Restriction: Shotgun Only",
    ),
    (
        "SORTIE_MODIFIER_SNIPER_ONLY",
        "Weapon Restriction: Sniper Only",
    ),
    (
        "SORTIE_MODIFIER_RIFLE_ONLY",
        "Weapon Restriction: Assault Rifle Only",
    ),
    (
        "SORTIE_MODIFIER_MELEE_ONLY",
        "Weapon Restriction: Melee Only",
    ),
    ("SORTIE_MODIFIER_BOW_ONLY", "Weapon Restriction: Bow Only"),
    (
        "SORTIE_MODIFIER_HAZARD_RADIATION",
        "Hazard: Radiation Pockets",
    ),
    (
        "SORTIE_MODIFIER_HAZARD_MAGNETIC",
        "Hazard: Electromagnetic Anomalies",
    ),
    ("SORTIE_MODIFIER_HAZARD_FOG", "Hazard: Dense Fog"),
    ("SORTIE_MODIFIER_HAZARD_FIRE", "Hazard: Fire Hazard"),
    ("SORTIE_MODIFIER_HAZARD_ICE", "Hazard: Cryogenic Leakage"),
    ("SORTIE_MODIFIER_HAZARD_COLD", "Hazard: Extreme Cold"),
];

// FC_* faction codes (invasions).
const FACTIONS: &[(&str, &str)] = &[
    ("FC_GRINEER", "Grineer"),
    ("FC_CORPUS", "Corpus"),
    ("FC_INFESTATION", "Infested"),
    ("FC_INFESTED", "Infested"),
    ("FC_OROKIN", "Corrupted"),
    ("FC_NARMER", "Narmer"),
];

// Invasion reward items whose internal name isn't just camel-cased words.
const INVASION_ITEMS: &[(&str, &str)] = &[
    ("EnergyComponent", "Fieldron"),
    ("ChemComponent", "Detonite Injector"),
    ("BioComponent", "Mutagen Mass"),
    ("InfestedAladCoordinate", "Mutalist Alad V Nav Coordinate"),
    ("UtilityUnlockerBlueprint", "Exilus Adapter Blueprint"),
    (
        "WeaponUtilityUnlockerBlueprint",
        "Exilus Weapon Adapter Blueprint",
    ),
];

pub(super) struct NodeInfo {
    pub(super) name: &'static str,
    pub(super) enemy: &'static str,
    pub(super) mission: &'static str,
}

/// Decode a raw node id (also used by `arbys` for the arbitration schedule,
/// whose entries are keyed by the same SolNode/ClanNode/SettlementNode ids).
pub(super) fn node_info(id: &str) -> Option<&'static NodeInfo> {
    NODES.get(id)
}

static NODES: Lazy<HashMap<&'static str, NodeInfo>> = Lazy::new(|| {
    include_str!("data/sol_nodes.tsv")
        .lines()
        .filter_map(|l| {
            let mut f = l.split('\t');
            Some((
                f.next()?,
                NodeInfo {
                    name: f.next()?,
                    enemy: f.next().unwrap_or(""),
                    mission: f.next().unwrap_or(""),
                },
            ))
        })
        .collect()
});

fn tier_of(modifier: &str) -> Option<&'static str> {
    Some(match modifier {
        "VoidT1" => "Lith",
        "VoidT2" => "Meso",
        "VoidT3" => "Neo",
        "VoidT4" => "Axi",
        "VoidT5" => "Requiem",
        "VoidT6" => "Omnia",
        _ => return None,
    })
}

fn mission_name(mt: &str) -> String {
    MISSION_TYPES
        .iter()
        .find(|(k, _)| *k == mt)
        .map(|(_, v)| (*v).to_string())
        // Unknown MT_NEW_THING → "New Thing" rather than an internal ID.
        .unwrap_or_else(|| {
            let words = mt.trim_start_matches("MT_").split('_');
            words
                .map(|w| {
                    let mut c = w.chars();
                    match c.next() {
                        Some(f) => f
                            .to_uppercase()
                            .chain(c.flat_map(char::to_lowercase))
                            .collect(),
                        None => String::new(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
}

/// "SOME_INTERNAL_ID" → "Some Internal Id" (the unknown-ID fallback).
fn prettify(id: &str) -> String {
    id.split('_')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f
                    .to_uppercase()
                    .chain(c.flat_map(char::to_lowercase))
                    .collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// "KarakWraithBarrel" → "Karak Wraith Barrel" (invasion weapon parts).
fn split_camel(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for (i, ch) in s.chars().enumerate() {
        if ch.is_uppercase() && i > 0 {
            out.push(' ');
        }
        out.push(ch);
    }
    out
}

fn boss_info(id: &str) -> (String, String) {
    SORTIE_BOSSES
        .iter()
        .find(|(k, _, _)| *k == id)
        .map(|(_, name, faction)| ((*name).to_string(), (*faction).to_string()))
        .unwrap_or_else(|| {
            (
                prettify(id.trim_start_matches("SORTIE_BOSS_")),
                String::new(),
            )
        })
}

fn modifier_name(id: &str) -> String {
    SORTIE_MODIFIERS
        .iter()
        .find(|(k, _)| *k == id)
        .map(|(_, v)| (*v).to_string())
        .unwrap_or_else(|| prettify(id.trim_start_matches("SORTIE_MODIFIER_")))
}

fn faction_name(fc: &str) -> String {
    FACTIONS
        .iter()
        .find(|(k, _)| *k == fc)
        .map(|(_, v)| (*v).to_string())
        .unwrap_or_else(|| prettify(fc.trim_start_matches("FC_")))
}

/// Full node display ("Tamu (Deimos)"), degrading to the raw id.
fn node_name(id: &str) -> String {
    NODES
        .get(id)
        .map_or_else(|| id.to_string(), |n| n.name.to_string())
}

/// "/Lotus/Types/Items/Research/EnergyComponent" ×3 → "3 Fieldron".
fn invasion_reward(items: &[RawCountedItem]) -> Option<String> {
    let parts: Vec<String> = items
        .iter()
        .filter_map(|ci| {
            let tail = ci.item_type.as_deref()?.rsplit('/').next()?;
            let name = INVASION_ITEMS
                .iter()
                .find(|(k, _)| *k == tail)
                .map(|(_, v)| (*v).to_string())
                .unwrap_or_else(|| split_camel(tail));
            let n = ci.item_count.unwrap_or(1);
            Some(if n > 1 { format!("{n} {name}") } else { name })
        })
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" + "))
    }
}

// ---------------------------------------------------------------------------
// Raw shapes (Mongo-export style: dates as {"$date":{"$numberLong":"ms"}}).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RawDate {
    #[serde(rename = "$date")]
    date: RawDateInner,
}
#[derive(Deserialize)]
struct RawDateInner {
    #[serde(rename = "$numberLong")]
    ms: String,
}

fn to_iso(d: &Option<RawDate>) -> Option<String> {
    let ms: i64 = d.as_ref()?.date.ms.parse().ok()?;
    Some(chrono::DateTime::from_timestamp_millis(ms)?.to_rfc3339())
}

#[derive(Deserialize)]
struct RawWorld {
    #[serde(rename = "Time")]
    time: Option<i64>, // unix seconds — DE's own snapshot clock
    #[serde(default, rename = "ActiveMissions")]
    active_missions: Vec<RawMission>,
    #[serde(default, rename = "VoidStorms")]
    void_storms: Vec<RawStorm>,
    #[serde(default, rename = "SyndicateMissions")]
    syndicate_missions: Vec<RawSyndicate>,
    #[serde(default, rename = "Sorties")]
    sorties: Vec<RawDeSortie>,
    #[serde(default, rename = "LiteSorties")]
    lite_sorties: Vec<RawLiteSortie>,
    #[serde(default, rename = "Invasions")]
    invasions: Vec<RawDeInvasion>,
}

#[derive(Deserialize)]
struct RawDeSortie {
    #[serde(rename = "Boss")]
    boss: Option<String>,
    #[serde(rename = "Activation")]
    activation: Option<RawDate>,
    #[serde(rename = "Expiry")]
    expiry: Option<RawDate>,
    #[serde(default, rename = "Variants")]
    variants: Vec<RawDeVariant>,
}

#[derive(Deserialize)]
struct RawDeVariant {
    #[serde(rename = "missionType")]
    mission_type: Option<String>,
    #[serde(rename = "modifierType")]
    modifier_type: Option<String>,
    node: Option<String>,
}

#[derive(Deserialize)]
struct RawLiteSortie {
    #[serde(rename = "Boss")]
    boss: Option<String>,
    #[serde(rename = "Activation")]
    activation: Option<RawDate>,
    #[serde(rename = "Expiry")]
    expiry: Option<RawDate>,
    #[serde(default, rename = "Missions")]
    missions: Vec<RawLiteMission>,
}

#[derive(Deserialize)]
struct RawLiteMission {
    #[serde(rename = "missionType")]
    mission_type: Option<String>,
    node: Option<String>,
}

#[derive(Deserialize)]
struct RawDeInvasion {
    #[serde(rename = "Node")]
    node: Option<String>,
    #[serde(rename = "Count")]
    count: Option<i64>, // attacker progress; negative = defender winning
    #[serde(rename = "Goal")]
    goal: Option<i64>,
    #[serde(default, rename = "Completed")]
    completed: bool,
    #[serde(rename = "Faction")]
    attacker_faction: Option<String>, // top-level Faction IS the attacker
    #[serde(rename = "DefenderFaction")]
    defender_faction: Option<String>,
    // Rewards arrive as {"countedItems": […]} but degrade to "" / {} on the
    // infested side — keep them untyped and dig the items out tolerantly.
    #[serde(rename = "AttackerReward")]
    attacker_reward: Option<serde_json::Value>,
    #[serde(rename = "DefenderReward")]
    defender_reward: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct RawCountedItem {
    #[serde(rename = "ItemType")]
    item_type: Option<String>,
    #[serde(rename = "ItemCount")]
    item_count: Option<i64>,
}

fn counted_from(v: &Option<serde_json::Value>) -> Vec<RawCountedItem> {
    v.as_ref()
        .and_then(|v| v.get("countedItems"))
        .and_then(|ci| serde_json::from_value(ci.clone()).ok())
        .unwrap_or_default()
}

/// Bounty rotation windows. The Ostron (CetusSyndicate) expiry doubles as the
/// Cetus day/night clock anchor — bounties rotate exactly at night's end.
#[derive(Deserialize)]
struct RawSyndicate {
    #[serde(rename = "Tag")]
    tag: Option<String>,
    #[serde(rename = "Expiry")]
    expiry: Option<RawDate>,
}

#[derive(Deserialize)]
struct RawMission {
    #[serde(rename = "Expiry")]
    expiry: Option<RawDate>,
    #[serde(rename = "Node")]
    node: Option<String>,
    #[serde(rename = "MissionType")]
    mission_type: Option<String>,
    #[serde(rename = "Modifier")]
    modifier: Option<String>,
    #[serde(default, rename = "Hard")]
    hard: bool,
}

#[derive(Deserialize)]
struct RawStorm {
    #[serde(rename = "Expiry")]
    expiry: Option<RawDate>,
    #[serde(rename = "Node")]
    node: Option<String>,
    #[serde(rename = "ActiveMissionTier")]
    tier: Option<String>,
}

/// Decoded raw worldstate — fissures (the cross-check) plus the blocks that
/// double as warframestat fallbacks (sortie / archon hunt / invasions), so
/// those panels survive wrapper outages.
pub struct DeWorld {
    /// DE's snapshot time (unix seconds); how fresh the ground truth itself is.
    pub time: Option<i64>,
    pub fissures: Vec<Fissure>,
    /// CetusSyndicate bounty expiry (unix seconds) = the end of the current
    /// Cetus night — the anchor for the derived Cetus/Cambion cycle clock.
    pub cetus_night_end: Option<i64>,
    pub sortie: Option<Sortie>,
    pub archon_hunt: Option<Sortie>,
    pub invasions: Vec<Invasion>,
}

/// Warn once when `empty` flips true (and re-arm when it heals) — every section
/// of `RawWorld` is `#[serde(default)]`, so a DE field rename silently yields an
/// empty vec; this is the only signal that the schema moved under us.
fn warn_if_newly_empty(flag: &std::sync::atomic::AtomicBool, empty: bool, what: &str) {
    use std::sync::atomic::Ordering;
    if empty {
        if !flag.swap(true, Ordering::Relaxed) {
            tracing::warn!(section = what, "DE worldstate section empty — outage or schema change");
        }
    } else {
        flag.store(false, Ordering::Relaxed);
    }
}

fn parse(raw: RawWorld) -> DeWorld {
    use std::sync::atomic::AtomicBool;
    static MISSIONS_EMPTY: AtomicBool = AtomicBool::new(false);
    static ANCHOR_EMPTY: AtomicBool = AtomicBool::new(false);
    warn_if_newly_empty(
        &MISSIONS_EMPTY,
        raw.active_missions.is_empty(),
        "ActiveMissions (fissures)",
    );

    let mut fissures = Vec::new();

    // ActiveMissions = normal + Steel Path (`Hard`) relic fissures.
    for m in raw.active_missions {
        let Some(tier) = m.modifier.as_deref().and_then(tier_of) else {
            continue; // non-fissure modifier — not relic content
        };
        let node = m.node.as_deref().unwrap_or("");
        let info = NODES.get(node);
        fissures.push(Fissure {
            tier: tier.to_string(),
            mission_type: mission_name(m.mission_type.as_deref().unwrap_or("MT_DEFAULT")),
            node: info.map_or_else(|| node.to_string(), |n| n.name.to_string()),
            enemy: info.map(|n| n.enemy.to_string()).filter(|e| !e.is_empty()),
            expiry: to_iso(&m.expiry),
            eta: None,
            is_hard: m.hard,
            is_storm: false,
        });
    }

    // VoidStorms = Railjack; the mission type lives on the node, not the entry.
    for s in raw.void_storms {
        let Some(tier) = s.tier.as_deref().and_then(tier_of) else {
            continue;
        };
        let node = s.node.as_deref().unwrap_or("");
        let info = NODES.get(node);
        fissures.push(Fissure {
            tier: tier.to_string(),
            mission_type: info
                .map(|n| n.mission.to_string())
                .filter(|m| !m.is_empty())
                .unwrap_or_else(|| "Skirmish".to_string()),
            node: info.map_or_else(|| node.to_string(), |n| n.name.to_string()),
            enemy: info.map(|n| n.enemy.to_string()).filter(|e| !e.is_empty()),
            expiry: to_iso(&s.expiry),
            eta: None,
            is_hard: false,
            is_storm: true,
        });
    }

    let cetus_night_end = raw
        .syndicate_missions
        .iter()
        .find(|s| s.tag.as_deref() == Some("CetusSyndicate"))
        .and_then(|s| s.expiry.as_ref())
        .and_then(|d| d.date.ms.parse::<i64>().ok())
        .map(|ms| ms / 1000);
    // The Cetus bounty window is the anchor every derived world clock hangs off.
    warn_if_newly_empty(
        &ANCHOR_EMPTY,
        cetus_night_end.is_none(),
        "CetusSyndicate bounty window (cycle anchor)",
    );

    // Daily sortie: Boss + Variants (mission/modifier/node internal IDs).
    let sortie = raw.sorties.into_iter().next().and_then(|s| {
        let (boss, faction) = boss_info(s.boss.as_deref().unwrap_or_default());
        let missions: Vec<SortieMission> = s
            .variants
            .into_iter()
            .map(|v| SortieMission {
                node: node_name(v.node.as_deref().unwrap_or("")),
                mission_type: mission_name(v.mission_type.as_deref().unwrap_or("MT_DEFAULT")),
                modifier: v.modifier_type.as_deref().map(modifier_name),
                modifier_desc: None,
            })
            .collect();
        (!missions.is_empty()).then_some(Sortie {
            boss,
            faction,
            activation: to_iso(&s.activation),
            expiry: to_iso(&s.expiry),
            missions,
        })
    });

    // Weekly archon hunt (LiteSorties): same shape, no modifiers.
    let archon_hunt = raw.lite_sorties.into_iter().next().and_then(|s| {
        let (boss, faction) = boss_info(s.boss.as_deref().unwrap_or_default());
        let missions: Vec<SortieMission> = s
            .missions
            .into_iter()
            .map(|m| SortieMission {
                node: node_name(m.node.as_deref().unwrap_or("")),
                mission_type: mission_name(m.mission_type.as_deref().unwrap_or("MT_DEFAULT")),
                modifier: None,
                modifier_desc: None,
            })
            .collect();
        (!missions.is_empty()).then_some(Sortie {
            boss,
            faction,
            activation: to_iso(&s.activation),
            expiry: to_iso(&s.expiry),
            missions,
        })
    });

    // Invasions: Count runs ±Goal (negative = defender winning); the standard
    // presentation is attacker progress with 50% = even, like warframestat's.
    let invasions = raw
        .invasions
        .into_iter()
        .filter(|i| !i.completed)
        .filter_map(|i| {
            let node = i.node?;
            let goal = i.goal.filter(|g| *g > 0)? as f64;
            let count = i.count.unwrap_or(0) as f64;
            Some(Invasion {
                node: node_name(&node),
                attacker: faction_name(i.attacker_faction.as_deref().unwrap_or("")),
                defender: faction_name(i.defender_faction.as_deref().unwrap_or("")),
                attacker_reward: invasion_reward(&counted_from(&i.attacker_reward)),
                defender_reward: invasion_reward(&counted_from(&i.defender_reward)),
                completion: ((count + goal) / (2.0 * goal) * 100.0).clamp(0.0, 100.0),
                eta: None,
            })
        })
        .collect();

    DeWorld {
        time: raw.time,
        fissures,
        cetus_night_end,
        sortie,
        archon_hunt,
        invasions,
    }
}

/// Fetch + decode DE's raw worldstate. Shares the caller's HTTP client; the
/// caller owns cadence (worldstate TTL / background refresher) and fallback.
pub async fn fetch(http: &Client) -> AppResult<DeWorld> {
    let raw: RawWorld = http
        .get(RAW_URL)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(parse(raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{
        "Time": 1780510513,
        "ActiveMissions": [
            {
                "_id": {"$oid": "x"},
                "Activation": {"$date": {"$numberLong": "1780503722849"}},
                "Expiry": {"$date": {"$numberLong": "1780510892955"}},
                "Node": "SolNode41",
                "MissionType": "MT_INTEL",
                "Modifier": "VoidT1",
                "Hard": true
            },
            {
                "Expiry": {"$date": {"$numberLong": "1780513132916"}},
                "Node": "SolNodeBrandNew",
                "MissionType": "MT_SOME_NEW_MODE",
                "Modifier": "VoidT6"
            },
            {
                "Node": "SolNode1",
                "MissionType": "MT_CAPTURE",
                "Modifier": "NotAFissure"
            }
        ],
        "VoidStorms": [
            {
                "Expiry": {"$date": {"$numberLong": "1780512603351"}},
                "Node": "CrewBattleNode509",
                "ActiveMissionTier": "VoidT4"
            }
        ]
    }"#;

    #[test]
    fn parses_and_decodes_fixture() {
        let de = parse(serde_json::from_str(FIXTURE).expect("fixture json"));
        assert_eq!(de.time, Some(1780510513));
        assert_eq!(de.fissures.len(), 3); // non-fissure modifier dropped

        let f = &de.fissures[0];
        assert_eq!(f.tier, "Lith");
        assert_eq!(f.mission_type, "Spy");
        assert!(f.is_hard && !f.is_storm);
        assert_eq!(f.expiry.as_deref(), Some("2026-06-03T18:21:32.955+00:00"));
        // node decoded via the bundled map
        assert!(
            f.node.contains('('),
            "expected decoded node, got {}",
            f.node
        );

        // unknown node + unknown mission type degrade, not drop
        let g = &de.fissures[1];
        assert_eq!(g.tier, "Omnia");
        assert_eq!(g.node, "SolNodeBrandNew");
        assert_eq!(g.mission_type, "Some New Mode");

        let s = &de.fissures[2];
        assert!(s.is_storm && !s.is_hard);
        assert_eq!(s.tier, "Axi");
        assert_eq!(s.mission_type, "Skirmish");
        assert_eq!(s.node, "Iota Temple (Earth)");
        assert_eq!(s.enemy.as_deref(), Some("Grineer"));
    }

    #[test]
    fn node_map_loads() {
        assert!(NODES.len() > 400, "sol_nodes.tsv should be ~450 rows");
        assert_eq!(
            NODES.get("SolNode1").map(|n| n.name),
            Some("Galatea (Neptune)")
        );
    }

    // Live diagnostic — `cargo test --lib de_probe -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn de_probe() {
        let http = Client::builder()
            .user_agent("wfit-desktop/0.1")
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .unwrap();
        match fetch(&http).await {
            Ok(de) => {
                let now = chrono::Utc::now().timestamp();
                println!("OK  url={RAW_URL}");
                println!("  Time lag = {}s", de.time.map_or(-1, |t| now - t));
                println!("  fissures = {}", de.fissures.len());
                for f in de.fissures.iter().take(5) {
                    println!(
                        "    {} {} {} hard={} storm={}",
                        f.tier, f.mission_type, f.node, f.is_hard, f.is_storm
                    );
                }
                if let Some(s) = &de.sortie {
                    println!("  sortie: {} ({})", s.boss, s.faction);
                    for m in &s.missions {
                        println!(
                            "    {} {} [{}]",
                            m.mission_type,
                            m.node,
                            m.modifier.as_deref().unwrap_or("—")
                        );
                    }
                }
                if let Some(a) = &de.archon_hunt {
                    println!("  archon: {} ({})", a.boss, a.faction);
                    for m in &a.missions {
                        println!("    {} {}", m.mission_type, m.node);
                    }
                }
                println!("  invasions = {}", de.invasions.len());
                for i in de.invasions.iter().take(4) {
                    println!(
                        "    {} {} vs {} | {} / {} | {:.0}%",
                        i.node,
                        i.attacker,
                        i.defender,
                        i.attacker_reward.as_deref().unwrap_or("—"),
                        i.defender_reward.as_deref().unwrap_or("—"),
                        i.completion
                    );
                }
            }
            Err(e) => println!("ERR {e}"),
        }
    }
}
