//! Live world-state (Rotation screen). A SECOND, isolated data source, away
//! from the warframe.market path. Its own client, its own throttle, its own
//! in-memory cache. A market outage must not affect this and vice-versa.
//! Read-only, no auth, fully optional — the core app works with this off.
//!
//! Two upstreams, merged per fetch:
//! - api.warframestat.us (parsed wrapper) — cycles, Baro, fissure fallback.
//!   Friendly JSON, but its origin ingest lags real time by minutes.
//! - DE's raw worldState.php (`raw` module) — the AUTHORITATIVE fissure list,
//!   cross-checked against the wrapper and preferred whenever it responds.

mod arbys;
mod cycles;
mod extra;
mod raw;

pub use arbys::ArbitrationBlock;
pub use extra::{Invasion, Nightwave, Sortie, SteelPath, Trader};

use crate::error::AppResult;
use chrono::Utc;
use parking_lot::Mutex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};

// Canonical URL (the no-slash form 301-redirects). A per-fetch cache-buster query
// param is appended so Cloudflare can't serve a many-minutes-stale cached copy
// (it ignores client no-cache on a HIT) — fissures rotate too fast for that.
const WS_URL: &str = "https://api.warframestat.us/pc/";
const TTL: Duration = Duration::from_secs(45); // fissures rotate fast; keep it short
const MIN_GAP_MS: u64 = 350;
// Background re-check cadence (spawn_refresher). The UI's own 45s poll pauses
// whenever WebKitGTK throttles a hidden/unfocused window — exactly the
// "Rotation open on a second monitor while playing" case — so the backend
// re-confirms with the API on its own clock. ~3min is fresh enough for
// fissures and gentle on the free community service (~480 req/day).
const REFRESH_EVERY: Duration = Duration::from_secs(180);

