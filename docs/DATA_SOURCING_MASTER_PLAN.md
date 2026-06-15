# Primely — Data Sourcing Master Plan

**Status:** Authoritative · **Date:** 2026-05-30 · **Verified against the live warframe.market API on 2026-05-30.**

> **Single source of truth:** Every piece of data in Primely — the prime-part catalog, names,
> thumbnails, ducats, set composition, and prices — comes from **warframe.market**.
> No WFCD/warframe-items, no DE Public Export, no game-account auth, no other enrichment source.
> warframe.market in → local SQLite cache → frontend reads the cache. Nothing else phones home.
>
> **Known gap:** warframe.market does **not** expose **vault status** anywhere (verified — see §2/§8).
> With warframe.market as the only allowed source, the "vaulted" badge has no data and stays off in v1.

This document is the contract for the Rust `market.rs` data layer. It refines the market-sourcing
details in `DESKTOP_REWRITE_PRD.md §5.1` with field-level facts verified against the live API.

---

## 0. The design files are visuals only — NOT a data source

The `design/` files (`Primely Dashboard.html`, `primely.jsx`, `tweaks-panel.jsx`) are a **visual
prototype**. `primely.jsx` ships a hardcoded `CATALOG` of ~16 invented parts with **mock** plat,
ducats, sparklines, and deltas; the design README states plainly "All data is mock/static in the
prototype." **None of those values are real.** Take from the design files ONLY: layout, spacing,
typography, color tokens, motion, and component anatomy.

Every real value is warframe.market-derived at runtime — **never** copied from the design, never
hardcoded in app source:

| What the mock hardcodes | Where the real value actually comes from |
|---|---|
| `CATALOG` list of ~16 parts | `/v2/items` (730 prime items) |
| mock `plat` per item | `/v1/items/<slug>/statistics` median |
| mock `duc` ducats | `/v2/items` `ducats` |
| mock `spark` / `d` (7d delta) | real 90d series from statistics |
| mock set/"hot"/trend flags | derived from real data (sets via `/v2/items/<slug>`, trend from statistics) |

**The app is a presentation layer.** warframe.market in → SQLite cache → render. The *only* data the
app originates is the **user's own state**: inventory quantities and logged sale events. Nothing about
the game itself (what primes exist, their prices, ducats, sets) is ever authored, seeded, or hardcoded
in the app — it is all read from warframe.market and cached.

---

## 1. The three endpoints (and only these three)

All requests send headers: `User-Agent: primely-desktop/0.1`, `Language: en`, `Platform: pc`,
`Accept: application/json`. No auth. Throttle to **~2.5 req/s (400 ms min-gap)**, global across the whole client.

| # | Endpoint | Purpose | Cost |
|---|---|---|---|
| 1 | `GET /v2/items` | The full item **list** — catalog skeleton + **ducats** | 1 call, ~1.6 MB |
| 2 | `GET /v2/items/<slug>` | Per-item **detail** — **set composition** (+ tradable) | 1 call per item |
| 3 | `GET /v1/items/<slug>/statistics` | Per-item **price history** (90-day series) | 1 call per item |

Gotchas that bit the old build:
- Endpoint #2 is `/v2/items/<slug>` (**plural** `items`). The singular form 404s / `itemNotFound`.
- Endpoint #3 is **v1 only**. The v2 statistics endpoint (`/v2/items/<slug>/statistics`) returns **404**.
- **`vaulted` is not in any of these responses.** It is simply not part of the v2 API surface.

---

## 2. What each endpoint actually gives us (verified field-by-field)

### #1 — `GET /v2/items` (the list)
Returns `{ apiVersion, data: [...] }`. **3794 items total; 730 carry the `prime` tag; 157 are sets.**
Each prime list item has **exactly these keys**: `ducats, gameRef, i18n, id, maxRank, slug, tags`.

| Field | Reliable? | Use |
|---|---|---|
| `slug` | ✅ | primary key |
| `tags` (string[]) | ✅ | `prime` filter; category (`warframe`/`weapon`); `set`/`blueprint`/`component` |
| `i18n.en.name` | ✅ | `display_name` (fallback: slug) |
| `i18n.en.thumb` | ✅ | `thumbnail_url` = `https://warframe.market/static/assets/` + thumb |
| `i18n.en.icon` / `subIcon` | ✅ | higher-res icon / part-type sub-icon if wanted |
| `ducats` | ✅ **real** | `catalog_items.ducats` (38 distinct values; only **2** prime items have null — handle nulls) |
| `id` | ✅ | warframe.market item id — **needed to resolve `setParts` ids → slugs** (see §5) |
| `maxRank` | ✅ | rank ceiling (informational for prime parts) |
| `gameRef` | ✅ | DE internal path (informational) |

