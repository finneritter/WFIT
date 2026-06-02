# Primely — Live Game-State (Worldstate) Data

**Status:** Proposal · **Date:** 2026-05-30 · **Verified against the worldstate endpoints + WarframeStatus API 2026-05-30.**

> **What this is:** an *optional* live-game-state layer — Void Fissures, Sorties, and similar
> timer-based content — sourced from Warframe's **worldstate**, surfaced as a "what's farmable right
> now" companion view to the prime-part tracker.
>
> **Scope flag (read this):** this is a **second external data source**, a deliberate departure from the
> `DATA_SOURCING_MASTER_PLAN.md` contract ("100% warframe.market… nothing else phones home"). It is kept
> **fully optional, read-only, and separately cached** so it never touches the warframe.market data path.
> The core app still works with this turned off. Treat the master plan as authoritative for prices/catalog;
> this doc governs only the new game-state sidecar.
>
> **Why it belongs here anyway:** Void Fissures are how you crack Relics, and Relics drop prime parts. So
> "which fissures are live, and do any of them lead to a part I still want" is a coherent extension of a
> prime-part tracker — not a random bolt-on.

---

## 1. Two ways to get worldstate (use the parsed one)

| Option | Endpoint | Shape | Verdict |
|---|---|---|---|
| **Raw DE worldstate** | `https://content.warframe.com/dynamic/worldState.php` (and newer `https://api.warframe.com/cdn/worldState.php`) | Dense, **undocumented**, internal-ID JSON; changes without notice | **Avoid parsing directly.** |
| **Parsed wrapper (WarframeStatus)** | `https://api.warframestat.us/pc/...` (docs: `docs.warframestat.us`) | Clean, decoded JSON (tier/mission/node/expiry already resolved) | **Use this.** |

The raw endpoint feeds the official Warframe Companion app, so it's "public," but it's a cryptic blob:
fissures are buried in `ActiveMissions` with internal mission/region/tier IDs you'd have to map yourself,
and DE reserves the right to reshape it at any patch. **WarframeStatus** (the community parser behind most
Warframe tools) does that decoding for you and exposes tidy per-category endpoints. A second wrapper,
`api.tenno.tools`, exists as a fallback.

> **Cross-play note:** since Update 32 (2022) all platforms share one worldstate, so the `pc` path returns
> the same data everyone sees — platform choice is irrelevant.

> **Verification caveat:** the *raw* DE host has shifted recently (`content.warframe.com/dynamic/` →
> `api.warframe.com/cdn/`). Another reason to depend on the wrapper, which absorbs that churn. If you ever
> do hit DE directly, re-verify the live host first.

---

## 2. The fissures endpoint (the one we actually want)

`GET https://api.warframestat.us/pc/fissures`

Returns an array of active fissures. Relevant fields (already decoded by the wrapper):

| Field | Meaning | Use in Primely |
|---|---|---|
| `tier` | Relic tier: `Lith` / `Meso` / `Neo` / `Axi` / `Requiem` / `Omnia` | group/badge |
| `missionType` | e.g. `Capture`, `Survival`, `Interception` | row detail |
| `node` | star-chart node (e.g. `Callisto (Jupiter)`) | location |
| `enemy` / `faction` | Grineer / Corpus / Infested / etc. | row detail |
| `expiry` | ISO timestamp when it closes | countdown timer |
| `isStorm` | Railjack (Void Storm) fissure | filter |
| `isHard` | Steel Path fissure | filter |
| `active` | still live | filter stale |

Other categories are available the same way if wanted later (`/pc/sortie`, `/pc/voidTrader` for Baro,
`/pc/cetusCycle`, etc.) — but **fissures are the only one with a direct prime-part tie-in**, so start there.

---

## 3. Optional deeper feature — "farmable now" (relic → prime part)

Worldstate tells you *which tiers* are live, not *which parts* drop. To light up "a part you still want is
farmable right now," you need a **relic → reward** mapping, which is a **third** dataset:

- WarframeStatus also serves drop data (`api.warframestat.us/drops` / the WarframeStatus `warframe-drop-data`
  set), or DE's own **PublicExport** drop tables.
- Pipeline: live fissure `tier` → relics of that tier → their reward parts → intersect with the user's
  wanted/missing prime parts (from `catalog_items` / `inventory_items`).

This is a clear scope step-up (another source, another cache, relic-refresh data). Flag it as a **v2+
follow-up** — the v1 fissure panel ("here's what's live, with timers") stands on its own without it.

---

## 4. Where it lives in the app (kept off the warframe.market path)

- New Rust module `worldstate.rs` — **separate from `market.rs`**. Its own client, its own throttle, its
  own cache. A market outage must not affect fissures and vice-versa.
- **No persistent SQLite table needed** — fissures are ephemeral (minutes-to-hours TTL). Cache in memory /
  app state with a short TTL, or a single throwaway `gamestate_cache(key, json, fetched_at)` row if you want
  it to survive a restart. **Do not** mingle this with `catalog_items` / `price_cache`.
- New command: `get_active_fissures() -> Vec<Fissure>` — fetch (respecting cache TTL), filter `active`,
  sort by `expiry` asc. Optional params for `isHard` / `isStorm` filters.
- Frontend: a "Farmable / Fissures" panel or route, countdown timers off `expiry`. Fits the existing
  Linear/Raycast aesthetic; reuse the Glyph/Delta/Charts components.

---

## 5. Caching, freshness, etiquette (hard rules)

- **TTL: short** (~30–60 s). Fissures rotate frequently; anything older is misleading. Always show a
  "as of HH:MM" timestamp — same honesty rule as prices.
- **Don't poll tighter than the TTL.** One fetch per panel open + a gentle background refresh; never hammer.
- **Set a `User-Agent`** identifying the app (`primely-desktop/0.1`) — courtesy for a free community service.
- **Third-party dependency:** WarframeStatus can have downtime. Degrade gracefully (show last-known + a
  "couldn't refresh" note); never crash or block the rest of the app.
- **Read-only, no auth.** Nothing about this writes anywhere or identifies the user.

---

## 6. One-line summary for future sessions

> Optional **second** data source (separate from warframe.market) for live game-state. Get fissures from
> the **parsed wrapper** `GET https://api.warframestat.us/pc/fissures` — **not** DE's raw, undocumented
> `worldState.php` (host recently moved `content.warframe.com/dynamic/` → `api.warframe.com/cdn/`; cross-play
> = one shared worldstate). Decoded fields: `tier`, `missionType`, `node`, `expiry`, `isHard`, `isStorm`.
> Lives in its own `worldstate.rs` + short-TTL (~30–60 s) in-memory cache, exposed via `get_active_fissures()`;
> never touches `catalog_items`/`price_cache`. A "farmable now" relic→part view is a v2+ follow-up needing a
> third (drop-table) dataset. Read-only, no auth, optional, app works fully without it.
