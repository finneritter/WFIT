# WFIT — Game Inventory Import (Memory-Scan Session)

**Status:** Proposal · **Date:** 2026-06-01 · **An AlecaFrame-style real-inventory sync for WFIT.**

> **What this is:** an *optional* feature that reads your **real owned inventory** directly from the
> running Warframe client and merges it into WFIT — the thing warframe.market listings import (see
> `WFM_ACCOUNT_SIGNIN.md`) can't do. It works the way AlecaFrame / `warframe-api-helper` /
> `gjrud/warframe-helper` work: scan the live game's memory for the already-authenticated session
> (`accountId` + `nonce`), call the DE mobile/Companion inventory endpoint with it, and map the result
> onto WFIT's catalog.
>
> **This reverses a hard constraint.** `CLAUDE.md` says "No game-account (DE) auth, ever" and
> `WFM_ACCOUNT_SIGNIN.md` rules this exact approach out of scope citing ban risk. Building this is a
> deliberate, documented reversal of that decision — §8 updates the constraint language so the docs
> stop contradicting the code. **It carries a real, documented ban risk to the account.** It must stay
> opt-in, consent-gated, isolated, and supported only where memory reads are possible (Linux + Windows;
> not macOS).
>
> **Why it belongs anyway:** the whole point is to be an AlecaFrame alternative. Listings ≠ inventory;
> only a game-side read gives true owned counts. Everything else WFIT needs (prices, ducats, sets,
> worldstate) already comes from sanctioned sources — this is the one piece that requires the game.

---

## 0. The constraint reconciliation (read first)

`CLAUDE.md` claims every DE path is "dead (Akamai-blocked / decommissioned)." That is **only true of
programmatic login** — POSTing credentials to DE's auth endpoint now sits behind Akamai/Cloudflare and
is effectively dead for third parties. **Memory-scanning is a different path and is alive:** it never
logs in. The running game has already authenticated and holds a valid session in memory; the scan
lifts that session (`accountId` + `nonce`) and reuses it. `gjrud/warframe-helper` was updated April
2026 and still works this way. So:

- ❌ **Login path** (email/password → session): dead (Akamai). Don't attempt.
- ✅ **Session-reuse path** (read `accountId`+`nonce` from live game → inventory endpoint): works, **but
  ToS-prohibited and ban-risky.** This is the path this doc specs.

Fix the wording in `CLAUDE.md`/`WFM_ACCOUNT_SIGNIN.md` accordingly (§8): "dead" → "login is dead;
memory-scan works but is out-of-policy/ban-risky" — those are different conversations.

---

## 1. How it works (the mechanism, verified)

Three steps, exactly as `warframe-api-helper` (Sainan) and `warframe-helper` (gjrud) do it:

1. **Find the running client.** Locate the `Warframe` process (Linux: by name via `/proc`). Game must
   be running and logged in.
2. **Scan memory for the session.** Walk the process's readable regions in **fixed chunks** and
   pattern-match the two values the inventory endpoint needs: the account id and the request nonce.
   Chunked reads keep RAM bounded even when the game exposes huge readable regions.
3. **Call the mobile/Companion inventory endpoint** with `accountId` + `nonce`. It returns a big JSON
   blob describing everything the account owns, keyed by DE **`uniqueName`** paths (`/Lotus/Types/...`).
   Parse it, filter to tradeable prime parts, map to catalog slugs, write owned quantities.

> **Endpoint host churn:** DE has moved hosts before (`content.warframe.com` → `api.warframe.com`).
> **Do not hardcode from memory** — lift the exact host/path, headers, and the `accountId`/`nonce`
> byte signatures from the current `warframe-helper` / `warframe-api-helper` source at build time, and
> re-verify against one live scan. Treat the precise endpoint as a §9 open item, not a settled fact.

---

## 2. The mapping that makes this fit WFIT (the linchpin)

The DE inventory keys items by `uniqueName` (e.g. `/Lotus/Types/Recipes/Weapons/SomaPrimeBarrel`).
WFIT's catalog is keyed by warframe.market `slug` (e.g. `soma_prime_barrel`). The bridge already
exists in data you fetch but currently discard:

> `DATA_SOURCING_MASTER_PLAN.md §2` — `/v2/items` returns **`gameRef`** = "DE internal path". That is
> the same `uniqueName` space the inventory uses.

So the join is: **inventory `uniqueName` → `catalog_items.game_ref` → `slug`**. You already pull
`gameRef` in Pass A; you just don't store it. Add one column and the mapping is a local lookup — no
new network source for names.

