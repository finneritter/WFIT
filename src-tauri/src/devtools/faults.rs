//! Dev-only fault injection (feature `dev-dashboard`).
//!
//! A process-global [`FAULTS`] config of scalar atomics the market client and the
//! DB writer consult on their hot paths (via the `crate::devtools::fault_*` shims).
//! Off by default; the dashboard arms knobs over `POST /api/faults`. Injection is
//! placed to PRESERVE the throttle's serialization guarantee — it runs *after*
//! `throttled()`, and a synthetic 429 flows through the existing retry path so the
//! real retry/backoff is what gets exercised, not a parallel one.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering::Relaxed};
use std::time::Duration;

/// Artificial writer-lock hold is capped below the 5000ms `busy_timeout` so
/// readers wait (the resilience we want to observe) rather than erroring out.
const DB_HOLD_CAP_MS: u64 = 4000;

pub struct FaultConfig {
    enabled: AtomicBool,
    p429_pct: AtomicU8,
    timeout_pct: AtomicU8,
    extra_latency_ms: AtomicU64,
    jitter_ms: AtomicU64,
    empty_book_pct: AtomicU8,
    malformed_price_pct: AtomicU8,
    db_lock_hold_ms: AtomicU64,
}

pub static FAULTS: Lazy<FaultConfig> = Lazy::new(|| FaultConfig {
    enabled: AtomicBool::new(false),
    p429_pct: AtomicU8::new(0),
    timeout_pct: AtomicU8::new(0),
    extra_latency_ms: AtomicU64::new(0),
    jitter_ms: AtomicU64::new(0),
    empty_book_pct: AtomicU8::new(0),
    malformed_price_pct: AtomicU8::new(0),
    db_lock_hold_ms: AtomicU64::new(0),
});

// Per-thread xorshift — enough for probabilistic faults, no `rand` dependency
// (mirrors simulate.rs::Rng). Seeded from a global so threads diverge.
static SEED_SRC: AtomicU64 = AtomicU64::new(0x2545_F491_4F6C_DD1D);
thread_local! {
    static RNG: Cell<u64> = const { Cell::new(0) };
}

fn rand_u64() -> u64 {
    RNG.with(|c| {
        let mut x = c.get();
        if x == 0 {
            x = SEED_SRC.fetch_add(0x9E37_79B9_7F4A_7C15, Relaxed) | 1;
        }
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        c.set(x);
        x
    })
}

/// True with probability `pct`/100.
fn roll(pct: u8) -> bool {
    pct > 0 && (rand_u64() % 100) < pct as u64
}

// --- Consult points (called via the devtools shims) ------------------------

/// Outcome code for a market GET: `0` proceed, `1` synthetic timeout, `2`
/// synthetic 429. Also applies the configured added latency/jitter (so it's async).
pub async fn request_fault() -> u8 {
    let f = &*FAULTS;
    if !f.enabled.load(Relaxed) {
        return 0;
    }
    let base = f.extra_latency_ms.load(Relaxed);
    let jit = f.jitter_ms.load(Relaxed);
    let extra = base + if jit > 0 { rand_u64() % (jit + 1) } else { 0 };
    if extra > 0 {
        tokio::time::sleep(Duration::from_millis(extra)).await;
    }
    if roll(f.timeout_pct.load(Relaxed)) {
        return 1;
    }
    if roll(f.p429_pct.load(Relaxed)) {
        return 2;
    }
    0
}

/// Apply order-book faults: a chance of an empty book, else a chance of corrupting
/// each ask into an outlier (like the xiphos_set troll ask that broke valuation).
pub fn order_book(sells: super::Sells, bids: super::Bids) -> (super::Sells, super::Bids) {
    let f = &*FAULTS;
    if !f.enabled.load(Relaxed) {
        return (sells, bids);
    }
    if roll(f.empty_book_pct.load(Relaxed)) {
        return (Vec::new(), Vec::new());
    }
    let pct = f.malformed_price_pct.load(Relaxed);
    let sells = sells
        .into_iter()
        .map(|(rk, p)| {
            if roll(pct) {
                // 100×–1000× the real ask: a fat-finger/troll high price.
                (rk, p.max(1).saturating_mul(100 + (rand_u64() % 900) as i64))
            } else {
                (rk, p)
            }
        })
        .collect();
    (sells, bids)
}

/// Block the writer mutex for the armed duration (artificial contention).
pub fn db_hold() {
    let f = &*FAULTS;
    if !f.enabled.load(Relaxed) {
        return;
    }
    let ms = f.db_lock_hold_ms.load(Relaxed).min(DB_HOLD_CAP_MS);
    if ms > 0 {
        std::thread::sleep(Duration::from_millis(ms));
    }
}

// --- Dashboard get/set -----------------------------------------------------

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default)] // partial JSON is fine — omitted knobs reset to their default
pub struct FaultView {
    pub enabled: bool,
    pub p429_pct: u8,
    pub timeout_pct: u8,
    pub extra_latency_ms: u64,
    pub jitter_ms: u64,
    pub empty_book_pct: u8,
    pub malformed_price_pct: u8,
    pub db_lock_hold_ms: u64,
}

pub fn get() -> FaultView {
    let f = &*FAULTS;
    FaultView {
        enabled: f.enabled.load(Relaxed),
        p429_pct: f.p429_pct.load(Relaxed),
        timeout_pct: f.timeout_pct.load(Relaxed),
        extra_latency_ms: f.extra_latency_ms.load(Relaxed),
        jitter_ms: f.jitter_ms.load(Relaxed),
        empty_book_pct: f.empty_book_pct.load(Relaxed),
        malformed_price_pct: f.malformed_price_pct.load(Relaxed),
        db_lock_hold_ms: f.db_lock_hold_ms.load(Relaxed),
    }
}

pub fn set(v: FaultView) {
    let f = &*FAULTS;
    f.enabled.store(v.enabled, Relaxed);
    f.p429_pct.store(v.p429_pct.min(100), Relaxed);
    f.timeout_pct.store(v.timeout_pct.min(100), Relaxed);
    f.extra_latency_ms.store(v.extra_latency_ms, Relaxed);
    f.jitter_ms.store(v.jitter_ms, Relaxed);
    f.empty_book_pct.store(v.empty_book_pct.min(100), Relaxed);
    f.malformed_price_pct.store(v.malformed_price_pct.min(100), Relaxed);
    f.db_lock_hold_ms
        .store(v.db_lock_hold_ms.min(DB_HOLD_CAP_MS), Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    // One sequential test — `FAULTS` is a process global, so splitting these into
    // parallel #[test]s would race on it.
    #[test]
    fn fault_config_behaviour() {
        // disabled → pure passthrough
        set(FaultView::default());
        let sells = vec![(0i64, 50i64), (10, 90)];
        assert_eq!(order_book(sells.clone(), vec![]).0, sells);
        assert_eq!(get().p429_pct, 0);

        // set caps percentages and the db-hold duration
        set(FaultView {
            enabled: true,
            p429_pct: 250,
            db_lock_hold_ms: 999_999,
            ..Default::default()
        });
        let v = get();
        assert_eq!(v.p429_pct, 100);
        assert_eq!(v.db_lock_hold_ms, DB_HOLD_CAP_MS);

        // empty-book fault at 100% clears both sides
        set(FaultView {
            enabled: true,
            empty_book_pct: 100,
            ..Default::default()
        });
        let (s, b) = order_book(vec![(0, 50)], vec![(0, 5, 1)]);
        assert!(s.is_empty() && b.is_empty());

        set(FaultView::default()); // reset
    }
}