// ---------------------------------------------------------------------------
// Frontend-facing payload.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cycle {
    pub id: String,
    pub name: String,
    pub state: String,
    pub time_left: Option<String>,
    pub expiry: Option<String>, // ISO — drives the live client-side countdown
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fissure {
    pub tier: String,
    pub mission_type: String,
    pub node: String,
    pub enemy: Option<String>,
    pub expiry: Option<String>,
    pub eta: Option<String>,
    pub is_hard: bool,
    pub is_storm: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worldstate {
    pub cycles: Vec<Cycle>,
    pub fissures: Vec<Fissure>,
    /// Baro Ki'Teer — `Trader` carries the inventory too (empty until active).
    pub baro: Option<Trader>,
    /// Varzia (prime resurgence) — inventory prices are AYA in `ducats`.
    pub varzia: Option<Trader>,
    pub sortie: Option<Sortie>,
    /// The weekly archon hunt — same shape as the sortie (no modifiers).
    pub archon_hunt: Option<Sortie>,
    pub steel_path: Option<SteelPath>,
    /// Active Nightwave season: challenges + season end (no player standing —
    /// that's account data the worldstate doesn't carry).
    pub nightwave: Option<Nightwave>,
    /// Live (uncompleted) invasions.
    pub invasions: Vec<Invasion>,
    /// Community-precomputed schedule (browse.wf); None when unavailable.
    pub arbitration: Option<ArbitrationBlock>,
    pub fetched_at: String,
    /// warframe­stat.us's own snapshot time (ISO). When this lags real time the
    /// source is stale — every fissure/cycle reads as expired through no fault of
    /// ours, so the UI surfaces it instead of silently showing an empty page.
    pub source_timestamp: Option<String>,
    /// Which source produced `fissures`: `"de"` (authoritative raw worldstate,
    /// the normal case) or `"warframestat"` (fallback when DE is unreachable).
    pub fissure_source: String,
}

// ---------------------------------------------------------------------------
// Raw warframestat.us shapes (camelCase).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RawWorld {
    timestamp: Option<String>,
    #[serde(rename = "cetusCycle")]
    cetus_cycle: Option<RawCycle>,
    #[serde(rename = "vallisCycle")]
    vallis_cycle: Option<RawCycle>,
    #[serde(rename = "cambionCycle")]
    cambion_cycle: Option<RawCycle>,
    #[serde(rename = "duviriCycle")]
    duviri_cycle: Option<RawCycle>,
    #[serde(default)]
    fissures: Vec<RawFissure>,
    // Extra blocks land untyped and are parsed in `extra` with from_value().ok()
    // — a shape change in one block must never fail the whole payload.
    #[serde(rename = "voidTrader")]
    void_trader: Option<serde_json::Value>,
    #[serde(rename = "vaultTrader")]
    vault_trader: Option<serde_json::Value>,
    sortie: Option<serde_json::Value>,
    #[serde(rename = "archonHunt")]
    archon_hunt: Option<serde_json::Value>,
    #[serde(rename = "steelPath")]
    steel_path: Option<serde_json::Value>,
    nightwave: Option<serde_json::Value>,
    invasions: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct RawCycle {
    state: Option<String>,
    active: Option<String>, // cambion uses `active` (fass/vome)
    #[serde(rename = "timeLeft")]
    time_left: Option<String>,
    expiry: Option<String>,
}

#[derive(Deserialize)]
struct RawFissure {
    tier: Option<String>,
    #[serde(rename = "missionType")]
    mission_type: Option<String>,
    node: Option<String>,
    enemy: Option<String>,
    expiry: Option<String>,
    eta: Option<String>,
    #[serde(default, rename = "isHard")]
    is_hard: bool,
    #[serde(default, rename = "isStorm")]
    is_storm: bool,
}

// ---------------------------------------------------------------------------
// Client.
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct WorldstateClient {
    http: Client,
    last_call: Arc<Mutex<Instant>>,
    cache: Arc<Mutex<Option<(Instant, Worldstate)>>>,
    /// Arbitration schedule client — its own (12h) cache; browse.wf is hit
    /// twice a day, not on the 45s worldstate cadence.
    arbys: Arc<arbys::ArbysClient>,
    /// Last seen Cetus night-end (DE bounty expiry, unix seconds) — anchors the
    /// locally derived cycle clock (`cycles::derive`). Periodic, so it stays
    /// valid across DE outages once set.
    cetus_anchor: Arc<Mutex<Option<i64>>>,
}

impl Default for WorldstateClient {
    fn default() -> Self {
        Self::new()
    }
}

impl WorldstateClient {
    pub fn new() -> Self {
        let http = Client::builder()
            .user_agent("wfit-desktop/0.1")
            .timeout(Duration::from_secs(20))
            .build()
            .expect("reqwest client");
        Self {
            http,
            last_call: Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60))),
            cache: Arc::new(Mutex::new(None)),
            arbys: Arc::new(arbys::ArbysClient::default()),
            cetus_anchor: Arc::new(Mutex::new(None)),
        }
    }

    async fn throttled(&self) {
        let wait = {
            let last = *self.last_call.lock();
            let since = last.elapsed();
            let gap = Duration::from_millis(MIN_GAP_MS);
            if since >= gap {
                Duration::ZERO
            } else {
                gap - since
            }
        };
        if wait > Duration::ZERO {
            tokio::time::sleep(wait).await;
        }
        *self.last_call.lock() = Instant::now();
    }

    /// Background freshness loop: re-fetches every `REFRESH_EVERY` so the cache
    /// is never more than ~3min behind real time, even when the frontend can't
    /// poll (webview timers throttle while the window is hidden/unfocused).
    /// Failures degrade inside `get()`; the loop never dies.
    pub fn spawn_refresher(&self) {
        let client = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(REFRESH_EVERY).await;
                // TTL (45s) has always lapsed by now, so this hits the network.
                if let Err(e) = client.get().await {
                    tracing::warn!(error = %e, "background worldstate refresh failed");
                }
            }
        });
    }

    /// Cached fetch. Serves the in-memory copy within the TTL; on a refresh
    /// failure, degrades to the last-known value rather than erroring.
    pub async fn get(&self) -> AppResult<Worldstate> {
        if let Some((at, ws)) = self.cache.lock().as_ref() {
            if at.elapsed() < TTL {
                return Ok(ws.clone());
            }
        }

        match self.fetch().await {
            Ok(ws) => {
                *self.cache.lock() = Some((Instant::now(), ws.clone()));
                Ok(ws)
            }
            Err(e) => {
                // Degrade gracefully: return stale data if we have any.
                if let Some((_, ws)) = self.cache.lock().as_ref() {
                    tracing::warn!(error = %e, "worldstate refresh failed; serving stale");
                    return Ok(ws.clone());
                }
                Err(e)
            }
        }
    }

    /// Hard reset (the Rotation screen's force-refresh button): flush the
    /// arbitration schedule cache and re-fetch everything from the live
    /// sources right now, bypassing the TTL. Unlike `get()`, a total failure
    /// errors instead of degrading to stale — the user explicitly asked for
    /// fresh data, so pretending old data is fresh would be a lie. The old
    /// cache is only replaced on success, so `get()` still degrades gracefully
    /// afterwards.
    pub async fn force_refresh(&self) -> AppResult<Worldstate> {
        self.arbys.clear();
        let ws = self.fetch().await?;
        *self.cache.lock() = Some((Instant::now(), ws.clone()));
        Ok(ws)
    }

    /// Combined fetch: warframestat (cycles/Baro/fissure fallback) and DE's raw
    /// worldstate (authoritative fissures), concurrently. DE wins for fissures
    /// whenever it responds — its CDN copy is ≤43s old, while warframestat's
    /// origin ingest lags minutes. Either source alone still yields a payload.
    async fn fetch(&self) -> AppResult<Worldstate> {
        self.throttled().await;
        let (ws, de) = tokio::join!(self.fetch_warframestat(), raw::fetch(&self.http));
        // Remember the bounty anchor whenever DE responds — the derived cycle
        // clock below outlives any single fetch. Keep DE's sortie/archon/
        // invasion decodes too: they backfill whatever warframestat couldn't
        // provide (its origin has served empty 200s for hours at a time).
        let mut de_extras = None;
        if let Ok(de) = &de {
            if let Some(a) = de.cetus_night_end {
                *self.cetus_anchor.lock() = Some(a);
            }
            de_extras = Some((
                de.sortie.clone(),
                de.archon_hunt.clone(),
                de.invasions.clone(),
            ));
        }
        let mut ws = match (ws, de) {
            (Ok(mut ws), Ok(de)) => {
                cross_check(&ws.fissures, &de.fissures);
                ws.fissures = de.fissures;
                ws.fissure_source = "de".into();
                ws
            }
            (Ok(ws), Err(e)) => {
                tracing::warn!(error = %e, "DE worldstate unreachable; fissures from warframestat");
                ws
            }
            (Err(e), Ok(de)) => {
                // warframestat down: fissures stay accurate; carry the last-known
                // cycles/extras forward (their countdowns just won't refresh).
                tracing::warn!(error = %e, "warframestat unreachable; serving DE fissures");
                let prev = self.cache.lock().as_ref().map(|(_, w)| w.clone());
                Worldstate {
                    cycles: prev.as_ref().map(|p| p.cycles.clone()).unwrap_or_default(),
                    fissures: de.fissures,
                    baro: prev.as_ref().and_then(|p| p.baro.clone()),
                    varzia: prev.as_ref().and_then(|p| p.varzia.clone()),
                    sortie: prev.as_ref().and_then(|p| p.sortie.clone()),
                    archon_hunt: prev.as_ref().and_then(|p| p.archon_hunt.clone()),
                    nightwave: prev.as_ref().and_then(|p| p.nightwave.clone()),
                    invasions: prev
                        .as_ref()
                        .map(|p| p.invasions.clone())
                        .unwrap_or_default(),
                    steel_path: prev.and_then(|p| p.steel_path),
                    arbitration: None, // attached below — independent of warframestat
                    fetched_at: Utc::now().to_rfc3339(),
                    source_timestamp: de
                        .time
                        .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                        .map(|t| t.to_rfc3339()),
                    fissure_source: "de".into(),
                }
            }
            (Err(e), Err(de_err)) => {
                tracing::warn!(error = %de_err, "DE worldstate also unreachable");
                return Err(e);
            }
        };
        // DE fallbacks: when warframestat is down its blocks land as None/empty
        // — fill sortie / archon hunt / invasions from DE's own worldstate so
        // those panels survive wrapper outages. warframestat wins when present
        // (friendlier modifier descriptions); DE only plugs the gaps. There is
        // no DE equivalent for Nightwave (challenge names live client-side).
        if let Some((de_sortie, de_archon, de_invasions)) = de_extras {
            if ws.sortie.is_none() {
                ws.sortie = de_sortie;
            }
            if ws.archon_hunt.is_none() {
                ws.archon_hunt = de_archon;
            }
            if ws.invasions.is_empty() {
                ws.invasions = de_invasions;
            }
        }
        // Cycles are deterministic clocks — once we have a bounty anchor from
        // DE, derive them locally rather than trusting warframestat's snapshot
        // (its origin has been observed hours stale, leaving every cycle card
        // "expired"). Without an anchor (DE down since launch) the wrapper's
        // cycles stand as the fallback.
        if let Some(anchor) = *self.cetus_anchor.lock() {
            ws.cycles = cycles::derive(anchor, Utc::now().timestamp());
        }
        // Arbitration rides every payload but comes from its own schedule cache
        // (12h TTL) — after the first download this is an in-memory scan.
        ws.arbitration = self.arbys.block(&self.http, 5).await;
        Ok(ws)
    }

    async fn fetch_warframestat(&self) -> AppResult<Worldstate> {
        // Unique query each fetch → Cloudflare cache miss → warframestat's freshest
        // origin data. Only fires every ≥45s (TTL, or the background refresher).
        let url = format!("{WS_URL}?_={}", chrono::Utc::now().timestamp());
        let raw: RawWorld = self
            .http
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let mut cycles = Vec::new();
        if let Some(c) = raw.cetus_cycle {
            cycles.push(make_cycle("cetus", "Cetus", c));
        }
        if let Some(c) = raw.vallis_cycle {
            cycles.push(make_cycle("vallis", "Orb Vallis", c));
        }
        if let Some(c) = raw.cambion_cycle {
            cycles.push(make_cycle("cambion", "Cambion Drift", c));
        }
        if let Some(c) = raw.duviri_cycle {
            cycles.push(make_cycle("duviri", "Duviri", c));
        }

        let fissures: Vec<Fissure> = raw
            .fissures
            .into_iter()
            .filter(|f| f.tier.is_some())
            .map(|f| Fissure {
                tier: f.tier.unwrap_or_default(),
                mission_type: f.mission_type.unwrap_or_default(),
                node: f.node.unwrap_or_default(),
                enemy: f.enemy,
                expiry: f.expiry,
                eta: f.eta,
                is_hard: f.is_hard,
                is_storm: f.is_storm,
            })
            .collect();

        Ok(Worldstate {
            cycles,
            fissures,
            baro: extra::trader_from(raw.void_trader),
            varzia: extra::trader_from(raw.vault_trader),
            sortie: extra::sortie_from(raw.sortie),
            archon_hunt: extra::sortie_from(raw.archon_hunt),
            steel_path: extra::steel_path_from(raw.steel_path),
            nightwave: extra::nightwave_from(raw.nightwave),
            invasions: extra::invasions_from(raw.invasions),
            arbitration: None, // attached in fetch()
            fetched_at: Utc::now().to_rfc3339(),
            source_timestamp: raw.timestamp,
            fissure_source: "warframestat".into(),
        })
    }
}

