# WFIT — Implementation Plan (Tauri + SQLite desktop rewrite)

## Context

WFIT ("Warframe Item Tracker") is a single-user desktop app to track owned Warframe
tradeable items, see warframe.market prices/trends, keep a buy watchlist, and log sales.
It is a rewrite of an old React + Supabase webapp; the entire cloud backend (Auth, hosted
Postgres, RLS, a CORS edge-function proxy, a broken deploy) existed only to work around the
browser and is being deleted. Going desktop collapses it to **one Tauri binary + one local
SQLite file + direct warframe.market calls**: no auth, no hosting, no deploy, no env config.

The repo currently holds only reference docs/design (no app code yet). This plan is the action
strategy to go from empty repo → working v1.

**Design target = `design_handoff_wfit_update1/`** (the REFRESHED "Update 1" handoff — supersedes
the earlier `design_handoff_wfit/` AND the old `design/` "Primely" bundle). It is a **9-screen** app
with a full economic loop (acquire → track → understand market → sell).

**Decisions locked with the user this session:**
- Design target = the **WFIT update1 wireframe**, built **as-is** (monochrome, dense, square/
  no-radius, system fonts, mono numbers). **9 screens** (sidebar nav order): **Inventory** (default,
  tile grid), **Sets** (completion tracker), **Trends**, **Watchlist**, **Buy List** (planning cart
  + budget), **Listings** (your warframe.market sell orders), **Ducats** (conversion efficiency),
  **Rotation** (live world-state: cycles + fissures + Baro), **Sold History**. Plus the shared
  right-side **Drawer** and the **+ Add items** modal. Settings pinned in the sidebar footer.
- Catalog scope = **all 5 item categories**: Warframe parts, Weapon parts, Sets, Mods, Arcanes.
- **Mods scope = ALL mods (`tag:mod`, ~1388)** — user's call. Adds ~8 min to the one-time price
  drain; mitigated by the priority refresh (owned/watchlist first, background drain the rest).
- DB library = **rusqlite** (justified below).
- **Two new external capabilities (see §10–§11), both optional/read-only/isolated from the core
  market path:** (a) live **world-state** (the Rotation screen — cycles + fissures + Baro) from a
  *second* source `api.warframestat.us`; (b) **warframe.market account connect** (the Listings
  screen) to read/import your own sell orders. Governed by `GAMESTATE_WORLDSTATE.md` and
  `WFM_ACCOUNT_SIGNIN.md`.
- **Screen → data-source map:** Inventory/Sets/Trends/Watchlist/Buy List/Ducats/Sold History are
  all computed from the **core** layer (catalog + prices + inventory + sales + set_membership) — no
  new source. **Rotation** = worldstate (§10). **Listings** = wfm account (§11). So only 2 of the 5
  new screens need a new data source; Sets/Buy List/Ducats are pure new views over existing data.
- **Build timing = core first.** Ship the core screens + real data as a working tracker, then the
  computed screens (Sets/Buy List/Ducats), then Rotation (cheap/no-auth), then Listings/account.
- **WFM connection = username-now + JWT-paste option** (Tier 1 + Tier 2; NOT the design's raw
  email/password Tier 3 — RECOMMENDED, user delegated). Enter WFM username for the no-friction
  public path; optional "paste your JWT" (OS keychain) for invisible orders. The design's password
  form is relabeled to username + optional JWT — we never handle raw passwords. (Tier 3 only if
  later justified.) **NOTE:** the design's Listings screen also draws price-edit (±/Match) and a
  visibility status control (offline/online/ingame) implying *write* actions; for v1 keep it
  **READ-ONLY** per `WFM_ACCOUNT_SIGNIN.md` — show listings + import, defer order management.

**Data contract (verified live against warframe.market 2026-05-30, see
`DATA_SOURCING_MASTER_PLAN.md`):** all data comes from warframe.market via three endpoints
(global throttle 350ms / ~3 req/s; headers User-Agent/Language:en/Platform:pc):
- `GET /v2/items` — full list (3794 items). Reliable: slug, tags[], i18n.en.{name,thumb,icon},
  id, **ducats** (real for primes; null for mods/arcanes). NOT here: vaulted, setParts, tradable.
