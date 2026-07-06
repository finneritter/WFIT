# WFIT — Session Handoff (2026-06-03; current-state notes appended 2026-06-29)

WFIT is a working, installed **Tauri 2 (Rust) + local SQLite + React/Vite** desktop app for tracking
owned Warframe tradeables, warframe.market prices, sets, ducats, arcane/Vosfor economics, your sell
orders, and live world-state. Read with `CLAUDE.md` (hard constraints). This handoff supersedes the
earlier ones; prior sessions are condensed at the bottom.

## Status: all on `main` (committed + pushed)

Everything below is **merged to `main`** (`github.com/finneritter/WFIT`) and the installed desktop app
is on this code. The session feature branches (`perf/responsiveness`, `feat/animations`,
`feat/arcanes`) were merged and **deleted**. The 16 screens: Dashboard (home + customizable widget
grid), Inventory, Market (screener), **Riven Search** (auctions + value estimator), Relics
(full-catalog spreadsheet browser + RelicDrawer), Sets, Trends, Watchlist, Buy List, Listings,
Ducats, Arcanes, Rotation, Sold History,
Account (Tenno profile), Settings — plus a global-hotkey Void Cascade HUD overlay window. (This handoff
was written at the 11-screen mark; the newer screens are summarized under "Since this handoff" below.)

Gates green: `cargo clippy` clean · `cargo test` **27 pass + 3 ignored** · `tsc` · `npm run build` ·
`biome` (pre-existing a11y/array-key warnings tolerated). Backend changes spot-checked against the live
DB via `#[ignore]` probe tests (see below).

---

## Running / building

```fish
pkill -x wfit                       # stop the running instance (exact-name; broad pkill -f self-kills the shell)
npm run tauri:dev                   # dev; the WebKitGTK/Wayland env-var workaround lives in main() now
scripts/install.sh                  # build optimized release + install as a launchable app ("WFIT" in KRunner)
```
- **Linux prereq:** `webkit2gtk-4.1` (≥2.46 for `content-visibility`; this box runs 2.52).
- Live DB: `~/.local/share/dev.finn.wfit/wfit.sqlite`. Migrations `0001`–`0017` applied on launch
  (`db/mod.rs::SCHEMA_VERSION = 17` must be bumped with the list). A pre-migration snapshot is saved
  automatically to `…/backups/` before any pending migration; manual backups via Settings →
  Backups (`VACUUM INTO`, newest 10 kept). If the DB fails to open/migrate, the app boots into a
  recovery screen (back up / reset-aside / quit) instead of panicking.
- **Live-DB verification pattern (used heavily this session):** `#[ignore]` probe tests open a DB copy
  and print/compare derived values. Run: `WFIT_PROBE_DB=/tmp/copy.sqlite cargo test --lib <probe>
  -- --ignored --nocapture`. Make the copy with `sqlite3 $DB ".backup /tmp/copy.sqlite"` (consistent
  snapshot even while the app is running). Probes: `inventory::tests::probe_real_db` (valuation
  fingerprint), `db::arcanes::tests::probe_arcanes` (arcane dashboard), `worldstate::tests::ws_probe`
  (live fissure freshness).

---

## What this session added (2026-06-03)

### 1. Backend performance — no more freeze during a price sync
- **Read/write connection split** (`db/mod.rs`): a new `Db::read()` runs read-only closures on an
  **r2d2 pool of `query_only` connections**, isolated from the single writer mutex. WAL lets reads run
  while a sync holds the writer, so the UI no longer freezes mid-sync. **`with`/`with_mut` are
  unchanged** (writer mutex) — they double as write paths in many modules, so only verified read-only
  hot paths moved to `read()` (catalog, sets, trends, prices read-helpers, inventory read path,
  `get_item_detail`). Readers are `query_only` so a stray write errors loudly.
- **Pragmas** (`tune()` in `db/mod.rs`, all connections): `busy_timeout=5000`, `cache_size=-65536`
  (64MB), `mmap_size=256MB`, `temp_store=MEMORY`.
