# Changelog

All notable changes to WFIT are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-06-19

First stable release. WFIT is a single-user Tauri 2 (Rust) + local SQLite +
React desktop app for tracking owned Warframe tradeable items, warframe.market
prices/trends, and live world-state. No auth, no cloud, one local binary.

### Screens (11)

- **Dashboard** — portfolio value, "Do next" action feed, world-state at a glance.
- **Inventory** — owned items, rank-aware mods/arcanes, realizable (liquidation-
  adjusted) valuation, per-category cheap-item exclusion.
- **Watchlist / Buy list / Sold history** — price targets, budgeted buys, sale log
  with vs-median performance.
- **Sets** — set completion with cross-screen deep-links to missing parts.
- **Relics** — owned relics, "To crack" tab driven by wanted items, vault data.
- **Arcanes** — Vosfor dissolution screen (collection EV + keep/dissolve guidance).
- **Rotation** — fissures (DE raw worldstate), locally-derived world cycles, Baro/
  Varzia/sortie/Steel Path, and a Crack tab for relics dropping wanted items.
- **Listings** — your warframe.market sell orders + recommendations (read-only v1).
- **Account** — scan-populated Tenno trader profile (Profile · Codex · Resources · Arsenal).
- **Settings** — refresh controls, exclusions, backups, game-scan consent.

### Highlights

- **warframe.market v2 client** with a single serialized 400ms throttle and a
  version-tied User-Agent; outlier-robust trade medians and order-book pricing.
- **Realizable valuation** — values hoards by liquidating into live buy orders plus
  a volume-capped tail rather than naïve price × qty.
- **Live price heartbeat** — perpetual rolling repricer (watchlist → owned → catalog
  tail) emitting `prices-updated` events the UI listens for.
- **Opt-in game inventory import** — consent-gated DE memory scan (Linux + Windows;
  off by default) that reads the live session without logging in. ToS-prohibited and
  ban-risky; documented as such.
- **warframe.market account connect** — username (Tier 1) or pasted JWT in the OS
  keychain (Tier 2) for reading and writing your own orders.
- **Backend perf pass** — read-connection pool (WAL concurrent reads) + batched
  valuation so a market sync never freezes the UI.
- **Resilience** — pre-migration snapshots, schema-skew recovery mode, and a
  DIM-style monochrome UI with micro-animations and a reduced-motion guard.
