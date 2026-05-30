# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

wfinv ("Primely") is a Warframe prime-part inventory + sales tracker. React/Vite frontend, Supabase (Postgres + Auth + Edge Functions) backend, warframe.market for pricing. Manual inventory entry — there is no game-account auth (every third-party path was tested and is dead; do not propose auth-based inventory import).

## Commands

- `npm run dev` — Vite dev server on http://localhost:5173 (strict port; needs `.env.local`, see below)
- `npm run build` — `tsc --noEmit` typecheck **then** Vite build. This is the only check that exists — run it after changes.
- No test runner and no linter/formatter are configured. "Verifying" means `npm run build` passes and, when it matters, running the app.

## Environment

`.env.local` is required (gitignored) — copy `.env.example` and fill from Supabase dashboard → Project Settings → API:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Architecture

- `src/lib/` — core: `supabase.ts` (client + `marketProxy()` edge-function caller), `auth.tsx` (`AuthProvider` + `useAuth`, magic-link + Google OAuth), `database.types.ts` (hand-maintained — update it when the schema changes), `parts.ts`/`partname.ts` (catalog/inventory row → `PartItem`), `types.ts`, `derive.ts`.
- `src/hooks/` — React Query data hooks (`useInventory`, `useCatalogSearch`, `useSummary`, `useSales`, `useWatchlist`). All server state goes through React Query; mutations invalidate the relevant query keys (`inventory`, `summary`, `sales`, `catalog_search`).
- `src/routes/` — pages; `src/components/` — UI. Styling is Tailwind + CSS variables in `src/theme.css`.

### Supabase data model
- Shared, public-read (authenticated), service-role-write only: `catalog_items`, `price_cache`. Written exclusively by the `market-proxy` edge function.
- Per-user, RLS `auth.uid() = user_id`: `inventory_items`, `sale_events`. Mutated via RPCs `add_to_inventory`, `record_sale`, and `inventory_summary`.
- PostgREST embeds need a real FK. `inventory_items` has no FK to `price_cache` (both only reference `catalog_items`), so embed price **nested under `catalog_items`**, not as a sibling — a sibling embed fails with `PGRST200`.

### market-proxy edge function (`supabase/functions/market-proxy/`, Deno)
- Actions: `catalog_refresh` (warframe.market `/v2/items`, filter `tags.includes("prime")`) and `prices_refresh` (legacy `/v1/items/<slug>/statistics` — v2 stats 404s). Category comes from item `tags` (`warframe`/`weapon`/…).
- It's a public CORS proxy; it MUST be deployed with `--no-verify-jwt`.

## Deploy gotchas (important — easy to get wrong)

- **Edge-function changes are NOT live until deployed.** GitHub auto-deploy (`.github/workflows/deploy-supabase.yml`) is currently broken — the `SUPABASE_ACCESS_TOKEN` repo secret is unset, so its runs fail. Deploy manually: `supabase functions deploy market-proxy --no-verify-jwt --project-ref mpgcusphzngmvyscdiky` (or use `/deploy-edge`). After deploying, backfill data with a `catalog_refresh` / `prices_refresh` call if needed.
- **Migrations are never auto-deployed** (deliberate). Add `supabase/migrations/NNNN_*.sql` and apply with `supabase db push`.

## Git workflow

Solo project — commit and push straight to `main`. Pushing changes under `supabase/functions/**` triggers the (currently failing) deploy workflow; deploy edge functions manually instead.