```
DE inventory item            catalog_items                 inventory_items
{ ItemType: "/Lotus/.../    { slug: "soma_prime_barrel",    { slug: "soma_prime_barrel",
   SomaPrimeBarrel",   ─────►   game_ref: "/Lotus/.../   ─►     qty: <ItemCount>,
  ItemCount: 3 }                  SomaPrimeBarrel" }              source: "de_scan" }
```

**Fallback resolver (optional):** if `gameRef` coverage turns out imperfect, DE's **Public Export**
`ExportManifest.json` pairs every `uniqueName` with metadata and can backfill the map. Keep it as a
secondary, not the primary — `gameRef` from your existing catalog should cover the prime-part subset.

**Scope the import.** The DE inventory contains everything (resources, mods, built frames, etc.). For
a prime-part tracker, filter to the categories that hold tradeable prime parts — primarily the
`MiscItems` array (prime components/BPs). Map those via `game_ref`, intersect with catalog items
tagged `prime`, and ignore everything that doesn't resolve to a tracked tradeable slug. (Confirm the
exact category key names against a live response — see §9.)

---

## 3. Where it lives (isolated, like worldstate)

Mirror the `worldstate.rs` pattern from `GAMESTATE_WORLDSTATE.md §4`: a **separate module with its own
concern, never on the warframe.market data path.** A market outage and a game-scan failure must be
fully independent.

```
src-tauri/src/
  gamescan/
    mod.rs          # public surface: scan() -> Inventory, process detection
    process.rs      # find Warframe pid (Linux /proc); is_running()
    memory.rs       # chunked region reads; accountId + nonce extraction
    api.rs          # DE inventory endpoint client (own throttle, NOT market.rs)
    map.rs          # uniqueName -> slug via catalog game_ref; category filter
    consent.rs      # typed-phrase gate, persisted consent record
  market.rs         # UNTOUCHED — warframe.market only
  worldstate.rs     # UNTOUCHED
  commands.rs       # + new #[command] surface (§6)
  db/
    inventory.rs    # gains a merge-from-scan path (provenance-aware)
```

Its own HTTP client and throttle. It does **not** share `market.rs`'s 400 ms warframe.market limiter —
different host, different concern. The DB stays the source of truth for owned counts; the scan is just
a new writer into `inventory_items`.

---

## 4. Schema additions (migration `0003_game_import.sql`)

Small. Add the join key to the catalog, provenance to inventory, and a one-row import-state table.

```sql
-- The join key. Populated in catalog Pass A from /v2/items `gameRef` (already fetched, now stored).
ALTER TABLE catalog_items ADD COLUMN game_ref TEXT;
CREATE INDEX idx_catalog_game_ref ON catalog_items(game_ref);

-- Where an owned row came from, so scan-merge can be smart and undoable.
-- 'manual' | 'wfm_import' | 'de_scan'   (matches the source idea floated in WFM_ACCOUNT_SIGNIN §5)
ALTER TABLE inventory_items ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE inventory_items ADD COLUMN last_scan_qty INTEGER;   -- last value the scan reported

-- Single-row state for the feature.
CREATE TABLE game_scan_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  consent_at      TEXT,            -- when the user accepted the risk (NULL = not consented)
  last_scan_at    TEXT,
  last_account_id TEXT,            -- to detect "different account scanned" (optional)
  auto_sync       INTEGER NOT NULL DEFAULT 0
);
```

Note: the session (`accountId`/`nonce`) is **ephemeral and secret** — it is read, used for the request,
and discarded. **Never persist the nonce or write it to the DB or logs.** (The WFM JWT goes in the OS
keychain per `WFM_ACCOUNT_SIGNIN §2`; the game session isn't even worth storing — it's stale in
seconds. Re-scan each sync.)

---

## 5. Merge semantics (this is real inventory, unlike listings)

The WFM listings import (`WFM_ACCOUNT_SIGNIN §4`) is "merge, don't clobber" because listings are a
*weak signal*. A game scan is the **opposite — it's ground truth** for owned quantities. So:

- **First import:** show a **reviewable diff** (added / changed / removed vs current `inventory_items`),
  same courtesy as the listings preview. Nothing writes until the user confirms.
- **Confirmed / subsequent syncs:** the scan is authoritative for `source IN ('de_scan')` rows — set
  `qty = ItemCount`. For `source = 'manual'` rows that the scan also reports, surface the conflict on
  first reconciliation, then let the scan own them going forward (flip them to `de_scan`).
