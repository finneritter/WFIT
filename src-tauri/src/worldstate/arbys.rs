//! Arbitration schedule. warframestat's `arbitration` field is broken (always
//! expired, epoch timestamps) because DE doesn't publish arbitrations in the
//! worldstate at all — the rotation is a community-precomputed schedule.
//!
//! Source: `https://browse.wf/arbys.txt` (browse.wf, open data — attribution
//! appreciated; surfaced in the UI). CSV lines `unix_ts,NodeId`, one entry per
//! hour, extending years ahead. Node ids match `data/sol_nodes.tsv`, so name /
//! faction / mission type decode locally via `raw::node_info`.
//!
//! Tier ratings (S–D) are the Arbitration Goons' per-node map, snapshotted to
//! `data/arby_tiers.tsv` from `browse.wf/supplemental-data/arbyTiers.js`.
//! Unrated nodes → `tier: None` (UI shows "—").

use super::raw;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

const ARBYS_URL: &str = "https://browse.wf/arbys.txt";
/// The schedule is precomputed months ahead — one download per half-day is
/// plenty (and the file is ~1MB, so don't ride the 45s worldstate cadence).
const ARBYS_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const HOUR: i64 = 3600; // each schedule entry covers one hour

static TIERS: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    include_str!("data/arby_tiers.tsv")
        .lines()
        .filter_map(|l| {
            let mut f = l.split('\t');
            Some((f.next()?, f.next()?))
        })
        .collect()
});

// ---------------------------------------------------------------------------
// Frontend-facing shapes.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Arbitration {
    pub node: String,
    pub mission_type: String,
    pub enemy: Option<String>,
    pub tier: Option<String>, // "S".."D" (community rating) or None
    pub activation: String,   // ISO
    pub expiry: String,       // ISO
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArbitrationBlock {
    pub current: Option<Arbitration>,
    pub upcoming: Vec<Arbitration>,
}

// ---------------------------------------------------------------------------
// Client — own cache, own cadence; failures degrade to None, never error.
// ---------------------------------------------------------------------------

/// `(unix_ts, node_id)` pairs, sorted, one per hour.
type Schedule = Vec<(i64, String)>;

#[derive(Default)]
pub(super) struct ArbysClient {
    cache: Mutex<Option<(Instant, Arc<Schedule>)>>,
}

impl ArbysClient {
    /// Current + next `n` arbitrations, or None when the schedule is
    /// unavailable (first fetch failed) — the UI shows "unavailable".
    pub(super) async fn block(&self, http: &Client, n: usize) -> Option<ArbitrationBlock> {
        let sched = self.schedule(http).await?;
        Some(block_at(&sched, chrono::Utc::now().timestamp(), n))
    }

    async fn schedule(&self, http: &Client) -> Option<Arc<Schedule>> {
        if let Some((at, s)) = self.cache.lock().as_ref() {
            if at.elapsed() < ARBYS_TTL {
                return Some(s.clone());
            }
        }
        match fetch_schedule(http).await {
            Ok(s) => {
                let s = Arc::new(s);
                *self.cache.lock() = Some((Instant::now(), s.clone()));
                Some(s)
            }
            Err(e) => {
                // Serve a stale schedule over nothing — it's precomputed, so
                // "stale" only means we won't see upstream corrections.
                let stale = self.cache.lock().as_ref().map(|(_, s)| s.clone());
                tracing::warn!(error = %e, stale = stale.is_some(), "arbys schedule fetch failed");
                stale
            }
        }
    }
}

async fn fetch_schedule(http: &Client) -> crate::error::AppResult<Schedule> {
    let text = http
        .get(ARBYS_URL)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(parse_schedule(&text))
}

fn parse_schedule(text: &str) -> Schedule {
    let mut v: Schedule = text
        .lines()
        .filter_map(|l| {
            let (ts, node) = l.trim().split_once(',')?;
            Some((ts.parse().ok()?, node.to_string()))
        })
        .collect();
    v.sort_by_key(|(ts, _)| *ts); // upstream is sorted; don't depend on it
    v
}

