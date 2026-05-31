//! Pure domain logic: classification + name splitting. No I/O, no DB — ported
//! from reference/market-proxy/index.ts and reference/domain-logic/partname.ts.
//! The frontend never re-derives any of this; Rust hands it finished objects.

pub mod classify;
pub mod partname;