- **Disappeared items:** a part you scanned before that's now absent (traded/sold) → set qty 0 / remove,
  but only for `de_scan`-sourced rows. Never auto-delete a `manual` row.
- **Sales logging:** the scan replaces *current* counts; it does **not** synthesize `sale_events`. If you
  want realized P&L to stay accurate, keep logging sales through `record_sale` as today. (A future "infer
  sales from scan deltas" is possible but out of scope — deltas have many causes besides selling.)

Provenance (`source`) makes all of this auditable and the first-import undoable.

---

## 6. Commands (`commands.rs`)

Following the existing `#[command]` conventions and the read-preview / write-apply split from
`WFM_ACCOUNT_SIGNIN §6`:

| Command | Behavior |
|---|---|
| `game_scan_status()` | `{ consented, warframe_running, auto_sync, last_scan_at }` — drives the Settings UI. No scan. |
| `game_scan_consent(phrase)` | Validate the exact typed acknowledgment (§7); on match, set `consent_at`. Refuses otherwise. |
| `game_scan_revoke()` | Clear `consent_at` (restores the warning). Does not touch inventory. |
| `game_scan_preview()` | **Read-only.** Requires consent + running game. Scan → map → return a `Vec<ScanDiffRow>` (added/changed/removed) **without writing.** |
| `game_scan_apply(rows)` | Transactional merge of confirmed rows into `inventory_items` (§5 semantics). The only writer. |
| `game_scan_set_auto(on)` | Toggle background auto-sync (§9.auto). |

`game_scan_preview` is the gated entry point — it is the only thing that touches process memory, and
it cannot run unless `consent_at` is set and the game is detected. Keep `game_scan_apply` transactional
(BEGIN/COMMIT) like `add_to_inventory` / `record_sale`.

**Tauri ACL:** memory reads happen in Rust (no extra webview capability), but verify nothing in
`capabilities/default.json` needs widening. The frontend only calls `invoke()` — same as every other
command.

---

## 7. Consent & risk gate (non-negotiable — mirror warframe-helper exactly)

`warframe-helper` blocks the first scan behind a typed acknowledgment and persists the consent. WFIT
must do the same, and make the risk unmissable:

1. **First-run warning dialog** before any scan: plain language that this reads game memory, violates
   DE's ToS, and **could get the account banned**, and that the user accepts that risk.
2. **Typed acknowledgment**, not a checkbox — require the exact phrase (reuse warframe-helper's wording
   for familiarity): *"I understand and accept the risk involved in using this functionality."*
3. **Persist** in `game_scan_state.consent_at`. No re-prompt after that.
4. **Revoke** path in Settings (`game_scan_revoke`) that restores the prompt.
5. **Unreachable without consent:** the scan codepath returns an error if `consent_at` is NULL. Belt
   and suspenders: check in both the command and `gamescan::scan()`.
6. **Surface it in the UI and README** — this is a power-user, opt-in, off-by-default feature. Signed-out
   / not-consented is the default first-class state, exactly like WFM connect.

---

## 8. Decision reversal — doc edits required

So the repo stops contradicting itself, update:

- **`CLAUDE.md` hard constraints:** change "No game-account (DE) auth, ever — every path is dead" to
  something like: *"No programmatic DE login (Akamai-blocked). Real inventory is available only via an
  opt-in, consent-gated **memory-scan** of the running client (`gamescan` module, isolated from the
  market path, Linux + Windows) — ToS-prohibited and ban-risky; off by default. See `GAME_INVENTORY_IMPORT.md`."*
- **`WFM_ACCOUNT_SIGNIN.md`:** it currently says memory-scan is "Out of scope, deliberately." Add a
  pointer: *"Superseded for users who opt in — see `GAME_INVENTORY_IMPORT.md`. Listings import remains
  the safe default; game scan is the AlecaFrame-parity power-user path."* Keep listings as the
  zero-risk recommendation.
- **`README.md`:** add the feature under Screens/Settings with the ban-risk caveat.

Keep the listings-import path. The two coexist: listings = safe default; game scan = opt-in real sync.

---

## 9. Platform, automation, and open items

**Linux.** Reads use `/proc/<pid>/mem` (`pread`-backed `File::read_at`) over the writable anonymous
regions from `/proc/<pid>/maps`. With the common `kernel.yama.ptrace_scope = 1`, a non-root process can
read another process **owned by the same user** — which is your case (you launched both). No root in the
normal case. If `ptrace_scope` is 2/3, reads fail — detected and surfaced as a clear message.

**Windows.** Same idea via the Win32 APIs: `CreateToolhelp32Snapshot` finds `Warframe.x64.exe`,
`OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION)` opens it, `VirtualQueryEx` enumerates the
committed writable non-image regions, and `ReadProcessMemory` reads them. No admin needed for a process
you launched yourself (same user); on an access-denied open, surface "run WFIT as the same user (or as
administrator)." Warframe ships no kernel anti-cheat, so the read itself isn't detected — the ban risk is
the unauthorized session reuse, identical to Linux. The OS-specific code lives in
`gamescan/process_windows.rs` + `memory_windows.rs`, behind the shared `scan.rs` `MemReader` trait.

