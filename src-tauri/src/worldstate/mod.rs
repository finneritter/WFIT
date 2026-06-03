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

mod raw;

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
pub struct Baro {
    pub active: bool,
    pub activation: Option<String>, // ISO — arrival
    pub expiry: Option<String>,     // ISO — departure
    pub location: Option<String>,
    pub character: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worldstate {
    pub cycles: Vec<Cycle>,
    pub fissures: Vec<Fissure>,
    pub baro: Option<Baro>,
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
    #[serde(rename = "voidTrader")]
    void_trader: Option<RawTrader>,
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

#[derive(Deserialize)]
struct RawTrader {
    activation: Option<String>,
    expiry: Option<String>,
    location: Option<String>,
    character: Option<String>,
}

// ---------------------------------------------------------------------------
// Client.
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct WorldstateClient {
    http: Client,
    last_call: Arc<Mutex<Instant>>,
    cache: Arc<Mutex<Option<(Instant, Worldstate)>>>,
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

    /// Combined fetch: warframestat (cycles/Baro/fissure fallback) and DE's raw
    /// worldstate (authoritative fissures), concurrently. DE wins for fissures
    /// whenever it responds — its CDN copy is ≤43s old, while warframestat's
    /// origin ingest lags minutes. Either source alone still yields a payload.
    async fn fetch(&self) -> AppResult<Worldstate> {
        self.throttled().await;
        let (ws, de) = tokio::join!(self.fetch_warframestat(), raw::fetch(&self.http));
        match (ws, de) {
            (Ok(mut ws), Ok(de)) => {
                cross_check(&ws.fissures, &de.fissures);
                ws.fissures = de.fissures;
                ws.fissure_source = "de".into();
                Ok(ws)
            }
            (Ok(ws), Err(e)) => {
                tracing::warn!(error = %e, "DE worldstate unreachable; fissures from warframestat");
                Ok(ws)
            }
            (Err(e), Ok(de)) => {
                // warframestat down: fissures stay accurate; carry the last-known
                // cycles/Baro forward (their countdowns just won't refresh).
                tracing::warn!(error = %e, "warframestat unreachable; serving DE fissures");
                let prev = self.cache.lock().as_ref().map(|(_, w)| w.clone());
                Ok(Worldstate {
                    cycles: prev.as_ref().map(|p| p.cycles.clone()).unwrap_or_default(),
                    fissures: de.fissures,
                    baro: prev.and_then(|p| p.baro),
                    fetched_at: Utc::now().to_rfc3339(),
                    source_timestamp: de
                        .time
                        .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                        .map(|t| t.to_rfc3339()),
                    fissure_source: "de".into(),
                })
            }
            (Err(e), Err(de_err)) => {
                tracing::warn!(error = %de_err, "DE worldstate also unreachable");
                Err(e)
            }
        }
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

        let baro = raw.void_trader.map(|t| {
            let now = Utc::now();
            let parse = |s: &str| chrono::DateTime::parse_from_rfc3339(s).ok();
            let active = match (t.activation.as_deref(), t.expiry.as_deref()) {
                (Some(a), Some(e)) => {
                    matches!((parse(a), parse(e)), (Some(a), Some(e)) if a <= now && now < e)
                }
                _ => false,
            };
            Baro {
                active,
                activation: t.activation,
                expiry: t.expiry,
                location: t.location,
                character: t.character,
            }
        });

        Ok(Worldstate {
            cycles,
            fissures,
            baro,
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
