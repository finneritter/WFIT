//! In-process metrics registry for the dev dashboard (feature `dev-dashboard`).
//!
//! A process-global [`METRICS`] singleton of relaxed atomics + a small ring of
//! recent request latencies. Hot paths feed it through the `record_*` functions
//! (called via the `crate::devtools::rec_*` shims), and the server serializes a
//! [`MetricsSnapshot`] on demand / once a second over SSE.
//!
//! Percentiles are computed by sorting the recent-latency ring on snapshot rather
//! than via a histogram: at ≤256 samples a sort is trivial, the result is exact,
//! and "recent window" percentiles are what a live dashboard wants. Cheap relaxed
//! atomics carry the cumulative totals. All of this exists only in dev builds.

use crate::db::Db;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering::Relaxed};
use std::time::{Duration, Instant};

/// How many recent market requests to keep for percentile + sparkline + rate.
const LAT_RING: usize = 256;

pub static METRICS: Lazy<Metrics> = Lazy::new(Metrics::new);

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[derive(Clone, Copy)]
struct LatSample {
    at_ms: i64,
    ms: u32,
    err: bool,
}

/// Fixed-capacity ring of recent latency samples (overwrites oldest).
#[derive(Default)]
struct LatRing {
    buf: Vec<LatSample>,
    next: usize,
}

impl LatRing {
    fn push(&mut self, s: LatSample) {
        if self.buf.len() < LAT_RING {
            self.buf.push(s);
        } else {
            self.buf[self.next] = s;
            self.next = (self.next + 1) % LAT_RING;
        }
    }

    /// Samples oldest→newest (chronological), for sparkline display.
    fn chronological(&self) -> Vec<LatSample> {
        if self.buf.len() < LAT_RING {
            self.buf.clone()
        } else {
            let (a, b) = self.buf.split_at(self.next);
            b.iter().chain(a.iter()).copied().collect()
        }
    }
}

pub struct Metrics {
    start: Instant,
    // market client
    market_requests: AtomicU64,
    market_429: AtomicU64,
    market_errors: AtomicU64,
    lat: Mutex<LatRing>,
    // price heartbeat
    hb_last_tick_ms: AtomicI64,
    hb_changed_total: AtomicU64,
    hb_ticks: AtomicU64,
    // db writer mutex
    db_writer_ops: AtomicU64,
    db_writer_wait_ns: AtomicU64,
    db_writer_held_ns: AtomicU64,
    // db read pool
    db_read_ops: AtomicU64,
    db_read_wait_ns: AtomicU64,
    db_read_query_ns: AtomicU64,
    // batched valuation (owned_holdings)
    valuation_runs: AtomicU64,
    valuation_last_ns: AtomicU64,
    valuation_total_ns: AtomicU64,
}

impl Metrics {
    fn new() -> Self {
        Metrics {
            start: Instant::now(),
            market_requests: AtomicU64::new(0),
            market_429: AtomicU64::new(0),
            market_errors: AtomicU64::new(0),
            lat: Mutex::new(LatRing::default()),
            hb_last_tick_ms: AtomicI64::new(0),
            hb_changed_total: AtomicU64::new(0),
            hb_ticks: AtomicU64::new(0),
            db_writer_ops: AtomicU64::new(0),
            db_writer_wait_ns: AtomicU64::new(0),
            db_writer_held_ns: AtomicU64::new(0),
            db_read_ops: AtomicU64::new(0),
            db_read_wait_ns: AtomicU64::new(0),
            db_read_query_ns: AtomicU64::new(0),
            valuation_runs: AtomicU64::new(0),
            valuation_last_ns: AtomicU64::new(0),
            valuation_total_ns: AtomicU64::new(0),
        }
    }
}

// --- Recorders (called from the hot paths via the devtools shims) ----------

/// One network request to warframe.market. `status` is the HTTP status if a
/// response came back; `elapsed` should wrap only `send().await`, NOT the throttle
/// wait, so latency reflects the network not the deliberate pacing.
pub fn record_market(status: Option<u16>, elapsed: Duration, is_err: bool) {
    let m = &*METRICS;
    m.market_requests.fetch_add(1, Relaxed);
    if status == Some(429) {
        m.market_429.fetch_add(1, Relaxed);
    }
    if is_err {
        m.market_errors.fetch_add(1, Relaxed);
    }
    let ms = elapsed.as_millis().min(u32::MAX as u128) as u32;
    m.lat.lock().push(LatSample {
        at_ms: now_ms(),
        ms,
        err: is_err,
    });
}

