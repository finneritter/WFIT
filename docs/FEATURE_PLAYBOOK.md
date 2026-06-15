# WFIT Feature Playbook

**Read this before building any feature.** It encodes how WFIT is actually built so new
work matches the existing app instead of re-inventing patterns or duplicating logic that
later drifts. It is derived from the live code; when code and this doc disagree, fix
whichever is wrong (and update the other). `CLAUDE.md` is the project's hard constraints;
this is the *how-to-add-a-feature* companion.

Golden rule: **reuse the shared helper, don't reimplement it.** Most bugs this project hit
came from two copies of "the same" logic diverging (rank pricing, exclusions, valuation).

---

## A. The universal contracts (every feature touches these)

1. **Rust owns all logic; the frontend renders finished objects.** Transforms (classify,
   partname, pricing, valuation, exclusions, rank math) live in `src-tauri/`. A command
   returns a fully-computed row type; the frontend never re-derives value, rank, or price.
2. **Types mirror 1:1, snake_case.** A Rust struct in `src-tauri/src/types.rs` has a
   matching interface in `src/lib/types.ts` with identical snake_case field names (no serde
   rename). Add a field → update both → `npm run build` typechecks the mirror.
3. **One throttle for warframe.market.** Every market call goes through `market.rs`'s global
   serialized 400ms min-gap (~2.5 req/s); the async lock is held across the wait. Never add a
   second path or "optimize" it into a burst. Worldstate (350ms) and gamescan have their own
   isolated clients — keep them separate.
4. **Clicking an item opens the Drawer, everywhere.** Any row/tile representing an item is
   activatable and calls `onOpen(slug)`. This is a universal affordance, not per-screen.
5. **The topbar search must work on every page that lists rows.** A page that renders rows
   without wiring search is considered incomplete.
6. **Verify means gates green AND it runs.** `cargo test`/`clippy`/`fmt`, `tsc`+`vite build`,
   `biome`. Pricing/valuation changes also need a live-DB spot-check (`sqlite3 $DB`) — most
   pricing bugs were data/integration issues unit tests didn't see.

---

## B. Frontend checklist (a new screen or row-listing tab)

Component shape & mounting:
- [ ] Signature is `MyPage({ onOpen })` (add `onNavigate` only if it links elsewhere; the
      single nav entry point is `App.tsx::navigate(screen, opts?)`).
- [ ] Imported and mounted in `src/App.tsx` under the `screen === "x"` switch; add the
      `ScreenId` in `src/components/Sidebar.tsx` if it's a nav item.

Data layer (`src/lib/api.ts` → `src/hooks/queries.ts`):
- [ ] `invoke()` wrapper in `api.ts` (thin; no logic).
- [ ] React Query hook in `queries.ts` with a key registered in the central `keys` object.
- [ ] Reads use `useQuery`; writes use `useMutation` with **precise** `onSuccess`
      invalidation. Inventory-affecting writes call `invalidateInventoryDerived` (inventory,
      summary, sets, ducats, arcanes, watchlist, buyList, trends, +catalog stale). Value-bearing
      views are also refreshed live by `useLivePriceEvents` on the `prices-updated` event — add
      your key there if the heartbeat should surface it.

Search + filters (the contract in A.5):
- [ ] `SearchSchema<Row>` in `src/lib/searchSchemas.ts` (`text` haystack, `is:` flags,
      `fields` for numeric/enum/text). Register in `PAGE_SCHEMAS` + `PAGE_PLACEHOLDER` for a
      full screen.
- [ ] Component: `const search = usePageSearch(); const { test } = useMemo(() =>
      compileQuery(search, schema), [search]); rows.filter(test)`. A tab inside a screen
      compiles its own schema against `usePageSearch()` (e.g. Listings "Recommended").
- [ ] Non-text axes (category, sort) use `Chip` rows (`.mkt-filters`, Market-style: All ·
      Warframe · Weapon · Set · Mod · Arcane) and/or `Dropdown` — not bespoke controls.

Rendering (reuse primitives from `src/components/ui.tsx`, never hand-roll markup):
- [ ] Item cell = `ItemName` (glyph + name + sub + `ItemTags`). Row = `<tr {...rowAction(()
      => onOpen(r.slug))}>`; interactive cells `stopPropagation` so buttons don't open the drawer.
- [ ] Table = `<table className="dtable">`; sortable headers = `SortTh`; stat band =
      `StatBox` in `.statband`; modals = `Scrim` + `useEscape`.
- [ ] Every `<tbody>` renders `TableStatus` (loading/error/empty) when there are no rows,
      with a specific `emptyText`. Distinguish "nothing yet" from "nothing matches the filter".
