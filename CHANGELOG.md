# Changelog

All notable changes to WFIT are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [1.4.1] — 2026-07-12 · first user-reported bugfixes

- **Set completion respects per-set part quantities** (#1). Sets that
  need multiples of a part (Aksomati Prime: ×2 barrels and receivers)
  no longer read complete with one of each. Completion, part counters,
  one-away detection, "to complete" pricing, and the relic planner's
  wanted/one-away signals all count units now; the set drawer marks ×2
  parts and shows partial counts (1/2). The underlying set-composition
  sync had silently never stored quantities — existing installs re-sync
  automatically in the background on first launch after updating.
- **The Void Cascade overlay survives a force-closed window** (#3).
  Closing the overlay through the window manager used to kill the
  hotkey for the rest of the session; it now hides instead, and a
  destroyed window is rebuilt on the next press.
- **The "update available" notification deep-links to the installer** —
  clicking it opens Settings scrolled to About › Updates with the row
  highlighted, instead of the top of the page.

## [1.4.0] — 2026-07-09 · void UI + syndicates

- **Void UI revamp.** New void-blue palette and the "connected sheet"
  design language: hairlines run edge to edge, list screens go
  full-bleed, panels flatten into ruled bands, and a fused stat strip
  replaces boxed stats app-wide. Sets, Arcanes, and Trends rebuilt in
  the Relics table+drawer idiom.
- **Vendors › Syndicates tab.** All six relay syndicates' tradeable
  stock as static offering datasets — live prices, rank gates, standing
  costs, and plat-per-standing to spot what's worth buying to sell.
- Relics gained a refinement filter; the Market screener search
  returned to a floating box; Account got the connected-sheet
  treatment.

## [1.3.0] — 2026-07-06 · relic browser

- **The Relics screen is a full-catalog browser now.** Every known relic
  (~770, owned or not) in one full-screen spreadsheet, default-sorted by
  burn priority (completes a one-away set → drops a wanted item → EV);
  protected relics demoted, the unowned catalog last. Filters: owned,
  tier, signal chips, a custom **rare > N p** price floor, and the topbar
  grammar grew `is:owned/vaulted/protected/set/wanted/aya`, `rare>N`,
  `ducats>N`, and `drops:<name>` (reverse lookup by reward).
- **Squad-size EV (1–4).** Expected plat per crack computed as a true
  best-of-N radshare (order statistics over the drop value distribution),
  not naive averages — the 1/2/3/4 toggle recalculates the whole table.
  Ducat EV stays per-crack (every squad member dissolves their own pick).
- **Rare drop column.** The gold-tier reward's price, sortable, shown in
  gold; the drawer tags the rare reward.
- **Relic drawer.** Click any relic: per-refinement EV / ducats / rare
  odds / refine-ROI (plat per 100 traces, with a "worth radianting?"
  verdict), quantity steppers per refinement, a **Protect (do-not-burn)**
  flag, and the full drop table with per-drop ownership. Drop names open
  the item drawer on top; items gained a "Drops from relics" section.
- **Vault data stays fresh.** Relic reference data (drop tables + vault
  flags) auto-refreshes from WFCD on launch when older than 3 days — the
  bundled snapshot aged with every Prime Access rotation and showed
  currently-farmable relics as vaulted. Relics in Varzia's current Prime
  Resurgence stock now carry a gold **AYA** tag (vaulted but buyable).
- Removed: the old two-tab owned-only Relics screen, the manual add-relic
  modal (the catalog + drawer steppers replace it), and the crackable-now
  signal (Omnia fissures take any tier, so it was always on).

## [1.2.1] — 2026-07-04

- Maintenance release — the first one delivered over the new auto-update
  channel. If you're on v1.2.0 (Windows or AppImage), WFIT offers this
  update itself: Settings › About › **Install v1.2.1**, or wait for the
  daily check's notification. No functional changes.

## [1.2.0] — 2026-07-04 · auto-update

- **The app updates itself now.** A daily background check (Settings ›
  Notifications › "Check for updates", on by default) posts an in-app
  notification when a new version ships, and Settings › About grows an
  **Install** button: signed download with live progress, then restart
  (on Windows the installer takes over and relaunches). Nothing downloads
  or installs without your click.
  - In-place updates cover **Windows installs (NSIS/MSI) and Linux
    AppImages**. deb/rpm and source installs can't self-update — they get
    the notification with a link to GitHub Releases instead.
  - Update artifacts are cryptographically **signed**; installs verify the
    signature before applying (tauri-plugin-updater / minisign).
  - Note: MSI installs are migrated to the NSIS installer by their first
    auto-update (one-way; upstream supports only that direction).
  - **v1.1.0 predates the updater** — update from it manually (once) via
    GitHub Releases.

## [1.1.0] — 2026-07-04 · first public release

The first release published for anyone to download.

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

- Public packaging: release bundles are built **lean** (the local dev
  dashboard no longer ships in installers; developers opt in with
  `--features dev-dashboard`).
- CI drafts releases with install notes; Windows installers are unsigned for
  now (SmartScreen: More info → Run anyway).

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
