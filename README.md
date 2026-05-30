# WFIT — Primely Desktop (Warframe Inventory Tracker)

Fresh start for the **desktop rewrite** of Primely: a Tauri (Rust core + web frontend) + local SQLite
Warframe prime-part inventory & sales tracker. Replaces the old React/Vite + Supabase webapp
(repo: `../wfinv`), which is kept only as reference.

## Start here

1. **[`DESKTOP_REWRITE_PRD.md`](./DESKTOP_REWRITE_PRD.md)** — the plan. Stack decision, target
   architecture, full SQLite schema, the warframe.market port spec, a command-by-command
   hook→Tauri mapping, and a suggested build order. Read this first.
2. **[`DATA_SOURCING_MASTER_PLAN.md`](./DATA_SOURCING_MASTER_PLAN.md)** — the data contract.
   warframe.market is the **single source of truth** for everything (catalog, names, thumbs, ducats,
   vault status, set composition, prices). Lists the three endpoints and what each really returns
   (verified live 2026-05-30): the list gives slug/tags/names/thumbs/**real ducats**, but vault
   status and set composition need per-item detail calls. Read this before touching `market.rs`.
3. **[`design/`](./design/)** — the Claude-tool UI design output (`Primely Dashboard.html`,
   `primely.jsx`, `tweaks-panel.jsx`). This is the visual target for the frontend.

## `reference/` — source material from the old webapp (to port, not to copy verbatim)

| Path | What it is | Why it's here |
|---|---|---|
| `reference/migrations/*.sql` | Old Supabase Postgres schema (0001 init, 0002 drop FK, 0003 add category) | Source of truth for the SQLite schema in PRD §4. Strip `user_id`/RLS/`auth.users`. |
| `reference/market-proxy/index.ts` | The Deno edge function that calls warframe.market | **The single most important port** — `catalog_refresh` + `prices_refresh` logic becomes `market.rs`. See PRD §5.1. Note the v1-stats-not-v2 gotcha + 350ms throttle. |
| `reference/domain-logic/partname.ts` | Name parsing (`splitName`, `categoryFor`) | Pure logic → `partname.rs`. Low risk. |
| `reference/domain-logic/derive.ts` | Synthetic sparkline + delta generators | Pure logic → `derive.rs`. **These are placeholders** — PRD §8 suggests storing real 90d history instead. |
| `reference/domain-logic/parts.ts` | Catalog/inventory row → `PartItem` assembly | → `parts.rs`. |
| `reference/domain-logic/types.ts` | `PartItem` + `Category` types | Shape of what Rust commands return to the frontend. |
| `reference/domain-logic/database.types.ts` | Hand-maintained TS schema types | Cross-check for the schema. |
| `reference/prior-tauri-attempt/` | An earlier Tauri scaffold (`Cargo.toml`, `migrations/`, `src/`, `icons/`, `build.rs`) | Starting reference for the new `src-tauri/` — crates, config, icons may be reusable. |
| `reference/CLAUDE.old-project.md` | Old project's CLAUDE.md | Background/context on the original app and its constraints. |
| `reference/HANDOFF.old.md` | Old single-page project entry point | Background. |
| `reference/original-webapp-PRD.md` | The webapp's original PRD | Background on intended features. |
| `reference/research-findings.md` | warframe.market / auth research | Background; why there's no game-account auth. |
| `reference/current-scope.md` | Scope notes from the webapp | Background. |

## What's intentionally NOT carried over

- All of Supabase: auth (single local user), hosted Postgres (→ SQLite), the CORS edge-function
  proxy (Rust calls the API directly — no CORS in a desktop app), and the deploy pipeline.
- `SignIn` / auth UI and any `!user` redirects.

## Next step

Scaffold with `npm create tauri-app@latest` (React + TS + Vite), then follow PRD §7 build order:
DB layer → domain ports → `catalog_refresh` → read commands → write commands → frontend cleanup.

Two decisions to make before scaffolding (PRD §8): **sqlx vs rusqlite** (recommend sqlx) and
**domain transforms in Rust-only** (recommended) vs duplicated in TS.
