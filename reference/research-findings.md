# Warframe Inventory Pricer — Research Findings & Auth Reference

Companion document to the PRD. Consolidates research into existing tools and the
account-auth / inventory-fetch problem, so the implementation can **port from working
references instead of reverse-engineering from scratch.**

Intended reader: Claude Code (and the project owner).

---

## TL;DR

- Getting your in-game inventory by authenticating to DE's live servers **is feasible** — there is a recently maintained tool that does exactly this (`Sainan/warframe-api-helper`, last release Aug 2025).
- The earlier "auth is unverified" risk is now substantially reduced. The work is a **porting job** (read the working request format, reimplement in our language), not blind reverse-engineering.
- The clearest *documentation* of the login + inventory API surface is OpenWF's `SpaceNinjaServer` — a source-available reimplementation of DE's web services.
- Item-path → human-name resolution is solved by `WFCD/warframe-items`.
- warframe.market pricing was already confirmed working in the PRD.

The remaining risk is operational, not existential: matching the current request format (especially the build label) and handling 2FA. Plus the unchanged ToS / session-conflict constraints.

---

## 1. Tool landscape (sorted by what each ACTUALLY does)

### A. Live account inventory download — the thing we want
**`Sainan/warframe-api-helper`** — https://github.com/Sainan/warframe-api-helper
- Purpose: manually download your Warframe inventory from **live servers**.
- Language: C++ (depends on Sainan's `Soup` library, vendored as a submodule).
- Status: maintained; latest release 1.1.1, August 2025.
- License: MIT + Commons Clause (free to use/modify; cannot be sold).
- **Why it matters:** `main.cpp` is the current, working reference for the live login
  handshake and the inventory request. We won't link against it (C++), but we read it to
  copy the exact request shape into our own language.
- The "manually" / on-demand design (no background polling) is the lower-risk usage pattern; mirror it.

### B. API reference implementation — best documentation of login + inventory format
**OpenWF `SpaceNinjaServer`** — https://github.com/spaceninjaserver/SpaceNinjaServer
- A source-available reimplementation of Warframe's web services (TypeScript/Node, MongoDB).
- Built for **offline** play, NOT live servers — but it must mirror DE's real API, so its code
  is effectively the spec for how login and the inventory endpoint behave and what every
  inventory field means.
- Read the documented subsystems: "Login and Account System" and "Inventory Management
  System." DeepWiki is the readable view: https://deepwiki.com/spaceninjaserver/SpaceNinjaServer
- **Use it to:** understand why a login request is rejected, and decode the returned inventory JSON schema.
- **ToS nuance:** OpenWF's "no one got banned" claim applies only to playing offline against
  custom servers. Pointing the same login flow at LIVE servers (what our tool does) is the
  grey-area part. Reading the code is safe; how we use it carries the risk.

### C. Market-side only — does NOT read in-game inventory (don't be misled)
**`RafaFischerReichert/Warframe-API`** — https://github.com/RafaFischerReichert/Warframe-API
- A Tauri app that logs into **warframe.market** (not the game account) and scans all prime
  items from the public market API for trading opportunities.
- It does NOT retrieve what *you* own in-game.
- Still useful as: a Tauri + warframe.market client reference, and as a model for a fallback
  product ("scan all primes" rather than "scan my inventory").

### D. Item metadata / resolver layer
**`WFCD/warframe-items`** (`@wfcd/items` on npm) — https://github.com/WFCD/warframe-items
- Fetches every item from Warframe's mobile API endpoints, including unique in-game names
  (`/Lotus/Weapons/Tenno/...`), images, drop rates.
- This is the mapping needed to turn cryptic inventory item paths into human names and to
  detect which items are tradeable prime parts.
- Pairs with DE **Public Export** (origin/content `warframe.com/PublicExport/...`) for ducat
  values and freshest manifest data.

**`WFCD/warframe.py`** — https://github.com/WFCD/warframe.py
- Async Python wrapper, primarily worldstate (and later warframe.market). Not inventory.
  Listed for completeness.

### E. Relic-only fallback
**AlecaFrame stats API** — https://stats.alecaframe.com/api/swagger/index.html
- Exposes a user's relic inventory via a user-generated public token.
- Relics only (not full prime parts) and requires the user to run AlecaFrame (Windows/Overwolf).
- Last-resort fallback only.

---

## 2. The auth flow — what's known and the likely failure modes

The login is the blocker. With working references now in hand (Section 1A/1B), diagnosis is
tractable. Diff our request against Sainan's `main.cpp` (live behavior) and SpaceNinjaServer's
login handler (expected format). The usual culprits, in rough order of likelihood:

1. **Stale or missing build label.** The login request must carry a current game
   version/build label. If missing or outdated, the server rejects it. This moves with every
   game update, so it's the most common and most annoying failure. Need a strategy to obtain a
   current build label (e.g. read it from a reference source / the client).
2. **Wrong password transform.** DE expects the password hashed a specific way before it hits
   the endpoint. SpaceNinjaServer's login code shows exactly what transform is expected.
3. **Missing required fields** in the login payload (timestamps, platform, language, etc.).
4. **Unhandled 2FA step.** If the account has email 2FA, the first call returns a challenge
   state and a second request must submit the emailed code. The flow is two-step, not one.
5. **Bot protection / required headers** (User-Agent and similar). Match what the references send.
6. **Wrong endpoint host.** Confirm the current login host from the references rather than
   assuming an old one.

**Action for debugging:** capture the exact HTTP status and response body on failure and map it
to the list above before changing anything.

---

## 3. Recommended implementation path

1. **Port, don't reverse-engineer.** Treat `Sainan/warframe-api-helper` as the authoritative
   live-request reference and SpaceNinjaServer as the schema/spec. Reimplement the login +
   inventory fetch in the project's language (Rust core if Tauri; Swift if native macOS).
2. **Phase 0 spike (still the gate).** Smallest possible script that authenticates against live
   servers with a real test account, handles a 2FA challenge, and prints the raw inventory JSON.
   Build it directly from the reference request format. Exit criterion: real inventory JSON from
   a real account.
3. **Resolve items** with `WFCD/warframe-items` + Public Export (paths → names, prime flag, ducats).
4. **Price** via warframe.market v1 (median from statistics; throttle ~3 req/s; cache).
5. **Aggregate + rank + render** per the PRD and the approved mockup.

If Phase 0 still cannot be made to work (e.g. a hard 2FA/bot wall), fall back to **manual /
file import** (PRD Section 9, Fallback A) — the pricing + UI pipeline is identical regardless of
where the inventory JSON comes from, so build against a typed inventory interface.

---

## 4. Hard constraints (unchanged — carry into implementation)

- **Session conflict:** a companion-style account session cannot coexist with an active game
  session; one gets kicked. This is an **out-of-game tool**. Detect and surface login conflicts;
  do not attempt a live in-game overlay.
- **ToS grey area:** direct account auth by third-party software is the risky part (AlecaFrame
  avoids it via Overwolf). Keep strictly **read-only** — no writes, trades, or foundry actions.
  Show a one-time "unofficial, use at your own risk" acknowledgment.
- **Rate limits:** warframe.market ~3 req/s. Throttle + cache; never re-price on every render.
- **Secrets:** never persist the raw password. Store only the session token, in the OS keychain;
  refresh on expiry.
- **Freshness:** always display `lastSynced`; never present a cached price as live.

---

## 5. References

- Live inventory download (working reference): https://github.com/Sainan/warframe-api-helper
- API reimplementation / spec: https://github.com/spaceninjaserver/SpaceNinjaServer
- SpaceNinjaServer readable docs: https://deepwiki.com/spaceninjaserver/SpaceNinjaServer
- OpenWF project overview: https://about.openwf.io/
- Item metadata / resolver: https://github.com/WFCD/warframe-items
- DE Public Export (Wiki): https://warframe.fandom.com/wiki/Public_Export
- Market-side Tauri reference (NOT inventory): https://github.com/RafaFischerReichert/Warframe-API
- Older protocol reference (validate before trusting): https://github.com/cephalon-sofis/warframe_api
- warframe.market API docs: https://warframe.market/api_docs
- Relic-only fallback (AlecaFrame stats): https://stats.alecaframe.com/api/swagger/index.html