/// A completed price-heartbeat tick that touched `changed` slugs.
pub fn record_heartbeat(changed: u64) {
    let m = &*METRICS;
    m.hb_last_tick_ms.store(now_ms(), Relaxed);
    m.hb_changed_total.fetch_add(changed, Relaxed);
    m.hb_ticks.fetch_add(1, Relaxed);
}

/// A writer-mutex acquisition: `wait` blocked on the lock, `held` ran the closure.
pub fn record_db_writer(wait: Duration, held: Duration) {
    let m = &*METRICS;
    m.db_writer_ops.fetch_add(1, Relaxed);
    m.db_writer_wait_ns
        .fetch_add(wait.as_nanos() as u64, Relaxed);
    m.db_writer_held_ns
        .fetch_add(held.as_nanos() as u64, Relaxed);
}

/// A pooled read: `wait` checked out a connection, `query` ran the closure.
pub fn record_db_read(wait: Duration, query: Duration) {
    let m = &*METRICS;
    m.db_read_ops.fetch_add(1, Relaxed);
    m.db_read_wait_ns.fetch_add(wait.as_nanos() as u64, Relaxed);
    m.db_read_query_ns
        .fetch_add(query.as_nanos() as u64, Relaxed);
}

/// One full batched valuation pass (`owned_holdings`).
pub fn record_valuation(elapsed: Duration) {
    let m = &*METRICS;
    let ns = elapsed.as_nanos() as u64;
    m.valuation_runs.fetch_add(1, Relaxed);
    m.valuation_last_ns.store(ns, Relaxed);
    m.valuation_total_ns.fetch_add(ns, Relaxed);
}

// --- Snapshot --------------------------------------------------------------

#[derive(Serialize, Default)]
pub struct MetricsSnapshot {
    pub uptime_s: u64,
    pub market_requests: u64,
    pub market_429: u64,
    pub market_errors: u64,
    pub market_req_per_s: f64, // over the recent-ring span (decays when idle)
    pub market_err_rate: f64,  // errors / requests within the ring
    pub lat_p50_ms: u32,
    pub lat_p95_ms: u32,
    pub lat_max_ms: u32,
    pub recent_latencies: Vec<u32>, // chronological, for the sparkline
    pub hb_age_s: Option<i64>,
    pub hb_changed_total: u64,
    pub hb_ticks: u64,
    pub db_writer_ops: u64,
    pub db_writer_wait_avg_us: u64,
    pub db_writer_held_avg_us: u64,
    pub db_read_ops: u64,
    pub db_read_wait_avg_us: u64,
    pub db_read_query_avg_us: u64,
    pub valuation_runs: u64,
    pub valuation_last_ms: u64,
    pub valuation_avg_ms: u64,
    pub pricing_owned_priced: i64,
    pub pricing_owned_total: i64,
    pub pricing_coverage_pct: f64,
}

/// Nearest-rank percentile of an ascending-sorted slice (`p` in 0.0..=1.0).
fn percentile(sorted: &[u32], p: f64) -> u32 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn avg_us(total_ns: u64, ops: u64) -> u64 {
    total_ns.checked_div(ops).map_or(0, |ns| ns / 1_000)
}