**macOS (unsupported).** `task_for_pid` + SIP/hardened-runtime make reading another process's memory
effectively impossible without disabling SIP or running as root — non-starters — and Warframe has no
native Mac client (it runs under CrossOver/Whisky). `is_supported()` returns false; the Settings panel
shows "Not available on macOS." WFIT stays the manual + warframe.market + listings tool there.

**`auto` — AlecaFrame-style automatic sync.** Baseline is a manual "Scan now" button. For parity, add an
**opt-in `auto_sync`** that, *while Warframe is running*, re-scans on a conservative interval (e.g. every
few minutes, or on window focus) and applies deltas to `de_scan` rows without a prompt. **Scan frequency
is a risk dial** — more reads = more ToS surface. Default off; document the tradeoff; never poll tightly.
Detect the process first (`process.rs::is_running`) and no-op when the game is closed.

**Open items to confirm from source / a live scan (don't guess these):**
- Exact `accountId` + `nonce` byte signatures in current memory (lift from `warframe-helper`).
- Current inventory endpoint host/path + required headers (host has moved before).
- Inventory JSON category keys (`MiscItems` et al.) and the count field (`ItemCount`?) in the 2026 response.
- `gameRef` ↔ `uniqueName` coverage across the prime-part set (does every tracked prime resolve?).
- License terms of `warframe-helper` / `warframe-api-helper` before porting code vs. re-implementing
  from the protocol (same caveat as the earlier integration doc — protocol facts are free, their code may
  be copyleft).

---

## 10. Build order

1. **Catalog `game_ref`.** Migration `0003`; store `gameRef` in Pass A; backfill via one `catalog_refresh`.
   Zero risk, no scanning — and it's the prerequisite for mapping. Do this first.
2. **`map.rs` + tests.** uniqueName→slug resolution and the prime-part category filter, unit-tested
   against a saved sample inventory JSON (grab one from `warframe-helper`'s output or `browse.wf`).
3. **Consent gate.** `consent.rs` + `game_scan_consent` / `revoke` / `status` + Settings UI. Still no scan.
4. **`memory.rs` (Linux).** Process find + chunked read + `accountId`/`nonce` extraction. Verify against
   a live game by printing the extracted values (never log the nonce in committed code).
5. **`api.rs`.** Call the endpoint, parse to a normalized `Inventory`. Save a raw dump for debugging.
6. **Preview + apply.** `game_scan_preview` (diff) → review UI → `game_scan_apply` (transactional merge).
   This is the feature done.
7. **Auto-sync (optional).** Process-gated interval scan, opt-in toggle.

**Definition of done (v1):** Settings → consent → "Scan now" (game running) → review diff → apply →
inventory shows true owned counts, mapped to slugs, valued at warframe.market prices — with manual rows
preserved and the whole thing off by default and clearly labeled ban-risky.

---

## 11. One-line summary for future sessions

> Optional **AlecaFrame-parity real-inventory** feature, reversing the old "no DE auth" rule. It does
> **not** log in (that path is Akamai-dead); it **memory-scans the running client** for `accountId`+`nonce`
> and calls the DE mobile inventory endpoint — **ToS-prohibited, ban-risky, opt-in, consent-gated
> (typed phrase), Linux + Windows (not macOS), off by default.** Lives in an isolated `gamescan` module (never on the
> warframe.market path), like `worldstate.rs`. Maps DE `uniqueName` → `catalog_items.game_ref` → slug
> (the join key is already in `/v2/items` `gameRef`, just newly stored). Scan = ground truth for owned
> qty (`source='de_scan'`, reviewable diff first, manual rows preserved). Endpoint host/path + byte
> signatures must be lifted from `warframe-helper`/`warframe-api-helper` and re-verified live — don't
> hardcode from memory. macOS stays manual/listings-only (SIP). Listings import (`WFM_ACCOUNT_SIGNIN`)
> remains the safe default; this is the power-user lane.
