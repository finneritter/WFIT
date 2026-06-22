//! Dev-only tooling: a local web dashboard (observability + stress + fault
//! injection), gated behind the `dev-dashboard` Cargo feature so none of it — nor
//! its axum dependency — is compiled into shipped release builds.
//!
//! The running app (with the feature on) spawns a loopback HTTP server that shares
//! the live `AppState`, reads a metrics registry populated by thin recorder calls
//! at the existing chokepoints, and exposes fault-injection knobs the hot paths
//! consult. Hot paths call the `crate::devtools::*` shims defined here; when the
//! feature is off those shims are empty `#[inline(always)]` no-ops the optimiser
//! deletes entirely, so the release build pays nothing and links no devtools code.

#[cfg(feature = "dev-dashboard")]
pub mod faults;
#[cfg(feature = "dev-dashboard")]
pub mod metrics;
#[cfg(feature = "dev-dashboard")]
pub mod server;

/// A parsed order book's ask side: `(rank, price)` per rank.
pub type Sells = Vec<(i64, i64)>;
/// A parsed order book's bid side: `(rank, price, qty)`.
pub type Bids = Vec<(i64, i64, i64)>;

/// The running dev dashboard's URL, or `None` when the feature is off or the
/// server hasn't bound. Drives the Settings "Open dashboard" button.
#[cfg(feature = "dev-dashboard")]
pub fn dashboard_url() -> Option<String> {
    server::dashboard_url()
}
#[cfg(not(feature = "dev-dashboard"))]
pub fn dashboard_url() -> Option<String> {
    None
}

// --- Recorder shims --------------------------------------------------------
// Low-frequency hot paths (market ~2.5 req/s, the heartbeat, the per-refresh
// valuation) call these unconditionally. With the feature on they forward to the
// metrics registry; with it off they're empty `#[inline(always)]` no-ops the
// optimiser deletes — and the `_elapsed` arguments the callers compute are trivial
// next to a network request / full valuation, so there's no measurable cost.
//
// The high-frequency DB accessors (db/mod.rs) do NOT use shims: they time inside
// `#[cfg(feature = "dev-dashboard")]` blocks so the feature-off build computes no
// timestamps at all.

#[cfg(feature = "dev-dashboard")]
#[inline]
pub fn rec_market(status: Option<u16>, elapsed: std::time::Duration, is_err: bool) {
    metrics::record_market(status, elapsed, is_err);
}
#[cfg(not(feature = "dev-dashboard"))]
#[inline(always)]
pub fn rec_market(_status: Option<u16>, _elapsed: std::time::Duration, _is_err: bool) {}

#[cfg(feature = "dev-dashboard")]
#[inline]
pub fn rec_heartbeat(changed: u64) {
    metrics::record_heartbeat(changed);
}
#[cfg(not(feature = "dev-dashboard"))]
#[inline(always)]
pub fn rec_heartbeat(_changed: u64) {}

#[cfg(feature = "dev-dashboard")]
#[inline]
pub fn rec_valuation(elapsed: std::time::Duration) {
    metrics::record_valuation(elapsed);
}
#[cfg(not(feature = "dev-dashboard"))]
#[inline(always)]
pub fn rec_valuation(_elapsed: std::time::Duration) {}

// --- Fault-injection shims -------------------------------------------------
// Consulted in the market client (and order-book parse). No-ops when the feature
// is off. `fault_request` returns 0 = proceed, 1 = inject timeout, 2 = inject 429
// (and applies armed latency/jitter — hence async).

#[cfg(feature = "dev-dashboard")]
#[inline]
pub async fn fault_request() -> u8 {
    faults::request_fault().await
}
#[cfg(not(feature = "dev-dashboard"))]
#[inline(always)]
pub async fn fault_request() -> u8 {
    0
}

#[cfg(feature = "dev-dashboard")]
#[inline]
pub fn fault_order_book(sells: Sells, bids: Bids) -> (Sells, Bids) {
    faults::order_book(sells, bids)
}
#[cfg(not(feature = "dev-dashboard"))]
#[inline(always)]
pub fn fault_order_book(sells: Sells, bids: Bids) -> (Sells, Bids) {
    (sells, bids)
}