- `GET /v2/items/<slug>` (plural) — detail. Adds setParts (item **ids**), setRoot, quantityInSet
  (obs. 1), tradable. Only needed for Set features → deferrable.
- `GET /v1/items/<slug>/statistics` — `statistics_closed["90days"]` ~90 daily entries
  (median, volume) → real median/trend/sparkline/history. (v2 statistics 404s.)
- **`vaulted` is exposed nowhere** — not a feature; the wireframe uses plat value-tiers, not vault.

**Category → tag mapping (verified counts):** Arcanes = tag `arcane_enhancement` (166, NOT `arcane`
which is 0). Mods = tag `mod` = **all 1388** (user chose full scope). Sets = tag `set`. Warframe
parts = `prime`+`warframe`; Weapon parts = `prime`+`weapon` (verified:
weapon PARTS carry `component`/`blueprint`+`weapon`, the weapon-class tag like `primary`/`melee`
appears only on the `_set` item — so classify weapons by the `weapon` tag, not the class tag).
Ducats are null for every mod and arcane (render "—").

**The mock data is NOT a source.** `design/` and `wireframe.jsx` ship invented `CATALOG`/prices/
sparklines — take only layout/tokens/behavior; every real value is warframe.market-derived.

## Key framing

`reference/prior-tauri-attempt/` is a **working Tauri scaffold** (rusqlite) — but built for the
**old v1 catalog** (`/v1/items`, prime-only, no ducats/tags/id). Strategy: **reuse the plumbing**
(Db handle, error type, migration runner, transactional writes, throttle, command shape) and
**rewrite `market.rs` + classification** to the v2 contract and 5-category scope. Most of
`src/db/*.rs` and the write commands port nearly verbatim.

## 1. DB choice: rusqlite (+ rusqlite_migration)

The PRD leaned sqlx, but it predates the working rusqlite scaffold. Pick **rusqlite**: the app is
not concurrency-bound (one user, one window) — a single `Arc<Mutex<Connection>>` is plenty;
DB commands stay sync, only the two network commands are async. sqlx's compile-time query checking
needs a live `DATABASE_URL`/offline cache at build time (friction for a single-binary app) and
forces everything async, with no migration-runner advantage here. Reuse
`reference/prior-tauri-attempt/Cargo.toml` deps (tauri 2, reqwest 0.12 rustls, rusqlite bundled,
rusqlite_migration, chrono, parking_lot, thiserror, tokio sync/time/rt, tracing, serde_json);
rename `wfinv`→`wfit`.

## 2. SQLite schema — `src-tauri/migrations/0001_init.sql`

Extends the prior schema + master-plan §6. Key changes vs old: drop user_id/RLS/auth FKs;
**`category` NOT NULL with the 5 design values** (`warframe|weapon|set|mod|arcane`); add `wfm_id`
+ `detail_fetched_at` to catalog; add `delta_7d`+`volume_7d` to price_cache (real, not synthetic);
new tables `price_history` (real 90d series), `watchlist` (was localStorage), `set_membership`
(Pass B), `app_meta`. `is_vaulted` kept but inert (no source, never surfaced).

```sql
catalog_items(slug PK, wfm_id, display_name, part_type, category NOT NULL, set_slug,
  ducats, is_vaulted DEFAULT 0, is_tradeable DEFAULT 1, thumbnail_url, detail_fetched_at, updated_at)
price_cache(slug PK→catalog ON DELETE CASCADE, median_plat, trend CHECK(up/flat/down),
  delta_7d, volume_7d, fetched_at, expires_at)
price_history(slug→catalog, day, median, volume, PK(slug,day))
inventory_items(slug PK→catalog, qty CHECK>=0, first_added_at, last_modified_at, notes)
sale_events(id PK AUTOINC, slug→catalog, qty CHECK>0, plat_per_unit, market_median_at_sale_time, sold_at, notes)
watchlist(slug PK→catalog ON DELETE CASCADE, target_plat, added_at)
set_membership(set_slug, part_slug, quantity_in_set DEFAULT 1, PK(set_slug,part_slug))
app_meta(key PK, value)
buy_list(slug PK→catalog ON DELETE CASCADE, buy_qty CHECK>0, added_at)   -- Buy List screen
wfm_account(id PK CHECK(id=1), username, status, last_import_at)   -- single row; JWT NOT here (keychain only)
market_listings(order_id TEXT PK, slug→catalog, order_type, your_price, qty, visible, updated_at)  -- cache of your WFM sell orders (read-only mirror)
app_settings(key PK, value)   -- budget number, density/accent prefs, "include all mods" toggle, etc.
-- indexes: catalog(category), catalog(set_slug), catalog(display_name),
--          price_cache(expires_at), price_history(slug), sale_events(sold_at), market_listings(slug)
```