/// Pure lookup: the entry covering `now` (if any) + the next `n`.
fn block_at(sched: &[(i64, String)], now: i64, n: usize) -> ArbitrationBlock {
    // First entry strictly after now — its predecessor is the live one.
    let next_idx = sched.partition_point(|(ts, _)| *ts <= now);
    let current = next_idx
        .checked_sub(1)
        .map(|i| &sched[i])
        .filter(|(ts, _)| now < ts + HOUR) // a schedule gap → no live arby
        .map(|(ts, node)| decode(*ts, node));
    let upcoming = sched[next_idx..sched.len().min(next_idx + n)]
        .iter()
        .map(|(ts, node)| decode(*ts, node))
        .collect();
    ArbitrationBlock { current, upcoming }
}

fn decode(ts: i64, node_id: &str) -> Arbitration {
    let iso = |t: i64| {
        chrono::DateTime::from_timestamp(t, 0)
            .map(|d| d.to_rfc3339())
            .unwrap_or_default()
    };
    let info = raw::node_info(node_id);
    Arbitration {
        node: info.map_or_else(|| node_id.to_string(), |i| i.name.to_string()),
        mission_type: info
            .map(|i| i.mission.to_string())
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| "—".into()),
        enemy: info.map(|i| i.enemy.to_string()).filter(|e| !e.is_empty()),
        tier: TIERS.get(node_id).map(|t| (*t).to_string()),
        activation: iso(ts),
        expiry: iso(ts + HOUR),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = "1780686000,SolNode64\n1780689600,SolNode146\n1780693200,ClanNode10\n1780696800,SolNodeBrandNew\n";

    #[test]
    fn tier_map_loads() {
        assert!(TIERS.len() >= 30, "arby_tiers.tsv should have ~38 rows");
        assert_eq!(TIERS.get("SolNode64").copied(), Some("S"));
    }

    #[test]
    fn block_decodes_current_and_upcoming() {
        let sched = parse_schedule(FIXTURE);
        assert_eq!(sched.len(), 4);

        // 30 min into the second entry.
        let b = block_at(&sched, 1780689600 + 1800, 10);
        let cur = b.current.expect("live arby");
        assert_eq!(cur.expiry, iso(1780693200));
        assert_eq!(b.upcoming.len(), 2); // only 2 remain in the fixture

        // SolNode64 is S-tier in the bundled map; unknown node degrades.
        let first = block_at(&sched, 1780686000, 10);
        assert_eq!(first.current.unwrap().tier.as_deref(), Some("S"));
        let unknown = &b.upcoming[1];
        assert_eq!(unknown.node, "SolNodeBrandNew");
        assert!(unknown.tier.is_none());
        assert_eq!(unknown.mission_type, "—");
    }

    #[test]
    fn schedule_gap_means_no_current() {
        let sched = parse_schedule("100,SolNode64\n");
        // > 1h after the only entry: nothing live, nothing upcoming.
        let b = block_at(&sched, 100 + HOUR + 1, 5);
        assert!(b.current.is_none());
        assert!(b.upcoming.is_empty());
        // before the first entry: not live yet, but upcoming.
        let b = block_at(&sched, 50, 5);
        assert!(b.current.is_none());
        assert_eq!(b.upcoming.len(), 1);
    }

    #[test]
    fn malformed_lines_are_skipped() {
        let sched = parse_schedule("garbage\n123\n456,SolNode64\nnot,a,number\n");
        assert_eq!(sched.len(), 1);
    }

    fn iso(t: i64) -> String {
        chrono::DateTime::from_timestamp(t, 0).unwrap().to_rfc3339()
    }

    // Live diagnostic — `cargo test --lib arbys_probe -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn arbys_probe() {
        let http = Client::builder()
            .user_agent("wfit-desktop/0.1")
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .unwrap();
        let c = ArbysClient::default();
        match c.block(&http, 10).await {
            Some(b) => {
                println!("OK  url={ARBYS_URL}");
                match &b.current {
                    Some(a) => println!(
                        "  current: [{}] {} {} ({:?}) until {}",
                        a.tier.as_deref().unwrap_or("—"),
                        a.node,
                        a.mission_type,
                        a.enemy,
                        a.expiry
                    ),
                    None => println!("  current: none (schedule gap?)"),
                }
                for a in &b.upcoming {
                    println!(
                        "  next:    [{}] {} {} at {}",
                        a.tier.as_deref().unwrap_or("—"),
                        a.node,
                        a.mission_type,
                        a.activation
                    );
                }
            }
            None => println!("ERR schedule unavailable"),
        }
    }
}