- [ ] Numbers via `fmt`/`fmtK`/`pct`; colors via theme classes (`pos`/`neg`/`muted`,
      `t-*` tiers) — avoid inline color styles. Persist view/filter prefs via `usePersisted`.

---

## C. Backend checklist (a new command / data path)

Command surface:
- [ ] `#[tauri::command]` in `src-tauri/src/commands.rs`, first arg `State<'_, Arc<AppState>>`,
      returns `AppResult<T>`. `async` only if it calls `state.market.*` / external I/O.
- [ ] Registered in `src-tauri/src/lib.rs` `generate_handler!`.
- [ ] Real work delegated to a `db/` module function (one module per table/domain). Returns a
      finished `types.rs` row, not raw columns.

DB access (`db/mod.rs`):
- [ ] Hot UI reads use `db.read()` (pooled, query-only — won't block behind a sync). Writes
      use `db.with`/`with_mut`; wrap multi-step writes in a transaction.
- [ ] New table/column → numbered `src-tauri/migrations/000N_*.sql`, append to `MIGRATIONS`,
      **bump `SCHEMA_VERSION`** (a test enforces the match). User data (inventory/sales/
      watchlist/buy_list) is sacred; everything else is a rebuildable cache.

Reuse these shared helpers — **do not reimplement** (this is where logic drifts):
- [ ] **Price of an item at a rank:** `prices::effective_price` (live ask → exact-rank trade
      median → headline). Batched valuation uses `effective_price_from` over `PriceMaps` — it
      is an in-memory **twin** of the SQL and MUST stay identical (a test pins this).
- [ ] **Recommended sell price:** `prices::fair_sell_price` / `fair_from` — undercut the robust
      live low, anchor only to the **same rank's** median (exact match; nearest-rank anchoring
      inflated suggestions, e.g. Primed Animal Instinct r7 → 126 vs the real ~75).
- [ ] **Rank-aware goods:** mods/arcanes are priced **per rank** from `inventory_ranks`. Never
      default a ranked good to rank 0. Own-at-different-ranks = separate goods (the Recommended
      tab even splits them into rows). Use `rank_aware_value_from` for a stack's value.
- [ ] **Realizable (liquidation-adjusted) value:** `inventory::realizable_for` — full market
      value when `qty <= 1` OR it's a prime part (warframe/weapon/set); only multi-copy
      mod/arcane stacks take the demand-curve haircut (`realizable_default`).
- [ ] **Value exclusions:** `inventory::ExclusionRules::load(c)` then `is_excluded(category,
      mod_rarity, median)` — the single rule shared by inventory valuation, recommendations,
      and trends sell-signals. An item excluded in Settings is excluded everywhere.
- [ ] Bump `PRICING_VERSION` in `lib.rs` whenever *cached* price derivation changes
      (`price_cache`/`price_rank`/`order_cache`/`buy_orders`); a launch mismatch wipes and
      recomputes those caches. Realizable value is computed fresh per call — no bump needed.

Domain purity:
- [ ] `domain/` modules are pure (no I/O). Bundled datasets (`mod_rarity`, `arcane`) are
      `.tsv`s loaded into `Lazy` maps, not DB tables.

Tests:
- [ ] Unit-test the new logic with `db::testutil::test_db`. Pin twin/invariant properties
      (SQL ↔ in-memory; single-copy = full value; exclusion drops the right rows). Add a
      regression test when you fix a concrete pricing bug (cite the example in the test).

---

## D. When a change spans the whole app (the consistency rule)

If you change *what an item is worth* or *whether it should be shown/sold*, it must change
**everywhere** that surfaces it: inventory grid, item Drawer (`get_item_detail`), summary,
trends sell-signals, listing recommendations, and arcanes where relevant. The mechanism is
the shared helper (Section C) — fix the helper once, not each call site. If you find a second
copy of a rule, collapse it into the helper. The Drawer and the grid disagreeing on the same
number reads as a bug to the user.

---

## E. Pointers

- Hard constraints, schema, pricing model: `CLAUDE.md` (read first).
- Current running state: `docs/HANDOFF.md`.
- Data contract / endpoints: `docs/DATA_SOURCING_MASTER_PLAN.md`.
- Valuation economics: `docs/PERF_OPTIMIZATION.md`, `docs/CLAUDE_ECONOMIC_RESEARCH/` (historical).
- Design target: `reference/design_handoff_wfit_update1/`.
- Representative code to copy patterns from: `src/routes/Inventory.tsx` (filters/views),
  `src/routes/Listings.tsx` (tabs + Recommended), `src/db/prices.rs` + `src/db/inventory.rs`
  (the shared pricing/valuation helpers + their tests).
