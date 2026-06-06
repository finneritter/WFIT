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

/// Decoded raw worldstate — just what the cross-check needs.
pub struct DeWorld {
    /// DE's snapshot time (unix seconds); how fresh the ground truth itself is.
    pub time: Option<i64>,
    pub fissures: Vec<Fissure>,
    /// CetusSyndicate bounty expiry (unix seconds) = the end of the current
    /// Cetus night — the anchor for the derived Cetus/Cambion cycle clock.
    pub cetus_night_end: Option<i64>,
}

fn parse(raw: RawWorld) -> DeWorld {
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

    DeWorld {
        time: raw.time,
        fissures,
        cetus_night_end,
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
            }
            Err(e) => println!("ERR {e}"),
        }
    }
}
