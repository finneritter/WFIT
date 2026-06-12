# WFIT roadmap: features, optimizations, layout, cross-platform

A consolidated, opinionated plan for what to build next. Grounded in a full sweep of the
current codebase (11 screens, the Rust core, the docs). Items are tagged with a rough
effort (**S** ≤ half-day, **M** 1–3 days, **L** ≥ several days) and ordered within each
section by value-for-effort. Nothing here is started unless it says "DONE".

> Context: the app is feature-complete for its core scope. There are **zero** TODO/FIXME
> markers in the code — all deferred work lives in design docs and is a deliberate gate, not
> an oversight. So this roadmap is about *extending* a solid base, not patching holes.

---

## 0. Just completed (this session)

- **DONE — Arcanes: liquidity-adjusted Vosfor EV.** The collection EV now values each arcane
  as *one unranked copy sold into live rank-0 demand* (realizable curve) instead of its raw
  median, and the sell-vs-dissolve decision is rank-0-filtered (maxed bids no longer leak in).
  Live probe confirmed the implied rate fell 0.091 → **0.033 p/vf** and owned arcanes now flip
  toward "sell". Files: `db/prices.rs::bid_ladders_for_rank`, `db/inventory.rs::realizable_value_default`,
  `db/arcanes.rs`, `routes/Arcanes.tsx` caption. (Plan: `arcanes-liquidity-vosfor-fix.md`.)

---

## 1. New features

### 1a. Dashboard / portfolio home screen — **M** — *highest value*
There is no landing screen; the app opens straight into Inventory. Portfolio health is
scattered (sidebar "Quick Read", per-screen topbar totals, Trends heatmap). Add a **Home**
screen that aggregates the answer to "what's my situation and what should I do?":
- Realizable portfolio value + 7d/30d delta, optimistic-vs-realizable spread.
- Top earners / biggest movers (reuse Trends signals).
- Actionable callouts: items at watch target, listings that are now underpriced vs market,
  recommended arcane dissolves, biggest hoards collapsing to ~0 realizable.
- "Next action" strip pulling from Watchlist + Buy List + Listings.
Everything it needs already exists in backend commands — this is mostly a composition screen.
Pairs naturally with the nav regrouping in §3.

### 1b. Arcane "potential maxed value" column — **S**
Flagged in `HANDOFF.md` and the arcane plan's caveat. Some arcanes (e.g. Secondary Shiver)
are near-worthless unranked but 60–100p maxed (needs 21 fused copies). Add a muted reference
column / drawer note showing the maxed price and copies-to-max, so the "dissolve" verdict on a
high-ticket arcane reads as informed rather than blind. Data (`maxed` map) is already loaded in
`db/arcanes.rs::owned`; it's display-only. Do **not** let it drive the recommendation.

### 1c. Real price-history table (replace synthetic OHLC) — **M**
Today the 90d sparkline/candles are *derived* synthetically. The `/v1/items/<slug>/statistics`
endpoint already returns a real 90d series; store it in a `price_history`-style table and read
from it. Improves every chart and the z-score/trend signals. Noted as a "recommended early
follow-up" in the data-sourcing PRD. Backfill via the existing heartbeat tail.

### 1d. Farmable-now (relic → part) view on Rotation — **L**
The most-requested-shaped feature that's explicitly v2+: cross fissure rotations with relic
drop tables to answer "which active fissure drops a part I want/own-to-sell". Needs a **third**
data source (relic→reward tables, e.g. WFCD) bundled like the arcane/rarity TSVs. Large because
of the data pipeline, but high utility and a natural fit for the Rotation screen.

### 1e. Desktop notifications — **S–M**
The watchlist already computes "at target"; the heartbeat already emits events. Wire a Tauri
notification when (a) a watched item hits target, (b) Baro/Varzia arrives, (c) a listing of
yours becomes underpriced. Off by default, per-type toggles in Settings.

### 1f. Pass-B exact set composition — **S–M**
Set membership currently uses the `set_slug` heuristic. `GET /v2/items/<slug>` exposes exact
`setParts`/`setRoot`; fetch + cache it so Sets is precise (matters for oddball sets). One
fetch path + batching; gated until now because Sets has shipped.

---

## 2. Optimizations

The backend perf pass is already thorough (read pool, N+1 collapse 2000→7 queries, in-memory
pricing twins, tuned pragmas). Remaining items are smaller:

### 2a. True row virtualization for flat tables — **S–M**
`Sold History` and `Ducats` are flat tables relying on `content-visibility: auto`. For very
long lists, `@tanstack/react-virtual` would hard-cap DOM nodes. Deferred deliberately; only
worth doing if those lists grow large in practice. Measure first.

### 2b. Heartbeat coalescing / backoff — **S**
The 45s heartbeat is fine, but consider pausing it when the window is hidden/unfocused (Tauri
focus events) to cut idle warframe.market traffic, and a gentle backoff when the API errors.
Low risk, saves request budget.

### 2c. Verify in-memory pricing twins stay in lockstep — **S** (hygiene)
`effective_price_from`/`rank_aware_value_from` must stay byte-identical to their SQL originals.
Add a small test that runs both paths over a fixture DB and asserts equality, so a future price
change can't silently desync them. Cheap insurance for the most-iterated subsystem.

---

## 3. Menu / layout reorganization

The nav is a **flat list of 12 items** (`components/Sidebar.tsx`). It works but has no
information architecture, and several screens overlap in purpose. Recommended changes:

### 3a. Group the sidebar into sections — **S** — *do this first*
Collapsible groups instead of a flat list:
- **Home** (new, §1a)
- **Portfolio** — Inventory · Sets · Arcanes · Ducats
- **Trading** — Listings · Sold History · Market
- **Planning** — Watchlist · Buy List · Trends
- **World** — Rotation
- **Settings** (pinned bottom, already is)
Pure frontend; nav is a static array today, so this is a small, high-clarity win.

### 3b. Make Sets an Inventory view, not a separate screen — **S–M** (optional)
Sets is effectively Inventory filtered to set completion. Consider folding it into Inventory as
a view mode (grid / chips / list / **sets**), shrinking the nav. Judgment call — keep separate
if you like the dedicated surface.

### 3c. Consolidate listing CRUD — **S–M**
Listing create/edit happens in two places: the Listings screen *and* nested inside the item
Drawer. Pick the Listings screen as the source of truth and make the drawer form a thin
shortcut (or read-only with a "manage in Listings" link) to remove the nested-modal-in-drawer
cramping.

### 3d. Surface Inventory view prefs as a toolbar — **S**
Sort / view / tile-size / label-density are buried in dropdowns. A persistent inline toolbar
(they're already localStorage-persisted) makes current state visible at a glance.

### 3e. Rotation "what's happening now" lead widget — **S**
Rotation is dense (3 tabs, ticking countdowns). Add a single lead strip — next reset, hottest
active fissure, live Baro/invasion — above the detailed grid so the "what do I do right now"
answer is immediate.

---

## 4. Windows support for the game scan — **M** (~1.5–2 days incl. live test)

The `gamescan` module is Linux-only today but **~70% of it is already portable**. The protocol
(memory signature `accountId=<24 hex>&nonce=<digits>`, the `mobile.warframe.com/api/inventory.php`
endpoint, the DE-JSON→slug mapping in `map.rs`, consent in `consent.rs`) is platform-agnostic.
Only two files are Linux-specific:

| Linux today | Windows equivalent |
|---|---|
| `process.rs`: scan `/proc/*/comm` for the Warframe process | `CreateToolhelp32Snapshot` + `Process32First/Next`, match `szExeFile` |
| `process.rs`: read `/proc/sys/kernel/yama/ptrace_scope` | no equivalent — just try `OpenProcess(PROCESS_VM_READ)` and fail gracefully |
| `memory.rs`: parse `/proc/<pid>/maps` for regions | `VirtualQueryEx` loop over `MEMORY_BASIC_INFORMATION` |
| `memory.rs`: `read_at` on `/proc/<pid>/mem` | `OpenProcess` + `ReadProcessMemory` (keep the handle open, reuse the 1 MiB-chunk scan logic) |

**Plan:**
1. Introduce a small `PlatformScanner` trait (`find_process` + `read_memory(addr, buf)`),
   refactor the existing Linux code behind a `#[cfg(target_os = "linux")]` impl.
2. Add a `#[cfg(target_os = "windows")]` impl using the `windows` crate
   (`Win32::System::Diagnostics::ToolHelp`, `Win32::System::Memory`,
   `Win32::System::Threading`). RAII-wrap the process `HANDLE` so it's always closed.
3. Update `mod.rs::is_supported()`/cfg fallbacks to include Windows.
4. **Live-test on a real Windows box with Warframe running** — this is the only real risk:
   the heap session string should be present (same as Linux), but layout differs, so budget
   debugging time. May require `SeDebugPrivilege` / running WFIT elevated if the game runs as a
   different user; detect access-denied early and surface a clear message.

Difficulty: **medium**, not large — no new reverse-engineering, just swapping the OS memory
primitives. The current `#[cfg]` structure already makes room for it. Same effort would also
get a **macOS** scan if wanted (`task_for_pid` + `mach_vm_read`), but that needs the hardened-
runtime / entitlement song-and-dance and is genuinely harder — defer unless the Mac laptop
needs it.

---

## 5. Cross-platform builds (non-scan)

The Rust core and React UI are platform-agnostic; only the scan and a few env-var launch
hacks are Linux-specific.

- **macOS build — S–M.** Code is portable; needs `tauri build` *on* macOS (no cross-compile),
  keychain path verification, and a smoke test. The repo is already worked from a Mac laptop,
  so this may be close.
- **Windows build — S–M.** Same: `tauri build` on Windows, verify keychain (Windows Credential
  Manager via the `keyring` crate), and the `npm run tauri:dev` env-var wrapper is Linux/WebKitGTK
  specific — Windows uses WebView2, so the dev script needs a platform branch.

---

## 6. Recommended sequencing

A sensible order that front-loads clarity and low-risk wins:

1. **§3a** nav grouping + **§1a** Dashboard (biggest UX uplift, mostly composition). **M**
2. **§1b** arcane maxed column + **§2c** pricing-twin test (cheap, closes loops you just touched). **S**
3. **§1c** real price history (improves every chart + signal). **M**
4. **§4** Windows scan port + **§5** Windows build (the explicit ask; do together). **M**
5. **§1e** notifications, **§3c–e** layout polish (nice-to-haves). **S–M**
6. **§1d** farmable-now relic view (largest, most data work — schedule when the above lands). **L**

---

*Authored after a full codebase sweep (gamescan internals, frontend IA, feature/perf survey).
Effort tags are estimates; validate each against the relevant doc in `docs/` before starting —
most of these reference an existing design note that already nailed down the hard decisions.*
