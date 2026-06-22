//! Criterion microbenchmarks for the valuation hot path — the liquidation curve
//! (`realizable_value`), the most-iterated pricing math. Self-contained (no DB).
//!
//! Run with:  cargo bench --features bench
//! (The `bench` feature re-exports the crate-private fn via `wfit_lib::bench_api`.)
//!
//! For an end-to-end valuation bench at real inventory scale, use the running
//! dashboard's POST /api/stress/valuation-bench instead (see scripts/stress.sh) —
//! it times the full `owned_holdings` pass against the live DB.

#[cfg(feature = "bench")]
use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
#[cfg(feature = "bench")]
use wfit_lib::bench_api::realizable_value;

#[cfg(feature = "bench")]
fn bench_realizable(c: &mut Criterion) {
    const W: f64 = 30.0;
    const K: f64 = 1.0;
    const T: f64 = 0.35;
    // A realistic standing bid ladder (best price first).
    let bids: Vec<(i64, i64)> = (0..20).map(|i| (60 - i * 2, 3)).collect();
    let mut group = c.benchmark_group("realizable_value");
    // Vary the stack size: single copy (full-value fast path) → deep hoard
    // (walks the whole bid ladder + the volume-capped tail).
    for &qty in &[1i64, 10, 60, 500, 5000] {
        group.bench_with_input(BenchmarkId::from_parameter(qty), &qty, |b, &qty| {
            b.iter(|| {
                realizable_value(
                    black_box(45),
                    black_box(qty),
                    black_box(Some(280)),
                    black_box(&bids),
                    W,
                    K,
                    T,
                )
            });
        });
    }
    group.finish();
}

#[cfg(feature = "bench")]
criterion_group!(benches, bench_realizable);
#[cfg(feature = "bench")]
criterion_main!(benches);

#[cfg(not(feature = "bench"))]
fn main() {
    eprintln!("wfit valuation benches: run with `cargo bench --features bench`");
}
