# Primely Desktop — Rewrite PRD

**Status:** Draft for handoff · **Date:** 2026-05-30
**From:** React/Vite + Supabase webapp (`wfinv`, this repo) → **To:** Tauri (Rust core + web frontend) + local SQLite desktop app.

---

## 1. Why rewrite

Primely is a single-user, single-machine Warframe prime-part inventory + sales tracker with warframe.market pricing. The current webapp carries a full cloud backend (Supabase Auth + Postgres + RLS + an edge-function CORS proxy + a broken deploy pipeline) that exists **only to work around the browser** — none of it serves the actual use case.

Going desktop collapses the entire backend into one binary:

| Current (webapp) | Reason it exists | Desktop replacement |
|---|---|---|
| Supabase Auth (magic link + Google) | per-user data isolation | **Deleted** — single local user |
| Hosted Postgres + RLS | multi-tenant storage | **Local SQLite file** |
| `market-proxy` edge function | browsers can't call warframe.market (CORS) | **Deleted** — Rust calls the API directly |
| GitHub→Supabase deploy workflow (broken) | ship edge fn + migrations | **Deleted** — no deploy step at all |
| `.env.local`, service-role keys | client config | **Deleted** |

**Net effect:** no auth, no hosting, no deploy, no env config. One binary, one local DB file, direct API access. This is the whole point of the move — operational simplicity, not raw speed (the app was never compute-bound).

---

## 2. Stack decision

