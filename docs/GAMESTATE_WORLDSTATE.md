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

## Implementation notes (as built — 2026-06-03)

Built in `src-tauri/src/worldstate.rs` (own client, 350ms throttle, 45s in-memory TTL, serves stale on
fetch error) + the **Rotation** screen (`src/routes/Rotation.tsx`). Two gotchas learned the hard way:

- **Fetch `https://api.warframestat.us/pc/` (trailing slash) with a per-fetch cache-buster
  `?_=<unix_ts>`.** The no-slash `/pc` now **301-redirects** to `/pc/`, and the endpoint sits behind
  **Cloudflare**, which serves a many-minutes-stale cached copy (`cf-cache-status: HIT`) and **ignores a
  client `Cache-Control: no-cache` on a hit**. The unique query string forces a cache miss → warframestat's
  freshest origin data. Measured source lag **~13min → ~7min** (the residual is warframestat's own update
  cadence — that source can't go fresher; DE's raw worldstate is deliberately avoided).
- **The fissure list is THREE modes that live in different in-game menus** — show them separately:
  **Normal** (relic fissures), **Steel Path** (`isHard`), **Void Storms · Railjack** (`isStorm`). Mixing
  them makes Steel Path / Railjack fissures look like phantoms ("a Void Cascade the normal list doesn't
  have"). The Rotation screen groups them; the per-tier summary excludes Railjack storms; the Omnia
  "⚡ Void Cascade" callout is tagged with its mode so it points to the right group.

- **Fissures are now sourced from DE's raw worldstate, cross-checked against warframestat
  (2026-06-03).** Even with the cache-buster, warframestat's *origin ingest* lags real time by ~3–13
  min — observed as the Rotation page being "really out of sync" (e.g. 26 listed fissures vs DE's
  actual 32). `worldstate/raw.rs` fetches `https://api.warframe.com/cdn/worldState.php` (the old
  `content.warframe.com/dynamic` host now 301s there; DE serves `Cache-Control: max-age=43`, which we
  respect — no buster needed) and parses ONLY `ActiveMissions` (+ the `Hard` flag) and `VoidStorms`.
  Decoding uses two bundled maps so display strings stay identical to the wrapper's: a hardcoded
  `MT_*` table and `worldstate/data/sol_nodes.tsv`, regenerated with:
  `curl -s https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data/solNodes.json | jq -r 'to_entries|sort_by(.key)[]|[.key,(.value.value//.key),(.value.enemy//""),(.value.type//"")]|@tsv'`
  Per refresh both sources are fetched concurrently; **DE wins for fissures**
  (`Worldstate.fissure_source: "de"`), warframestat provides the slow-moving extras
  (sortie/Baro/Varzia/Steel Path) and is the fissure + cycle fallback; disagreements are logged
  (`cross_check`). Unknown node/mission IDs degrade to the raw ID
  (new content stays visible) — refresh the tsv when that shows up. Dates are Mongo-export style
  (`{"$date":{"$numberLong":"<ms>"}}`); Void Storm mission types live on the *node* (sol_nodes `type`
  column), not the storm entry.
- **A backend `spawn_refresher` re-confirms every 3 min** (and `useWorldstate` sets
  `refetchIntervalInBackground: true`): the frontend's 45s poll pauses whenever WebKitGTK throttles a
  hidden/unfocused window — exactly the "Rotation open on a second monitor while playing" case that
  made the page silently freeze mid-session.

Live freshness can be checked with the `worldstate::tests::ws_probe` `#[ignore]` test (prints source
lag + fissure source) and `worldstate::raw::tests::de_probe` (DE raw lag + decoded sample).

### Locally derived cycles (2026-06-06)

warframestat's origin was observed serving a **5h-stale snapshot** (every cycle card read as
expired, and no cache-buster can fix an upstream that isn't ingesting). Open-world cycles are
deterministic clocks, so `worldstate/cycles.rs` now derives all four locally and overrides the
wrapper's whenever an anchor is known:

- **Cetus / Cambion Drift** — anchored to DE's `SyndicateMissions[Tag=CetusSyndicate].Expiry`
  (= end of the current Cetus night; 150-min cycle, 100 day / 50 night; Cambion mirrors day↔fass,
  night↔vome). The anchor is cached in `WorldstateClient.cetus_anchor` and, being periodic
  (`rem_euclid`), stays valid across DE outages once seen.
- **Orb Vallis** — fixed 1600s loop (400 warm / 1200 cold) from the community epoch `1541837628`.
- **Duviri** — five moods × 2h on even UTC boundaries; the mood array in `cycles.rs` bakes in the
  epoch phase (verified against warframestat's own derivation).

Consequently the frontend's stale-source banner (`Rotation.tsx`) only fires when warframestat's
own *content* has lapsed (sortie expiry in the past) or when DE is also unreachable — a merely-old
snapshot with valid daily content no longer warns. The Rotation topbar refresh button doubles as a
**hard reset** (`force_worldstate_refresh`): flushes the worldstate + arbys caches and re-fetches
every source immediately, bypassing the TTL.

### Game-info hub expansion (2026-06-05)

The Rotation screen is now a three-sub-tab hub: **Overview** (cycles, arbitration, sortie, archon
hunt, Steel Path weekly, reset timers) · **Fissures** (the original UI, unchanged) · **Vendors**
(Baro + Varzia inventories). Backend additions, all riding the existing fetch/caches:

- **`worldstate/extra.rs`** — sortie / archon hunt / `steelPath` / `voidTrader` (Baro) /
  `vaultTrader` (Varzia) parsed **from the same warframestat `/pc/` response** (zero extra
  requests). Each block lands as an untyped `serde_json::Value` and is parsed with
  `from_value(..).ok()`, so a shape change in one block degrades that block to `None` instead of
  failing the payload. Quirks: the archon hunt uses `missions[].type` where the sortie uses
  `variants[].missionType`; **Varzia's stock mixes two currencies** (verified 2026-07-02 against
  DE raw `PrimeVaultTraders[].Manifest` — every item has exactly one of the two):
  `inventory[].ducats` = DE `PrimePrice` = **REGAL AYA** (frames 3 / single pack 6 / dual pack 10 /
  cosmetics 1–2), `inventory[].credits` = DE `RegularPrice` = **AYA** (relics, 1 each).
  `db/vendor.rs::enrich` resolves the per-row currency from that pair. Her vault-pack names
  arrive mangled ("M P V Rhino Prime Single Pack" — the `M P V ` prefix is stripped), and her
  aya relics arrive as projection names ("T1 Void Projection … Vault A Bronze" → rewritten to
  "Lith Relic (Vault A)"; T1..T4 = Lith/Meso/Neo/Axi, the specific relic is not encoded).
- **`worldstate/arbys.rs`** — arbitrations. warframestat's `arbitration` field is **broken**
  (always expired, epoch timestamps; DE doesn't publish arbitrations at all). Source instead:
  **`https://browse.wf/arbys.txt`** — a community-precomputed schedule (CSV `unix_ts,NodeId`, one
  per hour, years ahead; free to use, attribution shown in the UI). Node ids match
  `sol_nodes.tsv`, so name/faction/mission decode locally. Tier ratings (S–D, by the Arbitration
  Goons) are snapshotted into `worldstate/data/arby_tiers.tsv`; regenerate from
  `https://browse.wf/supplemental-data/arbyTiers.js` when stale. The schedule has its own
  **12h-TTL in-memory cache** (don't ride the 45s worldstate cadence — the file is ~1MB); fetch
  failures serve the stale schedule or drop the block to `None` ("unavailable" panel), never error.
  Probe: `worldstate::arbys::tests::arbys_probe`.
- Weekly/daily **reset timers are computed client-side** (`nextUtc()` in `src/lib/format.ts`) from
  fixed UTC rules (daily 00:00, weekly Mon 00:00, sortie 16:00) plus the data expiries
  (archon/Teshin/Baro/Varzia). Observed live: archon hunt + Teshin expire Monday 00:00 UTC.

### Wave-2 vendors (2026-07-04)

- **Duviri Circuit (Incarnons)** — DE raw `EndlessXpSchedule` (renamed from the old
  `EndlessXpChoices`; parsed in `worldstate/raw.rs::circuit_week`): an array of weekly windows
  (`Activation`/`Expiry` = Mon 00:00 UTC resets), each with `CategoryChoices` — `EXC_HARD` = the
  Steel Path track's 5 Incarnon Genesis weapons (plain names, "Braton"), `EXC_NORMAL` = the
  warframe track. Pick the window covering *now*, fall back to the last. DE-only: warframestat's
  `duviriCycle.choices` rides the 2h mood cycle, not the weekly window, so `Worldstate.circuit`
  carries the last-known week forward when DE is down (stale ≈ correct until the weekly reset).
  Panel rows are `"<weapon> Incarnon Genesis"` — account-bound, so untracked on warframe.market:
  no price/cost, manual check-off only (which persists across the 8-week rotation — the point).
- **Nightwave cred shop (Nora)** — no API exposes the shop stock (DE `SeasonInfo` and
  warframestat's `nightwave` carry challenges only), so rows come from a bundled dataset:
  `domain/data/nightwave_offerings.tsv` (`domain::nightwave::OFFERINGS`) — the stable cross-season
  core per wiki.warframe.com/w/Nightwave/Offerings (5x Nitain 15 · 10k Kuva 50 · built
  Catalyst/Reactor 75 · Vauban parts 25 · the 19-aura pool 20 · 9 melee blueprints 50). Aura names
  match warframe.market display names exactly → live prices; the rest pass through untradeable.
  Panel shows while a season is active; expiry = season end. Per-volume cosmetics are omitted —
  update the TSV if the stable catalog changes between seasons.

### Nightwave act check-off (2026-07-07)

Nightwave acts on the Rotation panel are check-off-able: scan-detected completions (from the
gamescan `SeasonChallengeHistory` blob) lock the checkbox green, while manual ticks persist in
`vendor_checkoff` under the `nightwave_acts` key so they survive a reload.

---

## 1. Two ways to get worldstate (use the parsed one)

| Option | Endpoint | Shape | Verdict |
|---|---|---|---|
| **Raw DE worldstate** | `https://content.warframe.com/dynamic/worldState.php` (now 301s to `https://api.warframe.com/cdn/worldState.php`) | Dense, **undocumented**, internal-ID JSON; changes without notice | ~~Avoid parsing directly~~ **Revised 2026-06-03: minimally parsed for fissures only** (see implementation notes) — the wrapper's origin lag made fissures inaccurate. |
| **Parsed wrapper (WarframeStatus)** | `https://api.warframestat.us/pc/...` (docs: `docs.warframestat.us`) | Clean, decoded JSON (tier/mission/node/expiry already resolved) | **Use this** for cycles/Baro + as the fissure fallback. |

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

> Optional **second** data source (separate from warframe.market) for live game-state. **Fissures come
> from DE's raw `api.warframe.com/cdn/worldState.php`** (authoritative, ≤43s CDN staleness; minimally
> parsed in `worldstate/raw.rs`, decoded via bundled WFCD maps), cross-checked against and falling back
> to the **parsed wrapper** `api.warframestat.us/pc/` — which still provides cycles/Baro (its origin
> ingest lags minutes; cross-play = one shared worldstate). Lives in its own `worldstate/` module +
> short-TTL (45 s) in-memory cache + a 3-min backend refresher; never touches
> `catalog_items`/`price_cache`. A "farmable now" relic→part view is a v2+ follow-up needing a third
> (drop-table) dataset. Read-only, no auth, optional, app works fully without it.