/// Serialize the current metrics. Pricing coverage is a best-effort read; on a DB
/// error it stays zero rather than failing the whole snapshot.
pub fn snapshot(db: &Db) -> MetricsSnapshot {
    let m = &*METRICS;
    let samples = m.lat.lock().chronological();
    let n = samples.len();

    let mut ms: Vec<u32> = samples.iter().map(|s| s.ms).collect();
    ms.sort_unstable();
    let errs_in_ring = samples.iter().filter(|s| s.err).count();

    // req/s over the span from the oldest sample to now — decays during idle.
    let req_per_s = match samples.first() {
        Some(first) if n > 0 => {
            let span_ms = (now_ms() - first.at_ms).max(1) as f64;
            n as f64 * 1000.0 / span_ms
        }
        _ => 0.0,
    };

    let hb_last = m.hb_last_tick_ms.load(Relaxed);
    let hb_age_s = (hb_last > 0).then(|| (now_ms() - hb_last) / 1000);

    let (priced, total) = pricing_coverage(db);

    MetricsSnapshot {
        uptime_s: m.start.elapsed().as_secs(),
        market_requests: m.market_requests.load(Relaxed),
        market_429: m.market_429.load(Relaxed),
        market_errors: m.market_errors.load(Relaxed),
        market_req_per_s: round2(req_per_s),
        market_err_rate: if n > 0 {
            round2(errs_in_ring as f64 / n as f64)
        } else {
            0.0
        },
        lat_p50_ms: percentile(&ms, 0.50),
        lat_p95_ms: percentile(&ms, 0.95),
        lat_max_ms: ms.last().copied().unwrap_or(0),
        recent_latencies: samples.iter().map(|s| s.ms).collect(),
        hb_age_s,
        hb_changed_total: m.hb_changed_total.load(Relaxed),
        hb_ticks: m.hb_ticks.load(Relaxed),
        db_writer_ops: m.db_writer_ops.load(Relaxed),
        db_writer_wait_avg_us: avg_us(
            m.db_writer_wait_ns.load(Relaxed),
            m.db_writer_ops.load(Relaxed),
        ),
        db_writer_held_avg_us: avg_us(
            m.db_writer_held_ns.load(Relaxed),
            m.db_writer_ops.load(Relaxed),
        ),
        db_read_ops: m.db_read_ops.load(Relaxed),
        db_read_wait_avg_us: avg_us(m.db_read_wait_ns.load(Relaxed), m.db_read_ops.load(Relaxed)),
        db_read_query_avg_us: avg_us(
            m.db_read_query_ns.load(Relaxed),
            m.db_read_ops.load(Relaxed),
        ),
        valuation_runs: m.valuation_runs.load(Relaxed),
        valuation_last_ms: m.valuation_last_ns.load(Relaxed) / 1_000_000,
        valuation_avg_ms: avg_ms(
            m.valuation_total_ns.load(Relaxed),
            m.valuation_runs.load(Relaxed),
        ),
        pricing_owned_priced: priced,
        pricing_owned_total: total,
        pricing_coverage_pct: if total > 0 {
            round2(priced as f64 / total as f64 * 100.0)
        } else {
            0.0
        },
    }
}

fn avg_ms(total_ns: u64, runs: u64) -> u64 {
    total_ns.checked_div(runs).map_or(0, |ns| ns / 1_000_000)
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

/// (owned slugs with any usable price, total owned slugs). Reuses the read pool;
/// a slug counts as priced if it has a headline median, a live ask, or a per-rank
/// median — the same three tables `effective_price` resolves against.
fn pricing_coverage(db: &Db) -> (i64, i64) {
    db.read(|c| {
        let total: i64 =
            c.query_row("SELECT COUNT(*) FROM inventory_items WHERE qty > 0", [], |r| r.get(0))?;
        let priced: i64 = c.query_row(
            "SELECT COUNT(*) FROM inventory_items ii WHERE ii.qty > 0 AND (
                 EXISTS (SELECT 1 FROM price_cache p WHERE p.slug = ii.slug AND p.median_plat IS NOT NULL)
                 OR EXISTS (SELECT 1 FROM order_cache o WHERE o.slug = ii.slug)
                 OR EXISTS (SELECT 1 FROM price_rank r WHERE r.slug = ii.slug)
             )",
            [],
            |r| r.get(0),
        )?;
        Ok((priced, total))
    })
    .unwrap_or((0, 0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_picks_nearest_rank() {
        let xs: Vec<u32> = (1..=100).collect(); // 1..100 ascending
        assert_eq!(percentile(&xs, 0.0), 1);
        assert_eq!(percentile(&xs, 0.50), 51); // round((99)*0.5)=50 → xs[50]=51
        assert_eq!(percentile(&xs, 0.95), 95);
        assert_eq!(percentile(&xs, 1.0), 100);
        assert_eq!(percentile(&[], 0.5), 0);
        assert_eq!(percentile(&[7], 0.95), 7);
    }

    #[test]
    fn ring_overwrites_oldest_and_keeps_order() {
        let mut r = LatRing::default();
        for i in 0..(LAT_RING as i64 + 5) {
            r.push(LatSample {
                at_ms: i,
                ms: i as u32,
                err: false,
            });
        }
        let chrono = r.chronological();
        assert_eq!(chrono.len(), LAT_RING);
        // oldest retained is sample #5, newest is the last pushed
        assert_eq!(chrono.first().unwrap().ms, 5);
        assert_eq!(chrono.last().unwrap().ms, LAT_RING as u32 + 4);
    }

    #[test]
    fn avg_helpers_guard_zero() {
        assert_eq!(avg_us(0, 0), 0);
        assert_eq!(avg_us(2_000_000, 2), 1_000); // 1ms = 1000us
        assert_eq!(avg_ms(0, 0), 0);
        assert_eq!(avg_ms(6_000_000, 2), 3); // 3ms avg
    }
}