- **Shell:** [Tauri 2.x](https://tauri.app) — Rust backend, system webview frontend.
- **Backend language:** Rust.
- **DB:** SQLite via [`sqlx`](https://github.com/launchbadge/sqlx) (compile-time-checked queries, async, built-in migrations) — or `rusqlite` if you prefer sync simplicity. **Recommendation: `sqlx`** for the migration runner + query checking.
- **HTTP:** [`reqwest`](https://github.com/seanmonstar/reqwest) (JSON + rustls) for warframe.market.
- **Frontend:** Keep React + Vite + Tailwind. Reuse the existing component tree and `theme.css`; swap the Supabase data layer for Tauri command calls. Drop in the Claude-designed UI where it improves on the current screens.
- **Frontend↔Rust:** Tauri `#[command]` functions invoked via `@tauri-apps/api`'s `invoke()`. React Query stays — it just calls `invoke()` instead of `supabase`.

**Rejected: pure-Rust GUI (egui/iced/Dioxus/Slint).** The app is design-led (Linear/Raycast aesthetic, a design being built in Claude's design tool which emits HTML/CSS/React). Pure-Rust GUI toolkits can't match that polish without major effort, and there's no compute win to justify discarding the design + existing UI. Tauri keeps the web UI *and* gives the Rust core.

---

## 3. Target architecture

```
primely-desktop/
├─ src-tauri/                 # Rust backend
│  ├─ src/
│  │  ├─ main.rs              # Tauri builder, command registration, app state
│  │  ├─ db.rs                # SQLite pool, migrations runner
│  │  ├─ market.rs            # warframe.market client (catalog + prices)
│  │  ├─ domain/
│  │  │  ├─ partname.rs       # split_name(), category_for()  (port of partname.ts)
│  │  │  ├─ derive.rs         # spark_for(), delta_for()       (port of derive.ts)
│  │  │  └─ parts.rs          # row → PartItem assembly         (port of parts.ts)
│  │  ├─ commands.rs          # #[command] fns = the old hooks/RPCs
│  │  └─ types.rs             # serde structs mirroring frontend types
│  ├─ migrations/             # sqlx migrations (port of supabase/migrations, RLS stripped)
│  └─ tauri.conf.json
├─ src/                       # React frontend (ported from this repo)
│  ├─ lib/        (partname/derive/types kept as TS too, OR thin re-exports)
│  ├─ hooks/      (React Query → invoke() wrappers)
│  ├─ components/ (ported as-is)
│  ├─ routes/     (ported; SignIn deleted)
│  └─ theme.css   (ported as-is)
└─ package.json
```

**Where SQLite lives:** `$APPDATA/primely/primely.db` via Tauri's `app_data_dir()`. Created + migrated on first launch.

---

## 4. Data model (SQLite)

Port the four tables from `supabase/migrations/0001_init.sql`, **dropping `user_id`, RLS, and `auth.users` FKs** (single user). Keep everything else.

```sql
CREATE TABLE catalog_items (
  slug          TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  part_type     TEXT NOT NULL,
  category      TEXT,                       -- 'Warframe' | 'Weapon' | 'Other'
  set_slug      TEXT,                       -- soft ref to catalog_items.slug (no FK, matches 0002)
  ducats        INTEGER,
  is_vaulted    INTEGER NOT NULL DEFAULT 0,
  is_tradeable  INTEGER NOT NULL DEFAULT 1,
  thumbnail_url TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE price_cache (
  slug        TEXT PRIMARY KEY REFERENCES catalog_items(slug) ON DELETE CASCADE,
  median_plat INTEGER NOT NULL,
  trend       TEXT CHECK (trend IN ('up','flat','down')),
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

CREATE TABLE inventory_items (
  slug             TEXT PRIMARY KEY REFERENCES catalog_items(slug),
  qty              INTEGER NOT NULL CHECK (qty >= 0),
  first_added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_modified_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes            TEXT
);

CREATE TABLE sale_events (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                       TEXT NOT NULL REFERENCES catalog_items(slug),
  qty                        INTEGER NOT NULL CHECK (qty > 0),
  plat_per_unit              INTEGER,
  market_median_at_sale_time INTEGER,
  sold_at                    TEXT NOT NULL DEFAULT (datetime('now')),
  notes                      TEXT
);

CREATE INDEX idx_catalog_set_slug   ON catalog_items(set_slug);
CREATE INDEX idx_catalog_name       ON catalog_items(display_name);   -- no pg_trgm; LIKE is fine at this scale
CREATE INDEX idx_price_expires      ON price_cache(expires_at);
CREATE INDEX idx_sale_sold_at       ON sale_events(sold_at);
```

**Notes**
- `inventory_items` PK becomes just `slug` (was `(user_id, slug)`).
- The PostgREST nested-embed gotcha is **gone** — in Rust you write the SQL JOIN yourself.
- `pg_trgm` fuzzy search → plain `LIKE '%q%'` (catalog is small, ~hundreds of rows). Add FTS5 later only if needed.
- Timestamps as TEXT (`datetime('now')`) for SQLite simplicity; serialize to ISO strings for the frontend.

---

## 5. Backend logic to port

### 5.1 warframe.market client (`market.rs`) — from `supabase/functions/market-proxy/index.ts`

The biggest single port. Two operations, plus a shared rate limiter.

**Constants**
```
MARKET_V1   = "https://api.warframe.market/v1"
MARKET_V2   = "https://api.warframe.market/v2"
STATIC_BASE = "https://warframe.market/static/assets/"
PRICE_TTL   = 6 hours
MIN_GAP_MS  = 400           // ~2.5 req/s; enforce a global min-gap throttle
```
Headers on every request: `User-Agent: primely-desktop/0.1`, `Language: en`, `Platform: pc`, `Accept: application/json`.

**`catalog_refresh()`**
1. `GET /v2/items`.
2. Keep items where `tags.includes("prime")`.
3. Per item, build a `catalog_items` row:
   - `slug` = `it.slug`
   - `display_name` = `it.i18n.en.name` (fallback: slug)
   - `part_type` = `part_type_of(slug, tags)` — see derivation below
   - `category` = `category_of(tags)`: has `warframe`→`Warframe`, has `weapon`→`Weapon`, else `Other`
   - `set_slug` = `derive_set_slug(slug)`: find `_prime`; if present and slug doesn't end `_set`, `"{prefix}_prime_set"`; else null
   - `ducats` = `it.ducats`
   - `is_vaulted` = false, `is_tradeable` = true (not in /v2/items)
   - `thumbnail_url` = `STATIC_BASE + it.i18n.en.thumb`
4. Upsert in chunks (`ON CONFLICT(slug) DO UPDATE`). In SQLite, batch inside one transaction.

**`part_type_of(slug, tags)`** (order matters):
- `tags` has `set` → `"Set"`; has `blueprint` → `"Blueprint"`.
- else suffix match on slug: `_systems`→Systems, `_chassis`→Chassis, `_neuroptics`→Neuroptics, `_blade`→Blade, `_blades`→Blades, `_handle`/`_grip`→Handle, `_barrel`→Barrel, `_receiver`→Receiver, `_stock`→Stock, `_string`→String, `_link`→Link, `_pouch`→Pouch, `_disc`→Disc, `_lower_limb`→Lower limb, `_upper_limb`→Upper limb, `_head`→Head, `_carapace`→Carapace, `_cerebrum`→Cerebrum, `_ornament`→Ornament, `_wings`→Wings.
- else `tags` has `component` → `"Component"`; else `"Other"`.

**`prices_refresh(slugs?)`**
1. If no `slugs`: select all `catalog_items.slug`, minus those with fresh `price_cache` (`expires_at > now`); cap at 50 per run.
2. Per slug: `GET /v1/items/{slug}/statistics` (v2 stats 404 — must use v1).
3. Read `payload.statistics_closed["90days"]`.
   - `median_plat` = median of the 90d `median` values.
   - `trend`: recent-7d avg vs prior-7d avg → `>×1.05` up, `<×0.95` down, else flat.
4. Upsert `price_cache` with `fetched_at=now`, `expires_at=now+6h`.
5. Throttle 400ms between calls.

### 5.2 Domain transforms — direct ports (no Supabase dependency, low risk)

- `partname.rs` ← `src/lib/partname.ts`: `split_name(display_name, part_type) -> {name, sub}` (split on `" Prime"`); `category_for(part_type)`.
- `derive.rs` ← `src/lib/derive.ts`: `spark_for(slug, trend) -> String` and `delta_for(slug, trend) -> i32`. **Deterministic, slug-seeded synthetic visuals** — keep the exact hashing so output is stable. (These are placeholders until real price history exists; consider replacing with a real 90d series stored in SQLite — see §8.)
- `parts.rs` ← `src/lib/parts.ts`: assemble `PartItem` from a joined row; `resolve_cat(category, part_type)`.

> Decision to make: keep these transforms in **Rust only** (frontend gets finished `PartItem`s) or duplicate in TS. **Recommendation: Rust-only** — one source of truth, frontend stays dumb. The existing TS versions become reference, not shipped code.

### 5.3 Commands (`commands.rs`) — replace hooks/RPCs

| Tauri command | Replaces | Behavior |
|---|---|---|
| `get_inventory()` | `useInventory` | JOIN inventory_items × catalog_items × price_cache, qty>0, return `Vec<PartItem>` sorted by `median_plat*qty` desc |
| `get_summary()` | `useSummary` + `inventory_summary` RPC | total_plat, prime_part_count, full_set_count (sets where owned==total), total_ducats, last_synced (max price_cache.fetched_at) |
| `search_catalog(q, limit)` | `useCatalogSearch` | `LIKE` on display_name, join price_cache, alphabetical |
| `add_to_inventory(slug, qty)` | `add_to_inventory` RPC | upsert qty (increment if exists); then trigger `prices_refresh([slug])`; return new qty |
| `set_qty(slug, qty)` | `useSetQty` | update or delete if ≤0 |
| `remove_item(slug)` | `useRemoveItem` | delete |
| `record_sale(slug, qty, plat_per_unit?, notes?)` | `record_sale` RPC | check qty, snapshot median, insert sale_event, decrement/delete inventory, return new qty |
| `get_sales()` | `useSales` | sale_events × catalog_items, newest first |
| `catalog_refresh()` / `prices_refresh(slugs?)` | `marketProxy()` | see §5.1 |

Keep `add_to_inventory` / `record_sale` **transactional** (BEGIN/COMMIT) to preserve the atomicity the Postgres RPCs gave you.

---

## 6. Frontend port

**Keep as-is (no Supabase coupling):**
`components/` — Glyph, Delta, Charts, Icon, Toast, Sidebar · `theme.css` + `lib/theme.ts` (localStorage works in webview; or move to a Tauri settings file later) · `tailwind.config.ts`, `vite.config.ts` · route shells (Dashboard, Inventory, Trends, SoldHistory, Settings, Watchlist).

**Rewrite:**
- `lib/supabase.ts` → `lib/api.ts`: thin `invoke()` wrappers, one per command.
- `hooks/*` → same React Query shape, but `queryFn`/`mutationFn` call `invoke()`. Query keys unchanged (`inventory`, `summary`, `sales`, `catalog_search`). Invalidation logic identical.
- `lib/parts/partname/derive/types.ts` → either delete (Rust returns finished objects) or keep `types.ts` only as the `PartItem` TS interface.

**Delete:**
- `lib/auth.tsx`, `routes/SignIn.tsx`, all `!user` redirects in `App.tsx`. App boots straight into Dashboard.
- entire `supabase/` directory (kept in old repo as reference).
- `@supabase/supabase-js` dependency.

**Settings page** loses "sign out / account"; keeps catalog/price refresh triggers (now calling Rust commands) + theme toggle.

---

## 7. Build plan (suggested order)

1. **Scaffold** `npm create tauri-app@latest` → React + TS + Vite template. Wire `sqlx` + `reqwest` + `serde` in `src-tauri/Cargo.toml`.
2. **DB layer** — migrations (§4), pool, `app_data_dir()` path, run-on-startup.
3. **Domain ports** — `partname.rs`, `derive.rs`, `parts.rs` (pure, unit-testable; port the TS test cases mentally — Mesa Prime Systems, Nova Prime Chassis Blueprint, Saryn Prime Set).
4. **Market client** — `catalog_refresh` first (gets you data), then `prices_refresh`. Verify against live warframe.market.
5. **Read commands** — `get_inventory`, `get_summary`, `search_catalog`, `get_sales`. Wire frontend hooks → `invoke()`. App shows data.
6. **Write commands** — `add_to_inventory`, `set_qty`, `remove_item`, `record_sale` (transactional). Wire modals.
7. **Frontend cleanup** — strip auth, port remaining routes, drop into Claude design.
8. **Polish** — auto price-refresh on launch (background, respect TTL), tray/window prefs, app icon, bundle.

**Definition of done for v1:** launch binary → catalog populates → add parts → see plat/ducats/trends → record sales → history + summary update. No network except warframe.market. No login.

---

## 8. Open decisions / future

- **Real price history.** `derive.rs` sparkline/delta are synthetic. Since `/v1/.../statistics` returns a 90d series, consider a `price_history(slug, day, median)` table and render real sparklines — removes the synthetic hack. *(Recommended early follow-up; not v1-blocking.)*
- **Watchlist** is localStorage today with no backend table. In desktop, promote to a real `watchlist` SQLite table, or keep in webview localStorage for v1.
- **Auto-refresh cadence.** On-launch refresh of stale prices (TTL 6h) + manual button. Optional periodic background timer.
- **Vaulted/tradeable** aren't in `/v2/items`. Left as defaults; a secondary data source could fill `is_vaulted` later.
- **Migration of existing data.** If there's live inventory in Supabase worth keeping, write a one-shot export (CSV/JSON) → import command. Otherwise start fresh (manual entry is the norm anyway).
- **sqlx vs rusqlite.** sqlx = async + migrations + compile-time checks (needs `DATABASE_URL` at build or offline mode). rusqlite = simpler, sync. Pick before step 2.

---

## 9. What carries zero risk vs. needs care

**Zero/low risk (mechanical ports):** all of §5.2 domain logic, all pure UI components, theme system, table schemas, React Query hook *shapes*.

**Needs care:** market client (live API shapes, rate limiting, the v1-stats-not-v2 gotcha), transactional write commands (preserve RPC atomicity), `app_data_dir` DB bootstrapping, and stripping auth cleanly from `App.tsx`.