- **Batched the inventory N+1:** `get_inventory` went from **~2000+ queries to ~7**. `prices::PriceMaps`
  + `load_owned_price_maps` preload order/rank/headline in 3 queries; `effective_price_from` /
  `rank_aware_value_from` are in-memory twins of the SQL (KEEP IN LOCKSTEP); `bid_ladders_for` /
  `recent_medians_for` / `inventory::memberships` batch the per-row/per-set loops. **Value-preserving** —
  proven byte-identical via `probe_real_db` and a concurrency test (`db::tests::read_does_not_block_on_a_held_write`).
- **Index** migration `0009_perf_indexes.sql` (`idx_catalog_cat_name` on `(category, display_name)`).
- See `docs/PERF_OPTIMIZATION.md` for the full write-up.

### 2. Data-layer + rendering responsiveness (frontend)
- **Scoped React Query invalidation** (`hooks/queries.ts`): inventory edits no longer force-refetch all
  5 catalog category queries — `patchCatalogRow` optimistically patches the owned slug; catalog is
  invalidated `refetchType: "none"`. Removed the redundant pricing-progress `setInterval` (drive off the
  progress query).
- **Micro-animations** (`feat/animations`): refresh-icon **spin** + a **global topbar progress bar**
  while a sync runs (`usePricingProgress` in `App.tsx`); drawer/modal **enter** transitions; collapsible
  **chevron** rotation; button/chip **press**; cached `Intl.NumberFormat` singletons; Rotation's 1s tick
  isolated to a `<Countdown>` leaf; a **`prefers-reduced-motion`** guard. `content-visibility: auto` on
  `.tile`/`.chip-it` (browser-native off-screen skipping for the big grids) + `React.memo` on the
  inventory rows.
- **Routes are EAGER imports** (`App.tsx`) — route code-splitting was tried and **reverted**: for a
  local desktop app it saved nothing and added a chunk-fetch flash on navigation.
- **Inventory nav-freeze fix:** Inventory stays mounted and is hidden (`display:none`) when inactive —
  re-mounting its ~800-tile grid on every navigation was a visible ~1s freeze.

### 3. Arcanes / Vosfor dissolution screen (new) — see `docs/ARCANE_DISSOLUTION.md`
- **Collection EV leaderboard:** ranks the 9 Loid collections by **expected platinum per 200 Vosfor**,
  computed from live warframe.market **rank-0 (unranked)** prices × each collection's drop table.
