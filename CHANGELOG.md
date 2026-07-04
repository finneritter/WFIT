# Changelog

All notable changes to WFIT are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-07-04 · first public beta

The first release published for anyone to download. Marked **pre-release** on
GitHub while WFIT is in beta.

### New screens & features

- **Riven Search** — a full riven market screen: v2 reference data + v1 auction
  search, unified stat picker with per-stat value thresholds, seller-status
  filter, saved searches with an in-app notification center, and a calibrated
  **value estimator** (winsorized ask-anchored band, confidence gating,
  per-listing deal score).
- **Home dashboard** — customizable freeform widget grid (iOS-style drag /
  resize / push-down), six new widgets, focus-to-scroll, search popover.
- **Vendors** — standalone full-width board (Baro · Varzia · Teshin) with
  check-off persistence, deal/owned tags and per-column totals; **Varzia's Aya
  vs Regal Aya** correctly resolved per row (the API mislabels them); Wave-2
  vendors: **The Circuit's weekly Incarnon choices** (live from DE) and
  **Nora's Nightwave cred shop** (bundled catalog, live aura prices).
- **Account** — scan-populated Tenno trader profile (Profile · Codex ·
  Resources · Arsenal).
- **Relics/Sets** — real vault data, a "To crack" tab driven by wanted items,
  cross-screen deep-links, one-click game-data update.
- **Void Cascade HUD overlay** — global hotkey (default `Alt+C`), always-on-top
  status pill with Rust-owned auto-hide.
- **Notifications** — desktop notifications (vendor arrivals, cascades,
  S-tier arbitrations, resets) + close-to-tray.

### Improvements & fixes

- Listings: min sell-price floor for recommendations; required `perTrade` field
  sent on ranked goods (order writes work again).
- Pricing: troll-high live asks rejected from valuation.
- Frameless window drag-to-resize + fluid responsive layout.
- Throttle hardening: serialized market throttle + 429 retry on writes.

### Distribution

- Public beta packaging: release bundles are built **lean** (the local dev
  dashboard no longer ships in installers; developers opt in with
  `--features dev-dashboard`).
- CI releases are drafted as **pre-releases** with install notes; Windows
  installers are unsigned for now (SmartScreen: More info → Run anyway).

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