The 9 screens map to tables: Inventory/Sets/Ducats ← catalog+inventory+price_cache(+set_membership);
Buy List ← buy_list; Listings ← market_listings+wfm_account; Sold History ← sale_events;
Watchlist ← watchlist; Trends ← price_history/price_cache; Rotation ← no table (in-memory, §10).

- `inventory_items` gains an optional `source TEXT` (`'manual'`|`'wfm_import'`) for import-conflict
  UX/provenance (see §11). Not strictly required for v1.
- **No table for worldstate (Rotation)** — ephemeral, in-memory short-TTL cache only (§10).
- **No table for the JWT** — OS keychain only, never SQLite (§11).
- `market_listings` is a read-only mirror of your WFM orders (refreshed on connect/sync), not a
  source of truth — your orders live on warframe.market. `buy_list`/`app_settings.budget` replace
  the wireframe's in-memory buy+budget state.

Future schema changes append `0002_*.sql` to the `Migrations::new(vec![...])` list in `db/mod.rs`.
`wfm_account` + `inventory_items.source` ship in `0001` if building the import feature in v1, else as a later migration.

## 3. Rust module layout (`src-tauri/src/`)

```
main.rs      REUSE (thin → lib::run())
lib.rs       REUSE shape; expand AppState{db,market} handler registry
error.rs     REUSE verbatim
types.rs     EXPAND (PartItem, Summary, SaleRow, WatchRow, Trends structs)
market.rs    REWRITE to v2 (old is v1) — highest-care file
worldstate.rs NEW — api.warframestat.us client (own throttle/cache; isolated from market.rs) §10
wfm_account.rs NEW — warframe.market auth + profile/orders client; keychain via `keyring` §11
commands.rs  EXPAND (prior is base; reuse transactional writes)
domain/{classify,partname,parts}.rs   NEW — port from market-proxy + domain-logic/*.ts
db/{mod,catalog,inventory,sales,prices,meta}.rs  REUSE/EXTEND
db/{watchlist,trends,buylist,wfm}.rs  NEW (buylist = Buy List; wfm = account row + listings mirror + import upsert)
```
New crate deps: `keyring` (OS keychain for the JWT). Worldstate/wfm reuse reqwest + the shared throttle.

**`market.rs` (rewrite):** keep the prior `Market` struct + reqwest builder + global
`throttled()` (350ms `Arc<Mutex<Instant>>` — the single rate-limit chokepoint). Replace logic:
- `fetch_catalog() -> (Vec<CatalogUpsert>, HashMap<wfm_id,slug>)`: `GET /v2/items`, filter via
  `classify::category_of(tags,slug) -> Option<Category>` (None=skip), build rows, return id→slug map.
- `fetch_statistics(slug) -> Option<StatsResult>`: `GET /v1/items/{slug}/statistics`, parse 90d
  series → full daily series (for price_history) + median_plat + trend (±5% recent-7d vs prior-7d)
  + delta_7d + volume_7d.
- `fetch_detail(slug)` (Pass B, deferred): `GET /v2/items/{slug}` → setParts(ids)/setRoot/
  quantityInSet → resolve ids→slugs → write set_membership; initially only `category='set'` (~157).

