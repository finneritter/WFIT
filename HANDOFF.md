# WFIT — Session Handoff (2026-05-31)

This session took WFIT from **planning-only** (empty `src/` + `src-tauri/` trees) to a **working
first implementation of the full approved plan** that runs end-to-end against the live
warframe.market API. Committed as `aea3e4f` on branch `feat/initial-app-implementation`
(off `main`); not yet pushed.

> Read this with `.claude/plans/i-just-added-the-noble-widget.md` (the build roadmap) and `CLAUDE.md`
> (hard constraints). Those remain authoritative; this doc records what was actually built and the
> sharp edges hit along the way.

---

## TL;DR — current state

- **All 5 build phases implemented**: scaffold → DB layer → market.rs (v2) + domain → command surface
  + launch orchestration → frontend (9 screens). 23 Rust files, 21 TS/TSX files.
- **Verified green**: `npx tsc --noEmit`, `npm run build`, `cargo check` (0 errors), `cargo test`
  (2/2), `cargo clippy` (0 warnings), **and a live `tauri dev` run**.
- **Live run proof**: app boots → migrates DB → fetches catalog (**2573 items**) → background price
  drain populates real 90-day history (`price_cache` + thousands of `price_history` rows).
- **One required env var on this box** to run the GUI (Wayland/WebKitGTK) — see "Running it" below.
- **Not yet done**: visual click-through of the 9 screens; `git push`; Pass-B set composition run;
  Tier-2 JWT path exercised; macOS build.

---

## Running it

Plain `npm run tauri dev` **crashes instantly on this machine** with:

```
Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display.
```

This is the known **WebKitGTK-on-Wayland renderer bug**, NOT an app bug — the Rust had already
logged `opening database` → `launch: refreshing catalog` before the window blew up; the crash takes
the process and the vite dev server down with it (the `write EPIPE` noise is a symptom, not a cause).

**Use the wrapper script that bakes in the fix:**

```bash
npm run tauri:dev      # = WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 tauri dev
```

If it still misbehaves, also try `GDK_BACKEND=x11` (XWayland). `npm run dev` (frontend only) and
`npm run build` need none of this.

**Prereq already satisfied here:** `webkit2gtk-4.1` (2.52.3) is installed. A fresh machine needs it
(`sudo pacman -S webkit2gtk-4.1` on CachyOS) before any Tauri build.

---

## What was built