- **Owned arcanes → keep/dissolve:** total Vosfor if you dissolved all unranked copies, plus a per-arcane
  verdict. **DISSOLVE only when an arcane is low value even when fully ranked** (maxed market price <
  `KEEP_FLOOR_PLAT=15`, `db/arcanes.rs`); else KEEP. (The earlier rank-0-price comparison wrongly said
  "dissolve Energize" — a rank-0 Energize is ~6p but it's a 100p arcane maxed.)
- **Data:** `domain/arcane.rs` loads bundled `domain/data/arcane_dissolution.tsv`
  (`slug\tcollection\trarity\tvosfor`), sourced from the wiki's `Module:Arcane` (rarity+Vosfor) and the
  Loid `loidogoffer` collection rosters, **validated against the per-rarity drop-table counts** (unit
  test `collection_pool_counts_match_wiki_checksums`). In-memory like `mod_rarity` — no DB table.
- Backend: `db/arcanes.rs` (`dashboard()` = `get_arcane_dashboard` command). Frontend:
  `routes/Arcanes.tsx`.
- **Screen layout (`routes/Arcanes.tsx`):** two column-sortable tables (`useColumnSort` +
  `SortTh`, persisted sort keys).
  1. **"Best collection to spend Vosfor on"** — the 9 Loid collections ranked by plat-EV per 200
     Vosfor (`CollectionEv`); a row opens the **collection breakdown modal**
     (`CollectionBreakdownModal` / `useCollectionBreakdown`) showing the per-arcane drop odds and
     prices behind that EV.
  2. **"Your arcanes — sell or dissolve"** — owned unranked arcanes with the per-copy verdict, the
     `sell` vs `dissolve` plat-equivalents, and Vosfor totals (`OwnedArcane`,
     `ownedValue = sell_plat + dissolve_plat_equiv`). Filter chips: **sell-only**, **dissolve-only**,
     **hide commons**; rows are also narrowed by the topbar search (`usePageSearch` → schema).
  Header stat card shows total **Vosfor (dissolve)** across your unranked spares.

### 4. Valuation rule: prime parts + single copies use FULL value
`db/inventory.rs::owned_holdings` — realizable value now equals `qty × price` (no liquidation haircut)
when the row is a **prime part** (`warframe`/`weapon`/`set`) **or** a **single copy** (`qty <= 1`).
Selling one item is easy; the haircut is for **hoards**, so it applies only to **multi-copy mod/arcane
stacks**. (e.g. 2 Mag Prime Systems BPs @ 18p → 36p, not ~12–14p.) Verified live (realizable rose,
full value unchanged).

### 5. Settings: per-category cheap-item floor
`Settings → Portfolio valuation → "Hide cheap items by category"`. A per-category min-plat
(`KEY_EXCLUDED_MIN_PLAT_BY_CAT`, JSON map in `app_settings`; `excluded_min_plat_by_cat`). Items in a
category whose unit price is at/below its floor are dropped from the portfolio value (and dimmed in the
grid, hideable via Inventory's existing "Hide excluded" toggle) — **same `excluded`-flag mechanism as
the rarity exclusion** (affects value, not the raw owned-count). Applied in `owned_holdings`.

### 6. Rotation / world-state fixes
- **Freshness:** `api.warframestat.us/pc` now **301-redirects to `/pc/`**, and Cloudflare was serving a
  **many-minutes-stale cached copy** (`cf-cache-status: HIT`, ignores client `no-cache` on a HIT). Fix
  (`worldstate.rs`): hit the canonical `/pc/` and append a **per-fetch cache-buster** `?_=<timestamp>`
  so each refresh misses the CDN cache. Measured **13min → 7min** lag (residual ~7min is warframestat's
  own update cadence — inherent to that source).
- **Fissures grouped by mode** (`routes/Rotation.tsx`): the list splits into **Normal / Steel Path
  (`isHard`) / Void Storms · Railjack (`isStorm`)** sections — each lives in a different in-game menu, so
  mixing them made Steel Path / Railjack fissures look like phantoms. Replaced the old "Steel Path"
  toggle. The per-tier summary excludes Railjack storms.
- **Omnia "⚡ Void Cascade" callout** is restored and **group-aware** ("· Steel Path" / "· Normal"),
  pointing to the group where the fissure row actually appears. Box + list both derive from the same
  data, so they agree.
- **Fissures are now DE-verified (2026-06-03):** `worldstate/raw.rs` fetches DE's raw
  `api.warframe.com/cdn/worldState.php` (authoritative, ≤43s CDN staleness) concurrently with
  warframestat each refresh; **DE wins for fissures** (`Worldstate.fissure_source: "de"`), warframestat
  still feeds cycles/Baro and is the fissure fallback; disagreements are logged (`cross_check`). Decoding
  uses bundled `worldstate/data/sol_nodes.tsv` + a hardcoded `MT_*` map (both from WFCD
  warframe-worldstate-data — the same data warframestat decodes with, so display strings are identical).
  A backend `spawn_refresher` re-confirms every 3 min even while the webview throttles timers
  (hidden/unfocused window — the original "Rotation froze mid-session" bug), and `useWorldstate` sets
  `refetchIntervalInBackground: true`. UI shows "as of HH:MM · DE-verified". Probe:
  `worldstate::raw::tests::de_probe`.

### 7. Live heartbeat ("the app should feel alive") — 2026-06-03
- **`lib.rs::spawn_price_heartbeat`**: perpetual 45s ticks; each refreshes the stalest tiered slice —
  watchlist (>10min old) → owned (>60min) → stale catalog tail (6h TTL) — capped at ~12 statistics +
  ~6 order-book calls/tick (~24 req/min worst case vs the 400ms throttle's ~150 ceiling; steady state
  ~13/min). Listings mirror piggybacks every ~13th tick via `commands::sync_listings_impl`. Skips
  while `pricing_active` (launch drain / manual refresh owns the throttle).
- Each tick that changed anything stamps `app_meta.last_price_sync` and **emits `prices-updated`**;
  `useLivePriceEvents` (App-mounted) invalidates inventory-derived + listings + progress queries, so
  fresh numbers appear seconds after they land. `prices::slugs_older_than` is the fetched_at-based
  tier query (tighter than `expires_at` staleness).
- **Topbar `LiveBadge`**: pulsing dot + ticking age of the newest data (`PricingProgress.last_price_sync`);
  dims after 5min without updates (offline). Verified live: `last_price_sync` advanced every ~60s for
  13 consecutive minutes post-drain.

### 8. Rotation acquisition planning — tabs, wanted-now, Crack (Vendors is now its own screen)
The Rotation screen is tabbed (`routes/Rotation.tsx`, `TABS`): **Overview · Fissures · Crack**.
Beyond the world-state clocks it answers "what should I go get right now?":
- **Wanted Now** (`WantedNowPanel`, Overview; `get_wanted_now` → `WantedNowRow`): wanted items a
  **live reward source is handing out right now**, so you don't miss a window. "Wanted" =
  `wanted::wanted_items` (watchlist items **plus** the missing parts of any set you've already
  started owning — distinct from the Crack tab's `crack_targets`, which also pulls the buy list and
  caps sets at 2 missing parts). Sources scanned each refresh: **invasions** (both attacker and
  defender rewards, per node) and the **current Steel Path rotation** reward (Teshin). Each hit
  carries a `source_label` and the source's `eta`, rendered as a live `Countdown`; rows are
  click-to-open the item drawer; deduped per slug+source.
  - **Matching** (`domain/reward_match.rs::reward_matches`): reward strings are free text
    ("2 Wraith Twin Vipers Blueprint"), so it's pure token-containment — every word of the item
    name must appear in the normalized reward, and the name must be **≥2 words** so single-word
    noise ("blueprint", "forma", "kuva") can't match half the catalog. Deliberately
    lower-fidelity but kept safe by only ever running against the user's small wanted set, so a
    loose match can at worst surface something they already care about. Unit-tested.
### 8b. Vendors screen — horizontal board + check-off (`routes/Vendors.tsx`)
The old Rotation "Vendors" tab is now its **own top-level screen**: a horizontally-scrolling board
of vendor **columns** (`get_vendor_board` → `Vec<VendorPanel>`), one per rotating vendor, each with a
live countdown header and a check-off spreadsheet of stock.
- **Vendors (Wave 1, fully live from worldstate):** **Baro Ki'Teer** (ducats), **Varzia** (aya +
  regal aya, per-row), **Teshin / Steel Path Honors** (steel essence — this week's featured pick +
  the permanent `evergreens` shop). Each panel: `{key, name, currency, active, activation, expiry,
  rows}`. Adding a vendor = one more panel producer in `commands::get_vendor_board`, no UI change.
- **Vendors (Wave 2, added 2026-07-04):** **The Circuit · Incarnons** (this week's 5 Steel Path
  Incarnon Genesis choices, live from DE raw `EndlessXpSchedule` → `Worldstate.circuit`; account-
  bound so no prices — manual check-off persists across the 8-week rotation) and **Nora · Cred
  Offerings** (bundled stable catalog `domain/data/nightwave_offerings.tsv` — no API exposes the
  shop; the 19-aura pool resolves to live market prices, staples pass through untradeable; panel
  rides the active season's end). Details: `docs/GAMESTATE_WORLDSTATE.md` §Wave-2.
- **Enrichment** (`db/vendor.rs::enrich(vendor_key, items)`): pure DB-side cross-join. Resolves each
  line to a market slug via **`game_ref` (DE `uniqueName`, exact)** first, then falls back to
  `catalog::normalize_name` fuzzy matching. Attaches market value, owned qty, cost-per-plat, the
  **DEAL** flag (`DEAL_MIN_PLAT = 40`, unowned only), plus `tradeable` (resolved to a slug) and the
  check state. Items that resolve to no slug pass through priceless + `tradeable=false` (account-bound
  wares — manual-check only). Lives in `db/vendor.rs`, keeping `worldstate/` DB-free.
- **Check-off** (auto + manual): a row shows **checked** when you **own it** (`owned_qty>0`, from
  inventory / game-scan — `check_source="owned"`, can't be unticked) **or** you manually ticked it
  (`check_source="manual"`). Manual checks persist in the `vendor_checkoff` table (migration 0017,
  `db/vendor_checkoff.rs`, keyed `(vendor_key, item_ref)`, **no catalog FK** so account-bound items
  are tickable), survive rotations, and are cleared per-column via `clear_vendor_checks`. Commands:
  `mark_vendor_check` / `unmark_vendor_check` / `clear_vendor_checks`. Search wired via
  `vendorsSchema` (`is:deal|owned|checked|tradeable`, `plat`/`cost`), filtered per column.
- **Crack tab** (`CrackTab` + `CrackRow`): owned relics whose drops include a **wanted** item —
  watch/buy-list entries plus the missing parts of any set you're within **2 parts** of finishing
  (`db::wanted::crack_targets`, `SET_CLOSE_THRESHOLD = 2`). Rows split into **Crackable now** (a
  live fissure of the relic's tier is up — `CrackNowRow::crackable_now`) and **Waiting on a
  fissure** (kept for planning); sorted crackable-first, then by wanted-drop count, then EV
  (`db::relics::crack_now`). Replaced the old Overview "Crack now" panel, which only showed relics
  matching a live fissure and hid otherwise — the tab now always lists what's worth holding.

---

## Since this handoff (2026-06-11 → 2026-06-29)

Features added after the 2026-06-03 session above. Each has its own spec/design doc where noted; this is
the current-state index.

- **Dashboard — home screen with customizable widget grid** (2026-06-11, widget redesign 2026-06-19;
  `routes/Dashboard.tsx`, see `docs/HOME_WIDGETS.md`). Action-first overview: fixed portfolio hero +
  world strip on top, a drag/reorder/resizable widget grid below (FLIP animation, persisted to
  `localStorage`).
- **Market — item screener** (2026-06-12; `routes/Market.tsx`). Category/price/volume filters, seller
  order books with bid ladders, market link + copy-to-clipboard whisper. In-app market nav from the buy
  list (2026-06-19) and budget UX.
- **Relics screen** (2026-06-15; reworked 2026-07-06 into a full-catalog spreadsheet browser;
  `routes/Relics.tsx` + `components/RelicDrawer.tsx`, migrations `0011_owned_relics` +
  `0012_relic_data` + `0018_relic_prefs`). Every known relic (~770, owned or not) in one
  Vendors-style ruled grid: burn-order default sort (one-away set > wanted > EV; protected demoted,
  unowned last), **squad-size 1–4 best-of-N EV** (`domain/relic.rs::squad_ev`, order statistics),
  ducat EV, a sortable **Rare drop** price column + custom `rare > Np` filter, per-stack refinement
  counts in the Qty column, and VAULT / **AYA** (in Varzia's current Resurgence stock, resolved from
  worldstate projections) / PROT tags. Row click opens the **RelicDrawer**: per-refinement
  EV/ducats/rare-odds/refine-ROI (plat per 100 traces) with qty steppers, Protect (do-not-burn)
  toggle, and the drop table with per-drop ownership; drop names stack the item Drawer on top. The
  item Drawer gained a "Drops from relics" reverse lookup (`db/relics.rs::sources_for`), and the
  topbar grammar a `drops:<name>` field. Relic reference data (drop tables + vault flags, WFCD
  `Relics.json`) now auto-refreshes on launch when >3 days stale — the bundled snapshot ages with
  every Prime Access/Resurgence rotation and used to show currently-farmable relics as vaulted.
  Replaced the two-tab owned-only screen (`get_crack_plan`/`get_relics` and the crackable-now
  signal are gone — Omnia fissures accept any tier, so it carried no information).
- **Account — Tenno trader profile** (2026-06-18; `routes/Account.tsx`, migration `0013_account`, see
  `docs/WFM_ACCOUNT_SIGNIN.md`). Scan-populated sections plus a sales-backed Overview that works without
  a game scan.
- **Riven Search screen** (2026-06-24+; `routes/RivenSearch.tsx`, `src-tauri/src/rivens/`, migrations
  `0014_rivens` / `0015_riven_search_thresholds` / `0016_app_notifications`). Separate warframe.market
  surface: **v2 riven reference** (weapons/attributes, disposition in-API) + **v1 auction search**.
  Unified stat picker with per-stat value thresholds, seller-status filter, a **riven value estimator**
  (asks-anchored winsorized price band, confidence gating, per-listing **Deal** scoring — `rivens/grade.rs`
  + `rivens/price.rs`), saved searches + an in-app notification center (`rivens/watch.rs`, `notify.rs`,
  `db/notifications.rs`). Values stored at max rank; grade formula calibrated. See
  `docs/superpowers/specs/2026-06-27-riven-value-estimator-design.md`.
- **Void Cascade HUD overlay** (2026-06-24; `src-tauri/src/overlay.rs`, `src/overlay/`). A global-hotkey
  always-on-top pill window (separate from the main webview) showing active Void Cascade tier / Steel
  Path status / countdown, or time to the next Omnia reset. Rust-owned auto-hide; the frontend is a
  minimal React app with no router/React Query, just listening for backend-pushed show events.
- **Listings: min sell-price floor + Recommended Refresh** (2026-06-29; commit `17620c5`). A per-unit
  sell-price floor in Settings (default 15p) filters `Listings → Recommended` to items worth the trade
  hassle; a Refresh button force-reprices all owned items and rebuilds the recommendations.
- **Vendor check-off** (migration `0017_vendor_checkoff`, `db/vendor_checkoff.rs`): mark Baro/Varzia lines
  as bought.

---

## Architecture pointers
- **Migrations:** `0001_init` · `0002_ohlc` · `0003_game_import` · `0004_ranks` · `0005_orders` ·
  `0006_buy_orders` · `0007_mod_rarity` (`catalog_items.mod_rarity` + bundled `mod_rarity.tsv`) ·
  `0008_vault_status` (`vault_status` table, WFCD-sourced, `db/vault.rs`) · `0009_perf_indexes` ·
  `0010_order_fetch_meta` · `0011_owned_relics` · `0012_relic_data` · `0013_account` · `0014_rivens` ·
  `0015_riven_search_thresholds` · `0016_app_notifications` · `0017_vendor_checkoff` ·
  `0018_relic_prefs` (per-relic protected/do-not-burn flag). (`SCHEMA_VERSION = 18`.)
- **DB connection model** (`db/mod.rs`): one writer `Arc<Mutex<Connection>>` (`with`/`with_mut`) + an
  r2d2 read pool (`read()`). All tuned by `tune()`.
- **Pricing path:** `market.rs` → `db/prices.rs` (`effective_price` + the batched `PriceMaps` /
  `effective_price_from` / `bid_ladders_for` / `recent_medians_for`) → `db/inventory.rs`
  (`owned_holdings`: rank-aware value, realizable value with the prime/single-copy full-value rule,
  per-category + rarity exclusion) → `Summary`/`InventoryRow`/`ItemDetail`.
- **Reference data (bundled, no DB table):** `domain/mod_rarity.rs` (mod rarity),
  `domain/arcane.rs` (arcane collection/rarity/vosfor). Pattern: `include_str!` a `.tsv`, `Lazy` map.
- **Modules** (`src-tauri/src/`): `market.rs`, `worldstate/` (`mod.rs` + `raw.rs` DE cross-check),
  `wfm_account.rs`, `wfm_socket.rs`, `gamescan/`, `rivens/` (separate wfm riven API — `mod.rs` +
  `grade.rs`/`price.rs` value estimator + `watch.rs` saved-search matching), `overlay.rs` (global-hotkey
  Void Cascade HUD window), `notify.rs` (in-app notification center), `domain/`
  (`classify`/`partname`/`mod_rarity`/`arcane`), `db/` (per-table incl. `arcanes.rs`, `relics.rs`,
  `account.rs`, `rivens.rs`, `notifications.rs`, `vendor_checkoff.rs`), `commands.rs`, `lib.rs`.

## Key gotchas / lessons
- **`PRICING_VERSION` (`lib.rs`, currently checked on launch):** bump it when you change how *cached*
  derived values are computed. NOTE: `realizable_plat` is computed fresh each `get_inventory` (not
  cached), so this session's valuation changes needed no bump — but a change to `price_cache`/
  `price_rank`/`order_cache` derivation does.
- **`effective_price` (SQL) and `effective_price_from` (in-memory) must stay identical** — the batched
  path relies on them being twins.
- **Don't trust cross-snapshot DB comparisons** — the running app drains prices in the background.
  Use one `.backup` copy for before/after.
- `/proc/<pid>/comm` truncates to 15 chars (`Warframe.x64.exe` → `Warframe.x64.ex`).
- **UI not exhaustively click-tested** (no window-raise/input tool on this box). Verified via gates +
  live-DB probes + the user confirming behavior in the installed app. Shell stdout can be unreliable —
  route to files / trust exit codes.

## Known gaps / next steps
- Arcane EV uses **rank-0 (unranked) prices** (what collections actually grant) — not the maxed value.
  A "potential maxed value" column is an easy add if wanted. The Cavia drop-pool vs intrinsic-rarity
  quirk (Melee Fortification/Retaliation) is noted in `db/arcanes.rs`/the dataset.
- ~~World-state residual ~7min lag~~ resolved 2026-06-03: fissures now come from DE's raw worldstate
  (≤43s stale); only the cycle bar/Baro still ride warframestat's cadence (they're deterministic
  timers, so lag there is mostly harmless).
- Per-category/rarity exclusion affects portfolio **value**, not the "Parts" count stat (matches the
  existing rarity-exclusion behavior).
- Pass B set composition still uses the `set_slug` heuristic; game-scan is manual + Linux/Windows (macOS
  unsupported). Listings write actions **shipped** (create/update/delete orders, `hooks/queries.ts` +
  `components/ListingForm.tsx`); the macOS build is still deferred.

---

## Appendix — earlier sessions (condensed)
- **2026-06-01:** game inventory import (memory-scan, `gamescan/`), rank-aware mods/arcanes
  (`0004_ranks`), order-book pricing (`0005_orders`, `effective_price`/`robust_price`, `PRICING_VERSION`
  auto-reprice), realizable valuation (`0006_buy_orders`, `realizable_value` + tail). Plus (later):
  mod rarity (`0007`) + rarity/global-min-plat exclusion, vault status (`0008`).
- **2026-05-31:** frameless window + titlebar + icon; Settings; Trends (index + z-score signals); item
  drawer (OHLC candlestick + MA, live spread); sets-as-parts valuation; Rotation live countdowns; wfm
  icons; global search (`ininv:`); in-app wiki window (`0002_ohlc`).

## Repo
Private **github.com/finneritter/WFIT**, branch `main`. `src-tauri/gen/` gitignored.