**NOT present in the list (must use detail #2):** `setParts`, `quantityInSet`, `setRoot`, `tradable`,
`reqMasteryRank`, `tradingTax`. **Not present anywhere:** `vaulted`.

### #2 — `GET /v2/items/<slug>` (the detail) — set composition lives here
Returns `{ apiVersion, data: {...} }`. Detail keys (consistent across parts and sets):
`ducats, gameRef, i18n, id, quantityInSet, reqMasteryRank, setParts, setRoot, slug, tags, tradable, tradingTax`.

| Field | Meaning | Feeds |
|---|---|---|
| `setParts` (string[]) | item **ids** of every member of this item's set — **present on EVERY item** (part or set), flat array of id strings | set membership (resolve ids→slugs via list map) |
| `setRoot` | `true` only on the `*_set` item; `false` on components | identifies which row is the set |
| `quantityInSet` | how many of THIS part a complete set needs (observed: always 1; verify) | **complete-set detection** |
| `tradable` | tradeable flag | `is_tradeable` (default true; all primes appear tradable) |
| `ducats` | matches the list value | (already have it from #1) |
| `reqMasteryRank` / `tradingTax` | MR gate / trade tax | optional UI detail |
| `i18n.en.{name,thumb,icon}` | localized strings | display |

> There is **no `vaulted` field** on the detail endpoint either — confirmed on `soma_prime_barrel`,
> `mesa_prime_set`, and the famously-vaulted `rhino_prime_set` / `frost_prime_set` / `mag_prime_set`.

### #3 — `GET /v1/items/<slug>/statistics` (the prices)
Returns `{ payload: { statistics_closed: {...}, statistics_live: {...} } }`.
`statistics_closed["90days"]` = **~90 daily entries**, each with
`datetime, median, avg_price, min_price, max_price, moving_avg, open_price, closed_price, volume, ...`.

This gives the **real 90-day median series** — enough for true sparklines, a real 7d delta, and an
actual price-history chart (the design's price-history modal + Trends screen).

---

## 3. Source → field map (what fills every column/feature)

| Data the app shows | Comes from | Field |
|---|---|---|
| Part exists in catalog | #1 list | `slug` + `tags.includes("prime")` |
| Part name | #1 list | `i18n.en.name` |
| Thumbnail | #1 list | `i18n.en.thumb` (+ static base) |
| Category (Warframe/Weapon/Other) | #1 list | `tags` |
| **Ducats** | **#1 list** | `ducats` (real — no detail call needed) |
| part_type, set_slug heuristics | local | derived from slug + tags (sufficient for v1; #2 makes sets exact later) |
| **Set composition / "complete set"** | **#2 detail** | `setParts` (ids) + `quantityInSet` + `setRoot` |
| Tradeable flag | #2 detail | `tradable` (or default true) |
| **Vaulted badge** | **NO SOURCE** | not exposed by warframe.market → off in v1 (honest gap) |
| Median platinum | #3 stats | median of 90d `median` series |
| Trend (up/flat/down) | #3 stats | recent-7d avg vs prior-7d avg (±5%) |
| Sparkline + 7d delta % | #3 stats | **real** 90d series (replaces synthetic `derive.ts`) |
| Price-history chart | #3 stats | full 90d series stored locally |

---

## 4. Refresh strategy

**Catalog Pass A — skeleton + ducats (cheap, 1 call).** `GET /v2/items` → filter `tags.includes("prime")`
→ upsert `slug, display_name, part_type, category, set_slug(heuristic), ducats, thumbnail_url, wfm_id`.
Persist the **id→slug map** from this response (needed later to resolve `setParts`). After Pass A the
app is fully usable: names, thumbnails, search, **ducats**, add-to-inventory all work.

**Prices (endpoint #3).** Refresh stale/missing prices (6 h TTL); cap per run (e.g. 50) + background
drain; throttled. This is the only per-item pass needed for the core v1 experience (value, trend, sparkline).

**Catalog Pass B — set composition (optional, deferred until set features ship).** Only needed for the
design's "complete set" / "sell as set vs parts" features. Two ways to get it:
- **Cheap (~157 calls):** call detail on only the `set`-tagged items. Each set's `setParts` lists all
  its member ids → resolve to slugs → that's the full membership map. Assume `quantityInSet = 1` (true
  in every sample so far).
- **Exact (~730 calls, ~4.3 min throttled):** call detail on every prime to read each part's own
  `quantityInSet`. Use only if a set is found that needs >1 of a part.

Run Pass B in the background, incrementally (`detail_fetched_at` per row, long TTL). It is **not v1-blocking**
— the slug-derivation `set_slug` heuristic covers grouping until then.

---

## 5. Set detection (warframe.market-native, no slug heuristics)

For the "complete set" / "sell as set vs parts" features (Pass B):
1. A set's `setParts` (from any of its items, or just the set-root) gives the member item **ids**.
2. Resolve ids → slugs via the id→slug map from the list (Pass A).
3. `quantityInSet` per part = how many the set needs; a set is **complete** when, for every member
   part, `owned_qty >= quantityInSet`.
4. The slug-derivation `set_slug` heuristic (port of `deriveSetSlug`) stays the v1 placeholder until
   Pass B fills authoritative membership.

---

## 6. Local SQLite schema implications

Add to the PRD §4 schema to support warframe.market-native sets + real history:
- `catalog_items`: `ducats` filled in Pass A. Add `wfm_id TEXT` (item id, for `setParts` resolution)
  and `detail_fetched_at TEXT` (Pass-B incremental enrich). **`is_vaulted` has no data source** —
  keep the column but it stays at its default; don't promise the badge in v1.
- New `set_membership(set_slug TEXT, part_slug TEXT, quantity_in_set INTEGER, PRIMARY KEY(set_slug, part_slug))`
  — populated from `setParts`/`quantityInSet` in Pass B. Replaces the heuristic for completeness checks.
- New `price_history(slug TEXT, day TEXT, median INTEGER, volume INTEGER, PRIMARY KEY(slug, day))`
  — the 90d series from #3, enabling real sparklines and the history chart (PRD §8 "real price
  history"; now first-class since the data is free from the same endpoint).
- `price_cache` (median_plat + trend + TTL) stays as the fast read-path; derived from `price_history`.

---

## 7. Caching, freshness, rate limits (hard rules)

- **Throttle:** global 400 ms min-gap (~2.5 req/s) across ALL warframe.market calls. Never burst.
- **Price TTL:** 6 h. On launch, refresh only stale/missing prices; cap per run + background drain.
- **Detail TTL:** long (weekly-ish) — set data changes rarely; don't re-fetch details often.
- **Always surface `last_synced`** in the UI; never present a cached price as live.
- Everything is a **cache of warframe.market**; the DB can be rebuilt entirely from the three endpoints.

---

## 8. Verification status

| Claim | Status |
|---|---|
| `/v2/items` returns 730 prime (157 sets) of 3794 total | ✅ verified live 2026-05-30 |
| List prime keys = `ducats, gameRef, i18n, id, maxRank, slug, tags`; **ducats is real** | ✅ verified (38 distinct, 2 null) |
| List does NOT include `setParts`, `quantityInSet`, `setRoot`, `tradable` | ✅ verified (keys absent) |
| `/v2/items/<slug>` provides `setParts` (id strings) on **every** item, `setRoot` flags the set, `quantityInSet`, `tradable` | ✅ verified (5 items: parts + sets) |
| **`vaulted` is exposed NOWHERE** (not list, not detail) — incl. on known-vaulted sets | ✅ verified (rhino/frost/mag prime sets) |
| `/v1/items/<slug>/statistics` returns ~90 daily entries with `median`; v2 stats 404s | ✅ verified |
| `quantityInSet` > 1 ever (sets needing 2+ of a part) | ⬜ always 1 so far — spot-check more sets in Pass B |

---

## 9. One-line summary for future sessions

> Primely's data is **100% warframe.market**, via three endpoints: `/v2/items` (skeleton — slug, tags,
> names, thumbs, **real ducats**, id; NO set fields, NO vaulted), `/v2/items/<slug>` (set composition:
> `setParts` id-array on every item + `setRoot` + `quantityInSet` + `tradable`; still NO vaulted), and
> `/v1/items/<slug>/statistics` (real 90-day price series). **Vault status has no warframe.market
> source — the badge is dark in v1.** v1 runs on list + statistics; the per-item detail pass is only
> for set features and is deferrable (~157 calls if limited to set-tagged items). Cache everything in
> local SQLite; the DB is fully rebuildable from these three endpoints.