### Backend — `src-tauri/src/`
- `migrations/0001_init.sql` — full schema, **13 tables** (catalog_items, price_cache, price_history,
  inventory_items, sale_events, watchlist, buy_list, set_membership, wfm_account, market_listings,
  app_meta, app_settings, + sqlite_sequence). `category` is NOT NULL with the 5 design values;
  `set_slug` is deliberately **not** a FK (prior attempt's lesson).
- `market.rs` — warframe.market client: v2 `/items` catalog, v1 `/items/<slug>/statistics`
  (real 90-day median/volume → trend/delta_7d/volume_7d + history), v2 detail (Pass B), v1 profile
  orders. One global 350ms throttle (`throttled()`), headers per CLAUDE.md.
- `worldstate.rs` — **isolated** api.warframestat.us client (own throttle + 45s in-memory cache,
  degrades to stale on failure). Powers Rotation. Never touches the market path.
- `wfm_account.rs` — JWT in OS keychain via `keyring` (never in SQLite).
- `domain/{classify,partname}.rs` — pure: 5-category `category_of`, `part_type_of`,
  `derive_set_slug`, `split_name`. Has the 2 passing unit tests.
- `db/*.rs` — one module per table; transactional writes; `Db` = `Arc<Mutex<Connection>>`.
- `commands.rs` — the full `#[command]` surface (catalog/inventory/sales+undo/watchlist/buylist/
  sets/ducats/trends/prices/detail/worldstate/wfm account+import/sets_refresh).
- `lib.rs` — `AppState{db, market, worldstate}`; on launch spawns `launch_refresh`: catalog if
  empty/stale → priority prices (owned+watchlist) → background drain oldest-first, persisting in
  chunks so the UI sees data early and the 350ms cap is never exceeded.

### Frontend — `src/`
- `lib/{types,api,format}.ts` — TS DTO mirrors of the Rust types, `invoke()` wrappers, presentation
  helpers (tier/glyph/relativeDay/syncedAgo).
- `hooks/queries.ts` — React Query reads + mutations with cross-screen invalidation.
- `components/` — Sidebar, Drawer, AddItems modal, Icon, charts (Spark/MiniArea/BigChart), ui.
- `routes/` — all 9 screens: Inventory, Sets, Trends, Watchlist, BuyList, Listings, Ducats,
  Rotation, SoldHistory.
- `theme.css` — lifted verbatim from `design_handoff_wfit_update1/WFIT Wireframe.html`.

---

## Live-run numbers (this session, partial drain in progress when captured)

`~/.local/share/dev.finn.wfit/wfit.sqlite`:

| metric | value |
|---|---|
| catalog_items | 2573 |
| — by category | arcane 166 · mod 1384 · set 227 · warframe 196 · weapon 600 |
| with real ducats | 715 |
| with heuristic set_slug | 559 |
| price_cache | 120 (drain ongoing) |
| price_history rows | ~8,900 (drain ongoing) |

The full price drain takes minutes (all-mods scope, throttled); these counts grow until it finishes.
Everything except inventory/sales/watchlist/buy_list is a rebuildable cache.

---

## Fixes made during bring-up (don't re-discover these)

1. **`capabilities/default.json` needs `"local": true`.** Without it Tauri 2.x fails the build with
   *"data did not match any variant of untagged enum CapabilityFile"* (F0307).
2. **tsconfig project-references conflict.** `tsconfig.json` referenced `tsconfig.node.json` as a
   composite project with `noEmit` → TS6310. Dropped the `references` and made `tsconfig.node.json`
   a plain non-composite config. (Also turned `noUnusedLocals`/`noUnusedParameters` off to avoid
   brittle churn.)
3. **WebKit/Wayland env var** — see "Running it".

---

## Known gaps / next steps

- **UI not click-tested.** The 9 screens type-check, build, and are wired to working commands, but
  no one has visually exercised add-item / sell / undo / watchlist / set-completion / import in the
  live window. Recommended next: drive the running app through those flows.
- **Committed but not pushed.** All work is in commit `aea3e4f` on branch
  `feat/initial-app-implementation` (`main` is untouched). Push with
  `git push -u origin feat/initial-app-implementation` when ready. Note: `src-tauri/gen/schemas/*`
  (Tauri-generated, regenerated on build) was committed — consider adding `src-tauri/gen/` to
  `.gitignore` and `git rm --cached`-ing it.
- **Pass-B set composition** (`sets_refresh` / `set_membership`) is implemented but not run; Sets
  screen currently uses the `set_slug` heuristic (`quantity_in_set` assumed 1). Run `sets_refresh`
  for authoritative membership.
- **WFM account**: Tier 1 (public username) wired; Tier 2 (pasted JWT) implemented but not exercised
  against a real account. Listings are **read-only in v1** (price-edit/Match/status are deferred).
- **macOS build** must be done on macOS (no webview cross-compile).

---

## Environment notes / gotchas

- **This box's interactive shell has unreliable stdout** (corrupted/duplicated trailing lines).
  Route command output to a temp file and Read it; trust **exit codes** over printed text.
- **Stop the dev server with exact-name kills** (`pkill -x wfit`, `pkill -x node`). Broad
  `pkill -f "vite"` / `pkill -f "tauri dev"` also match the agent's own wrapper shell → exit 144
  (self-kill), which masquerades as a failure.
- **Catalog fetch takes ~30–40s** after launch; poll the DB rather than assuming instant population.

---

## Verification commands (all currently pass)

```bash
# frontend
npx tsc --noEmit
npm run build

# rust (from src-tauri/)
cargo check
cargo test
cargo clippy

# live (from repo root) — needs the env var
npm run tauri:dev
# then inspect: sqlite3 ~/.local/share/dev.finn.wfit/wfit.sqlite 'SELECT COUNT(*) FROM catalog_items;'
```