/// The "confirm the values" step: log where the wrapper disagrees with DE's
/// ground truth. `missing` = live per DE but not yet listed by warframestat;
/// `stale` = still listed by warframestat but actually over.
fn cross_check(ws: &[Fissure], de: &[Fissure]) {
    fn keys(fs: &[Fissure]) -> HashSet<(&str, bool, bool)> {
        fs.iter()
            .map(|f| (f.node.as_str(), f.is_hard, f.is_storm))
            .collect()
    }
    let (ws, de) = (keys(ws), keys(de));
    let missing = de.difference(&ws).count();
    let stale = ws.difference(&de).count();
    if missing > 0 || stale > 0 {
        tracing::info!(
            missing,
            stale,
            "worldstate cross-check: warframestat lags DE"
        );
    }
}

fn make_cycle(id: &str, name: &str, c: RawCycle) -> Cycle {
    let state = c.state.or(c.active).unwrap_or_else(|| "—".into());
    Cycle {
        id: id.to_string(),
        name: name.to_string(),
        state,
        time_left: c.time_left,
        expiry: c.expiry,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Live diagnostic: hit the configured WS_URL via the app's exact client and
    // report what it actually gets. `cargo test --lib ws_probe -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn ws_probe() {
        let c = WorldstateClient::new();
        match c.get().await {
            Ok(ws) => {
                let now = chrono::Utc::now();
                println!("OK  url={WS_URL}");
                println!("  source_timestamp = {:?}", ws.source_timestamp);
                println!("  now              = {}", now.to_rfc3339());
                println!(
                    "  fissures={} cycles={}",
                    ws.fissures.len(),
                    ws.cycles.len()
                );
                println!("  fissure_source = {}", ws.fissure_source);
                if let Some(ts) = &ws.source_timestamp {
                    if let Ok(t) = chrono::DateTime::parse_from_rfc3339(ts) {
                        let lag = now.signed_duration_since(t.with_timezone(&chrono::Utc));
                        println!("  source lag = {} min", lag.num_minutes());
                    }
                }
            }
            Err(e) => println!("ERR url={WS_URL}: {e}"),
        }
    }
}