**`domain/classify.rs`:** port `partTypeOf`/`deriveSetSlug` from
`reference/market-proxy/index.ts`; `category_of` implements the 5-column mapping above (arcane via
`arcane_enhancement`; mod via `legendary`∪`galvanized_` default). One predicate so widening mods
later is a one-function change.

**`domain/partname.rs`+`parts.rs`:** port `split_name` + PartItem assembly from a joined
catalog×price_cache×price_history×inventory row. **`derive.ts` is retired** (real history replaces
synthetic sparkline/delta); keep only a "no data" fallback.

**Command surface (registered in `lib.rs`):** reuse prior transactional impls for writes.
`get_inventory`, `get_summary`, `get_catalog(category?)`/`search_catalog(q,limit)`,
`add_to_inventory(slug,qty?)` (+enqueue price refresh), `set_qty`, `remove_item`,
`record_sale(...)`, `undo_sale(id)` (NEW; today's rows only), `get_sales(limit?)`,
`get_watchlist`/`add_watch(slug,target?)`/`remove_watch`/`set_target`, `get_trends(timeframe?)`,
`catalog_refresh`, `prices_refresh(slugs?,force?)`, `get_item_detail(slug)`/`get_item_history(slug,tf)`.
Plus computed-screen commands: `get_sets()` (set completion from catalog+set_membership/heuristic+
inventory), `get_buy_list()`/`add_to_buy_list(slug,qty)`/`set_buy_qty`/`remove_buy`/`purchase_buy(slug)`
(→inventory)/`get_budget`/`set_budget`, `get_ducats()` (ducat-efficiency ranking).
Plus world-state (§10): `get_worldstate()` → cycles + fissures + Baro.
Plus wfm account (§11): `wfm_connect(username)`, `wfm_set_session(jwt)`, `wfm_signout`,
`get_wfm_account()`, `wfm_sync_listings()` (refresh the mirror), `wfm_fetch_listings()` (read-only
preview for import), `wfm_apply_import(rows)` (transactional merge).

## 4. Frontend port

Scaffold `npm create tauri-app@latest` (React+TS+Vite) + Tailwind + `@tanstack/react-query` +
`@tauri-apps/api`. Reuse prior `tauri.conf.json` (rename to wfit/dev.finn.wfit; devUrl :1420).

- **Tokens → `src/theme.css`:** lift the wireframe's `<style>` block verbatim; use the **HTML's**
  values (`--nav:182px; --tile:46px; dense 40px`). Keep the wireframe's component class names
  (`.tile`, `.statband`, `.mrow`, `.drawer`, `.modal`, `.dtable`, `.syncbar`…) — fastest fidelity
  route since design ships as-is. `tailwind.config.ts` only bridges tokens + enforces globals
  (radius 0, base 12px, mono tabular-nums numbers, system fonts).
- **Components (1:1 with wireframe.jsx):** `App` (shell), `Sidebar` (syncbar from
  `summary.last_synced`), `StatBand` (from `get_summary`), `Inventory`+`Section`/`Tile`/`Legend`
  (from `get_inventory` grouped by category; tier=`tier(plat)`; trend strip from delta_7d sign),
  `Trends`+movers/`MiniSpark`/`BigChart` (from `get_trends` — **replace the wireframe's fake
  factor-scaling with real per-timeframe deltas + real `volume_7d`**), `SoldHistory` (get_sales,
  relative dates, ↺ undo today), `Watchlist` (get_watchlist + targets/status), `Drawer`
  (get_item_detail/history; "Sell 1"→record_sale, "Add to watchlist"→add_watch; ducat "—" when
  null), `AddItems` (get_catalog per category; Warframe/Weapon grouped+expandable by set, others
  flat; toggle/stepper → add/set_qty/remove), `Settings` (refresh triggers + rebuild-cache +
  **Connect warframe.market** account panel §11; **Tweaks panel dropped**).
- **The 5 new screens (design grew to 9 total):**
  - `Sets` (computed) — set-completion tracker: stat band (Complete / One-away / Completable value /
    Avg %), filter chips, `.setrow` (name+progress bar, 4 part-chips owned✓/missing-price, full-set
    value or "Buy N missing"→buy_list). From `get_sets()`. Missing-part chips feed Buy List.
  - `Buy List` (computed) — planning cart: editable budget input, stat band (Items/Units/Total/
    Remaining), `.dtable` with qty stepper + "Bought"(→inventory) + remove + "Purchase all". From
    `get_buy_list`/`set_budget`. Fed by Sets, Watchlist "+buy", Drawer.
  - `Ducats` (computed) — conversion efficiency: stat band (Inventory ducats / Trash-tier / Trash
    candidates / Avg d-per-part), ranked `.dtable` by ducats÷plat with "ducat it" vs "sell for plat"
    verdict. Only parts with ducats. From `get_ducats()`.
  - `Rotation` (worldstate §10) — `.cyclebar` 4 cards (Cetus/Vallis/Cambion/Duviri state+countdown),
    Void Fissures panel (tier chips + Steel Path toggle + `.dtable` with live time-left), Baro panel
    (arrival countdown + relay; NO stock list until active — design note explains). From `get_worldstate()`.
  - `Listings` (wfm account §11) — connection banner (status dot + "as {ign} · rep {n}" + Sync),
    stat band (Active / Listed value / At best / Undercut), your-listings `.dtable` (Item / your
    price / qty / market low / rank / status). **v1 read-only** (Match/± edits + status control are
    deferred write features); "Import to inventory" merges into inventory. Signed-out = sign-in card.
  - Drawer gains context actions: owned → Sell 1 + **List on market** (deferred/stub in v1) + Add to
    watchlist; not-owned → **Add to buy list** + Add to watchlist.
- **Data layer:** `lib/api.ts` thin invoke() wrappers; React Query keys `inventory/summary/sales/
  watchlist/catalog/trends/itemDetail`; mutations invalidate related keys. Domain transforms stay
  **Rust-only** (frontend gets finished PartItems); keep only a TS `PartItem` interface.

## 5. Refresh / caching strategy

- Throttle: 350ms global (reuse `Market::throttled`). TTLs: price `expires_at`=6h; detail=weekly+;
  catalog skeleton on launch if >~24h old (1 call).
- `prices_refresh` priority: (1) owned inventory stale/missing, (2) watchlist, (3) background drain
  of the rest oldest-first. Foreground cap ~50; background = a tokio task looping at the throttled
  rate, persisting as it goes (UI never blocked, limit never exceeded). Full drain once: ~957 items
  (primed+galvanized scope) ≈ 5.6 min; all-mods ≈ 13 min — then only stale refresh.
- On launch: open+migrate DB → catalog_refresh if empty/stale → foreground price refresh for
  owned+watchlist (capped) → spawn background drain.
- "synced Nm ago" = `summary.last_synced` = max(price_cache.fetched_at), stored in `app_meta`
  via `meta::set` (prior code already does this). Each refresh upserts price_history AND recomputes
  price_cache from it in one transaction.

## 6. Build order (runnable early) — CORE FIRST, then the two optional layers

1. **Scaffold** — Tauri2 + Vite/React/TS/Tailwind; copy `tauri.conf.json`, `icons/`, `Cargo.toml`,
   `build.rs`, Rust `src/` from prior attempt; rename wfit. *(Verify: window opens.)*
2. **DB layer** — new `0001_init.sql`; reuse `db/mod.rs`+`meta.rs`; migrate in `app_data_dir()`.
3. **Catalog skeleton** — rewrite `market.rs::fetch_catalog` v2 + `classify.rs`; reuse
   `catalog::upsert_many` (new cols); wire `catalog_refresh`. *(Verify: 1 call → ~730 primes + 166
   arcanes + mods/sets; count>0.)*
4. **Read commands + Inventory screen** — get_catalog/search/inventory/summary; port theme.css +
   Sidebar/StatBand/Inventory/Section/Tile/AddItems(read-only). First "looks like the design".
5. **Write commands** — reuse transactional inventory add/set_qty/remove + sales::record; wire
   AddItems steppers + Drawer "Sell 1"; add undo_sale. *(Verify: add→grid+statband update; sell→ledger+decrement.)*
6. **Prices + real history** — extend `prices.rs` (write price_history; derive median/trend/
   delta_7d/volume_7d); priority order + background drain. Replace synthetic sparklines with real
   history. *(Verify: owned items show real plat/trend; synced-ago updates.)*
7. **Remaining core screens** — Sold History (undo), Watchlist (watchlist.rs + commands + screen),
   Drawer detail/history/chart, Settings.
8. **Trends** — trends.rs aggregates; Trends screen with real per-timeframe deltas + volume.
9. **Computed screens** — Sets (needs set_membership — do Pass B here or use heuristic), Buy List
   (buylist.rs + budget in app_settings), Ducats (pure query). No new data source.
10. **Rotation (worldstate)** — `worldstate.rs` + `get_worldstate` (cycles + fissures + Baro) +
    Rotation screen (§10). Self-contained, no auth.
11. **Listings + WFM account** — Listings screen (signed-out card + signed-in table); Tier 1 public
    username `wfm_connect`→`wfm_sync_listings`/`wfm_fetch_listings`→table + import→`wfm_apply_import`;
    then Tier 2 (pasted JWT + keychain). Read-only in v1 (§11).
12. **Pass B (set composition)** — fetch_detail on set items → set_membership → authoritative full-set
    detection (feeds Sets screen; do earlier in step 9 if exact sets are wanted from the start).
13. **Bundle** — icon; macOS + Linux builds (`bundle.targets:"all"`).

**DoD v1 (core):** launch → catalog populates → add items across 5 categories → real plat/ducats/
trends/sparklines → record+undo sales → watchlist with targets → Trends overview. No login required.
**DoD for the optional layers:** Fissures tab shows live timers; Settings → Connect warframe.market →
enter username → review found listings → import selected (manual counts preserved, labeled as listings).
Both are independent and can ship after the core.

## Critical files
- `reference/prior-tauri-attempt/src/market.rs` — rewrite v1→v2; reuse Market struct + throttle.
- `reference/market-proxy/index.ts` — port partTypeOf/categoryOf/deriveSetSlug + median/trend → `classify.rs`.
- `reference/prior-tauri-attempt/src/commands.rs` + `src/db/{inventory,sales}.rs` — base for command surface + transactional writes.
- `reference/prior-tauri-attempt/migrations/0001_init.sql` — base schema to extend (§2).
- `design_handoff_wfit_update1/wireframe.jsx` + `WFIT Wireframe.html` + `README.md` — THE design target (9 screens); component tree, data fields, CSS tokens, Data Sources section.
- `DATA_SOURCING_MASTER_PLAN.md` — the data contract (endpoints, field facts, scope).
- `GAMESTATE_WORLDSTATE.md` — worldstate/fissures source + rules (§10).
- `WFM_ACCOUNT_SIGNIN.md` — warframe.market account connect + listings import (§11).

## Risks & open decisions
- **Mods scope = ALL 1388 (chosen):** adds ~8 min to the one-time price drain and pulls in low-value
  clutter, but the priority refresh (owned/watchlist first) means it never blocks the user; the drain
  runs in the background. An `app_settings` "include all mods" flag could later narrow it if desired.
- **"Most traded"/volume:** real `volume` from statistics → only meaningful after background drain;
  until then ranks the priced subset.
- **Thin/empty history** (some mods/arcanes) → no price_cache row → UI must render null plat ("—",
  basic tier, flat strip). prior `list_ranked` already LEFT JOINs price_cache.
- **Set composition:** Pass B deferred; `set_slug` heuristic + approximate full-set count until
  `set_membership` lands. quantityInSet assumed 1 (verify on more sets before relying on >1).
- **Cross-platform:** Linux needs webkit2gtk+libsoup dev pkgs; **macOS must build on macOS**
  (no webview cross-compile) — per-OS builds. `csp:null` ok (only hits api.warframe.market;
  optionally tighten).
- **Rebuildable cache:** everything except inventory/sales/watchlist is a cache of the 3 endpoints;
  Settings "rebuild cache" wipes catalog/price tables and re-runs without touching user data.
